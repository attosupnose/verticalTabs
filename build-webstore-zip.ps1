param(
  [string]$Version = "1.0.0"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$distDir = Join-Path $root "dist"
$stageDir = Join-Path $distDir "webstore-package"
$zipPath = Join-Path $distDir ("all-tabs-webstore-v" + $Version + ".zip")

if (Test-Path $stageDir) {
  Remove-Item -Recurse -Force $stageDir
}

if (!(Test-Path $distDir)) {
  New-Item -ItemType Directory -Path $distDir | Out-Null
}

New-Item -ItemType Directory -Path $stageDir | Out-Null

$includeFiles = @(
  "manifest.json",
  "background.js",
  "content.js",
  "content.css",
  "popup.html",
  "popup.js",
  "popup.css",
  "sidepanel.html",
  "sidepanel.js",
  "sidepanel.css",
  "PRIVACY_POLICY.md"
)

foreach ($file in $includeFiles) {
  $src = Join-Path $root $file
  if (Test-Path $src) {
    Copy-Item $src $stageDir -Force
  }
}

$includeDirs = @(
  "icons"
)

foreach ($dir in $includeDirs) {
  $srcDir = Join-Path $root $dir
  if (Test-Path $srcDir) {
    Copy-Item $srcDir (Join-Path $stageDir $dir) -Recurse -Force
  }
}

if (Test-Path $zipPath) {
  Remove-Item -Force $zipPath
}

Compress-Archive -Path (Join-Path $stageDir "*") -DestinationPath $zipPath -Force

Write-Host "Web Store package created:"
Write-Host $zipPath
