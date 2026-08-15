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
    param([string[]]$KubectlArgs)

    if ($KubeContext) {
        & kubectl --context $KubeContext @KubectlArgs
    } else {
        & kubectl @KubectlArgs
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

function Get-PreferredEnvValue {
    param(
        [string]$PrimaryName,
        [string]$FallbackName
    )

    $primary = Get-EnvValue $PrimaryName
    if ($primary) { return $primary }
    return (Get-EnvValue $FallbackName)
}

function Invoke-CheckedCommand {
    param(
        [string]$Command,
        [string[]]$Arguments
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command failed with exit code $LASTEXITCODE."
    }
}

function Add-NoProxyHost {
    param([string]$HostName)

    $current = [System.Environment]::GetEnvironmentVariable("NO_PROXY")
    $entries = @()
    if ($current) {
        $entries = $current.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ }
    }

    if ($entries -notcontains $HostName) {
        $entries += $HostName
        Set-Item -Path "Env:NO_PROXY" -Value (($entries | Select-Object -Unique) -join ",")
    }
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

Add-NoProxyHost "localhost"
Add-NoProxyHost "127.0.0.1"
Add-NoProxyHost "::1"
Add-NoProxyHost "kubernetes.docker.internal"

$backendImage = "openshorts-backend:local"
$frontendImage = "openshorts-frontend:local"
$rendererImage = "openshorts-renderer:local"
$translationImage = $backendImage

$postgresDb = Get-EnvValue "OPENSHORTS_POSTGRES_DB"
if (-not $postgresDb) { $postgresDb = "openshorts" }
$postgresUser = Get-EnvValue "OPENSHORTS_POSTGRES_USER"
if (-not $postgresUser) { $postgresUser = "openshorts" }
$postgresPassword = Get-EnvValue "OPENSHORTS_POSTGRES_PASSWORD"
if (-not $postgresPassword) { $postgresPassword = "openshorts-local" }
$postgresPasswordURL = [System.Uri]::EscapeDataString($postgresPassword)
$databaseUrl = "postgres://$postgresUser`:$postgresPasswordURL@openshorts-postgres:5432/$postgresDb"

Write-Step "Building local images"
Invoke-CheckedCommand "docker" @("build", "-t", $backendImage, ".")
Invoke-CheckedCommand "docker" @("build", "-t", $frontendImage, "-f", "dashboard/Dockerfile", "dashboard")
Invoke-CheckedCommand "docker" @("build", "-t", $rendererImage, "-f", "render-service/Dockerfile", ".")

Write-Step "Preparing PostgreSQL Secret"
if ($KubeContext) {
    kubectl --context $KubeContext create namespace $Namespace --dry-run=client -o yaml | kubectl --context $KubeContext apply -f -
    $secretYaml = kubectl --context $KubeContext create secret generic openshorts-postgres -n $Namespace `
        --from-literal=POSTGRES_DB=$postgresDb `
        --from-literal=POSTGRES_USER=$postgresUser `
        --from-literal=POSTGRES_PASSWORD=$postgresPassword `
        --from-literal=DATABASE_URL=$databaseUrl `
        --dry-run=client -o yaml
    $secretYaml | kubectl --context $KubeContext apply -f -
} else {
    kubectl create namespace $Namespace --dry-run=client -o yaml | kubectl apply -f -
    $secretYaml = kubectl create secret generic openshorts-postgres -n $Namespace `
        --from-literal=POSTGRES_DB=$postgresDb `
        --from-literal=POSTGRES_USER=$postgresUser `
        --from-literal=POSTGRES_PASSWORD=$postgresPassword `
        --from-literal=DATABASE_URL=$databaseUrl `
        --dry-run=client -o yaml
    $secretYaml | kubectl apply -f -
}

Write-Step "Applying PostgreSQL"
Invoke-Kubectl @("apply", "-f", "k8s/openshorts-postgres.yaml")
Invoke-Kubectl @("rollout", "status", "deployment/openshorts-postgres", "-n", $Namespace, "--timeout=180s")

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
        "MAX_CONCURRENT_JOBS" = (Get-EnvValue "MAX_CONCURRENT_JOBS")
        "AI_PROVIDER" = (Get-EnvValue "AI_PROVIDER")
        "AI_BASE_URL" = (Get-PreferredEnvValue "AI_BASE_URL" "OPENSHORTS_AI_BASE_URL")
        "AI_QUALITY_PRESET" = (Get-EnvValue "AI_QUALITY_PRESET")
        "AI_MODEL" = (Get-EnvValue "AI_MODEL")
        "AI_ANALYZE_MODEL" = (Get-EnvValue "AI_ANALYZE_MODEL")
        "AI_VISION_MODEL" = (Get-EnvValue "AI_VISION_MODEL")
        "AI_IMAGE_MODEL" = (Get-EnvValue "AI_IMAGE_MODEL")
        "VITE_AI_PROVIDER" = (Get-EnvValue "VITE_AI_PROVIDER")
        "VITE_AI_BASE_URL" = (Get-PreferredEnvValue "VITE_AI_BASE_URL" "OPENSHORTS_VITE_AI_BASE_URL")
        "VITE_AI_QUALITY_PRESET" = (Get-EnvValue "VITE_AI_QUALITY_PRESET")
        "VITE_AI_MODEL" = (Get-EnvValue "VITE_AI_MODEL")
        "VITE_AI_ANALYZE_MODEL" = (Get-EnvValue "VITE_AI_ANALYZE_MODEL")
        "VITE_AI_VISION_MODEL" = (Get-EnvValue "VITE_AI_VISION_MODEL")
        "VITE_AI_IMAGE_MODEL" = (Get-EnvValue "VITE_AI_IMAGE_MODEL")
        "AWS_REGION" = (Get-EnvValue "AWS_REGION")
        "AWS_S3_BUCKET" = (Get-EnvValue "AWS_S3_BUCKET")
        "AWS_S3_PUBLIC_BUCKET" = (Get-EnvValue "AWS_S3_PUBLIC_BUCKET")
        "AWS_S3_ENDPOINT_URL" = (Get-EnvValue "AWS_S3_ENDPOINT_URL")
        "AWS_S3_PUBLIC_URL_BASE" = (Get-PreferredEnvValue "AWS_S3_PUBLIC_URL_BASE" "OPENSHORTS_S3_PUBLIC_URL_BASE")
        "AWS_S3_PUBLIC_ENDPOINT_URL" = (Get-PreferredEnvValue "AWS_S3_PUBLIC_ENDPOINT_URL" "OPENSHORTS_S3_PUBLIC_ENDPOINT_URL")
        "AWS_S3_FORCE_PATH_STYLE" = (Get-EnvValue "AWS_S3_FORCE_PATH_STYLE")
        "RENDER_SERVICE_URL" = (Get-EnvValue "RENDER_SERVICE_URL")
        "TRANSLATION_SERVICE_URL" = (Get-EnvValue "TRANSLATION_SERVICE_URL")
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

Write-Step "Updating deployment images"
Invoke-Kubectl @("set", "image", "deployment/openshorts-backend", "backend=$backendImage", "-n", $Namespace)
Invoke-Kubectl @("set", "image", "deployment/openshorts-frontend", "frontend=$frontendImage", "-n", $Namespace)
Invoke-Kubectl @("set", "image", "deployment/openshorts-renderer", "renderer=$rendererImage", "-n", $Namespace)
Invoke-Kubectl @("set", "image", "deployment/openshorts-translation", "translation=$translationImage", "-n", $Namespace)

Write-Step "Restarting deployments"
Invoke-Kubectl @("rollout", "restart", "deployment/openshorts-backend", "deployment/openshorts-frontend", "deployment/openshorts-renderer", "deployment/openshorts-translation", "-n", $Namespace)

Write-Step "Waiting for rollouts"
Invoke-Kubectl @("rollout", "status", "deployment/openshorts-backend", "-n", $Namespace, "--timeout=180s")
Invoke-Kubectl @("rollout", "status", "deployment/openshorts-frontend", "-n", $Namespace, "--timeout=180s")
Invoke-Kubectl @("rollout", "status", "deployment/openshorts-renderer", "-n", $Namespace, "--timeout=180s")
Invoke-Kubectl @("rollout", "status", "deployment/openshorts-translation", "-n", $Namespace, "--timeout=180s")

Write-Host ""
Write-Host "Local deploy completed successfully." -ForegroundColor Green
