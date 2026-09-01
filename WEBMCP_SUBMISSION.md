# The WebMCP Challenge submission draft

Nothing in this file has been submitted. Public URLs, anonymous access, and the final Devpost receipt still need verification.

## Project name

BugReel

## Tagline

Find the bug. Prove the fix. Together.

## What it does

BugReel turns one observed failing test, stack trace, or error log into a shared visual evidence chase with three competing causes, a checked source citation, a candidate patch, and an explicit regression gate. ChatGPT can hand a failure directly into the open page through WebMCP, inspect the evolving investigation, and focus the strongest cause for the human. Every view-changing agent action leaves a factual receipt on the page. The person keeps control of the final trust boundary: only a real check in a trusted repository checkout can mark the bug verified.

## Why WebMCP is the right interface

Debugging agents usually lose context at the browser boundary. A person copies an error into chat, waits for analysis, then manually reconstructs that work in a project dashboard. BugReel exposes the dashboard's real actions as structured browser tools. The agent and human now operate on the same failure, job ID, hypotheses, citations, and verification state.

This is more than UI automation. WebMCP gives the agent a typed, bounded contract for starting work and reading results. It avoids brittle clicking, makes side effects explicit, and keeps the failure, chase, selected diagnosis, activity receipt, and verification state visible to the human.

## What people and agents do together

1. A person opens BugReel and asks ChatGPT to investigate an observed failure.
2. ChatGPT calls `start_failure_hunt` with the public repository and exact failure evidence.
3. BugReel freezes the evidence, retrieves bounded public source, and queues one GLM resolver.
4. ChatGPT calls `inspect_bugreel_workspace` to read the competing causes and current gate.
5. ChatGPT calls `show_investigation` to focus the relevant job or hypothesis in the visible page, which updates the visible activity receipt.
6. The person evaluates the cited diagnosis, applies the bounded patch in a trusted checkout, and runs the regression.

Without WebMCP, steps 2 through 5 require manual copying and navigation. With WebMCP, the agent can move the shared investigation forward while the person retains the high-consequence verification decision.

## Implementation

BugReel registers five tools with `document.modelContext.registerTool`:

- `inspect_bugreel_workspace`
- `start_failure_hunt`
- `generate_failure_probe`
- `show_investigation`
- `start_team_replay`

Each tool has a strict JSON input schema, a clear effect description, and WebMCP annotations. The registrations share the same React action bridge and API routes used by the visible controls. An `AbortController` removes registrations when the app unmounts. Browsers without WebMCP keep the complete human and CLI experience.

## Credible boundary

`diagnosis_grounded` means the model returned a structurally valid source citation covering an observed failure location. The UI calls this a leading diagnosis with a checked file and line. It does not prove the causal explanation or candidate patch. `squashed` and Ready require a patch applied in an isolated trusted copy plus a passing targeted regression. The twenty-bug replay demonstrates orchestration with controlled fixtures. It does not claim safe execution of arbitrary public repositories or twenty simultaneous GLM calls.

## Submission checklist

- [x] Non-trivial WebMCP implementation with five working tool contracts
- [x] Human interface and agent tools share the same actions and state
- [x] Ordinary-browser fallback remains usable
- [x] Focused WebMCP contract tests
- [x] Full investigation and regression test suite
- [x] Production build
- [x] Open-source license file
- [x] WebMCP calls exercised locally in ChatGPT's in-app browser
- [x] Public deployment blueprint with server-only model credential
- [x] Working public deployment verified anonymously
- [x] Public source repository verified with an MIT license
- [ ] Public demo video under three minutes with audio
- [ ] Final Devpost submission confirmed

## Links

- Live app: https://bugreel.onrender.com
- Public repository: https://github.com/thehimalayanleo/bugreel
- Demo video: TBD
