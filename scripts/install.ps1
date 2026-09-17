# Install dsh-workspace-persona into a DSH profile (Windows).
#
#   pwsh -File scripts/install.ps1
#   pwsh -File scripts/install.ps1 -Profile my-profile
#   pwsh -File scripts/install.ps1 -Profile web -Target .
param(
  [string]$Profile = "web",
  [string]$Target  = "dsh-workspace-persona"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command dsh -ErrorAction SilentlyContinue)) {
  Write-Error "dsh not found on PATH — install DeepSeek Harness first."
}

Write-Host "==> dsh plugin --profile $Profile add $Target"
& dsh plugin --profile $Profile add $Target
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host @"

Installed. ``dsh.profile.bundles`` is read at STARTUP, so restart the host now:

    dsh web

Then verify:
    Get-Content "`$env:DSH_HOME\workspace-persona.state.json"
    # Web -> 设置 -> 工作区人设
"@
