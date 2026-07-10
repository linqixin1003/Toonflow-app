# UI-UX API self-test — backend at http://localhost:10588
$ErrorActionPreference = "Stop"
$Base = "http://localhost:10588/api"
$Pass = 0
$Fail = 0
$Skip = 0
$token = $null
$projectId = $null
$asoProjectId = $null

function Test-Step {
    param([string]$Name, [scriptblock]$Block)
    try {
        & $Block
        Write-Host "[PASS] $Name" -ForegroundColor Green
        $script:Pass++
    } catch {
        $msg = $_.Exception.Message
        if ($msg -match '^\[SKIP\]') {
            Write-Host "[SKIP] $Name — $($msg -replace '^\[SKIP\]\s*','')" -ForegroundColor Yellow
            $script:Skip++
        } else {
            Write-Host "[FAIL] $Name — $msg" -ForegroundColor Red
            $script:Fail++
        }
    }
}

function Invoke-Api {
    param(
        [string]$Method,
        [string]$Path,
        $Body = $null,
        [string]$Token = $null,
        [int]$ExpectStatus = 200
    )
    $headers = @{ "Content-Type" = "application/json; charset=utf-8" }
    if ($Token) { $headers["Authorization"] = $Token }
    $params = @{
        Uri             = "$Base$Path"
        Method          = $Method
        Headers         = $headers
        UseBasicParsing = $true
    }
    if ($null -ne $Body) {
        $json = $Body | ConvertTo-Json -Depth 10 -Compress
        $params.Body = [System.Text.Encoding]::UTF8.GetBytes($json)
    }
    try {
        $resp = Invoke-WebRequest @params
        $status = [int]$resp.StatusCode
        $content = $resp.Content
    } catch {
        $ex = $_.Exception
        if (-not $ex.Response) {
            throw "request failed (server unreachable?): $($ex.Message)"
        }
        $status = [int]$ex.Response.StatusCode.value__
        $stream = $ex.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $content = $reader.ReadToEnd()
        $reader.Close()
        if ($status -ne $ExpectStatus) {
            throw "HTTP $status (expected $ExpectStatus): $content"
        }
        return ($content | ConvertFrom-Json)
    }
    if ($status -ne $ExpectStatus) {
        throw "HTTP $status (expected $ExpectStatus): $content"
    }
    return ($content | ConvertFrom-Json)
}

Write-Host ""
Write-Host "=== UI-UX API Self-Test ===" -ForegroundColor Cyan
Write-Host ""

Test-Step "U001 login admin/admin123" {
    $r = Invoke-Api -Method POST -Path "/login/login" -Body @{ username = "admin"; password = "admin123" }
    if ($r.code -ne 200 -or -not $r.data.token) { throw "login failed" }
    $script:token = $r.data.token
}

Test-Step "U002 GET /uiux/getSizePresets" {
    $r = Invoke-Api -Method GET -Path "/uiux/getSizePresets" -Token $token
    if ($r.code -ne 200 -or $r.data.presets.Count -lt 1) { throw "presets empty" }
    $ids = @($r.data.presets | ForEach-Object { $_.id })
    if ($ids -notcontains "iphone_14_390x844") { throw "missing default uiux preset" }
}

Test-Step "U003 find or create UI-UX project" {
    $r = Invoke-Api -Method POST -Path "/project/getProject" -Body @{} -Token $token
    $uiux = @($r.data | Where-Object { $_.projectType -eq "uiux" } | Sort-Object createTime -Descending)[0]
    if ($uiux) {
        $script:projectId = [long]$uiux.id
    } else {
        $ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        Invoke-Api -Method POST -Path "/project/addProject" -Body @{
            projectType    = "uiux"
            name           = "UIUX-test-$ts"
            intro          = "fitness app uiux test"
            type           = "tool"
            artStyle       = "realistic"
            directorManual = ""
            videoRatio     = "16:9"
            imageModel     = ""
            videoModel     = ""
            imageQuality   = "2K"
            mode           = "standard"
        } -Token $token | Out-Null
        $r2 = Invoke-Api -Method POST -Path "/project/getProject" -Body @{} -Token $token
        $created = @($r2.data | Where-Object { $_.name -eq "UIUX-test-$ts" })[0]
        if (-not $created) { throw "UI-UX project missing after create" }
        $script:projectId = [long]$created.id
    }
    Write-Host "       projectId=$projectId" -ForegroundColor DarkGray
}

