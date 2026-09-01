import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanDiagnostic, createBugAvatar, decorateInvestigation, FAST_CONTEXT_LIMITS, failureReferences, finalizeTimedOutInvestigation, parseGitHubRepo,
  openCodeRunArgs, parseOpenCodeEvents, provisionalInvestigation, rankRepository, renderCli,
  runInvestigation, sampleFailure, seedInvestigation, sourceContext, spawnText, validateInvestigationInput, verifyGeneratedFixture
} from "./bugreel.js";

const repository = {
  name: "fixture", source: "local", branch: "main", charCount: 100, truncated: false,
  files: [
    { path: "src/calculator.py", content: "def divide(total, count):\n    return total / count\n" },
    { path: "src/formatting.py", content: "def label(value):\n    return str(value)\n" }
  ]
};
const failure = 'File "src/calculator.py", line 2, in divide\nZeroDivisionError: division by zero';

test("parses a public GitHub repository URL", () => {
  assert.deepEqual(parseGitHubRepo("https://github.com/openai/openai-node.git"), { owner: "openai", repo: "openai-node" });
});

test("validates a failure-led web investigation", () => {
  const input = validateInvestigationInput({ repoUrl: "https://github.com/openai/openai-node", failure, expected: "reject zero" });
  assert.equal(input.repo, "openai-node");
  assert.equal(input.failure, failure);
});

test("allows reporters to omit expected behavior", () => {
  const input = validateInvestigationInput({ repoUrl: "https://github.com/openai/openai-node", failure });
  assert.equal(input.expected, "");
});

test("traceback reference dominates ranking", () => {
  const ranked = rankRepository(repository, failure);
  assert.equal(ranked[0].path, "src/calculator.py");
  assert.ok(ranked[0].score >= 120);
  assert.deepEqual(failureReferences(failure), [{ path: "src/calculator.py", line: 2 }]);
});

test("bounds fast-triage source by file count and characters", () => {
  const files = Array.from({ length: 6 }, (_, index) => ({
    path: `src/file-${index}.py`,
    content: Array.from({ length: 300 }, (__, line) => `value_${index}_${line} = ${line}`).join("\n")
  }));
  const ranked = files.map((file, index) => ({ path: file.path, score: 100 - index, reasons: ["test"] }));
  const context = sourceContext({ files }, 'File "src/file-0.py", line 150', ranked);
  assert.ok(context.length <= FAST_CONTEXT_LIMITS.files);
  assert.ok(context.reduce((total, item) => total + item.snippet.length, 0) <= FAST_CONTEXT_LIMITS.chars);
  assert.ok(context[0].start < 150 && context[0].end > 150);
});

test("creates immediate suspects without claiming a captured diagnosis", () => {
  const ranked = rankRepository(repository, failure);
  const preview = seedInvestigation({ failure, expected: "" }, repository, ranked, sourceContext(repository, failure, ranked));
  assert.equal(preview.status, "investigating");
  assert.ok(preview.hypotheses.length > 0);
  assert.ok(preview.hypotheses.every(({ status }) => status !== "captured"));
  assert.match(preview.boundary, /provisional/i);
});

test("bug avatars are deterministic but varied", () => {
  assert.deepEqual(createBugAvatar("same", 0), createBugAvatar("same", 0));
  assert.notDeepEqual(createBugAvatar("same", 0), createBugAvatar("different", 1));
  for (const seed of ["same", "different", "Missing zero-divisor guard in divide():calculator.py"]) {
    const avatar = createBugAvatar(seed, 0);
    assert.ok(avatar.horns >= 0 && avatar.horns <= 2);
    assert.ok(["float", "skitter", "bounce"].includes(avatar.gait));
    assert.ok(["plain", "spots", "stripes"].includes(avatar.pattern));
  }
});

test("extracts model text from OpenCode JSON events", () => {
  const output = [
    JSON.stringify({ type: "step_start" }),
    JSON.stringify({ type: "text", part: { text: '{"ok":true}' } }),
    JSON.stringify({ type: "step_finish" })
  ].join("\n");
  assert.equal(parseOpenCodeEvents(output), '{"ok":true}');
});

test("passes the investigation inline without an attachment failure mode", () => {
  const args = openCodeRunArgs("synthetic investigation", "high");
  assert.equal(args[0], "run");
  assert.equal(args[1], "synthetic investigation");
  assert.equal(args.includes("--file"), false);
  assert.deepEqual(args.slice(-2), ["--format", "json"]);
});

test("removes terminal color codes from model diagnostics", () => {
  assert.equal(cleanDiagnostic("\u001b[91m\u001b[1mError:\u001b[0m File not found"), "Error: File not found");
});

test("timeout kills the whole model process group promptly", async () => {
  const startedAt = Date.now();
  const descendant = "setTimeout(() => {}, 60_000)";
  const parent = `const { spawn } = require("node:child_process"); spawn(process.execPath, ["-e", ${JSON.stringify(descendant)}], { stdio: "inherit" }); setTimeout(() => {}, 60_000);`;
  await assert.rejects(
    spawnText(process.execPath, ["-e", parent], { cwd: process.cwd(), timeout: 200 }),
    /exceeded BugReel's 1 second pass limit/
  );
  assert.ok(Date.now() - startedAt < 2_000);
});

