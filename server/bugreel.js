import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, relative, resolve } from "node:path";

export const MODEL = "opencode-go/glm-5.3-flash";
const OPENCODE_ENDPOINT = "https://opencode.ai/zen/go/v1/chat/completions";
const MAX_REPO_CHARS = 360_000;
const MAX_FAILURE_CHARS = 30_000;
export const FAST_CONTEXT_LIMITS = Object.freeze({ files: 2, chars: 4_000, traceLines: 32, supportLines: 16 });
const PASS_TIMEOUTS = Object.freeze({ investigator: 45_000, challenger: 35_000, resolver: 45_000 });
const FAST_HUNT_TIMEOUT = 25_000;
const TEXT_EXTENSIONS = new Set([
  ".c", ".cc", ".cpp", ".cs", ".cu", ".go", ".h", ".hpp", ".java", ".js",
  ".jsx", ".kt", ".mjs", ".php", ".py", ".rb", ".rs", ".scala", ".sh", ".sol",
  ".swift", ".ts", ".tsx", ".vue", ".zig", ".json", ".md", ".toml", ".yaml", ".yml"
]);
const IGNORED_PARTS = new Set([
  ".git", ".venv", "__pycache__", "build", "coverage", "dist", "node_modules", "target", "vendor"
]);
const STOPWORDS = new Set([
  "assert", "error", "failed", "failure", "false", "file", "line", "none", "return",
  "test", "tests", "traceback", "true", "value", "with", "expected", "actual"
]);
const AVATAR_NAMES = [
  "Nullfang", "Reset Wraith", "Cache Imp", "Race Shade", "Loop Mite", "Schema Mimic",
  "State Phantom", "Timeout Toad", "Budget Muncher", "Branch Bat", "Pointer Poltergeist", "Retry Gremlin"
];
const HUNT_STAGES = [
  ["intake", "Failure secured", "The incident is frozen before the hunt begins."],
  ["retrieval", "Trail found", "Traceback and failure vocabulary rank likely code paths."],
  ["hypotheses", "Suspects released", "Competing bugs get evidence, counterevidence, and a next probe."],
  ["challenge", "Escape routes checked", "A challenger attacks the leading diagnosis."],
  ["capture", "Diagnosis captured", "The winning citation passes the deterministic grounding gate."]
];

export function parseGitHubRepo(input) {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.port) {
    throw new Error("Repository must be a public https://github.com URL.");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 2) throw new Error("Repository URL must include exactly an owner and repository name.");
  const [owner, rawRepo] = parts;
  const repo = rawRepo?.replace(/\.git$/, "");
  if (!owner || !repo || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) {
    throw new Error("Repository URL must include an owner and repository name.");
  }
  return { owner, repo };
}

export function validateInvestigationInput(body) {
  if (!body || typeof body !== "object") throw new Error("Request body is required.");
  const repoUrl = String(body.repoUrl || "").trim();
  const { owner, repo } = parseGitHubRepo(repoUrl);
  const failure = String(body.failure || "").trim();
  const expected = String(body.expected || "").trim();
  if (failure.length < 12) throw new Error("Paste a failing test, stack trace, or error log.");
  if (failure.length > MAX_FAILURE_CHARS) throw new Error("Failure evidence is limited to 30,000 characters.");
  if (expected.length > 1_000) throw new Error("Expected behavior is limited to 1,000 characters.");
  return { owner, repo, repoUrl, failure, expected };
}

export async function fetchGitHubRepository({ owner, repo }, fetchImpl = fetch) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "bugreel" };
  const repoResponse = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}`, { headers });
  if (!repoResponse.ok) throw new Error(`Could not read repository metadata (${repoResponse.status}).`);
  const metadata = await repoResponse.json();
  const branch = metadata.default_branch;
  const treeResponse = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, { headers });
  if (!treeResponse.ok) throw new Error(`Could not read repository tree (${treeResponse.status}).`);
  const tree = await treeResponse.json();
  const candidates = (tree.tree || [])
    .filter((item) => item.type === "blob" && item.size <= 180_000 && isTextPath(item.path))
    .sort((a, b) => filePriority(a.path) - filePriority(b.path) || a.path.localeCompare(b.path));

  const files = [];
  let used = 0;
  for (let offset = 0; offset < candidates.length && used < MAX_REPO_CHARS; offset += 12) {
    const batch = await Promise.all(candidates.slice(offset, offset + 12).map(async (item) => {
      const encodedPath = item.path.split("/").map(encodeURIComponent).join("/");
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${encodedPath}`;
      const response = await fetchImpl(rawUrl, { headers: { "User-Agent": "bugreel" } });
      return response.ok ? { path: item.path, content: await response.text() } : null;
    }));
    for (const file of batch.filter(Boolean)) {
      if (used >= MAX_REPO_CHARS) break;
      const content = file.content.slice(0, MAX_REPO_CHARS - used);
      files.push({ path: file.path, content });
      used += content.length;
    }
  }
  return { name: `${owner}/${repo}`, source: "github", branch, files, charCount: used, truncated: files.length < candidates.length };
}

