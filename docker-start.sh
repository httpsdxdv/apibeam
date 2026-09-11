#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"

APIBEAM_BROWSER="${APIBEAM_BROWSER:-firefox}"
export APIBEAM_BROWSER
if [ -z "${APIBEAM_EXTENSION_OUTPUT:-}" ]; then
  if [ "$APIBEAM_BROWSER" = "chrome" ]; then
    APIBEAM_EXTENSION_OUTPUT="./dist_chrome"
  else
    APIBEAM_EXTENSION_OUTPUT="./dist_firefox"
  fi
  export APIBEAM_EXTENSION_OUTPUT
fi

echo "[1/3] Building and starting ApiBeam API server..."
docker compose up -d --build api

echo "[2/3] Building ${APIBEAM_BROWSER} extension in Docker..."
docker compose --profile tools build extension-builder
docker compose --profile tools run --rm extension-builder

echo "[3/3] ApiBeam is ready."
echo "API server: http://localhost:3000"
echo "Extension folder: $(pwd)/${APIBEAM_EXTENSION_OUTPUT#./}"
if [ "$APIBEAM_BROWSER" = "chrome" ]; then
  echo "Open chrome://extensions, enable Developer mode, choose Load unpacked, and select dist_chrome."
else
  echo "Open about:debugging#/runtime/this-firefox, click Load Temporary Add-on, and select dist_firefox/manifest.json."
  echo "Firefox temporary add-ons must be reloaded after restarting Firefox."
fi
echo "Keep ChatGPT logged in and open. The extension defaults to the local Docker API server."

docker compose ps
