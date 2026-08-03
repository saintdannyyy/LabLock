<#
.SYNOPSIS
Removes LabLock's startup registration created by register-startup.ps1.

.DESCRIPTION
Removes whichever registration exists:
  - the Scheduled Task named "LabLock" (removing a per-user
    task does not require admin; the -AllUsers variant does, so pass -AllUsers
    if the original registration was created that way), and/or
  - the HKCU Run registry entry named "LabLock".

Safe to run with no arguments -- it deletes whatever is found and reports what
it removed.

.EXAMPLE
.\unregister-startup.ps1

.EXAMPLE
.\unregister-startup.ps1 -AllUsers
#>
[CmdletBinding()]
param(
  [switch]$AllUsers
)

$ErrorActionPreference = "Continue"

$taskName = "LabLock"
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$runValueName = "LabLock"

function Test-Elevated {
  $principal = New-Object Security.Principal.WindowsPrincipal(
    [Security.Principal.WindowsIdentity]::GetCurrent()
  )
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

$found = $false

# --- Scheduled Task -------------------------------------------------------
if ($AllUsers -and -not (Test-Elevated)) {
  Write-Host "Note: deleting an '-AllUsers' (any user) Scheduled Task requires an elevated shell. The HKCU Run entry and any per-user task will still be removed; re-run elevated to remove the any-user task."
}

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Continue
  if ($?) {
    Write-Host "[Scheduled Task] Removed '$taskName'."
    $found = $true
  }
} else {
  Write-Host "[Scheduled Task] No task named '$taskName' found."
}

# --- Run key --------------------------------------------------------------
$value = Get-ItemProperty -Path $runKey -Name $runValueName -ErrorAction SilentlyContinue
if ($null -ne $value) {
  Remove-ItemProperty -Path $runKey -Name $runValueName -ErrorAction Continue
  if ($?) {
    Write-Host "[Run key] Removed '$runValueName' from $runKey."
    $found = $true
  }
} else {
  Write-Host "[Run key] No entry named '$runValueName' found."
}

if (-not $found) {
  Write-Host "Nothing was registered under the startup mechanisms this script manages."
}