export async function readLocalRepository(repoPath) {
  const root = resolve(repoPath);
  const info = await stat(root);
  if (!info.isDirectory()) throw new Error(`Repository is not a directory: ${root}`);
  let tracked = [];
  try {
    tracked = execFileSync("git", ["-C", root, "ls-files", "-co", "--exclude-standard"], { encoding: "utf8" })
      .split("\n").filter(Boolean);
  } catch {
    tracked = await walk(root);
  }
  const files = [];
  let used = 0;
  for (const item of tracked.sort()) {
    if (used >= MAX_REPO_CHARS || !isTextPath(item)) continue;
    const path = join(root, item);
    try {
      const fileInfo = await stat(path);
      if (!fileInfo.isFile() || fileInfo.size > 180_000) continue;
      const content = (await readFile(path, "utf8")).slice(0, MAX_REPO_CHARS - used);
      files.push({ path: item, content });
      used += content.length;
    } catch {
      // A disappearing or unreadable file is skipped, never inferred.
    }
  }
  return { name: basename(root), source: "local", branch: currentBranch(root), files, charCount: used, truncated: used >= MAX_REPO_CHARS };
}

async function walk(root, current = root) {
  const result = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (IGNORED_PARTS.has(entry.name)) continue;
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) result.push(...await walk(root, absolute));
    else result.push(relative(root, absolute));
  }
  return result;
}

function currentBranch(root) {
  try {
    return execFileSync("git", ["-C", root, "branch", "--show-current"], { encoding: "utf8" }).trim() || "detached";
  } catch {
    return "workspace";
  }
}

function isTextPath(path) {
  if (path.split("/").some((part) => IGNORED_PARTS.has(part))) return false;
  const filename = basename(path);
  return ["Dockerfile", "Makefile", "Procfile", "LICENSE"].includes(filename) || TEXT_EXTENSIONS.has(extname(filename).toLowerCase());
}

function filePriority(path) {
  if (/readme|package\.json|pyproject|cargo\.toml|go\.mod/i.test(path)) return 0;
  if (/(^|\/)(src|app|server|api)(\/|$)/i.test(path)) return 1;
  if (/test|spec/i.test(path)) return 2;
  return 3;
}

function tokens(text) {
  return new Set((text.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) || [])
    .map((token) => token.toLowerCase()).filter((token) => !STOPWORDS.has(token)));
}

