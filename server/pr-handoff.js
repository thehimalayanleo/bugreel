import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

function safeTitle(value, fallback) {
  const title = String(value || "").replace(/[\r\n]/g, " ").trim().slice(0, 120);
  return title || fallback;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\\"'\\\"'")}'`;
}

async function git(repoPath, args) {
  try {
    const { stdout } = await execFile("git", args, { cwd: repoPath, maxBuffer: 120_000 });
    return String(stdout).trim();
  } catch (error) {
    const detail = String(error.stderr || error.message || "git command failed").trim();
    throw new Error(`Trusted checkout check failed: ${detail}`);
  }
}

function githubRemote(remote) {
  const normalized = String(remote || "").trim()
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/^ssh:\/\/git@github\.com\//, "https://github.com/")
    .replace(/\.git$/, "");
  return /^https:\/\/github\.com\/[A-Za-z\d_.-]+\/[A-Za-z\d_.-]+$/i.test(normalized) ? normalized : "";
}

export async function verifyPrHandoff({ repoPath, testCommand, runTest, title = "", base = "main" }) {
  if (!String(testCommand || "").trim()) throw new Error("--verify-pr requires --run with the regression command to verify.");
  const branch = await git(repoPath, ["branch", "--show-current"]);
  if (!branch) throw new Error("Trusted checkout check failed: use a named branch before preparing a pull request.");
  const diffCheck = await git(repoPath, ["diff", "--check"]);
  if (diffCheck) throw new Error(`Trusted checkout check failed: ${diffCheck}`);
  const changedFiles = (await git(repoPath, ["diff", "--name-only", "HEAD"]))
    .split("\n").map((item) => item.trim()).filter(Boolean).slice(0, 40);
  if (!changedFiles.length) throw new Error("Trusted checkout check failed: make and stage or leave the patch in the checkout before preparing a PR.");
  const diff = (await git(repoPath, ["diff", "--no-ext-diff", "--unified=3", "HEAD"])) .slice(0, 20_000);
  const remote = await git(repoPath, ["remote", "get-url", "origin"]);
  const repositoryUrl = githubRemote(remote);
  if (!repositoryUrl) throw new Error("Trusted checkout check failed: origin must be a GitHub repository before BugReel can prepare a GitHub PR handoff.");

  const result = await runTest(testCommand, repoPath);
  if (result.code !== 0) throw new Error("The supplied regression command still fails. BugReel will not prepare a PR handoff.");
  const prTitle = safeTitle(title, `Fix ${changedFiles[0]}`);
  const prBase = String(base || "main").trim().replace(/[^A-Za-z\d._/-]/g, "").slice(0, 120) || "main";
  const body = [
    "## BugReel verification receipt",
    "",
    `- Trusted regression passed: \`${testCommand}\``,
    `- Changed files: ${changedFiles.map((file) => `\`${file}\``).join(", ")}`,
    "- Source diagnosis remains a reviewable hypothesis."
  ].join("\n");
  return {
    mode: "trusted_checkout",
    status: "pr_ready_for_human_review",
    repositoryUrl,
    branch,
    base: prBase,
    title: prTitle,
    testCommand,
    testsPassed: true,
    changedFiles,
    diff,
    proposedBody: body,
    nextCommands: {
      push: `git push -u origin ${shellQuote(branch)}`,
      createPullRequest: `gh pr create --base ${shellQuote(prBase)} --head ${shellQuote(branch)} --title ${shellQuote(prTitle)} --body ${shellQuote(body)}`
    },
    boundary: "BugReel verified the current local diff and regression command. It did not push a branch or create a pull request. Review the diff, then explicitly run the two commands if you want to publish."
  };
}
