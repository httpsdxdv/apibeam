# ApiBeam Automation Worklog

Purpose: persistent handoff state for ChatGPT/terminal sessions.

## Current goal
Make httpsdxdv/apibeam + apibeam-api-server work end-to-end on this Windows PC with Firefox, Docker, and Cline, and automate startup/validation as much as possible.

## Machine
- Windows 11, user: httpsdxdv\dex
- Firefox 155.0.1: C:\Program Files\Mozilla Firefox\firefox.exe
- Docker 29.7.2 / Compose 5.5.0
- Node 24.19.0 / npm 12.0.2
- Git 2.55.0 / gh 2.100.0 authenticated as httpsdxdv
- VS Code 1.137.0
- Cline extension: C:\Users\dex\.vscode\extensions\saoudrizwan.claude-dev-4.1.17

## Repositories
- Active clean fork: C:\Users\dex\Documents\apibeam -> httpsdxdv/apibeam
- Old upstream checkout with local edits: C:\Users\dex\apibeam (DO NOT overwrite)
- Server fork: httpsdxdv/apibeam-api-server (not yet cloned locally)

## GitHub state
- Firefox/Cline/Docker fixes merged to main in both forks.
- CI passed for Firefox + Chrome + Docker and server + Docker.

## Next steps
1. Start Docker stack and build Firefox extension locally.
2. Inspect Firefox profiles and automate temporary extension loading using web-ext or a dedicated profile while preserving ChatGPT login.
3. Verify extension socket connection and discover room ID.
4. Test /models and real chat completion end to end.
5. Inspect/configure Cline to use the working local base URL.
6. Run a real Cline request and verify response path.
7. Add durable startup/health-check scripts and update this worklog with exact commands/status.
## 2026-09-11 - Project continuity checkpoint
- Confirmed active client fork: `C:\Users\dex\Documents\apibeam` -> `httpsdxdv/apibeam`.
- Confirmed legacy upstream checkout `C:\Users\dex\apibeam` has local changes and must not be overwritten.
- Cloned server fork to `C:\Users\dex\Documents\apibeam-api-server` from `httpsdxdv/apibeam-api-server`.
- Added `AGENTS.md`, `PROJECT_STATE.md`, and `project.ps1` to make project state/resume behavior repository-driven rather than dependent on chat history.
- Next verification: run `./project.ps1 doctor`, then `./project.ps1 start`, then validate Firefox connection/room ID and real API requests.

## 2026-09-11 - User operating protocol captured
- User approved autonomous editing/testing/process management, normal branch->PR->CI workflow, ordinary dependency installation, dedicated Firefox automation, and Cline configuration changes.
- Must ask before destructive/irreversible operations.
- Every logical program change must be reversible and exactly reported.
- Prefer D: for working data; created D:\AIWorkspace control center, backups, logs, and DPAPI secret storage.
- Live status dashboard/log created at D:\AIWorkspace\AgentControl.
- Created .ai project state/decisions/todo/tests/changes files.
- Pre-change rollback snapshot: D:\AIWorkspace\Backups\apibeam-20260911-110045.
- Deterministic local room local-cline is the current unmerged runtime change; extension build passed after that edit.


## 2026-09-14 - Firefox relay completion
- Fixed Firefox MV3 event-page suspension by holding an `apibeam-keepalive` runtime port from the dedicated ChatGPT worker tab.
- Added a DOM response fallback for current ChatGPT UI behavior when the legacy SSE fetch interceptor does not emit a parseable response event.
- Docker Firefox + Chrome production builds PASS.
- Live status PASS: `connected=true`, `httpBridgeConnected=true`, `socketConnected=false`.
- `/v1/models` PASS with `gpt-5.6-sol` and `gpt-4o`.
- `/v1/chat/completions` PASS: exact `APIBEAM_REAL_OK_2` returned in OpenAI chat-completion JSON.
- Two consecutive chat completions PASS: `CHAT_ONE_OK`, `CHAT_TWO_OK`.
- `/v1/responses` PASS: exact `RESPONSES_OK` in Responses-style envelope.
- Streaming chat PASS: `text/event-stream` chunks returned `STREAM_OK` followed by `[DONE]`.
- Working local OpenAI-compatible base URL: `http://127.0.0.1:3000/app/local-cline/v1`.
- The server currently does not enforce API-key authentication; clients that require a non-empty key can use a local placeholder such as `apibeam-local`.
