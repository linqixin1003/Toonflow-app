# T070 - ASO five-minute E2E (API-driven)
# Prerequisite: models configured (setup-aso-models.ps1) + backend at :10588
$ErrorActionPreference = "Stop"
$Base = "http://localhost:10588/api"
$MaxImageWaitSec = 180
$Pass = 0
$Fail = 0
$token = $null
$projectId = $null
$swTotal = [System.Diagnostics.Stopwatch]::StartNew()

function Step {
    param([string]$Name, [scriptblock]$Block)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        & $Block
        $sw.Stop()
        Write-Host ("[PASS] {0} ({1:N1}s)" -f $Name, $sw.Elapsed.TotalSeconds) -ForegroundColor Green
        $script:Pass++
    } catch {
        $sw.Stop()
        Write-Host ("[FAIL] {0} ({1:N1}s) - {2}" -f $Name, $sw.Elapsed.TotalSeconds, $_.Exception.Message) -ForegroundColor Red
        $script:Fail++
        throw
    }
}

function Invoke-Api {
    param(
        [string]$Method,
        [string]$Path,
        $Body = $null,
        [string]$Token = $null,
        [int]$ExpectStatus = 200,
        [int]$TimeoutSec = 300
    )
    $headers = @{ "Content-Type" = "application/json" }
    if ($Token) { $headers["Authorization"] = $Token }
    $params = @{
        Uri             = "$Base$Path"
        Method          = $Method
        Headers         = $headers
        UseBasicParsing = $true
        TimeoutSec      = $TimeoutSec
    }
    if ($null -ne $Body) { $params.Body = ($Body | ConvertTo-Json -Depth 10 -Compress) }
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
Write-Host "=== ASO T070 E2E ===" -ForegroundColor Cyan
Write-Host ""

try {
    Step "E01 login" {
        $r = Invoke-Api -Method POST -Path "/login/login" -Body @{ username = "admin"; password = "admin123" }
        if ($r.code -ne 200 -or -not $r.data.token) { throw "login failed" }
        $script:token = $r.data.token
    }

    Step "E02 create ASO project" {
        $ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        Invoke-Api -Method POST -Path "/project/addProject" -Body @{
            projectType    = "aso"
            name           = "E2E-$ts"
            intro          = "fitness app for busy professionals"
            type           = "tool"
            artStyle       = "realistic"
            directorManual = ""
            videoRatio     = "16:9"
            imageModel     = "suxi:gpt-image-2-all"
            videoModel     = "volcengine:doubao-seedance-2-0-fast-260128"
            imageQuality   = "2K"
            mode           = "standard"
        } -Token $token | Out-Null
        $r = Invoke-Api -Method POST -Path "/project/getProject" -Body @{} -Token $token
        $p = @($r.data | Where-Object { $_.name -eq "E2E-$ts" })[0]
        if (-not $p) { throw "project not found" }
        if (-not $p.imageModel) { throw "imageModel not set on new project" }
        $script:projectId = [long]$p.id
        Write-Host "       projectId=$projectId imageModel=$($p.imageModel)" -ForegroundColor DarkGray
    }

    Step "E03 init workspace + input" {
        Invoke-Api -Method POST -Path "/aso/getWorkspace" -Body @{ projectId = $projectId } -Token $token | Out-Null
        Invoke-Api -Method POST -Path "/aso/saveWorkspace" -Body @{
            projectId = $projectId
            patch     = @{
                inputText = "15-minute home workout app for busy office workers, highlight fat burn and no equipment"
                planCount = 1
            }
        } -Token $token | Out-Null
    }

    Step "E04 generatePlans (1 plan)" {
        $r = Invoke-Api -Method POST -Path "/aso/generatePlans" -Body @{
            projectId = $projectId
            inputText = "15-minute home workout app for busy office workers, highlight fat burn and no equipment"
            planCount = 1
            assetIds  = @()
        } -Token $token -TimeoutSec 600
        if ($r.code -ne 200 -or $r.data.plans.Count -lt 1) { throw "no plans returned" }
        $script:plan = $r.data.plans[0]
        Write-Host "       planId=$($plan.id) title=$($plan.title.Substring(0, [Math]::Min(40, $plan.title.Length)))..." -ForegroundColor DarkGray
    }

    Step "E05 edit plan (updatePlan)" {
        $newTitle = "E2E edited title"
        $newCopy = "E2E edited copy - burn fat in 15 minutes at home without equipment."
        $r = Invoke-Api -Method POST -Path "/aso/updatePlan" -Body @{
            projectId = $projectId
            planId    = $plan.id
            title     = $newTitle
            copy      = $newCopy
        } -Token $token
        if ($r.code -ne 200) { throw $r.message }
        $plan.title = $newTitle
        $plan.copy = $newCopy
    }

    Step "E06 generateAsoImage" {
        $r = Invoke-Api -Method POST -Path "/aso/generateAsoImage" -Body @{
            projectId = $projectId
            planId    = $plan.id
        } -Token $token
        if ($r.code -ne 200 -or -not $r.data.imageId) { throw "no imageId" }
        $script:imageId = [long]$r.data.imageId
        Write-Host "       imageId=$imageId" -ForegroundColor DarkGray
    }

    Step "E07 poll image until done" {
        $deadline = (Get-Date).AddSeconds($MaxImageWaitSec)
        while ((Get-Date) -lt $deadline) {
            Start-Sleep -Seconds 3
            $r = Invoke-Api -Method POST -Path "/aso/pollingOutputs" -Body @{
                projectId = $projectId
                imageIds  = @($imageId)
            } -Token $token
            $item = $r.data[0]
            if (-not $item) { continue }
            Write-Host "       state=$($item.state)" -ForegroundColor DarkGray
            if ($item.filePath) {
                $script:filePath = $item.filePath
                return
            }
            if ($item.errorReason) {
                throw "image failed: $($item.errorReason)"
            }
        }
        throw "timeout after ${MaxImageWaitSec}s"
    }

    Step "E08 workspace persistence check" {
        $r = Invoke-Api -Method POST -Path "/aso/getWorkspace" -Body @{ projectId = $projectId } -Token $token
        $ws = $r.data.workspace
        if ($ws.plans.Count -lt 1) { throw "plans missing after reload" }
        $edited = @($ws.plans | Where-Object { $_.title -eq $plan.title })[0]
        if (-not $edited) { throw "edited plan not in workspace" }
        $out = @($ws.outputs | Where-Object { $_.imageId -eq $imageId })[0]
        if (-not $out) { throw "output record missing" }
    }
} catch {
    # fall through to summary
}

$swTotal.Stop()
Write-Host ""
Write-Host ("=== T070 Summary: PASS={0} FAIL={1} TOTAL={2:N0}s ===" -f $Pass, $Fail, $swTotal.Elapsed.TotalSeconds) -ForegroundColor Cyan
if ($Fail -gt 0) { exit 1 }
if ($swTotal.Elapsed.TotalMinutes -gt 5) {
    Write-Host "[WARN] E2E exceeded SC-001 five-minute target" -ForegroundColor Yellow
}
exit 0
