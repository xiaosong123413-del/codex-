$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$sourceDir = Join-Path $root "desktop-webui-launcher"
$outDir = Join-Path $root "dist\desktop-webui-launcher"
$outExe = Join-Path $outDir "LLM-Wiki-WebUI-Launcher.exe"
$desktopExe = Join-Path ([Environment]::GetFolderPath("DesktopDirectory")) "LLM-Wiki-WebUI-Launcher.exe"
$desktopConfig = Join-Path ([Environment]::GetFolderPath("DesktopDirectory")) "launcher-config.json"
$iconPath = Join-Path $root "desktop-webui\assets\llm-wiki.ico"

$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) {
  $csc = "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
}
if (-not (Test-Path $csc)) {
  throw "csc.exe was not found. Install .NET Framework developer tools or .NET SDK."
}

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$arguments = @(
  "/nologo",
  "/target:winexe",
  "/platform:anycpu",
  "/optimize+",
  "/codepage:65001",
  "/reference:System.dll",
  "/reference:System.Core.dll",
  "/reference:System.Web.Extensions.dll",
  "/reference:System.Windows.Forms.dll",
  "/reference:System.Drawing.dll",
  "/out:$outExe"
)

if (Test-Path $iconPath) {
  $arguments += "/win32icon:$iconPath"
}

$arguments += Get-ChildItem -Path $sourceDir -Filter *.cs | Sort-Object Name | ForEach-Object { $_.FullName }

& $csc @arguments

if ($LASTEXITCODE -ne 0) {
  throw "csc.exe failed with exit code $LASTEXITCODE"
}

& node (Join-Path $root "scripts\assert-public-package-clean.mjs") $outDir
if ($LASTEXITCODE -ne 0) {
  throw "Public package cleanliness check failed."
}

$runningDesktopExe = Get-Process | Where-Object { $_.Path -eq $desktopExe }
if ($runningDesktopExe) {
  $runningDesktopExe | Stop-Process -Force
  Start-Sleep -Milliseconds 300
}

Copy-Item $outExe $desktopExe -Force
$escapedConfigRoot = $root.Replace("\", "\\").Replace('"', '\"')
"{""projectRoot"":""$escapedConfigRoot""}" | Set-Content -Path $desktopConfig -Encoding UTF8
Write-Host "Built: $outExe"
Write-Host "Desktop exe: $desktopExe"
