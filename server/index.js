import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { clientKey, createRateLimiter } from "./rate-limit.js";
import { fetchPublicRepositories } from "./github.js";
import { sampleInvestigation } from "../src/sample.js";
import {
  createBugAvatar, FAILURE_SAMPLE_KINDS, finalizeTimedOutInvestigation, fetchGitHubRepository, MODEL, modelAvailable, parseGitHubRepo,
  runInvestigation, sampleFailure, sampleFailureSweep, validateInvestigationInput, verifyGeneratedFixture
} from "./bugreel.js";

const root = fileURLToPath(new URL("../dist", import.meta.url));
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
const jobs = new Map();
const MODEL_CONCURRENCY = 1;
const activeModelJobs = new Set();
const modelWaiters = [];
const startLimiter = createRateLimiter({ max: 4, windowMs: 15 * 60_000 });
let modelAvailability = { value: false, expiresAt: 0 };

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/api/health") {
      return json(response, 200, { ok: true, liveModel: await modelIsAvailable(), model: MODEL, surfaces: ["web", "cli"] });
    }
    if (request.method === "GET" && request.url === "/api/sample") {
      return json(response, 200, { mode: "fixture", investigation: sampleInvestigation });
    }
    const profileMatch = request.method === "GET" && request.url?.match(/^\/api\/github-users\/([^/?]+)\/repos$/);
    if (profileMatch) {
      return json(response, 200, await fetchPublicRepositories(decodeURIComponent(profileMatch[1])));
    }
    if (request.method === "GET" && request.url === "/api/investigations") {
      const ordered = [...jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 40);
      return json(response, 200, {
        jobs: ordered.map(publicJob),
        manager: managerState()
      });
    }
    if (request.method === "POST" && request.url === "/api/demo-swarm") {
      const swarm = startDemoSwarm();
      return json(response, 202, { jobs: swarm.map(publicJob), manager: managerState() });
    }
    if (request.method === "POST" && request.url === "/api/imports") {
      const body = await readJson(request);
      const imported = importInvestigation(body);
      return json(response, 201, publicJob(imported));
    }
    if (request.method === "POST" && request.url === "/api/pr-receipts") {
      const body = await readJson(request);
      return json(response, 201, publicJob(importPrReceipt(body)));
    }
    const importMatch = request.method === "PUT" && request.url?.match(/^\/api\/imports\/([A-Z0-9-]+)$/);
    if (importMatch) {
      const body = await readJson(request);
      const imported = updateImportedInvestigation(importMatch[1], body);
      return json(response, 200, publicJob(imported));
    }
    if (request.method === "POST" && request.url === "/api/investigations") {
      if (!allowModelStart(request, response)) return;
      const body = await readJson(request);
      const input = validateInvestigationInput(body);
      if (!await modelIsAvailable()) return json(response, 503, { error: "OpenCode Go is not authenticated. Run `opencode auth login` and retry." });
      const job = createJob("investigation", input, "Failure secured. Waiting to read the repository.");
      void runJob(job.id, input);
      return json(response, 202, publicJob(job));
    }
    if (request.method === "POST" && request.url === "/api/failure-samples") {
      if (!allowModelStart(request, response)) return;
      const body = await readJson(request);
      const repoUrl = String(body.repoUrl || "").trim();
      const parsed = parseGitHubRepo(repoUrl);
      const kind = FAILURE_SAMPLE_KINDS.includes(body.kind) ? body.kind : "boundary";
      if (!await modelIsAvailable()) return json(response, 503, { error: "OpenCode Go is not authenticated. Run `opencode auth login` and retry." });
      const input = { ...parsed, repoUrl, kind };
      const job = createJob("failure_sample", input, `Preparing a synthetic ${kind} failure probe.`);
      void runSampleJob(job.id, input);
      return json(response, 202, publicJob(job));
    }
    if (request.method === "POST" && request.url === "/api/issue-sweeps") {
      if (!allowModelStart(request, response)) return;
      const body = await readJson(request);
      const repoUrl = String(body.repoUrl || "").trim();
      const parsed = parseGitHubRepo(repoUrl);
      if (!await modelIsAvailable()) return json(response, 503, { error: "OpenCode Go is not authenticated. Run `opencode auth login` and retry." });
      const input = { ...parsed, repoUrl };
      const job = createJob("failure_sweep", input, "Preparing three distinct synthetic issue probes.");
      void runSweepJob(job.id, input);
      return json(response, 202, publicJob(job));
    }
    const jobMatch = request.method === "GET" && request.url?.match(/^\/api\/investigations\/([A-Z0-9-]+)$/);
    if (jobMatch) {
      const job = jobs.get(jobMatch[1]);
      return job ? json(response, 200, publicJob(job)) : json(response, 404, { error: "This investigation job no longer exists. Start a new hunt." });
    }
    if (request.method !== "GET") return json(response, 405, { error: "Method not allowed" });
    const requested = request.url === "/" ? "index.html" : request.url.split("?")[0].replace(/^\//, "");
    const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
    let data;
    let isIndex = safePath === "index.html";
    try {
      data = await readFile(join(root, safePath));
    } catch {
      data = await readFile(join(root, "index.html"));
      isIndex = true;
    }
    if (isIndex) data = Buffer.from(String(data).replace("</head>", "    <link rel=\"stylesheet\" href=\"/responsive.css\">\n  </head>"));
    response.writeHead(200, { "Content-Type": mime[extname(safePath)] || "text/html" });
    response.end(data);
  } catch (error) {
    json(response, 400, { error: error.message });
  }
});

