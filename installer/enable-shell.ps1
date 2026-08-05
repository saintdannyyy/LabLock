<#
.SYNOPSIS
    Sets LabLock as the Windows shell (replaces explorer.exe).

.DESCRIPTION
    Sets HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\Shell to this app's
    executable path. Backs up the original Shell value to a rollback file so it can be
    restored. Requires an elevated (Run as Administrator) shell.

.NOTES
    * This replaces the Windows shell — no explorer.exe, no taskbar, no Start menu,
      no desktop icons. LabLock becomes the shell and launches at logon.
    * A tested rollback script (disable-shell.ps1) restores the original shell.
    * Test the rollback in a disposable session/VM before deploying to a lab machine.
    * If the machine becomes unbootable to a normal desktop, boot to Safe Mode
      (Shift+Restart → Troubleshoot → Advanced Options → Startup Settings → 4)
      and run disable-shell.ps1 from an elevated command prompt.
    * The rollback file is stored at $env:ProgramData\LabLock\winlogon-shell.backup.txt

.PARAMETER AppExe
    Full path to the LabLock executable. If omitted, the script
    searches common install locations (NSIS per-user, Program Files, release/win-unpacked).

.EXAMPLE
    # From elevated PowerShell
    .\enable-shell.ps1 -AppExe "C:\Program Files\LabLock\LabLock.exe"

.EXAMPLE
    # Auto-detect from common locations
    .\enable-shell.ps1
#>

param(
    [Parameter(Mandatory=$false)]
    [string]$AppExe
)

$ErrorActionPreference = 'Stop'

function Test-Admin {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Admin)) {
    Write-Error "This script requires Administrator privileges."
    Write-Error "Re-run PowerShell as Administrator (Right-click → Run as Administrator) and try again."
    exit 1
}

function Find-AppExe {
    $candidates = @(
        # NSIS per-user install
        Join-Path $env:LOCALAPPDATA 'LabLock\LabLock.exe'
        # System-wide NSIS install
        Join-Path $env:ProgramFiles 'LabLock\LabLock.exe'
        # Unpacked build output
        Join-Path $PSScriptRoot '..\release\win-unpacked\LabLock.exe'
    )
    foreach ($c in $candidates) {
        if (Test-Path -LiteralPath $c) { return $c }
    }
    return $null
}

if (-not $AppExe) {
    $AppExe = Find-AppExe
    if (-not $AppExe) {
        Write-Error "Could not locate LabLock.exe. Pass -AppExe explicitly."
        exit 1
    }
    Write-Host "Auto-detected app: $AppExe"
}

if (-not (Test-Path -LiteralPath $AppExe)) {
    Write-Error "AppExe not found: $AppExe"
    exit 1
}

if (-not (Test-Admin)) {
    Write-Error "This script requires Administrator privileges."
    Write-Error "Re-run PowerShell as Administrator (Right-click → Run as Administrator) and try again."
    exit 1
}

$winlogonPath = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Winlogon'
$valueName = 'Shell'
$backupDir = Join-Path $env:ProgramData 'LabLock'
$backupFile = Join-Path $backupDir 'winlogon-shell.backup.txt'

# 1. Backup current Shell value (or default to explorer.exe)
$currentShell = (Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' -Name 'Shell' -ErrorAction SilentlyContinue).Shell
if (-not $currentShell -or $currentShell.Trim() -eq '') {
    $currentShell = 'explorer.exe'
}

# 2. Backup
if (-not (Test-Path -LiteralPath $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
}
$currentShell | Set-Content -LiteralPath $backupFile -Encoding UTF8
Write-Host "Backed up current shell ($currentShell) to $backupFile"

# 3. Set new shell (quoted in case path has spaces)
$newShell = "`"$AppExe`""
Set-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' -Name 'Shell' -Value "`"$AppExe`"" -Force
Write-Host "Set Winlogon\Shell to $AppExe"

Write-Host ''
Write-Host 'Shell replacement complete.'
Write-Host '  - Original shell backed up to: ' $backupFile
Write-Host '  - New shell: ' $AppExe
Write-Host ''
Write-Host 'NEXT: Test the rollback (disable-shell.ps1) in a disposable session/VM'
Write-Host 'before deploying to a lab machine. A failed shell replacement can'
Write-Host 'leave a machine unable to boot to a normal desktop.'
Write-Host ''
Write-Host 'To rollback: run disable-shell.ps1 from an elevated shell.'
Write-Host ''
Write-Host 'To test the kiosk: log off and log back on (or reboot).'