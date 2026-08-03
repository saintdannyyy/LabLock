<#
.SYNOPSIS
    Disables the DisableTaskMgr policy (machine-wide) to restore Task Manager.

.DESCRIPTION
    Removes the DisableTaskMgr value from HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System.
    Requires an elevated (Run as Administrator) shell.
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

if (Test-Path -LiteralPath $policyPath) {
    if (Get-ItemProperty -Path $policyPath -Name $valueName -ErrorAction SilentlyContinue) {
        Remove-ItemProperty -Path $policyPath -Name $valueName -Force
        Write-Host "Removed $policyPath\$valueName"
    } else {
        Write-Host "$valueName not present — Task Manager already enabled."
    }
} else {
    Write-Host "Policy key does not exist — Task Manager already enabled."
}

Write-Host "Task Manager restored for all users. Log off/on or restart for immediate effect."