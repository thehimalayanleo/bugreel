# BugReel shared demo script

Target length: 105 to 115 seconds. This one video supports both entries.

## 0:00 to 0:12, hook

Show the complete first screen: observed failure, evidence chase, leading diagnosis, and verification rail.

Say: "Coding agents can propose a fix, but the evidence often disappears inside chat. BugReel turns one real failure into a chase you can inspect, challenge, and close only when the regression passes."

## 0:12 to 0:37, prove the GLM engine

Start the bundled Relay failure. Show up to three bug avatars entering the chase and open the leading cause.

Say: "GLM-5.3 Flash investigates two bounded source windows, returns competing diagnoses, and proposes the next discriminating test. A challenger pressure-tests the favorite before BugReel checks its cited file and line."

Pause on the counterevidence and citation.

Say: "Tracked means cited. Captured means the citation covers the observed failure. Neither word means the patch is fixed."

## 0:37 to 1:02, prove WebMCP collaboration

Keep BugReel beside ChatGPT. Ask: "Inspect this BugReel workspace and focus the leading diagnosis."

Show the WebMCP call to `inspect_bugreel_workspace`, then `show_investigation`. Point to the matching visible receipt in BugReel.

Say: "WebMCP gives ChatGPT seven typed BugReel tools. The agent can start asynchronous work, retrieve the exact job, and stage the next human action without scraping the page. Both sides share the same hypotheses, citations, and visible state."

## 1:02 to 1:25, prove the trust boundary

Hold on the three verification gates, then run or reveal the bundled trusted fixture result.

Say: "A grounded diagnosis is still only a leading explanation. Patch applied and regression passed are separate claims. Only a trusted isolated checkout can earn Ready."

## 1:25 to 1:43, show team scale

Ask ChatGPT to call `start_team_replay`. Show twenty controlled fixture bugs moving through Hunt, Patch, Verify, and Ready.

Say: "The team replay proves concurrent orchestration and real regression gates over controlled fixtures. It does not pretend to execute arbitrary repositories or spend twenty simultaneous model calls."

## 1:43 to 1:52, close

Return to the chase and keep the public URL and repository visible.

Say: "One failure. One chase. One gate. GLM advances the evidence, WebMCP keeps people and agents together, and the regression earns the word fixed."

## Recording gate

- Record the deployed HTTPS application, not localhost.
- Keep the final cut under three minutes with audible narration.
- Show one live GLM investigation or preserve an honest partial timeout.
- Show at least one real WebMCP call and its visible receipt.
- Never show API keys, private URLs, or browser credentials.
- Verify anonymous YouTube playback before using the link.
