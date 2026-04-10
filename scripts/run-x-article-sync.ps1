param(
  [int]$Count = 200,
  [int]$Limit = 0,
  [switch]$Overwrite,
  [switch]$All,
  [int]$MaxPages = 0,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$nodeScript = Join-Path $scriptDir "x-article-bookmarks-to-obsidian.mjs"

$arguments = @(
  $nodeScript
  "--vault-root", "C:\Users\justi\Obsidian Vault"
  "--output-folder", "Outputs\X_Articles"
  "--state-path", (Join-Path $repoRoot ".codex\state\x-article-bookmarks.json")
  "--assets-mode", "remote"
)

if ($All) {
  $arguments += "--all"
  if ($MaxPages -gt 0) {
    $arguments += @("--max-pages", $MaxPages)
  }
} else {
  $arguments += @("--count", $Count)
}

if ($Limit -gt 0) {
  $arguments += @("--limit", $Limit)
}

if ($Overwrite) {
  $arguments += "--overwrite"
}

if ($DryRun) {
  $arguments += "--dry-run"
}

& node @arguments
exit $LASTEXITCODE
