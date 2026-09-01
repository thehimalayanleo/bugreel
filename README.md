# BugReel

**One failure. One chase. One gate.**

BugReel turns one failing test, stack trace, or error log into a shared visual investigation with competing causes, a checked source citation, a bounded patch, and an explicit regression gate. The primary screen keeps the observed failure, arcade evidence chase, leading diagnosis, and verification state visible together.

With WebMCP, ChatGPT can hand that failure into the page, inspect the competing causes, and focus the result for the human. The browser agent and the person share one visible investigation instead of copying state between chat and a separate debugging dashboard.

```text
observed failure + repository
              |
              v
       bounded source trail
              |
              v
     three competing diagnoses
              |
              v
       checked file and line
              |
              v
candidate patch -> trusted regression -> done
```

## WebMCP collaboration

BugReel progressively registers five tools through `document.modelContext.registerTool` when the browser supports WebMCP:

- `inspect_bugreel_workspace` reads the staged failure, current investigation, queue, and verification boundary.
- `start_failure_hunt` sends an observed failure into the existing bounded GLM investigation route.
- `generate_failure_probe` creates a source-cited synthetic test idea that remains unobserved until a human runs it.
- `show_investigation` brings a queued result or competing cause into the visible page.
- `start_team_replay` loads twenty deterministic patch and regression fixtures without spending model calls.

The tools call the same React actions and server routes as the human interface. There is no hidden agent-only workflow. Mutating and view-changing tool calls also leave a factual activity receipt on the visible page so the human can see what the agent changed. Tool registrations use an `AbortController` for cleanup, strict JSON schemas, read-only annotations where appropriate, and explicit descriptions of side effects and trust boundaries.

In an ordinary browser, BugReel remains fully usable and labels the integration `WEBMCP READY`. In ChatGPT's in-app browser, or Chrome with WebMCP testing enabled, the header reports `5 TOOLS` after registration.

The collaboration boundary is deliberate: an agent may organize evidence and propose a diagnosis, but only a trusted checkout may apply a patch and pass the regression gate.

Each hypothesis receives a deterministic bug avatar. The avatar is presentation, while its state has a strict meaning:

- `spotted`: a hypothesis exists.
- `tracked`: its source citation is structurally valid.
- `cornered`: the leading diagnosis is plausible but does not cover the observed failure.
- `captured`: the diagnosis cites valid source covering the observed failure.
- `squashed`: the patch was applied in an isolated copy and its targeted regression passed.

## Run both surfaces

OpenCode 1.18.15 or newer must be authenticated with OpenCode Go for live GLM calls:

```bash
opencode auth login
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`.

To exercise the WebMCP surface, open that page in ChatGPT's in-app browser. For local Chrome testing, enable `chrome://flags/#enable-webmcp-testing`, restart Chrome, and open the page.

Run the same investigation artifact in the terminal:

```bash
npm run bugreel -- --repo . --run "npm test" --server http://127.0.0.1:8787
npm run demo:cli
npm run bugreel -- --repo . --failure-file ./failure.log
npm run bugreel -- --repo https://github.com/owner/repo --failure-file ./failure.log --json
```

The automatic command runs one trusted local test command. A passing command creates nothing. A failing command is captured immediately in Team View, then the CLI reads the local checkout and updates the same card with a GLM diagnosis or an honest timeout. No failure log or expected-behavior field is required.

The CLI accepts local repositories. A live local hunt sends only bounded source evidence to OpenCode Go. Use the bundled fixture when source must remain offline. The browser never executes repository code.

For a deployed server without the OpenCode CLI, set `OPENCODE_GO_API_KEY` in the server environment. The browser never receives the credential.

## Investigation engine

1. Freeze the failure evidence before inference.
2. Rank files using traceback locations, filenames, and failure vocabulary.
3. Send only the highest-signal bounded source to the investigator.
4. Require competing hypotheses with evidence, counterevidence, confidence, and a next probe.
5. Run a separate challenger pass.
6. Resolve conservatively.
7. Validate file and line citations deterministically.
8. Keep public-repository patches unverified until a trusted checkout can run their regression.
9. Apply and test bundled trusted fixtures in isolated temporary folders.

## Team replay

The team replay is deliberately secondary to the one-failure path. Expand it after the primary chase makes sense. Each fixture bug has one readable state: Inbox, Hunt, Patch, Verify, or Ready. Repository retrieval and deterministic provisional triage can overlap. GLM work enters a bounded FIFO queue with one active model slot, while trusted patch and regression workers run independently.

- `POST /api/investigations` starts a failure-led investigation.
- `POST /api/failure-samples` starts a GLM-generated, source-cited synthetic probe.
- `POST /api/demo-swarm` starts twenty trusted fixture workers and runs their patch plus targeted regression gates concurrently.
- `POST /api/imports` immediately captures a trusted local CLI failure in Team View.
- `PUT /api/imports/:id` updates that same card with the completed or partial investigation.
- `GET /api/investigations` returns jobs plus active and queued model counts.
- `GET /api/investigations/:id` returns one investigation or sampler job.

The failure sampler never claims it observed a bug. Every generated artifact begins with `SYNTHETIC PROBE - NOT OBSERVED`. It becomes real failure evidence only after its proposed command or test is executed and actually fails.

The 20-bug replay uses generated Python fixtures controlled by BugReel. Each worker first proves its regression fails, applies a bounded source change in an isolated temporary folder, and reruns `python3 -B -m unittest discover`. This proves orchestration and regression gating. It does not prove that arbitrary public repository code is safe to execute or that twenty GLM calls run simultaneously.

## Verify

```bash
npm test
npm run build
npm run demo:cli
```

The test suite includes WebMCP tool-contract coverage alongside the investigation, grounding, timeout, and trusted-fixture regression tests.

## Deploy

The repository includes `render.yaml` for a single Node web service. The service builds the Vite client, serves `dist`, and exposes the API from the same origin.

1. Push this repository to a public Git host.
2. Create a Render Blueprint from `render.yaml`.
3. Set `OPENCODE_GO_API_KEY` as a secret environment variable.
4. Verify `/api/health`, the primary evidence chase, and all five WebMCP tools from an anonymous browser session.

Local development binds to `127.0.0.1`. The Render blueprint sets `HOST=0.0.0.0` for the public service. The API credential remains server-side and is never sent to the browser.

## Entry packets

BugReel uses one product, repository, deployment, and under-three-minute demo for two distinct entries:

- [`GLM_SUBMISSION.md`](./GLM_SUBMISSION.md) leads with bounded GLM reasoning and evidence gates.
- [`WEBMCP_SUBMISSION.md`](./WEBMCP_SUBMISSION.md) leads with typed human-agent collaboration.
- [`HACKATHON_ENTRIES.md`](./HACKATHON_ENTRIES.md) records the shared-artifact strategy and claim boundary.
- [`SHARED_DEMO_SCRIPT.md`](./SHARED_DEMO_SCRIPT.md) is the single under-three-minute proof sequence for both entries.

## Evidence boundary

`diagnosis_grounded` means the model returned a structurally valid source citation that covers an observed failure location. It does not prove the causal explanation or candidate patch. A bug reaches Ready only after a real targeted regression passes in a trusted execution boundary.
