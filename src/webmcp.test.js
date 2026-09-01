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
    "show_investigation",
    "start_team_replay"
  ]);
  assert.equal(new Set(definitions.map((tool) => tool.name)).size, definitions.length);
  assert.equal(definitions[0].annotations.readOnlyHint, true);
  assert.equal(definitions[1].annotations.readOnlyHint, false);
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
  const result = await definitions[3].execute({ jobId: "hunt-2", hypothesisId: "cause-b" });
  assert.deepEqual(readResult(result), { jobId: "hunt-2", hypothesisId: "cause-b", visible: true });
});
