$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not $env:APIBEAM_BROWSER) { $env:APIBEAM_BROWSER = "firefox" }
if (-not $env:APIBEAM_EXTENSION_OUTPUT) {
  if ($env:APIBEAM_BROWSER -eq "chrome") {
    $env:APIBEAM_EXTENSION_OUTPUT = "./dist_chrome"
  } else {
    $env:APIBEAM_EXTENSION_OUTPUT = "./dist_firefox"
  }
}

Write-Host "[1/3] Building and starting ApiBeam API server..."
docker compose up -d --build api

Write-Host "[2/3] Building $($env:APIBEAM_BROWSER) extension in Docker..."
docker compose --profile tools build extension-builder
docker compose --profile tools run --rm extension-builder

Write-Host "[3/3] ApiBeam is ready."
Write-Host "API server: http://localhost:3000"
Write-Host "Extension folder: $PSScriptRoot\$($env:APIBEAM_EXTENSION_OUTPUT.TrimStart('./'))"

if ($env:APIBEAM_BROWSER -eq "chrome") {
  Write-Host "Open chrome://extensions, enable Developer mode, choose Load unpacked, and select dist_chrome."
} else {
  Write-Host "Open about:debugging#/runtime/this-firefox, click Load Temporary Add-on, and select dist_firefox\manifest.json."
  Write-Host "Firefox temporary add-ons must be reloaded after restarting Firefox."
}

Write-Host "Keep ChatGPT logged in and open. The extension defaults to the local Docker API server."
docker compose ps