server.listen(port, host, () => console.log(`BugReel server listening on http://${host}:${port}`));

async function runJob(id, input) {
  const job = jobs.get(id);
  try {
    updateJob(job, "running", "repository", "Reading the public repository and freezing bounded source.");
    const repository = await fetchGitHubRepository(input);
    const investigation = await runInvestigation(input, repository, {
      onProgress: ({ phase, message, preview }) => updateJob(job, "running", phase, message, preview),
      acquireModelSlot: (request) => acquireModelSlot(job, request)
    });
    updateJob(job, "complete", "complete", investigation.boundary);
    job.investigation = investigation;
  } catch (error) {
    const timeoutMatch = String(error.message || "").match(/exceeded BugReel's (\d+) second pass limit/i);
    if (job.preview && timeoutMatch) {
      const preview = finalizeTimedOutInvestigation(job.preview);
      updateJob(job, "partial", "partial", `GLM did not resolve within ${timeoutMatch[1]} seconds. BugReel finished the fail-closed path and withheld capture.`, preview);
    } else {
      updateJob(job, "error", "error", error.message || "The investigation stopped unexpectedly.");
    }
  }
}

async function runSampleJob(id, input) {
  const job = jobs.get(id);
  try {
    updateJob(job, "running", "repository", "Reading bounded source for a synthetic failure probe.");
    const repository = await fetchGitHubRepository(input);
    const sample = await sampleFailure(input, repository, {
      acquireModelSlot: (request) => acquireModelSlot(job, request)
    });
    job.sample = sample;
    updateJob(job, "complete", "complete", sample.boundary);
  } catch (error) {
    updateJob(job, "error", "error", error.message || "The synthetic failure probe stopped unexpectedly.");
  }
}

async function runSweepJob(id, input) {
  const job = jobs.get(id);
  try {
    updateJob(job, "running", "repository", "Reading bounded source for a three-class issue sweep.");
    const repository = await fetchGitHubRepository(input);
    const sweep = await sampleFailureSweep(input, repository, {
      acquireModelSlot: (request) => acquireModelSlot(job, request)
    });
    job.sweep = sweep;
    updateJob(job, "complete", "complete", "GLM returned three source-cited test ideas. They remain synthetic until a human runs them.");
  } catch (error) {
    updateJob(job, "error", "error", error.message || "The issue sweep stopped unexpectedly.");
  }
}

function createJob(type, input, message) {
  const now = new Date().toISOString();
  const job = {
    id: `JOB-${randomUUID().slice(0, 8).toUpperCase()}`,
    type,
    repo: `${input.owner}/${input.repo}`,
    label: type === "failure_sample" ? `${input.kind} probe`
      : type === "failure_sweep" ? "3-class issue sweep"
        : String(input.failure).split("\n").find(Boolean)?.slice(0, 90) || "Failure investigation",
    status: "queued",
    phase: "intake",
    message,
    startedAt: now,
    phaseStartedAt: now,
    updatedAt: now
  };
  jobs.set(job.id, job);
  return job;
}

function importInvestigation(body) {
  const investigation = body?.investigation;
  if (body?.state !== "intake" && (!investigation || typeof investigation !== "object" || !Array.isArray(investigation.hypotheses))) {
    throw new Error("The imported investigation artifact is invalid.");
  }
  const now = new Date().toISOString();
  const failure = String(body.failure || "Failure captured by the local CLI");
  const job = {
    id: `JOB-${randomUUID().slice(0, 8).toUpperCase()}`,
    type: "investigation",
    repo: String(body.repo || investigation.repository?.name || "local checkout").slice(0, 160),
    label: failure.split("\n").find(Boolean)?.slice(0, 90) || investigation.incident?.title || "Automatically captured failure",
    status: body?.state === "intake" ? "running" : "complete",
    phase: body?.state === "intake" ? "intake" : "grounding",
    message: body?.state === "intake"
      ? "Failure captured automatically. Local evidence collection has started."
      : investigation.status === "diagnosis_grounded"
        ? "Failure captured automatically. Diagnosis grounded; patch verification is still required."
        : "Failure captured automatically. The diagnosis remains provisional.",
    startedAt: now,
    phaseStartedAt: now,
    updatedAt: now,
    ...(body?.state === "intake" ? {} : { finishedAt: now, investigation })
  };
  jobs.set(job.id, job);
  console.log(`[job ${job.id}] imported/grounding: ${job.message}`);
  return job;
}

function updateImportedInvestigation(id, body) {
  const job = jobs.get(id);
  if (!job) throw new Error("The automatic intake job no longer exists.");
  const now = new Date().toISOString();
  if (body?.error) {
    Object.assign(job, {
      status: "partial",
      phase: "partial",
      message: `Failure captured automatically. ${String(body.error).slice(0, 240)}`,
      updatedAt: now,
      phaseStartedAt: now,
      finishedAt: now
    });
    return job;
  }
  const investigation = body?.investigation;
  if (!investigation || typeof investigation !== "object" || !Array.isArray(investigation.hypotheses)) {
    throw new Error("The imported investigation artifact is invalid.");
  }
  Object.assign(job, {
    status: "complete",
    phase: "grounding",
    message: investigation.status === "diagnosis_grounded"
      ? "Automatic diagnosis grounded; patch verification is still required."
      : "Automatic diagnosis remains provisional.",
    updatedAt: now,
    phaseStartedAt: now,
    finishedAt: now,
    investigation
  });
  return job;
}

function importPrReceipt(receipt) {
  if (receipt?.mode !== "trusted_checkout" || receipt?.status !== "pr_ready_for_human_review" || receipt?.testsPassed !== true) {
    throw new Error("The PR handoff receipt is missing trusted regression proof.");
  }
  if (!/^https:\/\/github\.com\/[A-Za-z\d_.-]+\/[A-Za-z\d_.-]+$/i.test(String(receipt.repositoryUrl || ""))) {
    throw new Error("The PR handoff receipt must name an exact public GitHub repository.");
  }
  if (!Array.isArray(receipt.changedFiles) || receipt.changedFiles.length === 0) {
    throw new Error("The PR handoff receipt must list a changed file.");
  }
  const now = new Date().toISOString();
  const job = {
    id: `PR-${randomUUID().slice(0, 8).toUpperCase()}`,
    type: "pr_handoff",
    repo: receipt.repositoryUrl.replace("https://github.com/", ""),
    label: String(receipt.title || "Verified local change").slice(0, 120),
    status: "complete",
    phase: "pr_review",
    message: "Trusted local diff and regression passed. Waiting for a human to review and publish the pull request.",
    startedAt: now,
    phaseStartedAt: now,
    updatedAt: now,
    finishedAt: now,
    prHandoff: {
      ...receipt,
      diff: String(receipt.diff || "").slice(0, 20_000),
      proposedBody: String(receipt.proposedBody || "").slice(0, 4_000)
    }
  };
  jobs.set(job.id, job);
  console.log(`[job ${job.id}] pr_review: ${job.message}`);
  return job;
}

const DEMO_FAILURES = [
  "Resume loses cursor state", "Zero divisor crosses boundary", "Retry budget decrements twice", "Cache key ignores tenant",
  "Pagination skips final row", "Timeout races cleanup", "Schema coercion drops null", "Batch order becomes unstable",
  "Token refresh loops", "Checkpoint writes stale offset", "Unicode slug truncates", "Feature gate leaks control",
  "Queue ack arrives early", "Date window includes tomorrow", "Partial merge erases fields", "Lock release misses error path",
  "Decimal round-trip drifts", "Worker heartbeat stalls", "Cursor decode accepts junk", "Fallback shadows primary error"
];

function startDemoSwarm() {
  for (const [id, job] of jobs) if (job.demo) jobs.delete(id);
  const now = Date.now();
  const swarm = DEMO_FAILURES.map((label, index) => {
    const startedAt = new Date(now + index).toISOString();
    const job = {
      id: `SWARM-${String(index + 1).padStart(2, "0")}`,
      type: "demo_bug",
      repo: ["relay/core", "relay/runtime", "relay/store", "relay/api"][index % 4],
      label,
      status: "queued",
      phase: "intake",
      message: "Failure secured by a local worker.",
      startedAt,
      phaseStartedAt: startedAt,
      updatedAt: startedAt,
      demo: true,
      worker: index + 1,
      avatar: createBugAvatar(`${label}:${index}`, index),
      verification: { mode: "trusted_fixture", status: "waiting", testsPassed: 0, testsTotal: 1 }
    };
    jobs.set(job.id, job);
    void runDemoWorker(job, index);
    return job;
  });
  return swarm;
}

async function runDemoWorker(job, index) {
  try {
    await pause(180 + index * 180);
    updateJob(job, "running", "hunting", "Local triage ranked the failure trail.");
    await pause(1_150 + (index % 4) * 120);
    updateJob(job, "running", "patching", "A bounded fixture patch is being applied in an isolated copy.");
    await pause(900 + (index % 3) * 110);
    updateJob(job, "running", "verifying", "Running the targeted regression in worker isolation.");
    job.verification = await verifyGeneratedFixture(index);
    updateJob(job, "complete", "complete", "Patch applied and the targeted regression passed.");
  } catch (error) {
    job.verification = { ...job.verification, status: "failed", regressionPassed: false, output: error.message };
    updateJob(job, "error", "verifying", "The isolated regression failed.");
  }
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function managerState() {
  const visible = [...jobs.values()];
  return {
    modelConcurrency: MODEL_CONCURRENCY,
    activeModels: activeModelJobs.size,
    queuedModels: modelWaiters.length,
    activeWorkers: visible.filter((job) => job.demo && job.status === "running").length,
    verificationPassed: visible.filter((job) => job.verification?.regressionPassed).length
  };
}

function acquireModelSlot(job, request = {}) {
  const grant = () => {
    activeModelJobs.add(job.id);
    updateJob(job, "running", request.phase || "investigator", request.message || "GLM slot acquired.");
    let released = false;
    return () => {
      if (released) return;
      released = true;
      activeModelJobs.delete(job.id);
      const next = modelWaiters.shift();
      if (next) next.resolve(next.grant());
    };
  };
  if (activeModelJobs.size < MODEL_CONCURRENCY) return Promise.resolve(grant());
  updateJob(job, "queued", "model_queue", `Provisional work is ready. Waiting for GLM slot ${modelWaiters.length + 1}.`);
  return new Promise((resolve) => modelWaiters.push({ job, grant, resolve }));
}

async function modelIsAvailable() {
  if (Date.now() < modelAvailability.expiresAt) return modelAvailability.value;
  modelAvailability = { value: await modelAvailable(), expiresAt: Date.now() + 30_000 };
  return modelAvailability.value;
}

function updateJob(job, status, phase, message, preview) {
  const phaseChanged = job.phase !== phase;
  Object.assign(job, { status, phase, message, updatedAt: new Date().toISOString() });
  if (phaseChanged) job.phaseStartedAt = job.updatedAt;
  if (["complete", "partial", "error"].includes(status) && !job.finishedAt) job.finishedAt = job.updatedAt;
  if (preview) job.preview = preview;
  console.log(`[job ${job.id}] ${status}/${phase}: ${message}`);
}

function allowModelStart(request, response) {
  const decision = startLimiter.take(clientKey(request.headers, request.socket.remoteAddress));
  if (decision.allowed) return true;
  json(response, 429, {
    error: "Too many GLM jobs from this client. Try again after the listed delay.",
    retryAfterSeconds: decision.retryAfterSeconds
  }, { "Retry-After": String(decision.retryAfterSeconds) });
  return false;
}

function publicJob(job) {
  const waiterIndex = modelWaiters.findIndex((item) => item.job.id === job.id);
  return {
    id: job.id,
    type: job.type,
    repo: job.repo,
    label: job.label,
    status: job.status,
    phase: job.phase,
    message: job.message,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    phaseStartedAt: job.phaseStartedAt,
    finishedAt: job.finishedAt || null,
    elapsedMs: Math.max(0, new Date(job.finishedAt || Date.now()).getTime() - new Date(job.startedAt).getTime()),
    phaseElapsedMs: Math.max(0, new Date(job.finishedAt || Date.now()).getTime() - new Date(job.phaseStartedAt).getTime()),
    queuePosition: waiterIndex >= 0 ? waiterIndex + 1 : 0,
    boardStage: boardStage(job),
    demo: Boolean(job.demo),
    worker: job.worker || null,
    ...(job.avatar ? { avatar: job.avatar } : {}),
    ...(job.verification ? { verification: job.verification } : {}),
    ...(job.preview ? { preview: job.preview } : {}),
    ...(job.investigation ? { investigation: job.investigation } : {}),
    ...(job.sample ? { sample: job.sample } : {}),
    ...(job.sweep ? { sweep: job.sweep } : {}),
    ...(job.prHandoff ? { prHandoff: job.prHandoff } : {})
  };
}

function boardStage(job) {
  if (job.prHandoff?.testsPassed) return "done";
  if (job.verification?.regressionPassed) return "done";
  if (job.phase === "verifying" || job.status === "error" || job.status === "partial") return "verify";
  if (job.phase === "patching" || (job.status === "complete" && job.investigation?.status === "diagnosis_grounded")) return "patch";
  if (["retrieval", "investigator", "challenger", "resolver", "grounding", "hunting", "model_queue"].includes(job.phase)) return "hunt";
  return "intake";
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 50_000) throw new Error("Request body is too large.");
  }
  return JSON.parse(body || "{}");
}

function json(response, status, value, headers = {}) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
  response.end(JSON.stringify(value));
}
