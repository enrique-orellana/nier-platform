param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("up", "down")]
    [string]$Action,

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
    param([string[]]$CommandArgs)

    if ($KubeContext) {
        & kubectl --context $KubeContext @CommandArgs
    } else {
        & kubectl @CommandArgs
    }
}

function Test-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found in PATH."
    }
}

Test-Command kubectl

if ($Action -eq "down") {
    Write-Step "Scaling all deployments to 0 in namespace '$Namespace'"
    Invoke-Kubectl @("scale", "deployment", "--all", "--replicas=0", "-n", $Namespace)
    Write-Host ""
    Write-Host "Scale down completed successfully." -ForegroundColor Green
} elseif ($Action -eq "up") {
    Write-Step "Restoring deployments to their defined replicas from k8s/openshorts.yaml in namespace '$Namespace'"
    Invoke-Kubectl @("apply", "-f", "k8s/openshorts.yaml", "-n", $Namespace)
    Write-Host ""
    Write-Host "Scale up completed successfully." -ForegroundColor Green
}