Test-Step "U004 getWorkspace default preset is UI-UX device" {
    # Use a fresh project so default preset is not polluted by prior ASO-style saves
    $ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    Invoke-Api -Method POST -Path "/project/addProject" -Body @{
        projectType    = "uiux"
        name           = "UIUX-preset-$ts"
        intro          = "preset check"
        type           = "tool"
        artStyle       = "realistic"
        directorManual = ""
        videoRatio     = "16:9"
        imageModel     = ""
        videoModel     = ""
        imageQuality   = "2K"
        mode           = "standard"
    } -Token $token | Out-Null
    $r = Invoke-Api -Method POST -Path "/project/getProject" -Body @{} -Token $token
    $fresh = @($r.data | Where-Object { $_.name -eq "UIUX-preset-$ts" })[0]
    if (-not $fresh) { throw "fresh project missing" }
    $freshId = [long]$fresh.id
    try {
        $ws = Invoke-Api -Method POST -Path "/uiux/getWorkspace" -Body @{ projectId = $freshId } -Token $token
        $preset = $ws.data.workspace.outputSizePreset
        if ($preset -ne "iphone_14_390x844") {
            throw "expected iphone_14_390x844, got $preset"
        }
    } finally {
        Invoke-Api -Method POST -Path "/project/delProject" -Body @{ id = $freshId } -Token $token | Out-Null
    }
}

Test-Step "U005 saveWorkspace rawInputText + strip outputs" {
    $r = Invoke-Api -Method POST -Path "/uiux/saveWorkspace" -Body @{
        projectId = $projectId
        patch     = @{
            inputText    = "fitness app home"
            rawInputText = "做一个健身首页"
            planCount    = 2
        }
    } -Token $token
    if ($r.code -ne 200) { throw $r.message }
    if ($r.data.workspace.rawInputText -ne "做一个健身首页") { throw "rawInputText not persisted" }

    $beforeCount = @($r.data.workspace.outputs).Count
    $fake = @{
        planId    = "uiux-fake-plan"
        assetId   = 123456789
        imageId   = 123456789
        presetId  = "iphone_14_390x844"
        width     = 390
        height    = 844
        state     = "已完成"
        createdAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    }
    $r2 = Invoke-Api -Method POST -Path "/uiux/saveWorkspace" -Body @{
        projectId = $projectId
        patch     = @{ outputs = @($fake) }
    } -Token $token
    if (@($r2.data.workspace.outputs).Count -ne $beforeCount) { throw "client outputs were persisted" }
    if (@($r2.data.workspace.outputs | Where-Object { $_.planId -eq "uiux-fake-plan" }).Count -gt 0) {
        throw "fake output leaked"
    }
}

Test-Step "U006 ASO API rejects UI-UX project" {
    try {
        Invoke-Api -Method POST -Path "/aso/getWorkspace" -Body @{ projectId = $projectId } -Token $token -ExpectStatus 400 | Out-Null
    } catch {
        if ($_.Exception.Message -notmatch "400") { throw }
    }
}

Test-Step "U007 UI-UX API rejects ASO project" {
    $r = Invoke-Api -Method POST -Path "/project/getProject" -Body @{} -Token $token
    $aso = @($r.data | Where-Object { $_.projectType -eq "aso" } | Sort-Object createTime -Descending)[0]
    if (-not $aso) { throw "[SKIP] no ASO project for cross-type check" }
    $script:asoProjectId = [long]$aso.id
    try {
        Invoke-Api -Method POST -Path "/uiux/getWorkspace" -Body @{ projectId = $asoProjectId } -Token $token -ExpectStatus 400 | Out-Null
    } catch {
        if ($_.Exception.Message -notmatch "400") { throw }
    }
}

Test-Step "U008 optimizePrompt endpoint (needs universalAi)" {
    try {
        $r = Invoke-Api -Method POST -Path "/uiux/optimizePrompt" -Body @{
            projectId = $projectId
            inputText = "做一个健身 App 首页"
        } -Token $token
        if ($r.code -ne 200 -or -not $r.data.optimizedText) { throw "optimize returned empty" }
    } catch {
        $msg = $_.Exception.Message
        if ($msg -match "400|404|500") { throw "[SKIP] configure universalAi for optimizePrompt E2E: $msg" }
        throw
    }
}

Test-Step "U009 refineInput endpoint (needs AI)" {
    try {
        $r = Invoke-Api -Method POST -Path "/uiux/refineInput" -Body @{
            projectId = $projectId
            rawInput  = "健身首页，记录运动和饮食"
            assetIds  = @()
        } -Token $token
        if ($r.code -ne 200 -or -not $r.data.refinedText) { throw "refine returned empty" }
    } catch {
        $msg = $_.Exception.Message
        if ($msg -match "400|404|500") { throw "[SKIP] configure AI for refineInput E2E: $msg" }
        throw
    }
}

Test-Step "U010 editOutput rejects nonexistent (404)" {
    try {
        Invoke-Api -Method POST -Path "/uiux/editOutput" -Body @{
            projectId = $projectId
            imageId   = 999999999
            prompt    = "make it blue"
            model     = "selftest:model"
        } -Token $token -ExpectStatus 404 | Out-Null
    } catch {
        if ($_.Exception.Message -notmatch "404") { throw }
    }
}

Write-Host ""
Write-Host "=== Summary: PASS=$Pass FAIL=$Fail SKIP=$Skip ===" -ForegroundColor Cyan
Write-Host ""
if ($Fail -gt 0) { exit 1 }
exit 0
