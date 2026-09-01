#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { sampleInvestigation, SAMPLE_FAILURE } from "../src/sample.js";
import { fetchGitHubRepository, parseGitHubRepo, readLocalRepository, renderCli, runInvestigation } from "../server/bugreel.js";

const args = process.argv.slice(2);
const options = parseArgs(args);

if (options.help) {
  console.log(`BugReel hunts a failure through a repository with GLM-5.3 Flash.

Usage:
  bugreel --sample
  bugreel --repo . --run "npm test" --server http://127.0.0.1:8787
  bugreel --repo . --failure-file ./failure.log
  bugreel --repo https://github.com/owner/repo --failure-file ./failure.log

Options:
  --sample              Replay the bundled grounded fixture
  --repo <path|url>     Local checkout or public GitHub repository
  --run <command>       Run a trusted local test command and capture its failure
  --failure-file <path> Existing failing test, stack trace, or error log
  --server <url>        Add the completed diagnosis to a running BugReel team queue
  --expected <text>     Expected behavior
  --deep                Run three independent model passes instead of Fast Hunt
  --json                Emit the shared investigation artifact as JSON
  --help                Show this help

Local source is sent to OpenCode Go only when you run a live hunt.`);
  process.exit(0);
}

let investigation;
let capturedFailure = "";
let importedJobId = "";
if (options.sample || (!options.repo && !options.failureFile && !options.testCommand)) {
  investigation = sampleInvestigation;
} else {
  if (!options.repo || (!options.failureFile && !options.testCommand)) throw new Error("--repo requires either --run or --failure-file.");
  if (options.failureFile && options.testCommand) throw new Error("Use either --run or --failure-file, not both.");
  if (options.testCommand && /^https:\/\/github\.com\//.test(options.repo)) throw new Error("--run requires a trusted local checkout, not a public repository URL.");
  if (options.testCommand) {
    const captured = await runTestCommand(options.testCommand, resolve(options.repo));
    if (captured.code === 0) {
      console.log("BugReel found no failure. The test command passed, so no investigation was created.");
      process.exit(0);
    }
    capturedFailure = `${captured.stdout}\n${captured.stderr}`.trim().slice(-30_000);
  } else {
    capturedFailure = (await readFile(resolve(options.failureFile), "utf8")).slice(-30_000);
  }
  if (options.server) importedJobId = await publishIntake(options.server, options.repo, capturedFailure);
  const input = { failure: capturedFailure || SAMPLE_FAILURE, expected: options.expected || "", repoUrl: options.repo };
  let repository;
  if (/^https:\/\/github\.com\//.test(options.repo)) {
    const parsed = parseGitHubRepo(options.repo);
    repository = await fetchGitHubRepository(parsed);
  } else {
    repository = await readLocalRepository(options.repo);
  }
  try {
    investigation = await runInvestigation(input, repository, { strategy: options.deep ? "deep" : "fast" });
  } catch (error) {
    if (options.server && importedJobId) await publishImportError(options.server, importedJobId, error.message);
    throw error;
  }
}

if (options.server && importedJobId) await publishInvestigation(options.server, importedJobId, investigation);

console.log(options.json ? JSON.stringify(investigation, null, 2) : renderCli(investigation));

function parseArgs(values) {
  const result = { sample: false, deep: false, json: false, help: false, repo: "", failureFile: "", testCommand: "", server: "", expected: "" };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--sample") result.sample = true;
    else if (value === "--deep") result.deep = true;
    else if (value === "--json") result.json = true;
    else if (value === "--help" || value === "-h") result.help = true;
    else if (["--repo", "--run", "--failure-file", "--server", "--expected"].includes(value)) {
      const target = { "--repo": "repo", "--run": "testCommand", "--failure-file": "failureFile", "--server": "server", "--expected": "expected" }[value];
      result[target] = values[++index] || "";
    } else throw new Error(`Unknown argument: ${value}`);
  }
  return result;
}

function runTestCommand(command, cwd) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, { cwd, shell: true, env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-30_000); });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-30_000); });
    child.on("error", rejectPromise);
    child.on("close", (code) => resolvePromise({ code: Number(code ?? 1), stdout, stderr }));
  });
}

async function publishIntake(server, repo, failure) {
  const endpoint = `${String(server).replace(/\/$/, "")}/api/imports`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state: "intake", repo, failure })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "BugReel could not add the investigation to Team View.");
  console.error(`Captured ${payload.id} in BugReel Team View.`);
  return payload.id;
}

async function publishInvestigation(server, id, artifact) {
  const endpoint = `${String(server).replace(/\/$/, "")}/api/imports/${id}`;
  const response = await fetch(endpoint, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ investigation: artifact })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "BugReel could not update the Team View investigation.");
  console.error(`Updated ${payload.id} in BugReel Team View.`);
}

async function publishImportError(server, id, message) {
  const endpoint = `${String(server).replace(/\/$/, "")}/api/imports/${id}`;
  await fetch(endpoint, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ error: `GLM resolution stopped: ${String(message).slice(0, 180)}` })
  }).catch(() => {});
}
