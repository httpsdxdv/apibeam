# ApiBeam Project State

Last updated: 2026-09-14 (America/Sao_Paulo)

## Goal
Deliver a reliable local ApiBeam setup on Windows 11 where Firefox uses the signed-in ChatGPT web session as the backend for OpenAI-compatible requests from Cline.

## Source of truth
1. This file = current state and next action.
2. `CHATGPT_WORKLOG.md` = chronological evidence/history.
3. GitHub commits/CI = durable implementation history.
4. Chat history = supplementary context only.

## Canonical repositories
- Client: `C:\Users\dex\Documents\apibeam` / `httpsdxdv/apibeam`
- Server: `C:\Users\dex\Documents\apibeam-api-server` / `httpsdxdv/apibeam-api-server`
- Do not modify legacy checkout: `C:\Users\dex\apibeam`

## Verified state
- Client fork main contains Firefox-first relay fixes, Docker workflow, and CI.
- Server fork main contains request serialization/concurrency fixes, local model discovery, response normalization/SSE support, Docker workflow, and CI.
- Client CI previously passed for Firefox, Chrome, and Docker builds.
- Server CI previously passed for server and Docker builds.
- Server fork is now cloned locally beside the client repo.
- Firefox is the primary target browser.
- Local relay target is `http://127.0.0.1:3000` / `http://localhost:3000`.
- Current completion phase: local OpenAI-compatible relay is verified end-to-end; optional next phase is client integration/startup automation.

## Current branch / checkpoint
Firefox DOM relay hardening is validated on `fix/dom-response-normalization` at commits `507230e` and `ff3cbe4`.

## Next action
Use `http://127.0.0.1:3000/app/local-cline/v1` in Cline and run a real coding request. The Firefox HTTP bridge, consecutive non-streaming calls, streaming SSE, and `/v1/responses` are all verified after the DOM relay fix. Then automate temporary-addon startup/recovery.

## Immediate task queue
- [ ] Validate local prerequisites and Docker health.
- [ ] Start/rebuild API server and Firefox extension.
- [ ] Load/reload extension in Firefox while preserving the existing ChatGPT login.
- [ ] Confirm server connection and capture room ID.
- [ ] Verify `/models` and `/v1/models`.
- [ ] Verify a real non-streaming completion through ChatGPT.
- [ ] Verify streaming/tool-call path required by Cline.
- [ ] Configure Cline against `http://localhost:3000/app/<ROOM_ID>`.
- [ ] Run a real Cline coding request and verify the response reaches Cline.
- [ ] Automate the remaining manual startup/reload/health steps where practical.
- [ ] Re-run CI/local builds and close the project tracker when definition of done is satisfied.

## Known constraints
- Firefox temporary add-ons normally disappear after Firefox exits.
- The extension must run in the host browser because it uses the authenticated ChatGPT session.
- Do not store ChatGPT session cookies, GitHub tokens, or other credentials in the repository.
- `C:\Users\dex\apibeam` has unrelated local modifications and must not be cleaned/reset.

## Recovery rule
If a session ends unexpectedly, the next session should not reconstruct history from chat. It should read this file, run `./project.ps1 status`, inspect the latest worklog entry, and continue the unchecked task nearest to `Next action`.
