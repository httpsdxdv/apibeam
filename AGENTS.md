# AGENTS.md - ApiBeam Project Operating Rules

This repository is the coordination point for the ApiBeam local relay project.

## Mission
Make ApiBeam work end-to-end on this Windows 11 machine with Firefox, Docker, and Cline: Cline sends OpenAI-compatible requests to the local ApiBeam server, the Firefox extension relays them through the authenticated ChatGPT web session, and the answer returns correctly to Cline.

## Canonical project locations
- Client/extension/coordinator: `C:\Users\dex\Documents\apibeam` -> `httpsdxdv/apibeam`
- API server: `C:\Users\dex\Documents\apibeam-api-server` -> `httpsdxdv/apibeam-api-server`
- Legacy upstream checkout: `C:\Users\dex\apibeam` -> `NiteshSingh17/apibeam` (DO NOT overwrite or clean; it contains unrelated local edits)

## Resume protocol - always do this first
1. Read `PROJECT_STATE.md`.
2. Read the latest section of `CHATGPT_WORKLOG.md`.
3. Run `./project.ps1 status` from this repository.
4. Inspect `git status` in both canonical repositories.
5. Continue from `Next action` in `PROJECT_STATE.md` unless new evidence makes it obsolete.

Do not ask the user to repeat information already captured in these files. Prefer verifying state with the terminal or GitHub.

## Working rules
- The repository is the persistent memory for this project; chat history is supplementary.
- Use the authorized Windows terminal and GitHub proactively for project work.
- Before code changes, create a focused branch unless the change is an emergency hotfix or a trivial state-only checkpoint.
- Never force-push, delete uncommitted user work, reset another checkout, or commit secrets/tokens/cookies.
- Keep the client and server repositories independently buildable and testable.
- After meaningful code changes, run the relevant build/tests and record the result.
- Push useful checkpoints to GitHub so another session can recover even if the current session ends unexpectedly.
- Keep `PROJECT_STATE.md` concise and current. Keep `CHATGPT_WORKLOG.md` append-only for historical detail.
- When a blocker is discovered, record: symptom, evidence, attempted fixes, exact next command/experiment.

## Checkpoint protocol
Before ending a work session, or after any major milestone:
1. Update `PROJECT_STATE.md` with verified current state and the single best next action.
2. Append a timestamped entry to `CHATGPT_WORKLOG.md`.
3. Commit and push completed/validated work when appropriate.
4. Leave both repositories with an explicit `git status` recorded in the worklog if there are intentional uncommitted changes.

## Definition of done
The project is complete when all are true:
- Docker starts the API server reliably from the client repo.
- Firefox extension builds reproducibly and can be loaded/reloaded with documented or automated steps.
- Extension connects to the local server and a room ID can be obtained reliably.
- `/models` and `/v1/models` respond locally without generating a ChatGPT message.
- A real non-streaming OpenAI-compatible chat request returns the ChatGPT response.
- A real streaming request works, including tool-call events required by Cline.
- Cline is configured to the local room base URL and completes a real coding request successfully.
- Restart/recovery flow is documented and tested.
- CI is green for both `httpsdxdv/apibeam` and `httpsdxdv/apibeam-api-server`.

## Primary commands
```powershell
./project.ps1 status
./project.ps1 doctor
./project.ps1 start
./project.ps1 health
./project.ps1 build-extension
./project.ps1 logs
./project.ps1 stop
```

## User-approved global operating protocol
- Read D:\AIWorkspace\AGENT_PROTOCOL.md before substantial work.
- Prefer D:\AIWorkspace for new repos/caches/backups/logs.
- Publish periodic progress with D:\AIWorkspace\AgentControl\Set-AgentStatus.ps1.
- Use DPAPI local prompts for secrets; never ask for plaintext keys in chat when avoidable.
- Every logical change must have a rollback path and exact change/test reporting.

