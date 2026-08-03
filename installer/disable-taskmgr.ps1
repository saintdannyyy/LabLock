<#
.SYNOPSIS
    Enables the DisableTaskMgr policy (machine-wide) to block Task Manager.

.DESCRIPTION
    Writes DisableTaskMgr=1 to HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System.
    Requires an elevated (Run as Administrator) shell. On Windows 11, the HKCU Policies
    key is ACL-protected; HKLM is the supported path for machine-wide deployment.

.NOTES
    After running, Task Manager (taskmgr.exe) refuses to start from any entry point:
    Ctrl+Shift+Esc, Ctrl+Alt+Del, Run dialog, Start menu, command line.
    To restore Task Manager, run enable-taskmgr.ps1 (also requires elevation).
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

$policyPath = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System'
$valueName = 'DisableTaskMgr'

if (-not (Test-Path -LiteralPath $policyPath)) {
    New-Item -Path $policyPath -Force | Out-Null
}

Set-ItemProperty -Path $policyPath -Name $valueName -Value 1 -Type DWord -Force
Write-Host "Set $policyPath\$valueName = 1"
Write-Host "Task Manager is now blocked for all users. Log off/on or restart for immediate effect."