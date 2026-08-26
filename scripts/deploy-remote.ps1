param(
    [string]$Registry = $(if ($env:OPENSHORTS_REGISTRY) { $env:OPENSHORTS_REGISTRY } else { "" }),

    [string]$Tag = $(if ($env:OPENSHORTS_TAG) { $env:OPENSHORTS_TAG } else { "" }),

    [string]$Namespace = $(if ($env:OPENSHORTS_NAMESPACE) { $env:OPENSHORTS_NAMESPACE } else { "openshorts" }),

    [string]$KubeContext = $(if ($env:OPENSHORTS_KUBE_CONTEXT) { $env:OPENSHORTS_KUBE_CONTEXT } else { "" }),

    [string]$ConfigEnvFile = $(if ($env:OPENSHORTS_CONFIG_ENV_FILE) { $env:OPENSHORTS_CONFIG_ENV_FILE } else { "k8s/openshorts.env" }),

    [string]$BackendBaseUrl = $(if ($env:OPENSHORTS_BACKEND_BASE_URL) { $env:OPENSHORTS_BACKEND_BASE_URL } else { "" }),

    [string]$FrontendBaseUrl = $(if ($env:OPENSHORTS_FRONTEND_BASE_URL) { $env:OPENSHORTS_FRONTEND_BASE_URL } else { "" }),

    [string]$S3PublicUrlBase = $(if ($env:OPENSHORTS_S3_PUBLIC_URL_BASE) { $env:OPENSHORTS_S3_PUBLIC_URL_BASE } else { "" }),

    [string]$S3PublicEndpointUrl = $(if ($env:OPENSHORTS_S3_PUBLIC_ENDPOINT_URL) { $env:OPENSHORTS_S3_PUBLIC_ENDPOINT_URL } else { "" }),

    [string]$GpuRuntime = $(if ($env:OPENSHORTS_GPU_RUNTIME) { $env:OPENSHORTS_GPU_RUNTIME } else { "" }),

    [string]$NodeName = $(if ($env:OPENSHORTS_NODE_NAME) { $env:OPENSHORTS_NODE_NAME } else { "" }),

    [string]$StoragePath = $(if ($env:OPENSHORTS_STORAGE_PATH) { $env:OPENSHORTS_STORAGE_PATH } else { "" }),

    [string]$Profile = $(if ($env:OPENSHORTS_ENV_PROFILE) { $env:OPENSHORTS_ENV_PROFILE } else { "" })
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Invoke-Kubectl {
    param([string[]]$KubectlArgs)

    if ($KubeContext) {
        & kubectl --context $KubeContext @KubectlArgs
    }
    else {
        & kubectl @KubectlArgs
    }
}

function Test-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found in PATH."
    }
}

function Get-EffectiveValue {
    param(
        [string]$ParameterValue,
        [string]$EnvironmentName,
        [string]$Default = ""
    )
    if ($ParameterValue) {
        return $ParameterValue
    }
    $envValue = [System.Environment]::GetEnvironmentVariable($EnvironmentName)
    if ($envValue) {
        return $envValue
    }
    return $Default
}

$ExplicitEnv = @{
    "OPENSHORTS_REGISTRY"               = [System.Environment]::GetEnvironmentVariable("OPENSHORTS_REGISTRY")
    "OPENSHORTS_TAG"                    = [System.Environment]::GetEnvironmentVariable("OPENSHORTS_TAG")
    "OPENSHORTS_NAMESPACE"              = [System.Environment]::GetEnvironmentVariable("OPENSHORTS_NAMESPACE")
    "OPENSHORTS_KUBE_CONTEXT"           = [System.Environment]::GetEnvironmentVariable("OPENSHORTS_KUBE_CONTEXT")
    "OPENSHORTS_CONFIG_ENV_FILE"        = [System.Environment]::GetEnvironmentVariable("OPENSHORTS_CONFIG_ENV_FILE")
    "OPENSHORTS_BACKEND_BASE_URL"       = [System.Environment]::GetEnvironmentVariable("OPENSHORTS_BACKEND_BASE_URL")
    "OPENSHORTS_FRONTEND_BASE_URL"      = [System.Environment]::GetEnvironmentVariable("OPENSHORTS_FRONTEND_BASE_URL")
    "OPENSHORTS_S3_PUBLIC_URL_BASE"     = [System.Environment]::GetEnvironmentVariable("OPENSHORTS_S3_PUBLIC_URL_BASE")
    "OPENSHORTS_S3_PUBLIC_ENDPOINT_URL" = [System.Environment]::GetEnvironmentVariable("OPENSHORTS_S3_PUBLIC_ENDPOINT_URL")
    "OPENSHORTS_GPU_RUNTIME"            = [System.Environment]::GetEnvironmentVariable("OPENSHORTS_GPU_RUNTIME")
    "OPENSHORTS_NODE_NAME"              = [System.Environment]::GetEnvironmentVariable("OPENSHORTS_NODE_NAME")
    "OPENSHORTS_STORAGE_PATH"           = [System.Environment]::GetEnvironmentVariable("OPENSHORTS_STORAGE_PATH")
    "OPENSHORTS_ENV_PROFILE"            = [System.Environment]::GetEnvironmentVariable("OPENSHORTS_ENV_PROFILE")
}

