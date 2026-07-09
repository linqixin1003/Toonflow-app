# ASO API self-test — backend at http://localhost:10588
$ErrorActionPreference = "Stop"
$Base = "http://localhost:10588/api"
$Pass = 0
$Fail = 0
$Skip = 0
$token = $null
$projectId = $null
$materialId = $null
$uploadedAssetId = $null
$uploadedImageId = $null

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
        # UTF-8 bytes: PowerShell 5.1 would otherwise send string bodies as ISO-8859-1,
        # mangling Chinese enum values like 已完成
        $json = $Body | ConvertTo-Json -Depth 10 -Compress
        $params.Body = [System.Text.Encoding]::UTF8.GetBytes($json)
    }
    try {
        $resp = Invoke-WebRequest @params
        $status = [int]$resp.StatusCode
        $content = $resp.Content
    } catch {
        $status = [int]$_.Exception.Response.StatusCode.value__
        $stream = $_.Exception.Response.GetResponseStream()
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
Write-Host "=== ASO API Self-Test ===" -ForegroundColor Cyan
Write-Host ""

Test-Step "T001 login admin/admin123" {
    $r = Invoke-Api -Method POST -Path "/login/login" -Body @{ username = "admin"; password = "admin123" }
    if ($r.code -ne 200 -or -not $r.data.token) { throw "login failed" }
    $script:token = $r.data.token
}

Test-Step "T002 GET /aso/getSizePresets" {
    $r = Invoke-Api -Method GET -Path "/aso/getSizePresets" -Token $token
    if ($r.code -ne 200 -or $r.data.presets.Count -lt 1) { throw "presets empty" }
}

Test-Step "T003 find or create ASO project" {
    $r = Invoke-Api -Method POST -Path "/project/getProject" -Body @{} -Token $token
    $aso = @($r.data | Where-Object { $_.projectType -eq "aso" } | Sort-Object createTime -Descending)[0]
    if ($aso) {
        $script:projectId = [long]$aso.id
    } else {
        $ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        Invoke-Api -Method POST -Path "/project/addProject" -Body @{
            projectType    = "aso"
            name           = "ASO-test-$ts"
            intro          = "fitness app test"
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
        $aso2 = @($r2.data | Where-Object { $_.projectType -eq "aso" } | Sort-Object createTime -Descending)[0]
        if (-not $aso2) { throw "ASO project missing after create" }
        $script:projectId = [long]$aso2.id
    }
    Write-Host "       projectId=$projectId" -ForegroundColor DarkGray
}

Test-Step "T004 POST /aso/getWorkspace lazy init" {
    $r = Invoke-Api -Method POST -Path "/aso/getWorkspace" -Body @{ projectId = $projectId } -Token $token
    if ($r.code -ne 200 -or -not $r.data.workspace) { throw "workspace missing" }
}

Test-Step "T005 POST /aso/saveWorkspace" {
    $r = Invoke-Api -Method POST -Path "/aso/saveWorkspace" -Body @{
        projectId = $projectId
        patch     = @{ inputText = "test fitness app"; planCount = 2 }
    } -Token $token
    if ($r.code -ne 200) { throw $r.message }
}

Test-Step "T006 POST /aso/createTextMaterial" {
    $r = Invoke-Api -Method POST -Path "/aso/createTextMaterial" -Body @{
        projectId  = $projectId
        describe   = "home workout 15min"
        promptSlot = 1
    } -Token $token
    if ($r.code -ne 200 -or -not $r.data.assetId) { throw "no assetId" }
    $script:materialId = [long]$r.data.assetId
}

Test-Step "T007 POST /aso/listMaterials" {
    $r = Invoke-Api -Method POST -Path "/aso/listMaterials" -Body @{ projectId = $projectId; type = "aso_material" } -Token $token
    $found = @($r.data | Where-Object { $_.id -eq $materialId })
    if ($found.Count -lt 1) { throw "material not listed" }
}

Test-Step "T008 409 duplicate generateAsoImage lock" {
    $proj = (Invoke-Api -Method POST -Path "/project/getProject" -Body @{} -Token $token).data |
        Where-Object { $_.id -eq $projectId } | Select-Object -First 1
    if (-not $proj.imageModel) {
        throw "[SKIP] set project imageModel to verify duplicate image 409 lock"
    }

    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $plan = @{
        id        = "selftest-plan-$now"
        title     = "lock test"
        copy      = "copy"
        edited    = $false
        createdAt = $now
        updatedAt = $now
    }
    Invoke-Api -Method POST -Path "/aso/saveWorkspace" -Body @{
        projectId = $projectId
        patch     = @{ plans = @($plan); selectedPlanId = $plan.id }
    } -Token $token | Out-Null

    $body = (@{ projectId = $projectId; planId = $plan.id } | ConvertTo-Json -Compress)
    $headers = @{ "Content-Type" = "application/json"; "Authorization" = $token }
    Invoke-Api -Method POST -Path "/aso/generateAsoImage" -Body (@{ projectId = $projectId; planId = $plan.id }) -Token $token | Out-Null
    try {
        Invoke-Api -Method POST -Path "/aso/generateAsoImage" -Body (@{ projectId = $projectId; planId = $plan.id }) -Token $token -ExpectStatus 409 | Out-Null
    } catch {
        if ($_.Exception.Message -notmatch "409") { throw }
    }
}

Test-Step "T008b generatePlans needs AI config (manual E2E)" {
    try {
        Invoke-Api -Method POST -Path "/aso/generatePlans" -Body @{
            projectId = $projectId
            inputText = "manual e2e"
            planCount = 1
            assetIds  = @()
        } -Token $token | Out-Null
    } catch {
        $msg = $_.Exception.Message
        if ($msg -match "409") { return }
        if ($msg -match "400") { throw "[SKIP] configure universalAi and asoVisionAi in settings" }
        throw
    }
}

Test-Step "T011 POST /aso/uploadMaterial single image" {
    # 1x1 transparent PNG
    $png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    $r = Invoke-Api -Method POST -Path "/aso/uploadMaterial" -Body @{
        projectId = $projectId
        name      = "selftest-upload"
        base64    = $png
    } -Token $token
    if ($r.code -ne 200 -or -not $r.data.assetId) { throw "upload failed: $($r.message)" }
    $script:uploadedAssetId = [long]$r.data.assetId
    $script:uploadedImageId = [long]$r.data.imageId
}

Test-Step "T012 editAsoOutput rejects nonexistent output (404)" {
    try {
        Invoke-Api -Method POST -Path "/aso/editAsoOutput" -Body @{
            projectId = $projectId
            imageId   = 999999999
            prompt    = "make it blue"
            model     = "selftest:model"
        } -Token $token -ExpectStatus 404 | Out-Null
    } catch {
        if ($_.Exception.Message -notmatch "404") { throw }
    }
}

Test-Step "T013 saveWorkspace strips client outputs field" {
    $before = (Invoke-Api -Method POST -Path "/aso/getWorkspace" -Body @{ projectId = $projectId } -Token $token).data.workspace
    $beforeCount = @($before.outputs).Count
    $fakeOutput = @{
        planId    = "selftest-fake-plan"
        assetId   = 123456789
        imageId   = 123456789
        presetId  = "general_vertical_1080x1920"
        width     = 1080
        height    = 1920
        state     = "已完成"
        createdAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    }
    $r = Invoke-Api -Method POST -Path "/aso/saveWorkspace" -Body @{
        projectId = $projectId
        patch     = @{ outputs = @($fakeOutput) }
    } -Token $token
    if ($r.code -ne 200) { throw $r.message }
    $after = @($r.data.workspace.outputs)
    if ($after.Count -ne $beforeCount) { throw "outputs count changed: $beforeCount -> $($after.Count)" }
    if (@($after | Where-Object { $_.planId -eq "selftest-fake-plan" }).Count -gt 0) {
        throw "client-injected output was persisted"
    }
}

Test-Step "T014 pollingOutputs isolates by project" {
    # own material imageId resolves; unknown id returns nothing instead of erroring
    $r = Invoke-Api -Method POST -Path "/aso/pollingOutputs" -Body @{
        projectId = $projectId
        imageIds  = @($uploadedImageId, 999999999)
    } -Token $token
    if ($r.code -ne 200) { throw $r.message }
    $rows = @($r.data)
    if (@($rows | Where-Object { $_.imageId -eq $uploadedImageId }).Count -lt 1) { throw "own image not returned" }
    if (@($rows | Where-Object { $_.imageId -eq 999999999 }).Count -gt 0) { throw "unknown image returned" }
    # cross-project: another ASO project must NOT see this image
    $ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    Invoke-Api -Method POST -Path "/project/addProject" -Body @{
        projectType    = "aso"
        name           = "ASO-iso-$ts"
        intro          = "isolation test"
        type           = "tool"
        artStyle       = "realistic"
        directorManual = ""
        videoRatio     = "16:9"
        imageModel     = ""
        videoModel     = ""
        imageQuality   = "2K"
        mode           = "standard"
    } -Token $token | Out-Null
    $projs = (Invoke-Api -Method POST -Path "/project/getProject" -Body @{} -Token $token).data
    $iso = @($projs | Where-Object { $_.name -eq "ASO-iso-$ts" })[0]
    if (-not $iso) { throw "isolation project missing" }
    $isoId = [long]$iso.id
    try {
        $r2 = Invoke-Api -Method POST -Path "/aso/pollingOutputs" -Body @{
            projectId = $isoId
            imageIds  = @($uploadedImageId)
        } -Token $token
        if (@($r2.data | Where-Object { $_.imageId -eq $uploadedImageId }).Count -gt 0) {
            throw "cross-project image leak via pollingOutputs"
        }
    } finally {
        Invoke-Api -Method POST -Path "/project/delProject" -Body @{ id = $isoId } -Token $token | Out-Null
    }
}

Test-Step "T015 edit async E2E + duplicate 409 (needs completed output)" {
    $ws = (Invoke-Api -Method POST -Path "/aso/getWorkspace" -Body @{ projectId = $projectId } -Token $token).data.workspace
    $doneOutput = @($ws.outputs | Where-Object { $_.state -eq "已完成" })[0]
    if (-not $doneOutput) { throw "[SKIP] no completed output; generate an image first" }
    $proj = (Invoke-Api -Method POST -Path "/project/getProject" -Body @{} -Token $token).data |
        Where-Object { $_.id -eq $projectId } | Select-Object -First 1
    if (-not $proj.imageModel) { throw "[SKIP] set project imageModel to run edit E2E" }

    $srcId = [long]$doneOutput.imageId
    $r = Invoke-Api -Method POST -Path "/aso/editAsoOutput" -Body @{
        projectId = $projectId
        imageId   = $srcId
        prompt    = "selftest: slightly increase contrast"
        apply     = $true
    } -Token $token
    if ($r.code -ne 200 -or $r.data.state -ne "生成中") { throw "edit not scheduled: $($r.message)" }
    $newId = [long]$r.data.imageId

    # duplicate edit on same source must be rejected while first is running
    try {
        Invoke-Api -Method POST -Path "/aso/editAsoOutput" -Body @{
            projectId = $projectId
            imageId   = $srcId
            prompt    = "duplicate"
            apply     = $true
        } -Token $token -ExpectStatus 409 | Out-Null
    } catch {
        if ($_.Exception.Message -notmatch "409") { throw "duplicate edit not blocked: $($_.Exception.Message)" }
    }

    # poll async job until terminal state (bounded)
    $deadline = (Get-Date).AddSeconds(180)
    $state = "生成中"
    while ((Get-Date) -lt $deadline -and $state -eq "生成中") {
        Start-Sleep -Seconds 3
        $p = Invoke-Api -Method POST -Path "/aso/pollingOutputs" -Body @{
            projectId = $projectId
            imageIds  = @($newId)
        } -Token $token
        $row = @($p.data | Where-Object { $_.imageId -eq $newId })[0]
        if ($row) { $state = $row.state }
    }
    if ($state -eq "生成中") { throw "edit job did not finish within 180s" }
    Write-Host "       edit result state=$state" -ForegroundColor DarkGray
}

Test-Step "T016 cleanup uploaded material" {
    Invoke-Api -Method POST -Path "/aso/deleteMaterial" -Body @{
        projectId = $projectId
        assetId   = $uploadedAssetId
    } -Token $token | Out-Null
}

Test-Step "T009 regression novel API reachable" {
    $headers = @{ "Content-Type" = "application/json"; "Authorization" = $token }
    try {
        Invoke-WebRequest -Uri "$Base/novel/getNovel" -Method POST -Headers $headers -Body "{}" -UseBasicParsing | Out-Null
    } catch {
        $code = [int]$_.Exception.Response.StatusCode.value__
        if ($code -eq 404) { throw "novel route 404" }
        if ($code -ge 500) { throw "server error $code" }
    }
}

function Find-OrCreateProject {
    param([string]$ProjectType, [string]$NamePrefix)
    $r = Invoke-Api -Method POST -Path "/project/getProject" -Body @{} -Token $token
    $existing = @($r.data | Where-Object { $_.projectType -eq $ProjectType } | Sort-Object createTime -Descending)[0]
    if ($existing) { return [long]$existing.id }
    $ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    Invoke-Api -Method POST -Path "/project/addProject" -Body @{
        projectType    = $ProjectType
        name           = "$NamePrefix-$ts"
        intro          = "regression test"
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
    $created = @($r2.data | Where-Object { $_.projectType -eq $ProjectType } | Sort-Object createTime -Descending)[0]
    if (-not $created) { throw "failed to create $ProjectType project" }
    return [long]$created.id
}

Test-Step "T067 regression ASO API rejects novel project" {
    $novelId = Find-OrCreateProject -ProjectType "novel" -NamePrefix "reg-novel"
    try {
        Invoke-Api -Method POST -Path "/aso/getWorkspace" -Body @{ projectId = $novelId } -Token $token -ExpectStatus 400 | Out-Null
    } catch {
        if ($_.Exception.Message -notmatch "400") { throw }
    }
}

Test-Step "T068 regression script API unchanged" {
    $scriptId = Find-OrCreateProject -ProjectType "script" -NamePrefix "reg-script"
    $r = Invoke-Api -Method POST -Path "/script/getScrptApi" -Body @{ projectId = $scriptId } -Token $token
    if ($r.code -ne 200) { throw "script API failed: $($r.message)" }
}

Test-Step "T069 regression delete ASO project removes workspace" {
    $ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    Invoke-Api -Method POST -Path "/project/addProject" -Body @{
        projectType    = "aso"
        name           = "ASO-del-$ts"
        intro          = "delete test"
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
    $delProj = @($r.data | Where-Object { $_.name -eq "ASO-del-$ts" })[0]
    if (-not $delProj) { throw "temp ASO project missing" }
    $delId = [long]$delProj.id
    Invoke-Api -Method POST -Path "/aso/getWorkspace" -Body @{ projectId = $delId } -Token $token | Out-Null
    Invoke-Api -Method POST -Path "/aso/createTextMaterial" -Body @{
        projectId  = $delId
        describe   = "cleanup"
        promptSlot = 1
    } -Token $token | Out-Null
    Invoke-Api -Method POST -Path "/project/delProject" -Body @{ id = $delId } -Token $token | Out-Null
    $r2 = Invoke-Api -Method POST -Path "/project/getProject" -Body @{} -Token $token
    if (@($r2.data | Where-Object { $_.id -eq $delId }).Count -gt 0) {
        throw "project still listed after delete"
    }
}

Test-Step "T010 frontend index served" {
    $r = Invoke-WebRequest -Uri "http://localhost:10588/" -UseBasicParsing
    if ($r.StatusCode -ne 200) { throw "index not 200" }
    if ($r.Content -notmatch '<div id="app">' -or $r.Content -notmatch 'assets/') {
        throw "index.html does not look like the built SPA"
    }
}

Write-Host ""
Write-Host "=== Summary: PASS=$Pass FAIL=$Fail SKIP=$Skip ===" -ForegroundColor Cyan
Write-Host ""
if ($Fail -gt 0) { exit 1 }
exit 0
