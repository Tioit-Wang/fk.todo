param(
  [Parameter(Mandatory = $false)]
  [string]$Tag,

  [Parameter(Mandatory = $false)]
  [switch]$RequireClean
)

$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
  Write-Host "ERROR: $Message" -ForegroundColor Red
  exit 1
}

function Info([string]$Message) {
  Write-Host $Message -ForegroundColor Cyan
}

function Ok([string]$Message) {
  Write-Host $Message -ForegroundColor Green
}

function Parse-CargoPackageVersion([string]$CargoTomlPath) {
  $lines = Get-Content -LiteralPath $CargoTomlPath -ErrorAction Stop
  $inPackage = $false
  foreach ($line in $lines) {
    if ($line -match "^\s*\[package\]\s*$") {
      $inPackage = $true
      continue
    }
    if ($inPackage -and $line -match "^\s*\[.+\]\s*$") {
      break
    }
    if ($inPackage -and $line -match '^\s*version\s*=\s*"([^"]+)"') {
      return $Matches[1]
    }
  }
  return $null
}

$repoRoot = (& git rev-parse --show-toplevel 2>$null)
if (-not $repoRoot) {
  Fail "Not a git repository (git rev-parse failed). Run this from inside the repo."
}
$repoRoot = $repoRoot.Trim()

Push-Location $repoRoot
try {
  $pkgPath = Join-Path $repoRoot "todo-tool/package.json"
  $tauriPath = Join-Path $repoRoot "todo-tool/src-tauri/tauri.conf.json"
  $cargoPath = Join-Path $repoRoot "todo-tool/src-tauri/Cargo.toml"

  if (-not (Test-Path -LiteralPath $pkgPath)) { Fail "Missing file: $pkgPath" }
  if (-not (Test-Path -LiteralPath $tauriPath)) { Fail "Missing file: $tauriPath" }
  if (-not (Test-Path -LiteralPath $cargoPath)) { Fail "Missing file: $cargoPath" }

  $pkg = Get-Content -Raw -LiteralPath $pkgPath | ConvertFrom-Json
  $tauri = Get-Content -Raw -LiteralPath $tauriPath | ConvertFrom-Json
  $cargoVersion = Parse-CargoPackageVersion -CargoTomlPath $cargoPath

  $pkgVersion = [string]$pkg.version
  $tauriVersion = [string]$tauri.version

  if (-not $pkgVersion) { Fail "Failed to read version from todo-tool/package.json" }
  if (-not $tauriVersion) { Fail "Failed to read version from todo-tool/src-tauri/tauri.conf.json" }
  if (-not $cargoVersion) { Fail "Failed to parse [package].version from todo-tool/src-tauri/Cargo.toml" }

  Info "Versions:"
  Write-Host ("  {0,-40} {1}" -f "todo-tool/package.json", $pkgVersion)
  Write-Host ("  {0,-40} {1}" -f "todo-tool/src-tauri/Cargo.toml", $cargoVersion)
  Write-Host ("  {0,-40} {1}" -f "todo-tool/src-tauri/tauri.conf.json", $tauriVersion)

  if (($pkgVersion -ne $cargoVersion) -or ($pkgVersion -ne $tauriVersion)) {
    Fail "Version mismatch. Keep all three versions identical before tagging."
  }

  if ($Tag) {
    if ($Tag -notmatch "^V\d{8}\.\d+\.\d+(-bate(\.\d+)?)?$") {
      Fail "Invalid tag format: $Tag (expected VYYYYMMDD.N.P or VYYYYMMDD.N.P-bate[.N])"
    }
    $tagVersion = $Tag.Substring(1)
    if ($tagVersion -ne $pkgVersion) {
      Fail "Tag/version mismatch. Tag=$tagVersion, files=$pkgVersion"
    }
    Ok "Tag OK: $Tag"
  } else {
    Info "Tip: pass -Tag V<version> to also validate the tag matches the files."
  }

  $dirty = (& git status --porcelain) -join "`n"
  if ($dirty) {
    if ($RequireClean) {
      Fail "Working tree is dirty. Commit/stash changes before release."
    }
    Write-Warning "Working tree is dirty. This is OK for checks, but releases should normally be tagged from a clean tree."
  }

  Ok "Version OK: $pkgVersion"
} finally {
  Pop-Location
}
