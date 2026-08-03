<#
.SYNOPSIS
Registers LabLock to launch automatically at Windows logon.

.DESCRIPTION
Default method (no switches): a Scheduled Task that runs the app when the
current user logs on. Creating a task for the current user does NOT require
admin rights.

Alternatives:
  -UseRunKey  : writes HKCU\Software\Microsoft\Windows\CurrentVersion\Run
                instead of a Scheduled Task. Simpler, but the Run key launches
                the app slightly later (after shell startup) and offers no
                run-level/logging options. Per-user only.
  -AllUsers   : registers the task to run at ANY user's logon (the classic
                schtasks /SC ONLOGON behavior). Requires an elevated shell --
                creating an "any user" task needs admin rights.

The executable is resolved automatically if -AppExe is omitted: the NSIS
install location, then Program Files, then release/win-unpacked relative to
this repo. Pass -AppExe explicitly for any other location.

.PARAMETER AppExe
Full path to the app executable (LabLock.exe). Auto-detected if omitted.

.PARAMETER AllUsers
Register the Scheduled Task to run at logon of any user (requires admin).

.PARAMETER UseRunKey
Use the HKCU Run registry key instead of a Scheduled Task.

.EXAMPLE
.\register-startup.ps1 -AppExe "C:\Program Files\LabLock\LabLock.exe"

.EXAMPLE
.\register-startup.ps1 -UseRunKey
#>
[CmdletBinding()]
param(
  [string]$AppExe = "",
  [switch]$AllUsers,
  [switch]$UseRunKey
)

$ErrorActionPreference = "Stop"

$productName = "LabLock"
$taskName = "LabLock"
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"

function Test-Elevated {
  $principal = New-Object Security.Principal.WindowsPrincipal(
    [Security.Principal.WindowsIdentity]::GetCurrent()
  )
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# --- Resolve the app executable ------------------------------------------
if (-not $AppExe) {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\LabLock\LabLock.exe"),
    (Join-Path ${env:ProgramFiles} "LabLock\LabLock.exe"),
    (Join-Path $PSScriptRoot "..\release\win-unpacked\LabLock.exe")
  )
  $AppExe = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (-not $AppExe) {
    throw "Could not locate 'LabLock.exe'. Pass -AppExe with the full path."
  }
}
if (-not (Test-Path -LiteralPath $AppExe)) {
  throw "App executable not found at: $AppExe"
}
Write-Host "Using app executable: $AppExe"

# --- Register -------------------------------------------------------------
if ($UseRunKey) {
  Set-ItemProperty -Path $runKey -Name $productName -Value ('"' + $AppExe + '"') -Type String
  Write-Host "[Run key] Registered '$productName' at $runKey"
  Write-Host "[Run key] This applies to the current user ($env:USERNAME) only."
  exit 0
}

if ($AllUsers) {
  if (-not (Test-Elevated)) {
    throw "-AllUsers requires an elevated (Run as Administrator) shell, because an 'any user logon' Scheduled Task needs admin rights. Re-run elevated, or omit -AllUsers to register for the current user only."
  }
  $quoted = '"' + $AppExe + '"'
  & schtasks.exe /Create /TN $taskName /TR $quoted /SC ONLOGON /F
  if ($LASTEXITCODE -ne 0) {
    throw "schtasks failed with exit code $LASTEXITCODE"
  }
  Write-Host "[Scheduled Task] Created '$taskName' to run at logon of any user."
  exit 0
}

# Default: Scheduled Task for the current user (no admin required).
$user = "$env:USERDOMAIN\$env:USERNAME"
$action = New-ScheduledTaskAction -Execute $AppExe
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
  -Description "Launches LabLock at logon of $user" -Force | Out-Null
Write-Host "[Scheduled Task] Created '$taskName' to run at logon of $user (current user)."
Write-Host "[Scheduled Task] RunLevel: Limited -- the app itself does not need admin rights at runtime."