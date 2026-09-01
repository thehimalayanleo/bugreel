# GLM-5.3 Flash Lightning Hackathon submission draft

Nothing in this file has been submitted. The live application, public video, X post, and final submission receipt still need verification.

## Team name

BugReel

## One-line pitch

BugReel turns a failing test into a visual evidence chase where GLM-5.3 Flash proposes competing causes, but only checked source and a trusted regression can close the bug.

## Project description

BugReel starts from one observed failure rather than an open-ended coding prompt. It freezes the error evidence, retrieves two bounded source windows, and asks GLM-5.3 Flash for competing diagnoses with evidence, counterevidence, and a next discriminating test. A separate challenger and conservative resolver pressure-test the leading explanation. Deterministic grounding then checks that its cited file and line actually cover the observed failure location.

The result is a Pacman-inspired evidence chase that makes the model's investigation legible. `spotted` means a hypothesis exists. `tracked` means its citation is structurally valid. `captured` means the leading diagnosis cites source covering the observed failure. `squashed` and Ready require a bounded patch applied in a trusted isolated copy plus a passing targeted regression.

Automatic CLI intake makes the workflow practical for teams. A failing trusted test command creates a Team View card immediately, while GLM continues asynchronously. A timeout leaves the card visibly partial instead of inventing a root cause. The deterministic twenty-bug replay demonstrates concurrent orchestration and regression gating without pretending to run arbitrary public repository code or twenty simultaneous model calls.

## Why GLM-5.3 Flash is central

The product needs fast, structured reasoning over source, stack traces, and competing explanations. GLM supplies the investigation, challenger, and resolver outputs. Deterministic retrieval, citation validation, and regression execution constrain those outputs so model confidence never becomes proof by itself.

## Public links

- Repository: https://github.com/thehimalayanleo/bugreel
- Live application: https://bugreel.onrender.com
- Public demo video: TBD
- X post: TBD

## Submission gate

- [x] Exact `opencode-go/glm-5.3-flash` route verified locally
- [x] Investigator, challenger, resolver, and deterministic grounding gate
- [x] Automatic trusted-test intake with honest timeout behavior
- [x] Public MIT-licensed repository
- [x] 23 tests and production build passing
- [ ] Live GLM investigation saved as evidence
- [x] Public deployment verified anonymously
- [ ] Public demo video verified anonymously
- [ ] X post published and verified
- [ ] Final Cerebral Valley submission confirmed by Ajinkya
