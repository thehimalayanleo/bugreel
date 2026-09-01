# BugReel WebMCP demo script

Target length: 100 to 115 seconds.

## 0:00 to 0:12, show the whole product

Open BugReel beside ChatGPT. Keep the first screen visible: observed failure on the left, evidence chase in the center, leading diagnosis on the right, and the three-part verification rail below.

Say: "A coding agent can propose a fix in chat, but the human cannot see what it inspected or what still needs proof. BugReel turns one real failure into a shared visual investigation."

## 0:12 to 0:32, start through WebMCP

Ask ChatGPT: "Use BugReel to investigate this observed Relay failure."

Show the `start_failure_hunt` call. Point to the factual receipt that appears in BugReel: `CHATGPT · Started investigation JOB-...`.

Say: "WebMCP calls the same bounded hunt as the visible form. The receipt proves that the agent changed this shared workspace."

## 0:32 to 0:58, follow competing causes

Let the hunter move through the source maze as up to three causes appear. Ask ChatGPT to inspect the workspace and focus the leading hypothesis with `show_investigation`.

Say: "GLM ranks competing explanations against bounded public source. The human can select any cause and inspect its file, line, counterevidence, and next discriminating test. The ranking is directional, not a calibrated probability."

## 0:58 to 1:20, prove the boundary

Keep the verification rail visible.

Say: "A checked citation is not a verified fix. BugReel keeps file and line checked, patch applied, and regression passed as three separate claims. Only a trusted repository checkout can close the last two gates."

Run the bundled trusted fixture through the local runner, or show the prepared passing fixture result. The final gate changes to `Regression passed`.

## 1:20 to 1:42, scale carefully

Expand Team Replay and ask ChatGPT to call `start_team_replay`. Show twenty fixture bugs moving through Inbox, Hunt, Patch, Verify, and Ready.

Say: "This deterministic replay proves concurrent orchestration and regression gating. It does not spend twenty model calls or claim that arbitrary public repositories are safe to execute."

## 1:42 to 1:52, close

Return to the first-screen chase.

Say: "One failure. One chase. One gate. The agent advances the evidence, and the regression earns the word fixed."

## Recording checklist

- Keep the video under three minutes with audible narration.
- Show at least one real WebMCP tool call and its matching visible receipt.
- Show the checked citation before the trusted regression passes.
- Keep the public URL and repository URL visible at the end.
- Do not describe the fixture replay as twenty live GLM investigations.
