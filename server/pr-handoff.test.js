import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { verifyPrHandoff } from "./pr-handoff.js";

const exec = promisify(execFile);
async function git(cwd, ...args) { await exec("git", args, { cwd }); }

test("prepares, but never executes, the final GitHub PR commands after a passing trusted test", async () => {
  const repo = await mkdtemp(join(tmpdir(), "bugreel-pr-"));
  await git(repo, "init", "-b", "demo-branch");
  await git(repo, "config", "user.email", "test@bugreel.local");
  await git(repo, "config", "user.name", "BugReel Test");
  await git(repo, "remote", "add", "origin", "https://github.com/example/demo.git");
  await writeFile(join(repo, "example.txt"), "before\n");
  await git(repo, "add", "example.txt");
  await git(repo, "commit", "-m", "initial");
  await writeFile(join(repo, "example.txt"), "after\n");
  let checked = false;
  const receipt = await verifyPrHandoff({
    repoPath: repo,
    testCommand: "node --eval \\\"process.exit(0)\\\"",
    title: "Fix example",
    runTest: async () => { checked = true; return { code: 0, stdout: "ok", stderr: "" }; }
  });
  assert.equal(checked, true);
  assert.equal(receipt.status, "pr_ready_for_human_review");
  assert.equal(receipt.repositoryUrl, "https://github.com/example/demo");
  assert.deepEqual(receipt.changedFiles, ["example.txt"]);
  assert.match(receipt.nextCommands.push, /git push/);
  assert.match(receipt.nextCommands.createPullRequest, /gh pr create/);
  assert.match(receipt.boundary, /did not push/i);
});

test("refuses a PR handoff when the regression still fails", async () => {
  await assert.rejects(
    verifyPrHandoff({ repoPath: process.cwd(), testCommand: "npm test", runTest: async () => ({ code: 1 }) }),
    /regression command still fails/
  );
});
