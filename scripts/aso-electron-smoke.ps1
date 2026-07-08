# T071 - Electron / bundled web smoke checks for ASO workbench
$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$Pass = 0
$Fail = 0
$Base = "http://localhost:10588/api"

function Step {
    param([string]$Name, [scriptblock]$Block)
    try {
        & $Block
        Write-Host "[PASS] $Name" -ForegroundColor Green
        $script:Pass++
    } catch {
        Write-Host "[FAIL] $Name - $($_.Exception.Message)" -ForegroundColor Red
        $script:Fail++
    }
}

Write-Host ""
Write-Host "=== ASO Electron Smoke (T071) ===" -ForegroundColor Cyan
Write-Host ""

Step "S01 electron package present" {
    $electronPkg = Join-Path $Root "node_modules\electron\package.json"
    if (-not (Test-Path $electronPkg)) { throw "run yarn install in toonflow root" }
}

Step "S02 dev:gui script defined" {
    $raw = Get-Content (Join-Path $Root "package.json") -Raw -Encoding UTF8
    if ($raw -notmatch '"dev:gui"\s*:') { throw "dev:gui script missing" }
}

Step "S03 bundled web contains ASO route" {
    $html = Get-Content (Join-Path $Root "data\web\index.html") -Raw
    if ($html -notmatch '/aso') { throw "/aso route not found in data/web/index.html" }
    if ($html -notmatch 'ASO') { throw "ASO strings not found in bundle" }
}

Step "S04 ASO API reachable (server on :10588)" {
    try {
        $login = Invoke-WebRequest -Uri "$Base/login/login" -Method POST `
            -Headers @{ "Content-Type" = "application/json" } `
            -Body '{"username":"admin","password":"admin123"}' `
            -UseBasicParsing -TimeoutSec 10
        $r = $login.Content | ConvertFrom-Json
        if ($r.code -ne 200) { throw "login failed" }
        $token = $r.data.token
        $presets = Invoke-WebRequest -Uri "$Base/aso/getSizePresets" -Method GET `
            -Headers @{ "Authorization" = $token } -UseBasicParsing -TimeoutSec 10
        $p = $presets.Content | ConvertFrom-Json
        if ($p.code -ne 200) { throw "getSizePresets failed" }
    } catch {
        throw "backend not running on :10588 - start yarn dev or yarn dev:gui first"
    }
}

Step "S05 electron binary launches" {
    $electronExe = Join-Path $Root "node_modules\electron\dist\electron.exe"
    if (-not (Test-Path $electronExe)) { throw "electron.exe not found" }
    $probeFile = Join-Path $env:TEMP "toonflow-electron-probe.js"
    $outFile = Join-Path $env:TEMP "toonflow-electron-out.txt"
    @"
const { app } = require('electron');
app.whenReady().then(() => { console.log('ELECTRON_OK'); app.quit(); });
"@ | Set-Content -Path $probeFile -Encoding UTF8
    $proc = Start-Process -FilePath $electronExe -ArgumentList $probeFile -Wait -PassThru `
        -RedirectStandardOutput $outFile -RedirectStandardError "$env:TEMP\toonflow-electron-err.txt"
    $out = if (Test-Path $outFile) { Get-Content $outFile -Raw } else { "" }
    Remove-Item $probeFile, $outFile -Force -ErrorAction SilentlyContinue
    if ($proc.ExitCode -ne 0 -or $out -notmatch 'ELECTRON_OK') {
        throw "electron probe failed (exit $($proc.ExitCode)): $out"
    }
}

Write-Host ""
Write-Host "=== Summary: PASS=$Pass FAIL=$Fail ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Manual: run 'yarn dev:gui', open an ASO project, verify canvas + inspector." -ForegroundColor DarkGray
Write-Host ""
if ($Fail -gt 0) { exit 1 }
exit 0
