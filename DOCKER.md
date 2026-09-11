# ApiBeam local Docker setup

This fork runs the **API relay server in Docker** and uses Docker to **build the browser extension**. The extension itself runs in your normal host browser because it must use your authenticated ChatGPT session.

The default browser for this fork is **Firefox**. Chrome remains available by setting `APIBEAM_BROWSER=chrome`.

## Requirements

- Docker Desktop with Docker Compose
- Firefox
- A logged-in ChatGPT session

## One-command start (Windows PowerShell)

```powershell
.\docker-start.ps1
```

Linux/macOS:

```bash
./docker-start.sh
```

The command:

1. Builds/starts the patched API server on `127.0.0.1:3000`.
2. Builds the Firefox extension in Docker.
3. Writes the unpacked extension to `./dist_firefox`.

Then open:

```text
about:debugging#/runtime/this-firefox
```

Choose **Load Temporary Add-on** and select:

```text
dist_firefox/manifest.json
```

Firefox removes temporary add-ons when Firefox exits, so after restarting Firefox you must load `dist_firefox/manifest.json` again. The Docker server can stay running.

The fork defaults to `http://localhost:3000/` and automatically attempts to connect. Open the extension settings to copy the room-specific API URL:

```text
http://localhost:3000/app/<ROOM_ID>
```

Use that URL as the OpenAI-compatible base URL in Cline. An API key is not required; use any non-empty placeholder if Cline requires one.

## Cline model discovery

The Docker server answers `/models` and `/v1/models` locally instead of sending model-discovery requests into ChatGPT. Default models:

- `gpt-5.6-sol`
- `gpt-4o`

Override them before startup if desired:

```powershell
$env:APIBEAM_MODELS="gpt-5.6-sol,gpt-4o"
.\docker-start.ps1
```

## What this fork fixes

- Serializes browser requests so Cline cannot submit multiple prompts at once and interrupt ChatGPT generation.
- Gives every HTTP request a unique request ID so concurrent requests cannot overwrite one another on the server.
- Answers `/models` locally.
- Filters unrelated page `window.postMessage` traffic such as MetaMask events instead of treating them as AI responses.
- Normalizes fallback responses into OpenAI-compatible `chat/completions` / `responses` envelopes.
- Emits compatible SSE chunks for streamed chat-completion responses, including tool calls.
- Returns JSON API errors instead of HTML timeout pages.
- Increases the default browser-response timeout to 180 seconds (configurable with `APIBEAM_REQUEST_TIMEOUT_MS`).
- Defaults the extension to the local Docker server and reconnects Socket.IO automatically after server restarts.
- Allows both `moz-extension://` and `chrome-extension://` origins on the local relay server.

## Optional Chrome build

PowerShell:

```powershell
$env:APIBEAM_BROWSER="chrome"
$env:APIBEAM_EXTENSION_OUTPUT="./dist_chrome"
.\docker-start.ps1
```

Linux/macOS:

```bash
APIBEAM_BROWSER=chrome APIBEAM_EXTENSION_OUTPUT=./dist_chrome ./docker-start.sh
```

## Useful commands

```powershell
# status
docker compose ps

# logs
docker compose logs -f api

# stop
docker compose down

# rebuild Firefox extension only
docker compose --profile tools build extension-builder
docker compose --profile tools run --rm extension-builder
```

## Test without Cline

After the extension says connected, copy its room ID and run:

```powershell
curl.exe "http://localhost:3000/app/<ROOM_ID>/test-me?message=Reply%20with%20hello"
```

Model discovery should return immediately without creating a ChatGPT message:

```powershell
curl.exe "http://localhost:3000/app/<ROOM_ID>/models"
```