test("applies a trusted fixture patch and runs its regression", async () => {
  const result = await verifyGeneratedFixture(3);
  assert.equal(result.baselineFailed, true);
  assert.equal(result.patchApplied, true);
  assert.equal(result.regressionPassed, true);
  assert.equal(result.testsPassed, 1);
  assert.match(result.command, /unittest discover/);
});

test("reports truthful phases during a three-pass investigation", async () => {
  const investigator = {
    incident: { title: "Zero divisor", summary: "division failed", observed: "exception", expected: "validation" },
    hypotheses: [{ id: "H1", title: "Missing guard", kind: "boundary", severity: "high", file: "src/calculator.py", lines: [1, 2], cause: "count is zero", evidence: ["traceback"], counterevidence: [], confidence: 0.9, nextProbe: "run test" }],
    rootCause: { hypothesisId: "H1", file: "src/calculator.py", lines: [1, 2], explanation: "zero is unchecked", confidence: 0.9 },
    candidatePatch: { summary: "guard zero", diff: "+ guard", verification: ["run regression"] }
  };
  const challenge = { winner: "H1", reason: "survives", challenges: [] };
  const resolved = { ...investigator, challenge: { summary: "survives", survivors: ["H1"], rejected: [] } };
  const responses = [investigator, challenge, resolved];
  const progress = [];
  const calls = [];
  const result = await runInvestigation({ failure, expected: "reject zero" }, repository, {
    strategy: "deep",
    call: async (prompt, options) => { calls.push({ prompt, options }); return responses.shift(); },
    onProgress: (update) => progress.push(update)
  });
  assert.deepEqual(progress.map(({ phase }) => phase), ["retrieval", "investigator", "challenger", "resolver", "grounding"]);
  assert.equal(progress[2].preview.status, "investigating");
  assert.equal(progress[2].preview.hypotheses[0].status, "tracked");
  assert.equal(progress[3].preview.hypotheses[0].status, "cornered");
  assert.deepEqual(progress[2].preview.hypotheses[0].avatar, progress[3].preview.hypotheses[0].avatar);
  assert.deepEqual(calls.map(({ options }) => options.variant), ["low", "low", "low"]);
  assert.ok(calls.every(({ options }) => options.timeout <= 45_000));
  assert.equal(result.status, "diagnosis_grounded");
});

test("fast hunt resolves in one bounded model call", async () => {
  const resolved = {
    incident: { title: "Zero divisor", summary: "division failed", observed: "exception", expected: "Inferred from failure: division should not crash" },
    hypotheses: [
      { id: "H1", title: "Missing guard", kind: "boundary", severity: "high", file: "src/calculator.py", lines: [1, 2], cause: "count is zero", evidence: ["traceback"], counterevidence: [], confidence: 0.9, nextProbe: "run test" },
      { id: "H2", title: "Label conversion", kind: "data", severity: "low", file: "src/formatting.py", lines: [1, 2], cause: "wrong type", evidence: ["utility exists"], counterevidence: ["not in traceback"], confidence: 0.2, nextProbe: "inspect caller" }
    ],
    rootCause: { hypothesisId: "H1", file: "src/calculator.py", lines: [1, 2], explanation: "zero is unchecked", confidence: 0.9 },
    candidatePatch: { summary: "guard zero", diff: "+ guard", verification: ["run regression"] },
    challenge: { summary: "H1 covers the traceback", survivors: ["H1"], rejected: ["H2"] }
  };
  const calls = [];
  const progress = [];
  const slots = [];
  const result = await runInvestigation({ failure, expected: "" }, repository, {
    call: async (prompt, options) => { calls.push({ prompt, options }); return resolved; },
    onProgress: (update) => progress.push(update),
    acquireModelSlot: async (request) => { slots.push(`acquire:${request.phase}`); return () => slots.push("release"); }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.variant, "low");
  assert.equal(calls[0].options.timeout, 25_000);
  assert.deepEqual(progress.map(({ phase }) => phase), ["retrieval", "investigator", "grounding"]);
  assert.equal(progress[1].preview.status, "investigating");
  assert.deepEqual(slots, ["acquire:investigator", "release"]);
  assert.equal(result.strategy, "fast");
  assert.equal(result.status, "diagnosis_grounded");
  assert.match(result.boundary, /CLI --deep/);
});

test("GLM failure samples stay synthetic and source-cited", async () => {
  const result = await sampleFailure({ kind: "boundary" }, repository, {
    call: async () => ({
      title: "Zero divisor probe",
      kind: "boundary",
      failureEvidence: "ZeroDivisionError at divide",
      expectedBehavior: "Reject a zero divisor explicitly \u2014 with a clear validation error",
      file: "src/calculator.py",
      lines: [1, 2],
      whyPlausible: "No zero guard is visible.",
      probeCommand: "python -m pytest test_zero_divisor"
    })
  });
  assert.equal(result.status, "unobserved_probe");
  assert.equal(result.synthetic, true);
  assert.match(result.failureEvidence, /^SYNTHETIC PROBE - NOT OBSERVED/);
  assert.doesNotMatch(result.expectedBehavior, /[\u2013\u2014]/);
  assert.match(result.boundary, /not failure evidence/i);
});

test("retries one invalid synthetic-probe citation and still fails closed", async () => {
  const responses = [
    {
      title: "Invalid first probe",
      failureEvidence: "unobserved boundary failure",
      expectedBehavior: "reject an invalid boundary",
      file: "src/not-supplied.py",
      lines: [100, 120]
    },
    {
      title: "Corrected boundary probe",
      failureEvidence: "SYNTHETIC PROBE - NOT OBSERVED\nValueError at divide",
      expectedBehavior: "reject a zero divisor",
      file: "src/calculator.py",
      lines: [1, 2],
      whyPlausible: "The supplied boundary has no visible zero guard.",
      probeCommand: "python -m pytest test_zero_divisor"
    }
  ];
  const prompts = [];
  const result = await sampleFailure({ kind: "boundary" }, repository, {
    call: async (prompt) => {
      prompts.push(prompt);
      return responses.shift();
    }
  });
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /CITATION CORRECTION/);
  assert.deepEqual(result.lines, [1, 2]);
  assert.equal(result.synthetic, true);
});

