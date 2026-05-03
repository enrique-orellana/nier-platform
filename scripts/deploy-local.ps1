param(
    [string]$Namespace = "",
    [string]$KubeContext = "",
    [string]$ConfigEnvFile = "",
    [string]$Profile = ""
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Invoke-Kubectl {
    param([string[]]$Args)

    if ($KubeContext) {
        & kubectl --context $KubeContext @Args
    } else {
        & kubectl @Args
    }
}

function Test-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found in PATH."
    }
}

function Get-EnvValue {
    param([string]$Name)
    $value = [System.Environment]::GetEnvironmentVariable($Name)
    if ($value) { return $value }
    return ""
}

function Import-EnvFile {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        return
    }

    foreach ($line in Get-Content $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) {
            continue
        }
        if ($trimmed -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
            $name = $matches[1]
            $value = $matches[2]
            if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
                $value = $value.Substring(1, $value.Length - 2)
            }
            Set-Item -Path "Env:$name" -Value $value
        }
    }
}

$ExplicitNamespace = [System.Environment]::GetEnvironmentVariable("OPENSHORTS_NAMESPACE")
$ExplicitKubeContext = [System.Environment]::GetEnvironmentVariable("OPENSHORTS_KUBE_CONTEXT")
$ExplicitConfigEnvFile = [System.Environment]::GetEnvironmentVariable("OPENSHORTS_CONFIG_ENV_FILE")
$ExplicitProfile = [System.Environment]::GetEnvironmentVariable("OPENSHORTS_ENV_PROFILE")
$ExplicitAiBaseUrl = [System.Environment]::GetEnvironmentVariable("OPENSHORTS_AI_BASE_URL")
$ExplicitViteAiBaseUrl = [System.Environment]::GetEnvironmentVariable("OPENSHORTS_VITE_AI_BASE_URL")
$ExplicitS3PublicUrlBase = [System.Environment]::GetEnvironmentVariable("OPENSHORTS_S3_PUBLIC_URL_BASE")
$ExplicitS3PublicEndpointUrl = [System.Environment]::GetEnvironmentVariable("OPENSHORTS_S3_PUBLIC_ENDPOINT_URL")

$Profile = if ($Profile) { $Profile } elseif ($ExplicitProfile) { $ExplicitProfile } else { "" }

$BaseEnvFile = if (Test-Path ".env") { ".env" } elseif (Test-Path ".env.example") { ".env.example" } else { "" }
if ($BaseEnvFile) {
    Import-EnvFile $BaseEnvFile
} else {
    Write-Host "No .env or .env.example found. Continuing with process environment only." -ForegroundColor Yellow
}

if ($Profile) {
    $ProfileEnvFile = ".env.$Profile"
    if (Test-Path $ProfileEnvFile) {
        Import-EnvFile $ProfileEnvFile
    } else {
        Write-Host "Profile env file not found: $ProfileEnvFile" -ForegroundColor Yellow
    }
}

if ($ExplicitNamespace) { Set-Item -Path "Env:OPENSHORTS_NAMESPACE" -Value $ExplicitNamespace }
if ($ExplicitKubeContext) { Set-Item -Path "Env:OPENSHORTS_KUBE_CONTEXT" -Value $ExplicitKubeContext }
if ($ExplicitConfigEnvFile) { Set-Item -Path "Env:OPENSHORTS_CONFIG_ENV_FILE" -Value $ExplicitConfigEnvFile }
if ($ExplicitProfile) { Set-Item -Path "Env:OPENSHORTS_ENV_PROFILE" -Value $ExplicitProfile }
if ($ExplicitAiBaseUrl) { Set-Item -Path "Env:OPENSHORTS_AI_BASE_URL" -Value $ExplicitAiBaseUrl }
if ($ExplicitViteAiBaseUrl) { Set-Item -Path "Env:OPENSHORTS_VITE_AI_BASE_URL" -Value $ExplicitViteAiBaseUrl }
if ($ExplicitS3PublicUrlBase) { Set-Item -Path "Env:OPENSHORTS_S3_PUBLIC_URL_BASE" -Value $ExplicitS3PublicUrlBase }
if ($ExplicitS3PublicEndpointUrl) { Set-Item -Path "Env:OPENSHORTS_S3_PUBLIC_ENDPOINT_URL" -Value $ExplicitS3PublicEndpointUrl }