export function failureReferences(failure) {
  const patterns = [
    /File ["'](?<path>[^"']+)["'], line (?<line>\d+)/g,
    /(?<path>(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+):(?<line>\d+)/g
  ];
  const seen = new Set();
  const result = [];
  for (const pattern of patterns) {
    for (const match of failure.matchAll(pattern)) {
      const key = `${match.groups.path}:${match.groups.line}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ path: match.groups.path.replaceAll("\\", "/"), line: Number(match.groups.line) });
      }
    }
  }
  return result;
}

export function rankRepository(repository, failure, limit = 12) {
  const references = failureReferences(failure);
  const failureTerms = tokens(failure);
  const ranked = [];
  for (const file of repository.files) {
    let score = 0;
    const reasons = [];
    const normalizedPath = file.path.toLowerCase();
    for (const reference of references) {
      const normalizedReference = reference.path.toLowerCase();
      if (normalizedPath.endsWith(normalizedReference) || normalizedReference.endsWith(normalizedPath)) {
        score += 120;
        reasons.push(`failure references line ${reference.line}`);
      } else if (basename(normalizedPath) === basename(normalizedReference)) {
        score += 60;
        reasons.push("failure references matching filename");
      }
    }
    const fileTerms = tokens(file.content.slice(0, 180_000));
    const overlap = [...failureTerms].filter((term) => fileTerms.has(term));
    if (overlap.length) {
      score += Math.min(36, overlap.length * 2);
      reasons.push(`shares failure terms: ${overlap.sort((a, b) => b.length - a.length).slice(0, 5).join(", ")}`);
    }
    const pathOverlap = [...failureTerms].filter((term) => normalizedPath.includes(term));
    if (pathOverlap.length) {
      score += 12 + pathOverlap.length * 3;
      reasons.push("path matches failure vocabulary");
    }
    if (score > 0) ranked.push({ path: file.path, score: Math.round(score * 100) / 100, reasons });
  }
  return ranked.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit);
}

export function sourceContext(repository, failure, ranked, limits = FAST_CONTEXT_LIMITS) {
  const refs = failureReferences(failure);
  const context = [];
  let used = 0;
  for (const item of ranked.slice(0, limits.files)) {
    const file = repository.files.find((candidate) => candidate.path === item.path);
    if (!file || used >= limits.chars) continue;
    const matching = refs.find((ref) => item.path.endsWith(ref.path) || ref.path.endsWith(item.path));
    const lines = file.content.split("\n");
    const lineLimit = matching ? limits.traceLines : limits.supportLines;
    const start = matching ? Math.max(1, matching.line - Math.floor(lineLimit / 2)) : 1;
    const selected = [];
    for (const [offset, line] of lines.slice(start - 1, start - 1 + lineLimit).entries()) {
      const numbered = `${String(start + offset).padStart(5)} | ${line}`;
      if (used + numbered.length + 1 > limits.chars) break;
      selected.push(numbered);
      used += numbered.length + 1;
    }
    if (selected.length) context.push({ ...item, start, end: start + selected.length - 1, snippet: selected.join("\n") });
  }
  return context;
}

export function createBugAvatar(seed, index = 0) {
  const hash = hashText(`${seed}:${index}`);
  return {
    name: AVATAR_NAMES[hash % AVATAR_NAMES.length],
    hue: hash % 360,
    eyes: 1 + (hash % 3),
    horns: (hash >>> 4) % 3,
    gait: ["float", "skitter", "bounce"][(hash >>> 7) % 3],
    pattern: ["plain", "spots", "stripes"][(hash >>> 10) % 3]
  };
}

function hashText(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function parseJson(text) {
  if (typeof text !== "string") throw new Error("GLM returned no text result.");
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("GLM did not return a JSON object.");
  return JSON.parse(stripped.slice(start, end + 1));
}

export function parseOpenCodeEvents(output) {
  const textParts = [];
  for (const line of String(output).split("\n").filter(Boolean)) {
    try {
      const event = JSON.parse(line);
      if (event.type === "text" && typeof event.part?.text === "string") textParts.push(event.part.text);
    } catch {
      // OpenCode status noise is ignored. Model text must arrive as a JSON event.
    }
  }
  if (!textParts.length) throw new Error("OpenCode returned no model text.");
  return textParts.join("");
}

export async function modelAvailable() {
  if (process.env.OPENCODE_GO_API_KEY) return true;
  try {
    const credentials = execFileSync("opencode", ["auth", "list", "--pure"], {
      encoding: "utf8",
      timeout: 8_000
    });
    return credentials.includes("OpenCode Go");
  } catch {
    return false;
  }
}

async function callModel(prompt, { variant = "medium", timeout = 120_000 } = {}) {
  if (process.env.OPENCODE_GO_API_KEY) return callDirect(prompt, process.env.OPENCODE_GO_API_KEY, timeout);
  return callOpenCodeCli(prompt, { variant, timeout });
}

async function callDirect(prompt, apiKey, timeout) {
  const response = await fetch(OPENCODE_ENDPOINT, {
    method: "POST",
    signal: AbortSignal.timeout(timeout),
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "glm-5.3-flash",
      messages: [{ role: "user", content: prompt }],
      temperature: 1,
      top_p: 0.95,
      reasoning_effort: "low",
      response_format: { type: "json_object" }
    })
  });
  if (!response.ok) throw new Error(`OpenCode Go request failed (${response.status}).`);
  const payload = await response.json();
  return parseJson(payload.choices?.[0]?.message?.content);
}

async function callOpenCodeCli(prompt, { variant, timeout }) {
  const output = await spawnText("opencode", openCodeRunArgs(prompt, variant), { cwd: tmpdir(), timeout });
  return parseJson(parseOpenCodeEvents(output));
}

export function openCodeRunArgs(prompt, variant) {
  return [
    "run",
    prompt,
    "--pure", "--model", MODEL, "--variant", variant, "--format", "json"
  ];
}

export function spawnText(command, args, { cwd, timeout }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32"
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
    }, timeout);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) rejectPromise(new Error(`${command} exceeded BugReel's ${Math.max(1, Math.ceil(timeout / 1000))} second pass limit.`));
      else if (code === 0) resolvePromise(stdout);
      else rejectPromise(new Error(`${command} exited ${code}: ${cleanDiagnostic(stderr.slice(-500)) || "no diagnostic"}`));
    });
  });
}