test("keeps generated figures provisional until the resolver is grounded", () => {
  const data = {
    incident: { title: "Zero divisor", summary: "division failed", observed: "exception", expected: "validation" },
    hypotheses: [
      { id: "H1", title: "Missing guard", file: "src/calculator.py", lines: [1, 2], cause: "count is zero", evidence: ["traceback"], confidence: 0.9 },
      { id: "H2", title: "Formatting leak", file: "src/formatting.py", lines: [1, 2], cause: "label conversion", evidence: ["nearby utility"], confidence: 0.3 }
    ]
  };
  const preview = provisionalInvestigation(data, { failure, expected: "reject zero" }, repository, rankRepository(repository, failure));
  assert.equal(preview.status, "investigating");
  assert.equal(preview.hypotheses.some(({ status }) => status === "captured"), false);
  assert.match(preview.boundary, /provisional/i);
  assert.equal(preview.timeline.at(-1).complete, false);
});

test("finishes the timeout path without inventing a model verdict", () => {
  const ranked = rankRepository(repository, failure);
  const preview = seedInvestigation({ failure, expected: "" }, repository, ranked, sourceContext(repository, failure, ranked));
  const result = finalizeTimedOutInvestigation(preview);
  assert.equal(result.status, "diagnosis_unverified");
  assert.equal(result.timeline[2].label, "Provisional suspects released");
  assert.equal(result.timeline[3].label, "Resolution gate checked");
  assert.equal(result.timeline[4].label, "Capture withheld");
  assert.ok(result.timeline.every(({ complete }) => complete));
  assert.equal(result.hypotheses.some(({ status }) => status === "captured"), false);
  assert.equal(result.challenge.survivors.length, 0);
  assert.match(result.boundary, /captured nothing/i);
});

test("grounds a cited root cause but keeps the patch unverified", () => {
  const data = {
    incident: { title: "Zero divisor", summary: "division failed", observed: "exception", expected: "validation" },
    hypotheses: [{ id: "H1", title: "Zero imp", kind: "data", severity: "high", file: "src/calculator.py", lines: [1, 2], cause: "count reaches divide as zero", evidence: ["traceback line 2"], counterevidence: [], confidence: 0.9, nextProbe: "inspect caller" }],
    rootCause: { hypothesisId: "H1", file: "src/calculator.py", lines: [1, 2], explanation: "zero is not checked", confidence: 0.9 },
    candidatePatch: { summary: "validate count", diff: "+ if count == 0: raise", verification: ["run regression"] },
    challenge: { summary: "survives", survivors: ["H1"], rejected: [] }
  };
  const investigation = decorateInvestigation(data, { failure, expected: "reject zero" }, repository, rankRepository(repository, failure));
  assert.equal(investigation.status, "diagnosis_grounded");
  assert.equal(investigation.hypotheses[0].status, "captured");
  assert.equal(investigation.timeline.at(-1).label, "Diagnosis captured");
  assert.equal(investigation.candidatePatch.regressionPassed, false);
  assert.match(renderCli(investigation, { color: false }), /CITED/);
  assert.match(renderCli(investigation, { color: false }), /NEXT SAFE ACTION/);
});

test("fails closed when the root citation does not cover the traceback", () => {
  const data = {
    incident: { title: "Wrong file" },
    hypotheses: [{ id: "H1", title: "Mimic", file: "src/formatting.py", lines: [1, 2], evidence: ["weak"], confidence: 0.8 }],
    rootCause: { hypothesisId: "H1", explanation: "wrong" },
    candidatePatch: {}
  };
  const investigation = decorateInvestigation(data, { failure, expected: "" }, repository, rankRepository(repository, failure));
  assert.equal(investigation.status, "diagnosis_unverified");
  assert.equal(investigation.hypotheses[0].status, "cornered");
  assert.equal(investigation.timeline.at(-1).label, "Capture withheld");
});