$Namespace = if ($Namespace) { $Namespace } else { Get-EnvValue "OPENSHORTS_NAMESPACE" }
if (-not $Namespace) { $Namespace = "openshorts" }
$KubeContext = if ($KubeContext) { $KubeContext } else { Get-EnvValue "OPENSHORTS_KUBE_CONTEXT" }
$ConfigEnvFile = if ($ConfigEnvFile) { $ConfigEnvFile } else { Get-EnvValue "OPENSHORTS_CONFIG_ENV_FILE" }
if (-not $ConfigEnvFile) { $ConfigEnvFile = "k8s/openshorts.env.example" }

Test-Command docker
Test-Command kubectl

if (-not (Test-Path "k8s/openshorts.yaml")) {
    throw "Missing k8s/openshorts.yaml"
}

$backendImage = "openshorts-backend:local"
$frontendImage = "openshorts-frontend:local"
$rendererImage = "openshorts-renderer:local"

Write-Step "Building local images"
docker build -t $backendImage .
docker build -t $frontendImage -f dashboard/Dockerfile dashboard
docker build -t $rendererImage -f render-service/Dockerfile .

Write-Step "Applying bundle"
if ($KubeContext) {
    kubectl --context $KubeContext apply -f k8s/openshorts.yaml
} else {
    kubectl apply -f k8s/openshorts.yaml
}

Write-Step "Updating config map from env file"
if (-not (Test-Path $ConfigEnvFile)) {
    throw "Config env file not found: $ConfigEnvFile"
}

$tempEnvFile = Join-Path $env:TEMP ("openshorts-local-env-" + [guid]::NewGuid().ToString() + ".env")
Copy-Item $ConfigEnvFile $tempEnvFile -Force

try {
    $envContent = Get-Content $tempEnvFile -Raw
    $overrides = @{
        "AI_BASE_URL" = (Get-EnvValue "OPENSHORTS_AI_BASE_URL")
        "VITE_AI_BASE_URL" = (Get-EnvValue "OPENSHORTS_VITE_AI_BASE_URL")
        "AWS_S3_PUBLIC_URL_BASE" = (Get-EnvValue "OPENSHORTS_S3_PUBLIC_URL_BASE")
        "AWS_S3_PUBLIC_ENDPOINT_URL" = (Get-EnvValue "OPENSHORTS_S3_PUBLIC_ENDPOINT_URL")
    }

    foreach ($entry in $overrides.GetEnumerator()) {
        if ($entry.Value) {
            $envContent = [regex]::Replace(
                $envContent,
                "^($($entry.Key)=).*$",
                '${1}' + $entry.Value,
                [System.Text.RegularExpressions.RegexOptions]::Multiline
            )
        }
    }

    Set-Content -Path $tempEnvFile -Value $envContent -NoNewline

    if ($KubeContext) {
        kubectl --context $KubeContext create configmap openshorts-config `
            -n $Namespace `
            --from-env-file=$tempEnvFile `
            --dry-run=client -o yaml | kubectl --context $KubeContext apply -f -
    } else {
        kubectl create configmap openshorts-config `
            -n $Namespace `
            --from-env-file=$tempEnvFile `
            --dry-run=client -o yaml | kubectl apply -f -
    }
}
finally {
    Remove-Item $tempEnvFile -Force -ErrorAction SilentlyContinue
}

Write-Step "Restarting deployments"
Invoke-Kubectl @("rollout", "restart", "deployment/openshorts-backend", "deployment/openshorts-frontend", "deployment/openshorts-renderer", "-n", $Namespace)

Write-Step "Waiting for rollouts"
Invoke-Kubectl @("rollout", "status", "deployment/openshorts-backend", "-n", $Namespace, "--timeout=180s")
Invoke-Kubectl @("rollout", "status", "deployment/openshorts-frontend", "-n", $Namespace, "--timeout=180s")
Invoke-Kubectl @("rollout", "status", "deployment/openshorts-renderer", "-n", $Namespace, "--timeout=180s")

Write-Host ""
Write-Host "Local deploy completed successfully." -ForegroundColor Green
