# Configure ASO models via Toonflow API (http://localhost:10588)
# Usage:
#   $env:DEEPSEEK_KEY="sk-..."; $env:SUXI_KEY="sk-..."; $env:VOLC_KEY="..."
#   powershell -ExecutionPolicy Bypass -File scripts/setup-aso-models.ps1
param(
    [string]$Base = "http://localhost:10588/api",
    [string]$DeepseekKey = $env:DEEPSEEK_KEY,
    [string]$SuxiKey = $env:SUXI_KEY,
    [string]$VolcKey = $env:VOLC_KEY,
    [string]$DashscopeKey = $env:DASHSCOPE_KEY
)

$ErrorActionPreference = "Stop"
if (-not $DeepseekKey -or -not $SuxiKey -or -not $VolcKey -or -not $DashscopeKey) {
    Write-Error "Set DEEPSEEK_KEY, SUXI_KEY, VOLC_KEY, DASHSCOPE_KEY env vars before running."
}

function Invoke-Api($Method, $Path, $Body = $null, $Token = $null, [int]$TimeoutSec = 120) {
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
    $resp = Invoke-WebRequest @params
    return ($resp.Content | ConvertFrom-Json)
}

Write-Host "Logging in..." -ForegroundColor Cyan
$login = Invoke-Api POST "/login/login" @{ username = "admin"; password = "admin123" }
$token = $login.data.token

Write-Host "Enable DeepSeek..." -ForegroundColor Cyan
Invoke-Api POST "/setting/vendorConfig/enableVendor" @{ id = "deepseek"; enable = 1 } $token | Out-Null
Invoke-Api POST "/setting/vendorConfig/updateVendorInputs" @{
    id          = "deepseek"
    inputValues = @{ apiKey = $DeepseekKey; baseUrl = "https://api.deepseek.com/v1" }
} $token | Out-Null

Write-Host "Enable Volcengine (Doubao video)..." -ForegroundColor Cyan
Invoke-Api POST "/setting/vendorConfig/enableVendor" @{ id = "volcengine"; enable = 1 } $token | Out-Null
Invoke-Api POST "/setting/vendorConfig/updateVendorInputs" @{
    id          = "volcengine"
    inputValues = @{
        apiKey  = $VolcKey
        baseUrl = "https://ark.cn-beijing.volces.com/api/v3"
    }
} $token | Out-Null

Write-Host "Register DashScope vendor (ASO Vision)..." -ForegroundColor Cyan
python (Join-Path $PSScriptRoot "insert_dashscope_vendor.py") | Out-Null
Invoke-Api POST "/setting/vendorConfig/enableVendor" @{ id = "dashscope"; enable = 1 } $token | Out-Null
Invoke-Api POST "/setting/vendorConfig/updateVendorInputs" @{
    id          = "dashscope"
    inputValues = @{
        apiKey  = $DashscopeKey
        baseUrl = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    }
} $token | Out-Null

Write-Host "Register Suxi vendor..." -ForegroundColor Cyan
$suxiPath = Join-Path (Split-Path $PSScriptRoot -Parent) "data\vendor\suxi.ts"
if (-not (Test-Path $suxiPath)) { throw "Missing $suxiPath" }
python (Join-Path $PSScriptRoot "insert_suxi_vendor.py") | Out-Null
Invoke-Api POST "/setting/vendorConfig/enableVendor" @{ id = "suxi"; enable = 1 } $token | Out-Null
Invoke-Api POST "/setting/vendorConfig/updateVendorInputs" @{
    id          = "suxi"
    inputValues = @{ apiKey = $SuxiKey; baseUrl = "https://new.suxi.ai/v1" }
} $token | Out-Null

Write-Host "Bind Agent slots..." -ForegroundColor Cyan
$agents = Invoke-Api POST "/setting/agentDeploy/getAgentDeploy" @{} $token
$all = @($agents.data.qrdinaryData) + @($agents.data.advancedData)
$universal = $all | Where-Object { $_.key -eq "universalAi" } | Select-Object -First 1
$vision = $all | Where-Object { $_.key -eq "asoVisionAi" } | Select-Object -First 1

Invoke-Api POST "/setting/agentDeploy/updateAgentModel" @{
    id              = [int]$universal.id
    name            = $universal.name
    model           = "DeepSeek V4 Pro"
    modelName       = "deepseek:deepseek-v4-pro"
    vendorId        = "deepseek"
    desc            = $universal.desc
    temperature     = 1
    maxOutputTokens = 0
} $token | Out-Null

Invoke-Api POST "/setting/agentDeploy/updateAgentModel" @{
    id              = [int]$vision.id
    name            = $vision.name
    model           = "Qwen-VL Max"
    modelName       = "dashscope:qwen-vl-max"
    vendorId        = "dashscope"
    desc            = $vision.desc
    temperature     = 1
    maxOutputTokens = 0
} $token | Out-Null

Write-Host "Update ASO test project models..." -ForegroundColor Cyan
$projects = Invoke-Api POST "/project/getProject" @{} $token
$aso = @($projects.data | Where-Object { $_.projectType -eq "aso" } | Sort-Object createTime -Descending)[0]
if ($aso) {
    Invoke-Api POST "/project/editProject" @{
        id             = [long]$aso.id
        name           = $aso.name
        intro          = $aso.intro
        type           = $aso.type
        artStyle       = $aso.artStyle
        directorManual = $aso.directorManual
        videoRatio     = "16:9"
        imageModel     = "suxi:gpt-image-2"
        videoModel     = "volcengine:doubao-seedance-2-0-fast-260128"
        projectType    = "aso"
        imageQuality   = $aso.imageQuality
        mode           = "standard"
    } $token | Out-Null
    Write-Host "ASO project id=$($aso.id) imageModel=suxi:gpt-image-2 videoModel=volcengine:doubao-seedance-2-0-fast-260128" -ForegroundColor Green
}

Write-Host "Done. Restart not required." -ForegroundColor Green
