# Builds the InputHook.exe companion process using the .NET Framework csc.exe
# that ships with Windows (no Visual Studio / Build Tools required).
#
# Output: bin/inputhook/InputHook.exe (committed to the repo so lab installs
# and packaged builds never need a compiler).
#
# Usage:  powershell -ExecutionPolicy Bypass -File scripts/build-inputhook.ps1

$ErrorActionPreference = 'Stop'

$sourceDir = Join-Path $PSScriptRoot '..\src\inputhook'
$outDir    = Join-Path $PSScriptRoot '..\bin\inputhook'
$source    = Join-Path $sourceDir 'InputHook.cs'
$outExe    = Join-Path $outDir 'InputHook.exe'

$cscCandidates = @(
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
)
$csc = $cscCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $csc) {
    throw 'csc.exe not found. This machine lacks the .NET Framework 4.x compiler.'
}

if (-not (Test-Path -LiteralPath $outDir)) {
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

& $csc /nologo /target:winexe /optimize+ /platform:anycpu /out:"$outExe" "$source"
if ($LASTEXITCODE -ne 0) {
    throw "csc.exe failed with exit code $LASTEXITCODE"
}

Write-Host "Built $outExe"
