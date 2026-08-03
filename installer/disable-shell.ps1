<#
.SYNOPSIS
    Restores the original Windows shell (explorer.exe) from the backup.

.DESCRIPTION
    Reads the backed-up Shell value from the rollback file and writes it to
    HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\Shell.
    Requires an elevated (Run as Administrator) shell.

.NOTES
    * Run this if the shell replacement broke the machine.
    * In Safe Mode: Shift+Restart → Troubleshoot → Advanced Options → Startup Settings → 4
      Then open elevated PowerShell and run this script.
    * The rollback file is at $env:ProgramData\LabLock\winlogon-shell.backup.txt
    * If the backup file is missing, defaults to 'explorer.exe'.

.EXAMPLE
    # From elevated PowerShell
    .\disable-shell.ps1
#>

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

$backupDir = Join-Path $env:ProgramData 'LabLock'
$backupFile = Join-Path $backupDir 'winlogon-shell.backup.txt'

# Read backup or default to explorer.exe
$originalShell = 'explorer.exe'
if (Test-Path -LiteralPath $backupFile) {
    $originalShell = Get-Content -LiteralPath $backupFile -Raw -Encoding UTF8
    $originalShell = $originalShell.Trim()
    Write-Host "Read original shell from backup: $originalShell"
} else {
    Write-Warning "Backup file not found at $backupFile — defaulting to 'explorer.exe'"
}

# Restore
Set-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' -Name 'Shell' -Value $originalShell -Force
Write-Host "Restored Winlogon\Shell to: $originalShell"

# Clean up backup file
Remove-Item -LiteralPath $backupFile -Force -ErrorAction SilentlyContinue
Write-Host "Removed backup file."

Write-Host ''
Write-Host 'Shell restored. Log off and back on (or reboot) for the change to take effect.'