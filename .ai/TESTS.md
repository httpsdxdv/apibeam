# ApiBeam Tests

## Passed
- 2026-09-11: server Docker image build.
- 2026-09-11: server health endpoint `/app/health` returns status ok.
- 2026-09-11: Firefox production extension build.
- 2026-09-11: Chrome production extension build.
- 2026-09-11: Firefox `web-ext lint` returned 0 errors (4 warnings).
- 2026-09-11: Firefox remote debugging confirmed ApiBeam temporary extension installed with background worker RUNNING.

## Pending after deterministic-room rebuild
- Extension Socket.IO room connection.
- Local model discovery.
- Non-streaming completion.
- Streaming/tool calls.
- Cline end-to-end coding request.
- Restart/recovery test.