function killProcessTree(child) {
  if (!child.pid) return;
  try {
    if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
    else child.kill("SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

export function cleanDiagnostic(value) {
  return String(value || "").replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").trim();
}

export async function verifyGeneratedFixture(seed = 0) {
  const workspace = await mkdtemp(join(tmpdir(), "bugreel-verify-"));
  const increment = (Math.abs(Number(seed)) % 7) + 1;
  const wrongIncrement = increment - 1;
  const sourcePath = join(workspace, "subject.py");
  const testPath = join(workspace, "test_regression.py");
  const before = `def transform(value):\n    return value + ${wrongIncrement}\n`;
  const after = `def transform(value):\n    return value + ${increment}\n`;
  const testSource = `import unittest\nfrom subject import transform\n\nclass RegressionTest(unittest.TestCase):\n    def test_expected_transition(self):\n        self.assertEqual(transform(10), ${10 + increment})\n\nif __name__ == "__main__":\n    unittest.main()\n`;
  const command = "python3 -B -m unittest discover";
  const startedAt = Date.now();
  try {
    await writeFile(sourcePath, before);
    await writeFile(testPath, testSource);
    let baselineFailed = false;
    try {
      await spawnText("python3", ["-B", "-m", "unittest", "discover"], { cwd: workspace, timeout: 5_000 });
    } catch {
      baselineFailed = true;
    }
    if (!baselineFailed) throw new Error("Generated regression did not reproduce the failure before patching.");
    await writeFile(sourcePath, after);
    const output = await spawnText("python3", ["-B", "-m", "unittest", "discover"], { cwd: workspace, timeout: 5_000 });
    return {
      mode: "trusted_fixture",
      status: "passed",
      baselineFailed: true,
      patchApplied: true,
      regressionPassed: true,
      testsPassed: 1,
      testsTotal: 1,
      command,
      file: "subject.py",
      diff: `-    return value + ${wrongIncrement}\n+    return value + ${increment}`,
      durationMs: Date.now() - startedAt,
      output: cleanDiagnostic(output) || "1 regression passed"
    };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

function investigatorPrompt(input, repository, ranked, context) {
  return `You are BUGREEL HUNTER, a codebase investigator. Treat every root cause as a competing hypothesis. Work only from the supplied failure and source. Never claim that a candidate patch was tested.\n\nFAILURE\n${input.failure}\n\nEXPECTED\n${input.expected || "Not supplied"}\n\nRANKED FILES\n${JSON.stringify(ranked)}\n\nBOUNDED SOURCE\n${context.map((item) => `===== ${item.path}:${item.start}-${item.end} =====\n${item.snippet}`).join("\n")}\n\nReturn JSON exactly shaped as {"incident":{"title":"...","summary":"...","observed":"...","expected":"..."},"hypotheses":[{"id":"H1","title":"...","kind":"state|data|control|concurrency|boundary|unknown","severity":"low|medium|high|critical","file":"relative/path","lines":[1,2],"cause":"...","evidence":["..."],"counterevidence":["..."],"confidence":0.0,"nextProbe":"..."}],"rootCause":{"hypothesisId":"H1","file":"relative/path","lines":[1,2],"explanation":"...","confidence":0.0},"candidatePatch":{"summary":"...","diff":"unified diff or bounded pseudodiff","verification":["..."]}}. Return 2 to 4 hypotheses. Citations must refer to supplied source.`;
}

function challengerPrompt(input, repository, investigation, context) {
  return `You are BUGREEL PHANTOM, an adversarial debugging reviewer. Try to help the leading bug avatar escape by exposing unsupported claims. Work only from supplied evidence.\n\nFAILURE\n${input.failure}\n\nINVESTIGATION\n${JSON.stringify(investigation)}\n\nSOURCE\n${context.map((item) => `===== ${item.path}:${item.start}-${item.end} =====\n${item.snippet}`).join("\n")}\n\nReturn {"challenges":[{"hypothesisId":"H1","verdict":"survives|weakened|rejected","issue":"...","missingEvidence":"..."}],"winner":"H1 or null","reason":"..."}. A plausible explanation without a covering citation must be weakened.`;
}

function resolverPrompt(input, investigation, challenge) {
  return `You are BUGREEL KEEPER. Resolve the hunt conservatively. Do not invent files, tests, or successful execution.\n\nFAILURE\n${input.failure}\n\nINVESTIGATOR\n${JSON.stringify(investigation)}\n\nCHALLENGER\n${JSON.stringify(challenge)}\n\nReturn the investigator JSON shape, preserving hypotheses, plus "challenge":{"summary":"...","survivors":["H1"],"rejected":["H2"]}. You may lower confidence or set rootCause to null. Candidate patch verification remains proposed until a real regression test passes.`;
}

function fastHuntPrompt(input, preview, context) {
  return `You are BUGREEL FAST HUNT. Resolve one code failure quickly from only the bounded evidence below. Attack the two supplied candidates, choose at most one winner, and propose a small unverified patch. Never invent files, line numbers, tests, or successful execution. Use short sentences and no prose outside the JSON.

FAILURE
${input.failure}

REPORTER EXPECTATION
${input.expected || "Not supplied"}

CANDIDATES
${preview.hypotheses.map(({ id, file, lines }) => `${id}: ${file}:${lines?.[0]}-${lines?.[1]}`).join("\n")}

BOUNDED SOURCE
${context.map((item) => `===== ${item.path}:${item.start}-${item.end} =====
${item.snippet}`).join("\n")}

Return only {"summary":"...","hypotheses":[{"id":"H1","cause":"...","evidence":"...","counterevidence":"...","confidence":0.0,"nextProbe":"...","lines":[1,2]}],"winner":"H1 or null","rootExplanation":"...","patch":{"summary":"...","diff":"at most 3 lines","verification":"..."},"challenge":"..."}. Include each supplied candidate once. Keep every string under 120 characters and the entire response under 220 words. A plausible winner without a covering citation must be null.`;
}

export function seedInvestigation(input, repository, ranked, context) {
  const expectedLine = String(input.failure).split("\n").find((line) => /^\s*expected\b/i.test(line));
  const incident = {
    title: `Fast trail near ${basename(context[0]?.path || ranked[0]?.path || "the failure")}`,
    summary: "BugReel has ranked the failure trail locally. GLM review is still pending.",
    observed: String(input.failure).split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 280),
    expected: input.expected || (expectedLine ? `Inferred from failure: ${expectedLine.trim()}` : "Not supplied by the reporter.")
  };
  const hypotheses = context.slice(0, 2).map((item, index) => ({
    id: `H${index + 1}`,
    title: index === 0 ? `Failure boundary in ${basename(item.path)}` : `Competing trail through ${basename(item.path)}`,
    kind: "unknown",
    severity: index === 0 ? "high" : "medium",
    file: item.path,
    lines: [item.start, Math.min(item.end, item.start + 5)],
    cause: "This source window is strongly connected to the failure, but its causal role has not been resolved yet.",
    evidence: [`Local trail score ${item.score}: ${(item.reasons || []).join("; ") || "failure vocabulary overlap"}.`],
    counterevidence: ["GLM challenge and resolution have not completed."],
    confidence: index === 0 ? 0.38 : 0.24,
    nextProbe: `Inspect ${item.path}:${item.start}-${Math.min(item.end, item.start + 5)} while GLM reviews the competing trails.`
  }));
  return { ...provisionalInvestigation({ incident, hypotheses }, input, repository, ranked), strategy: "fast" };
}

function mergeFastVerdict(preview, verdict) {
  if (verdict?.incident && Array.isArray(verdict.hypotheses)) return verdict;
  const updates = new Map((Array.isArray(verdict?.hypotheses) ? verdict.hypotheses : []).map((item) => [item.id, item]));
  const hypotheses = preview.hypotheses.map((item) => {
    const update = updates.get(item.id) || {};
    return {
      ...item,
      cause: String(update.cause || item.cause),
      evidence: [...item.evidence, ...(update.evidence ? [String(update.evidence)] : [])],
      counterevidence: update.counterevidence ? [String(update.counterevidence)] : item.counterevidence,
      confidence: Number.isFinite(Number(update.confidence)) ? clamp(Number(update.confidence)) : item.confidence,
      nextProbe: String(update.nextProbe || item.nextProbe),
      lines: Array.isArray(update.lines) && update.lines.length === 2 ? update.lines.map(Number) : item.lines
    };
  });
  const winner = hypotheses.find((item) => item.id === verdict?.winner);
  return {
    incident: { ...preview.incident, summary: String(verdict?.summary || preview.incident.summary) },
    hypotheses,
    rootCause: winner ? {
      hypothesisId: winner.id,
      file: winner.file,
      lines: winner.lines,
      explanation: String(verdict?.rootExplanation || winner.cause),
      confidence: winner.confidence
    } : null,
    candidatePatch: {
      summary: String(verdict?.patch?.summary || "No candidate patch supplied."),
      diff: String(verdict?.patch?.diff || "Patch unavailable."),
      verification: verdict?.patch?.verification ? [String(verdict.patch.verification)] : []
    },
    challenge: {
      summary: String(verdict?.challenge || "The compact challenger returned no explanation."),
      survivors: winner ? [winner.id] : [],
      rejected: winner ? hypotheses.filter((item) => item.id !== winner.id).map((item) => item.id) : []
    }
  };
}

export async function runInvestigation(input, repository, {
  call = callModel,
  onProgress = () => {},
  strategy = "fast",
  acquireModelSlot = async () => () => {}
} = {}) {
  onProgress({ phase: "retrieval", message: "Repository secured. Ranking the failure trail." });
  const ranked = rankRepository(repository, input.failure);
  if (!ranked.length) throw new Error("The failure did not match any readable source files.");
  const context = sourceContext(repository, input.failure, ranked);
  if (strategy !== "deep") {
    const preview = seedInvestigation(input, repository, ranked, context);
    onProgress({
      phase: "investigator",
      message: "Instant source-grounded suspects ready. GLM is challenging and resolving them (25s limit).",
      preview
    });
    const release = await acquireModelSlot({ phase: "investigator", message: "GLM slot acquired. Resolving the provisional suspects." });
    let resolved;
    try {
      const verdict = await call(fastHuntPrompt(input, preview, context), { variant: "low", timeout: FAST_HUNT_TIMEOUT });
      resolved = mergeFastVerdict(preview, verdict);
    } finally {
      release();
    }
    onProgress({ phase: "grounding", message: "Fast hunt returned. Grounding every source citation before capture." });
    const investigation = decorateInvestigation(resolved, input, repository, ranked);
    return {
      ...investigation,
      strategy: "fast",
      boundary: `${investigation.boundary} Fast Hunt uses one self-challenging GLM pass; use CLI --deep for three independent passes.`
    };
  }
  onProgress({ phase: "investigator", message: "GLM pass 1 of 3: fast triage over three bounded evidence windows (45s limit)." });
  let release = await acquireModelSlot({ phase: "investigator", message: "GLM deep pass 1 acquired a model slot." });
  let investigation;
  try {
    investigation = await call(investigatorPrompt(input, repository, ranked, context), { variant: "low", timeout: PASS_TIMEOUTS.investigator });
  } finally {
    release();
  }
  onProgress({
    phase: "challenger",
    message: "Suspects generated. GLM pass 2 of 3 is attacking the leading diagnosis.",
    preview: provisionalInvestigation(investigation, input, repository, ranked)
  });
  release = await acquireModelSlot({ phase: "challenger", message: "GLM deep pass 2 acquired a model slot." });
  let challenge;
  try {
    challenge = await call(challengerPrompt(input, repository, investigation, context), { variant: "low", timeout: PASS_TIMEOUTS.challenger });
  } finally {
    release();
  }
  onProgress({
    phase: "resolver",
    message: "Challenge complete. GLM pass 3 of 3 is resolving the surviving suspect.",
    preview: provisionalInvestigation(investigation, input, repository, ranked, challenge)
  });
  release = await acquireModelSlot({ phase: "resolver", message: "GLM deep pass 3 acquired a model slot." });
  let resolved;
  try {
    resolved = await call(resolverPrompt(input, investigation, challenge), { variant: "low", timeout: PASS_TIMEOUTS.resolver });
  } finally {
    release();
  }
  onProgress({ phase: "grounding", message: "Model passes complete. Grounding source citations." });
  return { ...decorateInvestigation(resolved, input, repository, ranked), strategy: "deep" };
}

export const FAILURE_SAMPLE_KINDS = Object.freeze(["state", "boundary", "control", "concurrency", "data"]);

export async function sampleFailure(input, repository, {
  call = callModel,
  acquireModelSlot = async () => () => {}
} = {}) {
  const kind = FAILURE_SAMPLE_KINDS.includes(input.kind) ? input.kind : "boundary";
  const files = repository.files
    .filter((file) => [".js", ".jsx", ".mjs", ".py", ".ts", ".tsx"].includes(extname(file.path).toLowerCase()))
    .slice(0, 3);
  if (!files.length) throw new Error("No bounded source files are available for a synthetic failure probe.");
  let used = 0;
  const context = files.map((file) => {
    const selected = [];
    for (const [index, line] of file.content.split("\n").slice(0, 80).entries()) {
      const numbered = `${String(index + 1).padStart(5)} | ${line}`;
      if (used + numbered.length + 1 > 16_000) break;
      selected.push(numbered);
      used += numbered.length + 1;
    }
    return { path: file.path, start: 1, end: selected.length, snippet: selected.join("\n") };
  }).filter((item) => item.end > 0);
  const prompt = `You are BUGREEL PROBE LAB. Propose one plausible ${kind} bug that a developer could deliberately test against the bounded source below. This is a synthetic probe, not an observed failure. Do not claim the bug exists. Cite only supplied files and lines. Return a concise failing-test or stack-trace-shaped artifact that could guide a real test.

REPOSITORY
${repository.name}@${repository.branch}

BOUNDED SOURCE
${context.map((item) => `===== ${item.path}:${item.start}-${item.end} =====\n${item.snippet}`).join("\n")}

Return only {"title":"...","kind":"${kind}","failureEvidence":"SYNTHETIC PROBE - NOT OBSERVED\\n...","expectedBehavior":"...","file":"relative/path","lines":[1,2],"whyPlausible":"...","probeCommand":"..."}. Keep the response under 450 words.`;
  const release = await acquireModelSlot({ phase: "sampler", message: "GLM slot acquired. Generating a synthetic failure probe." });
  let result;
  const citationIsValid = (value) => {
    const cited = context.find((item) => item.path === value?.file);
    return Boolean(cited && Array.isArray(value.lines) && value.lines.length === 2
      && value.lines.every(Number.isInteger) && value.lines[0] >= cited.start
      && value.lines[0] <= value.lines[1] && value.lines[1] <= cited.end);
  };
  try {
    result = await call(prompt, { variant: "low", timeout: 45_000 });
    if (!citationIsValid(result)) {
      const allowed = context.map((item) => `${item.path}:${item.start}-${item.end}`).join("\n");
      const correction = `${prompt}\n\nCITATION CORRECTION\nYour previous response used a file or line range outside the supplied source. Return one corrected full JSON object. The file must exactly match one allowed path, and both line numbers must stay inside its listed range. Do not change the synthetic, unobserved boundary.\n\nALLOWED CITATIONS\n${allowed}\n\nPREVIOUS RESPONSE\n${JSON.stringify(result).slice(0, 4_000)}`;
      result = await call(correction, { variant: "low", timeout: 45_000 });
    }
  } finally {
    release();
  }
  if (!citationIsValid(result)) throw new Error("GLM returned a synthetic probe without a valid source citation after one bounded correction pass.");
  const failureEvidence = cleanGeneratedText(result.failureEvidence || "");
  return {
    title: cleanGeneratedText(result.title || `${kind} probe`).slice(0, 100),
    kind,
    status: "unobserved_probe",
    synthetic: true,
    failureEvidence: failureEvidence.startsWith("SYNTHETIC PROBE - NOT OBSERVED")
      ? failureEvidence
      : `SYNTHETIC PROBE - NOT OBSERVED\n${failureEvidence}`,
    expectedBehavior: cleanGeneratedText(result.expectedBehavior || ""),
    file: result.file,
    lines: result.lines,
    whyPlausible: cleanGeneratedText(result.whyPlausible || ""),
    probeCommand: cleanGeneratedText(result.probeCommand || ""),
    boundary: "GLM generated this as a source-cited test idea. It is not failure evidence until the probe is executed and actually fails."
  };
}

function cleanGeneratedText(value) {
  return String(value).replace(/[\u2013\u2014]/g, "-");
}

export function provisionalInvestigation(data, input, repository, ranked, challenge = null) {
  const winnerId = typeof challenge?.winner === "string" ? challenge.winner : null;
  const rejected = Array.isArray(challenge?.challenges)
    ? challenge.challenges.filter((item) => item.verdict === "rejected").map((item) => item.hypothesisId)
    : [];
  const preview = decorateInvestigation({
    ...data,
    rootCause: null,
    challenge: {
      summary: challenge?.reason || "The challenger has not returned yet.",
      survivors: winnerId ? [winnerId] : [],
      rejected
    }
  }, input, repository, ranked);
  return {
    ...preview,
    status: "investigating",
    hypotheses: preview.hypotheses.map((item) => ({
      ...item,
      status: item.id === winnerId ? "cornered" : item.status
    })),
    timeline: preview.timeline.map((item, index) => ({ ...item, complete: index < (challenge ? 4 : 3) })),
    boundary: "These suspects are provisional. Capture remains locked until the resolver output passes deterministic grounding."
  };
}

export function finalizeTimedOutInvestigation(preview) {
  const labels = [
    null,
    null,
    ["Provisional suspects released", "Deterministic triage released source-grounded candidates before the model timeout."],
    ["Resolution gate checked", "The timeout fallback confirmed that no GLM challenge or resolver verdict was available."],
    ["Capture withheld", "The grounding gate refused capture because the model resolution did not complete."]
  ];
  return {
    ...preview,
    status: "diagnosis_unverified",
    rootCause: null,
    hypotheses: preview.hypotheses.map((item) => ({
      ...item,
      status: item.status === "captured" || item.status === "cornered" ? "tracked" : item.status
    })),
    challenge: {
      summary: "GLM did not complete its challenge. The timeout fallback found no resolved diagnosis to ground.",
      survivors: [],
      rejected: []
    },
    timeline: preview.timeline.map((item, index) => ({
      ...item,
      ...(labels[index] ? { label: labels[index][0], detail: labels[index][1] } : {}),
      complete: true
    })),
    boundary: "Source-grounded suspects were released, but GLM did not complete its challenge or resolver pass. BugReel checked the fail-closed gate and captured nothing."
  };
}

export function decorateInvestigation(data, input, repository, ranked) {
  const fileMap = new Map(repository.files.map((file) => [file.path, file]));
  const rawHypotheses = Array.isArray(data.hypotheses) ? data.hypotheses.slice(0, 5) : [];
  const hypotheses = rawHypotheses.map((item, index) => {
    const pathValid = typeof item.file === "string" && fileMap.has(item.file);
    const lineCount = pathValid ? fileMap.get(item.file).content.split("\n").length : 0;
    const linesValid = Array.isArray(item.lines) && item.lines.length === 2 && item.lines.every(Number.isInteger)
      && item.lines[0] >= 1 && item.lines[0] <= item.lines[1] && item.lines[1] <= lineCount;
    const grounded = pathValid && linesValid && Array.isArray(item.evidence) && item.evidence.length > 0;
    const id = typeof item.id === "string" ? item.id : `H${index + 1}`;
    return {
      id,
      title: String(item.title || item.cause || `Hypothesis ${index + 1}`).slice(0, 100),
      kind: ["state", "data", "control", "concurrency", "boundary", "unknown"].includes(item.kind) ? item.kind : "unknown",
      severity: ["low", "medium", "high", "critical"].includes(item.severity) ? item.severity : "medium",
      file: pathValid ? item.file : "unresolved",
      lines: linesValid ? item.lines : null,
      cause: String(item.cause || "No bounded cause supplied."),
      evidence: Array.isArray(item.evidence) ? item.evidence.map(String).slice(0, 5) : [],
      counterevidence: Array.isArray(item.counterevidence) ? item.counterevidence.map(String).slice(0, 4) : [],
      confidence: clamp(Number(item.confidence) || 0),
      nextProbe: String(item.nextProbe || "Inspect the nearest caller with a targeted regression."),
      grounded,
      status: grounded ? "tracked" : "spotted",
      avatar: createBugAvatar(`${item.title || item.cause || id}:${item.file || "unknown"}`, index)
    };
  });
  if (!hypotheses.length) throw new Error("GLM returned no usable bug hypotheses.");

  const citedRoot = data.rootCause && typeof data.rootCause === "object" ? data.rootCause : null;
  const winner = citedRoot ? hypotheses.find((item) => item.id === citedRoot.hypothesisId) : null;
  const references = failureReferences(input.failure);
  const coversFailure = Boolean(winner?.lines && references.some((reference) => {
    const sameFile = winner.file.endsWith(reference.path) || reference.path.endsWith(winner.file);
    return sameFile && winner.lines[0] <= reference.line && reference.line <= winner.lines[1];
  }));
  const rootGrounded = Boolean(winner?.grounded && (references.length === 0 || coversFailure));
  const updatedHypotheses = hypotheses.map((item) => ({
    ...item,
    status: item.id === winner?.id && rootGrounded ? "captured" : item.id === winner?.id ? "cornered" : item.status
  }));
  const status = rootGrounded ? "diagnosis_grounded" : "diagnosis_unverified";
  const rootCause = winner ? {
    hypothesisId: winner.id,
    file: winner.file,
    lines: winner.lines,
    explanation: String(citedRoot.explanation || winner.cause),
    confidence: clamp(Number(citedRoot.confidence) || winner.confidence),
    grounded: rootGrounded
  } : null;
  const timeline = HUNT_STAGES.map(([id, label, detail], index) => ({
    id,
    label: index === 4 && !rootGrounded ? "Capture withheld" : label,
    detail: index === 4 && !rootGrounded ? "The leading diagnosis did not clear the grounding gate." : detail,
    complete: index < 4 || rootGrounded
  }));
  const maze = ranked.slice(0, 9).map((item, index) => ({ ...item, x: [8, 27, 49, 74, 88, 70, 45, 22, 8][index], y: [14, 14, 14, 14, 36, 59, 79, 79, 57][index] }));
  return {
    id: `BR-${new Date().toISOString().slice(5, 10).replace("-", "")}-${hashText(input.failure).toString(16).slice(0, 4).toUpperCase()}`,
    status,
    mode: "live",
    model: "GLM-5.3 Flash via OpenCode Go",
    repository: { name: repository.name, source: repository.source, branch: repository.branch, filesRead: repository.files.length, charsRead: repository.charCount, truncated: repository.truncated },
    incident: {
      title: String(data.incident?.title || "Unlabeled failure"),
      summary: String(data.incident?.summary || input.failure.split("\n").find(Boolean) || "Failure under investigation"),
      observed: String(data.incident?.observed || input.failure.split("\n").find(Boolean) || "Failure observed"),
      expected: String(data.incident?.expected || input.expected || "Expected behavior not supplied")
    },
    hypotheses: updatedHypotheses,
    rootCause,
    candidatePatch: {
      summary: String(data.candidatePatch?.summary || "No candidate patch supplied."),
      diff: String(data.candidatePatch?.diff || "Patch unavailable."),
      verification: Array.isArray(data.candidatePatch?.verification) ? data.candidatePatch.verification.map(String).slice(0, 6) : [],
      applied: false,
      regressionPassed: false
    },
    challenge: {
      summary: String(data.challenge?.summary || "Challenge pass completed."),
      survivors: Array.isArray(data.challenge?.survivors) ? data.challenge.survivors.map(String) : winner ? [winner.id] : [],
      rejected: Array.isArray(data.challenge?.rejected) ? data.challenge.rejected.map(String) : []
    },
    retrieval: ranked,
    maze,
    timeline,
    boundary: rootGrounded
      ? "The leading diagnosis has a checked source citation. The patch is still unverified until a regression test passes."
      : "The diagnosis is not grounded yet. BugReel will not call this bug captured."
  };
}

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}

export function renderCli(investigation, { color = process.stdout.isTTY } = {}) {
  const paint = (code, text) => color ? `\u001b[${code}m${text}\u001b[0m` : text;
  const status = investigation.status === "diagnosis_grounded" ? paint("32;1", "CITED") : paint("33;1", "STILL HUNTING");
  const lines = [
    "",
    paint("36;1", "BUGREEL // INVESTIGATION CONSOLE"),
    `${investigation.id}  ${status}  ${investigation.repository.name}@${investigation.repository.branch}`,
    "",
    `${paint("37;1", investigation.incident.title)}`,
    investigation.incident.summary,
    "",
    "HUNT  ● failure  · trail  · suspects  · challenge  ◎ citation",
    ""
  ];
  for (const bug of investigation.hypotheses) {
    const glyph = bug.status === "captured" ? "◎" : bug.status === "tracked" ? "◉" : "○";
    lines.push(`${glyph} ${paint("35;1", bug.avatar.name.padEnd(19))}  ${bug.status.toUpperCase()}`);
    lines.push(`  ${bug.file}${bug.lines ? `:${bug.lines[0]}-${bug.lines[1]}` : ""}`);
    lines.push(`  ${bug.cause}`);
  }
  lines.push("", paint("37;1", "NEXT SAFE ACTION"), investigation.rootCause?.grounded
    ? investigation.candidatePatch.verification[0] || "Run the targeted regression test."
    : investigation.hypotheses[0]?.nextProbe || "Collect more evidence.");
  lines.push("", paint("90", investigation.boundary), "");
  return lines.join("\n");
}