function Restore-EnvValue {
    param([string]$Name, [string]$Value)

    if ($null -ne $Value -and $Value -ne "") {
        Set-Item -Path "Env:$Name" -Value $Value
    }
}

$Profile = if ($Profile) { $Profile } elseif ($ExplicitEnv["OPENSHORTS_ENV_PROFILE"]) { $ExplicitEnv["OPENSHORTS_ENV_PROFILE"] } else { "" }

function Import-BaseEnvFiles {
    param([string]$ProfileName)

    $BaseEnvFile = if (Test-Path ".env") { ".env" } elseif (Test-Path ".env.example") { ".env.example" } else { "" }
    if ($BaseEnvFile) {
        Import-EnvFile $BaseEnvFile
    }
    else {
        Write-Host "No .env or .env.example found. Continuing with process environment only." -ForegroundColor Yellow
    }

    if ($ProfileName) {
        $ProfileEnvFile = ".env.$ProfileName"
        if (Test-Path $ProfileEnvFile) {
            Import-EnvFile $ProfileEnvFile
        }
        else {
            Write-Host "Profile env file not found: $ProfileEnvFile" -ForegroundColor Yellow
        }
    }
}

Import-BaseEnvFiles -ProfileName $Profile

foreach ($entry in $ExplicitEnv.GetEnumerator()) {
    Restore-EnvValue -Name $entry.Key -Value $entry.Value
}

$Registry = Get-EffectiveValue -ParameterValue $Registry -EnvironmentName "OPENSHORTS_REGISTRY"
$Tag = Get-EffectiveValue -ParameterValue $Tag -EnvironmentName "OPENSHORTS_TAG"
$Namespace = Get-EffectiveValue -ParameterValue $Namespace -EnvironmentName "OPENSHORTS_NAMESPACE" -Default "openshorts"
$KubeContext = Get-EffectiveValue -ParameterValue $KubeContext -EnvironmentName "OPENSHORTS_KUBE_CONTEXT"
$ConfigEnvFile = Get-EffectiveValue -ParameterValue $ConfigEnvFile -EnvironmentName "OPENSHORTS_CONFIG_ENV_FILE" -Default "k8s/openshorts.env"
$BackendBaseUrl = Get-EffectiveValue -ParameterValue $BackendBaseUrl -EnvironmentName "OPENSHORTS_BACKEND_BASE_URL"
$FrontendBaseUrl = Get-EffectiveValue -ParameterValue $FrontendBaseUrl -EnvironmentName "OPENSHORTS_FRONTEND_BASE_URL"
$S3PublicUrlBase = Get-EffectiveValue -ParameterValue $S3PublicUrlBase -EnvironmentName "OPENSHORTS_S3_PUBLIC_URL_BASE"
$S3PublicEndpointUrl = Get-EffectiveValue -ParameterValue $S3PublicEndpointUrl -EnvironmentName "OPENSHORTS_S3_PUBLIC_ENDPOINT_URL"
$GpuRuntime = Get-EffectiveValue -ParameterValue $GpuRuntime -EnvironmentName "OPENSHORTS_GPU_RUNTIME" -Default "cuda"
$NodeName = Get-EffectiveValue -ParameterValue $NodeName -EnvironmentName "OPENSHORTS_NODE_NAME" -Default "hinzky"
$StoragePath = Get-EffectiveValue -ParameterValue $StoragePath -EnvironmentName "OPENSHORTS_STORAGE_PATH" -Default "/var/lib/openshorts/workdir"

if ($GpuRuntime -notin @("cuda", "rocm-linux", "rocm-wsl", "cpu")) {
    throw "OPENSHORTS_GPU_RUNTIME must be cuda, rocm-linux, rocm-wsl, or cpu."
}

$backendDockerfile = switch ($GpuRuntime) {
    "cuda" { "Dockerfile.cuda" }
    "rocm-linux" { "Dockerfile.rocm-linux" }
    "rocm-wsl" { "Dockerfile" }
    "cpu" { "Dockerfile.cuda" }
}

if (-not $Registry -or -not $Tag) {
    throw "Missing required values. Set OPENSHORTS_REGISTRY and OPENSHORTS_TAG or pass -Registry and -Tag."
}

Test-Command docker
Test-Command kubectl

$backendImage = "$Registry/openshorts-backend:$Tag"
$frontendImage = "$Registry/openshorts-frontend:$Tag"
$rendererImage = "$Registry/openshorts-renderer:$Tag"

Write-Step "Building images"
if ($GpuRuntime -eq "cpu") {
    docker build -t $backendImage -f $backendDockerfile --build-arg OPENSHORTS_DEVICE=cpu .
}
else {
    docker build -t $backendImage -f $backendDockerfile .
}
docker build -t $frontendImage -f dashboard/Dockerfile dashboard
docker build -t $rendererImage -f render-service/Dockerfile .

