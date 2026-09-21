# Install dsh-agent-persona into a DSH profile (Windows).
#
#   pwsh -File scripts/install.ps1
#   pwsh -File scripts/install.ps1 -Profile my-profile
#   pwsh -File scripts/install.ps1 -Profile web -Target .
#   pwsh -File scripts/install.ps1 -Profile web -Target dsh-agent-persona@0.1.1
param(
  [string]$Profile = "web",
  [string]$Target  = "dsh-agent-persona"
)

$ErrorActionPreference = "Stop"

$PluginDir = Split-Path -Parent (Split-Path -Parent $PSCommandPath)

if (-not (Get-Command dsh -ErrorAction SilentlyContinue)) {
  Write-Error "dsh not found on PATH — install DeepSeek Harness first."
}

if ($Target -eq "." -or $Target -eq $PluginDir) {
  $Target = $PluginDir
}

# A path target is checked before it reaches the CLI: `dsh plugin add <path>` writes a link: dependency for
# whatever it is given, including a path that does not exist, so a typo becomes a broken profile entry.
if ($Target -match '^([A-Za-z]:[\\/]|\.{1,2}[\\/]|/)') {
  if (-not (Test-Path $Target -PathType Container)) {
    Write-Error "no such directory: $Target"
  }
  if (-not (Test-Path (Join-Path $Target "package.json"))) {
    Write-Error "$Target is not a plugin package (no package.json)."
  }
}

# Installing a checkout means installing its built half, which npm builds on install.
# A checkout that has never run `npm install` has no lib/, and the host would fail to load it.
if ($Target -eq $PluginDir) {
  $manifest = Join-Path $PluginDir "lib/index.js"
  $client   = Join-Path $PluginDir "lib/client.js"
  if (-not (Test-Path $manifest) -or -not (Test-Path $client)) {
    Write-Error "lib/ is missing — run 'npm install' in $PluginDir first (its prepare step builds both halves)."
  }
}

Write-Host "==> dsh plugin --profile $Profile add $Target"
& dsh plugin --profile $Profile add $Target
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$Version = "?"
try { $Version = (Get-Content (Join-Path $PluginDir "package.json") -Raw | ConvertFrom-Json).version } catch { }

$Home2 = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE ".dsh" }
$State = Join-Path $Home2 "dsh-agent-persona/state.json"

Write-Host @"

Installed into profile "$Profile" (this checkout is v$Version).

dsh.profile.bundles is read at STARTUP, so restart the host now:

    dsh web

Then check it loaded:

    Get-Content "$State"
    # 设置 -> Agent 人设        the management page
    # 对话页顶部「人设」        the per-session view
    # 设置 -> 通用设置           carries nothing from this plugin

Personas live in one file, shared by every profile unless you override config.storePath:

    $(Join-Path $Home2 "dsh-agent-persona/personas.json")

Later, from the same profile:

    dsh plugin --profile $Profile update dsh-agent-persona    # upgrade
    dsh plugin --profile $Profile remove dsh-agent-persona    # uninstall (the persona file stays)
"@
