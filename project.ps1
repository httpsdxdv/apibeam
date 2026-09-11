param(
    [Parameter(Position=0)]
    [ValidateSet('status','doctor','start','health','build-extension','logs','stop')]
    [string]$Command = 'status'
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$ServerRoot = Join-Path (Split-Path $Root -Parent) 'apibeam-api-server'
$Firefox = 'C:\Program Files\Mozilla Firefox\firefox.exe'
$Manifest = Join-Path $Root 'dist_firefox\manifest.json'
$HealthUrl = 'http://127.0.0.1:3000/app/health'

function Header([string]$Text) {
    Write-Host "`n=== $Text ==="
}

function Has-Command([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Show-GitState([string]$Name, [string]$Path) {
    Header "$Name git"
    if (!(Test-Path $Path)) {
        Write-Host "MISSING: $Path"
        return
    }
    git -C $Path status --short --branch
    git -C $Path remote -v
    git -C $Path log -3 --oneline --decorate
}

function Test-Health {
    Header 'API health'
    try {
        $response = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 5
        $response | ConvertTo-Json -Depth 10
        return $true
    } catch {
        Write-Host "NOT HEALTHY: $($_.Exception.Message)"
        return $false
    }
}

function Show-Status {
    Header 'Project'
    Write-Host "Client : $Root"
    Write-Host "Server : $ServerRoot"
    Write-Host "State  : $(Join-Path $Root 'PROJECT_STATE.md')"

    Show-GitState 'Client' $Root
    Show-GitState 'Server' $ServerRoot

    Header 'Runtime artifacts'
    Write-Host ("Firefox         : " + $(if (Test-Path $Firefox) { 'OK' } else { 'MISSING' }))
    Write-Host ("Firefox manifest: " + $(if (Test-Path $Manifest) { "OK - $Manifest" } else { "MISSING - $Manifest" }))

    Header 'Docker'
    if (Has-Command 'docker') {
        docker --version
        try { docker compose version } catch { Write-Host "Compose unavailable: $($_.Exception.Message)" }
        try { docker compose -f (Join-Path $Root 'docker-compose.yml') ps } catch { Write-Host "Compose status unavailable: $($_.Exception.Message)" }
    } else {
        Write-Host 'MISSING: docker'
    }

    [void](Test-Health)

    Header 'Resume'
    Write-Host 'Read PROJECT_STATE.md -> Next action, then continue the first unchecked task.'
}

function Show-Doctor {
    Header 'Prerequisites'
    $checks = @(
        @{ Name='git'; Present=(Has-Command 'git') },
        @{ Name='gh'; Present=(Has-Command 'gh') },
        @{ Name='docker'; Present=(Has-Command 'docker') },
        @{ Name='node'; Present=(Has-Command 'node') },
        @{ Name='npm'; Present=(Has-Command 'npm') },
        @{ Name='Firefox'; Present=(Test-Path $Firefox) },
        @{ Name='Server checkout'; Present=(Test-Path $ServerRoot) }
    )
    $checks | ForEach-Object { "{0,-18} {1}" -f $_.Name, $(if ($_.Present) {'OK'} else {'MISSING'}) }

    if (Has-Command 'git') { git --version }
    if (Has-Command 'gh') { gh auth status }
    if (Has-Command 'docker') {
        docker --version
        docker compose version
        try { docker info --format 'Docker engine: {{.ServerVersion}}' } catch { Write-Host "Docker engine unavailable: $($_.Exception.Message)" }
    }
    if (Has-Command 'node') { node --version }
    if (Has-Command 'npm') { npm --version }

    $missing = @($checks | Where-Object { -not $_.Present })
    if ($missing.Count -gt 0) {
        throw ('Missing prerequisites: ' + (($missing | ForEach-Object Name) -join ', '))
    }
}

function Build-Extension {
    Header 'Build Firefox extension'
    Set-Location $Root
    docker compose --profile tools build extension-builder
    docker compose --profile tools run --rm extension-builder
    if (!(Test-Path $Manifest)) {
        throw "Build completed but manifest was not found at $Manifest"
    }
    Write-Host "Firefox extension ready: $Manifest"
}

function Start-Project {
    Show-Doctor
    Header 'Start API server'
    Set-Location $Root
    docker compose up -d --build api
    Build-Extension
    Start-Sleep -Seconds 2
    if (!(Test-Health)) {
        Write-Host 'API did not pass health check. Recent logs:'
        docker compose logs --tail 120 api
        throw 'ApiBeam API health check failed.'
    }
    Header 'Next manual browser step'
    Write-Host 'Open Firefox -> about:debugging#/runtime/this-firefox'
    Write-Host "Load Temporary Add-on -> $Manifest"
    Write-Host 'Then open the extension and confirm it is connected; copy the room ID/base URL.'
}

switch ($Command) {
    'status' { Show-Status }
    'doctor' { Show-Doctor }
    'start' { Start-Project }
    'health' { if (!(Test-Health)) { exit 1 } }
    'build-extension' { Build-Extension }
    'logs' { Set-Location $Root; docker compose logs --tail 200 -f api }
    'stop' { Set-Location $Root; docker compose down }
}