Write-Step "Pushing images"
docker push $backendImage
docker push $frontendImage
docker push $rendererImage

Write-Step "Applying config"
if (-not (Test-Path $ConfigEnvFile)) {
    throw "Config env file not found: $ConfigEnvFile"
}

Invoke-Kubectl @("apply", "-f", "k8s/openshorts.yaml")

$tempEnvFile = Join-Path $env:TEMP ("openshorts-env-" + [guid]::NewGuid().ToString() + ".env")
Copy-Item $ConfigEnvFile $tempEnvFile -Force

try {
    $envContent = Get-Content $tempEnvFile -Raw

    if ($BackendBaseUrl) {
        $envContent = [regex]::Replace($envContent, '^(AI_BASE_URL=).*$', '${1}' + $BackendBaseUrl, [System.Text.RegularExpressions.RegexOptions]::Multiline)
    }
    if ($FrontendBaseUrl) {
        $envContent = [regex]::Replace($envContent, '^(VITE_AI_BASE_URL=).*$', '${1}' + $FrontendBaseUrl, [System.Text.RegularExpressions.RegexOptions]::Multiline)
    }
    if ($S3PublicUrlBase) {
        $envContent = [regex]::Replace($envContent, '^(AWS_S3_PUBLIC_URL_BASE=).*$', '${1}' + $S3PublicUrlBase, [System.Text.RegularExpressions.RegexOptions]::Multiline)
    }
    if ($S3PublicEndpointUrl) {
        $envContent = [regex]::Replace($envContent, '^(AWS_S3_PUBLIC_ENDPOINT_URL=).*$', '${1}' + $S3PublicEndpointUrl, [System.Text.RegularExpressions.RegexOptions]::Multiline)
    }

    $configValues = @{
        "OPENSHORTS_GPU_RUNTIME" = $GpuRuntime
        "OPENSHORTS_NODE_NAME" = $NodeName
        "OPENSHORTS_STORAGE_PATH" = $StoragePath
        "OPENSHORTS_DEVICE" = if ($GpuRuntime -eq "cpu") { "cpu" } else { "auto" }
        "RENDER_ACCELERATOR" = if ($GpuRuntime -eq "cpu") { "cpu" } else { "auto" }
        "RENDER_HARDWARE_ACCELERATION" = "if-possible"
    }
    foreach ($entry in $configValues.GetEnumerator()) {
        $envContent = [regex]::Replace(
            $envContent,
            "^($($entry.Key)=).*$",
            '${1}' + $entry.Value,
            [System.Text.RegularExpressions.RegexOptions]::Multiline
        )
    }

    Set-Content -Path $tempEnvFile -Value $envContent -NoNewline

    if ($KubeContext) {
        kubectl --context $KubeContext create configmap openshorts-config `
            -n $Namespace `
            --from-env-file=$tempEnvFile `
            --dry-run=client -o yaml | kubectl --context $KubeContext apply -f -
    }
    else {
        kubectl create configmap openshorts-config `
            -n $Namespace `
            --from-env-file=$tempEnvFile `
            --dry-run=client -o yaml | kubectl apply -f -
    }
}
finally {
    Remove-Item $tempEnvFile -Force -ErrorAction SilentlyContinue
}

if ($GpuRuntime -eq "cpu") {
    Invoke-Kubectl @("patch", "deployment/openshorts-backend", "--type=json", "-p", '[{"op":"remove","path":"/spec/template/spec/containers/0/resources/requests/nvidia.com~1gpu"},{"op":"remove","path":"/spec/template/spec/containers/0/resources/limits/nvidia.com~1gpu"}]', "-n", $Namespace)
    Invoke-Kubectl @("patch", "deployment/openshorts-renderer", "--type=json", "-p", '[{"op":"remove","path":"/spec/template/spec/containers/0/resources/requests/nvidia.com~1gpu"},{"op":"remove","path":"/spec/template/spec/containers/0/resources/limits/nvidia.com~1gpu"}]', "-n", $Namespace)
}

Write-Step "Updating deployment images"
Invoke-Kubectl @("set", "image", "deployment/openshorts-backend", "backend=$backendImage", "-n", $Namespace)
Invoke-Kubectl @("set", "image", "deployment/openshorts-frontend", "frontend=$frontendImage", "-n", $Namespace)
Invoke-Kubectl @("set", "image", "deployment/openshorts-renderer", "renderer=$rendererImage", "-n", $Namespace)

Write-Step "Waiting for rollouts"
Invoke-Kubectl @("rollout", "status", "deployment/openshorts-backend", "-n", $Namespace, "--timeout=180s")
Invoke-Kubectl @("rollout", "status", "deployment/openshorts-frontend", "-n", $Namespace, "--timeout=180s")
Invoke-Kubectl @("rollout", "status", "deployment/openshorts-renderer", "-n", $Namespace, "--timeout=180s")

Write-Host ""
Write-Host "Remote deploy completed successfully." -ForegroundColor Green
