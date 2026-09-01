export const SAMPLE_FAILURE = `FAILED arc-agi-3/tests/test_core.py::test_resume_restores_environment_state

File "arc-agi-3/src/relay_arc/core.py", line 84, in run
  observation = self.env.step(action)

AssertionError: resumed episode regressed from corridor:2/3 to corridor:1/3
Expected final state corridor:3/3 after three total RIGHT actions
Received corridor:2/3 after four total RIGHT actions`;

export const sampleInvestigation = {
  id: "BR-0830-8F2A",
  status: "diagnosis_grounded",
  mode: "fixture",
  model: "GLM-5.3 Flash via OpenCode Go",
  repository: {
    name: "thehimalayanleo/relay",
    source: "github",
    branch: "main",
    filesRead: 46,
    charsRead: 188420,
    truncated: false
  },
  incident: {
    title: "The episode that forgot where it was",
    summary: "A resumed long-horizon run reloads its observation but the environment restarts at position zero, repeating already completed work.",
    observed: "The first resumed RIGHT action returns corridor:1/3 instead of advancing from corridor:2/3.",
    expected: "Resume from corridor:2/3 and finish at corridor:3/3 in exactly three total actions."
  },
  hypotheses: [
    {
      id: "H1",
      title: "Environment state never restored",
      kind: "state",
      severity: "high",
      file: "arc-agi-3/src/relay_arc/core.py",
      lines: [80, 86],
      cause: "The checkpoint restores the serialized observation, but an older runner never restored the environment's internal position before calling step().",
      evidence: [
        "The failure regresses from corridor:2/3 to corridor:1/3 on the first resumed action.",
        "LongHorizonRunner resets the environment before loading the saved observation.",
        "The current repair calls restore(observation) when the environment supports it."
      ],
      counterevidence: ["The observation itself was serialized correctly."],
      confidence: 0.94,
      nextProbe: "Run only test_resume_restores_environment_state against the failing revision.",
      grounded: true,
      status: "captured",
      avatar: { name: "Reset Wraith", hue: 329, eyes: 2, horns: 2, gait: "float", pattern: "stripes" }
    },
    {
      id: "H2",
      title: "Action budget counted twice",
      kind: "control",
      severity: "medium",
      file: "arc-agi-3/src/relay_arc/core.py",
      lines: [88, 101],
      cause: "The resumed loop may be consuming the wrong remaining-action budget.",
      evidence: ["The final trace contains an extra RIGHT action."],
      counterevidence: ["The first incorrect state appears before budget exhaustion can matter."],
      confidence: 0.31,
      nextProbe: "Assert remaining_actions immediately before the resumed loop.",
      grounded: true,
      status: "tracked",
      avatar: { name: "Budget Muncher", hue: 47, eyes: 1, horns: 0, gait: "bounce", pattern: "spots" }
    },
    {
      id: "H3",
      title: "Checkpoint observations written out of order",
      kind: "data",
      severity: "medium",
      file: "arc-agi-3/src/relay_arc/core.py",
      lines: [41, 59],
      cause: "The store may have persisted a stale observation before the second action.",
      evidence: ["The resumed runner begins from serialized state."],
      counterevidence: ["The failure explicitly shows the saved observation at corridor:2/3."],
      confidence: 0.18,
      nextProbe: "Inspect the checkpoint JSON before constructing the resumed runner.",
      grounded: true,
      status: "tracked",
      avatar: { name: "Schema Mimic", hue: 190, eyes: 3, horns: 1, gait: "skitter", pattern: "plain" }
    }
  ],
  rootCause: {
    hypothesisId: "H1",
    file: "arc-agi-3/src/relay_arc/core.py",
    lines: [80, 86],
    explanation: "The runner reconstructed the Observation value but left CorridorWorld's private position at the reset state. The next step therefore replayed position one.",
    confidence: 0.94,
    grounded: true
  },
  candidatePatch: {
    summary: "Introduce a resumable environment protocol and restore the loaded observation before taking another action.",
    diff: `@@ LongHorizonRunner.run
 observation = self.env.reset()
 if episode.observations:
     observation = Observation(**episode.observations[-1])
+    restore = getattr(self.env, "restore", None)
+    if callable(restore):
+        restore(observation)`,
    verification: [
      "Run test_resume_restores_environment_state.",
      "Confirm exactly three total RIGHT actions.",
      "Run the full arc-agi-3 regression suite."
    ],
    applied: false,
    regressionPassed: false
  },
  challenge: {
    summary: "The budget and checkpoint-order hypotheses cannot explain why the first resumed transition starts from position zero. The missing environment restore does.",
    survivors: ["H1"],
    rejected: ["H2", "H3"]
  },
  retrieval: [
    { path: "arc-agi-3/src/relay_arc/core.py", score: 168, reasons: ["failure references line 84", "shares failure terms: observation, resumed, corridor"] },
    { path: "arc-agi-3/tests/test_core.py", score: 132, reasons: ["failure references matching test", "path matches failure vocabulary"] },
    { path: "arc-agi-3/src/relay_arc/demo.py", score: 28, reasons: ["shares failure terms: corridor, position"] },
    { path: "arc-agi-3/examples/completed-episode.json", score: 16, reasons: ["shares failure terms: actions, observations"] }
  ],
  maze: [
    { path: "failure.log", score: 200, reasons: ["incident origin"], x: 8, y: 14 },
    { path: "arc-agi-3/tests/test_core.py", score: 132, reasons: ["failing test"], x: 27, y: 14 },
    { path: "arc-agi-3/src/relay_arc/core.py", score: 168, reasons: ["traceback target"], x: 49, y: 14 },
    { path: "CheckpointStore.load", score: 76, reasons: ["state boundary"], x: 74, y: 14 },
    { path: "Environment.reset", score: 64, reasons: ["state reset"], x: 88, y: 36 },
    { path: "Observation.restore", score: 92, reasons: ["missing transition"], x: 70, y: 59 },
    { path: "CorridorWorld.step", score: 47, reasons: ["visible symptom"], x: 45, y: 79 },
    { path: "regression probe", score: 31, reasons: ["next safe action"], x: 22, y: 79 }
  ],
  timeline: [
    { id: "intake", label: "Failure secured", detail: "The incident is frozen before the hunt begins.", complete: true },
    { id: "retrieval", label: "Trail found", detail: "Traceback and failure vocabulary rank likely code paths.", complete: true },
    { id: "hypotheses", label: "Suspects released", detail: "Competing bugs get evidence, counterevidence, and a next probe.", complete: true },
    { id: "challenge", label: "Escape routes checked", detail: "A challenger attacks the leading diagnosis.", complete: true },
    { id: "capture", label: "Diagnosis captured", detail: "The winning citation passes the deterministic grounding gate.", complete: true }
  ],
  boundary: "The leading diagnosis has a checked source citation. The patch is still unverified until a regression test passes."
};
