import test from "node:test";
import assert from "node:assert/strict";
import { createBugReelToolDefinitions } from "./webmcp.js";

function readResult(result) {
  return JSON.parse(result.content[0].text);
}

test("publishes the bounded BugReel WebMCP surface", () => {
  const definitions = createBugReelToolDefinitions(() => ({}));
  assert.deepEqual(definitions.map((tool) => tool.name), [
    "inspect_bugreel_workspace",
    "start_failure_hunt",
    "generate_failure_probe",
    "inspect_bugreel_job",
    "stage_failure_probe",
    "show_investigation",
    "start_team_replay"
  ]);
  assert.equal(new Set(definitions.map((tool) => tool.name)).size, definitions.length);
  assert.equal(definitions[0].annotations.readOnlyHint, true);
  assert.equal(definitions[1].annotations.readOnlyHint, false);
});

test("inspect_bugreel_job retrieves one asynchronous result without changing it", async () => {
  const definitions = createBugReelToolDefinitions(() => ({
    inspectJob: ({ jobId }) => ({ id: jobId, status: "complete", probe: { synthetic: true } })
  }));
  const tool = definitions.find((item) => item.name === "inspect_bugreel_job");
  const result = await tool.execute({ jobId: "JOB-PROBE7" });
  assert.deepEqual(readResult(result), { id: "JOB-PROBE7", status: "complete", probe: { synthetic: true } });
  assert.equal(tool.annotations.readOnlyHint, true);
});

test("stage_failure_probe delegates the explicit job and preserves the synthetic boundary", async () => {
  const observed = [];
  const definitions = createBugReelToolDefinitions(() => ({
    stageProbe: (input) => {
      observed.push(input);
      return { jobId: input.jobId, staged: true, synthetic: true };
    }
  }));
  const tool = definitions.find((item) => item.name === "stage_failure_probe");
  const result = await tool.execute({ jobId: "JOB-PROBE7" });
  assert.deepEqual(observed, [{ jobId: "JOB-PROBE7" }]);
  assert.deepEqual(readResult(result), { jobId: "JOB-PROBE7", staged: true, synthetic: true });
  assert.equal(tool.annotations.readOnlyHint, false);
});

test("inspect returns the current workspace without starting work", async () => {
  let started = false;
  const definitions = createBugReelToolDefinitions(() => ({
    inspect: () => ({ mode: "fixture", verification: { regressionPassed: false } }),
    startHunt: () => { started = true; }
  }));
  const result = await definitions[0].execute({});
  assert.deepEqual(readResult(result), { mode: "fixture", verification: { regressionPassed: false } });
  assert.equal(started, false);
});

test("start_failure_hunt forwards only the explicit tool input", async () => {
  const observed = [];
  const definitions = createBugReelToolDefinitions(() => ({
    startHunt: async (input) => {
      observed.push(input);
      return { id: "hunt-7", status: "queued" };
    }
  }));
  const input = {
    repoUrl: "https://github.com/example/repo",
    failure: "AssertionError: expected 4, got 3",
    expected: "returns four items"
  };
  const result = await definitions[1].execute(input);
  assert.deepEqual(observed, [input]);
  assert.deepEqual(readResult(result), { id: "hunt-7", status: "queued" });
});

test("show_investigation delegates visible focus to the app", async () => {
  const definitions = createBugReelToolDefinitions(() => ({
    showInvestigation: ({ jobId, hypothesisId }) => ({ jobId, hypothesisId, visible: true })
  }));
  const tool = definitions.find((item) => item.name === "show_investigation");
  const result = await tool.execute({ jobId: "hunt-2", hypothesisId: "cause-b" });
  assert.deepEqual(readResult(result), { jobId: "hunt-2", hypothesisId: "cause-b", visible: true });
});
