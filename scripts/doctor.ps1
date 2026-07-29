$ErrorActionPreference = "SilentlyContinue"

function Test-Command {
  param([Parameter(Mandatory = $true)][string]$Name)
  return $null -ne (Get-Command $Name)
}

$checks = @()

$checks += [PSCustomObject]@{
  Component = "Node.js"
  RequiredFor = "All development"
  Ready = Test-Command "node"
  Detail = if (Test-Command "node") { node --version } else { "Install Node.js 22+" }
}

$checks += [PSCustomObject]@{
  Component = "pnpm"
  RequiredFor = "All development"
  Ready = Test-Command "pnpm"
  Detail = if (Test-Command "pnpm") { pnpm --version } else { "Install pnpm 9+" }
}

$checks += [PSCustomObject]@{
  Component = "Docker"
  RequiredFor = "Local services"
  Ready = Test-Command "docker"
  Detail = if (Test-Command "docker") { docker --version } else { "Install Docker Desktop" }
}

$checks += [PSCustomObject]@{
  Component = "Rust"
  RequiredFor = "Native Tauri"
  Ready = (Test-Command "cargo") -and (Test-Command "rustc")
  Detail = if (Test-Command "cargo") { cargo --version } else { "Install Rust stable-msvc" }
}

$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vs2022 = $null
if (Test-Path -LiteralPath $vswhere) {
  $vs2022 = & $vswhere -version "[17.0,18.0)" -products * `
    -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
    -property installationPath
}
$checks += [PSCustomObject]@{
  Component = "VS 2022 C++"
  RequiredFor = "Native Tauri"
  Ready = -not [string]::IsNullOrWhiteSpace($vs2022)
  Detail = if ($vs2022) { $vs2022 } else { "Install Desktop development with C++" }
}

$webViewClients = @(
  "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F1E7E0B4-E63F-4D5B-AE64-14D0A8E3C6A5}",
  "HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F1E7E0B4-E63F-4D5B-AE64-14D0A8E3C6A5}"
)
$webViewReady = $webViewClients | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
$checks += [PSCustomObject]@{
  Component = "WebView2"
  RequiredFor = "Native Tauri"
  Ready = $null -ne $webViewReady
  Detail = if ($webViewReady) { "Runtime detected" } else { "Install Evergreen WebView2 Runtime" }
}

$checks | Format-Table -AutoSize

$webReady = ($checks | Where-Object {
  $_.Component -in @("Node.js", "pnpm")
} | Where-Object { -not $_.Ready }).Count -eq 0

$nativeReady = ($checks | Where-Object {
  $_.RequiredFor -eq "Native Tauri"
} | Where-Object { -not $_.Ready }).Count -eq 0

Write-Host ""
Write-Host "Web development: $(if ($webReady) { 'ready' } else { 'not ready' })"
Write-Host "Native Tauri:   $(if ($nativeReady) { 'ready' } else { 'not ready' })"
