param(
    [string]$Namespace = "openshorts",
    [string]$KubeContext = ""
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

Test-Command kubectl

Write-Step "Scaling all deployments to 0 in namespace '$Namespace'"
Invoke-Kubectl @("scale", "deployment", "--all", "--replicas=0", "-n", $Namespace)

Write-Host ""
Write-Host "Scale down completed successfully." -ForegroundColor Green
