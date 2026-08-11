<#
.SYNOPSIS
Registers HALISY WORKStudio to launch automatically at Windows logon.

.DESCRIPTION
Default method (no switches): a Scheduled Task that runs the app when the
current user logs on. Creating a task for the current user does NOT require
admin rights.

The app runs with a Limited token by default, which means the Wi-Fi panel's
`netsh wlan` scan/connect cannot work (it needs elevation or Location consent).
Pass -Elevated to register the task with highest privileges so Wi-Fi control
works out of the box; this requires an elevated shell and the logon account
must be an administrator.

Alternatives:
  -UseRunKey  : writes HKCU\Software\Microsoft\Windows\CurrentVersion\Run
                instead of a Scheduled Task. Simpler, but the Run key launches
                the app slightly later (after shell startup), offers no
                run-level/logging options, and CANNOT elevate (ignored with
                -Elevated). Per-user only.
  -AllUsers   : registers the task to run at ANY user's logon (the classic
                schtasks /SC ONLOGON behavior). Requires an elevated shell --
                creating an "any user" task needs admin rights.
  -Elevated   : registers the Scheduled Task with RunLevel Highest so the app
                launches elevated (makes the Wi-Fi panel work). Requires an
                elevated shell, and combining with -UseRunKey is an error.

The executable is resolved automatically if -AppExe is omitted: the NSIS
install location, then Program Files, then release/win-unpacked relative to
this repo. Pass -AppExe explicitly for any other location.

.PARAMETER AppExe
Full path to the app executable (HalisyWorkStudio.exe). Auto-detected if omitted.

.PARAMETER AllUsers
Register the Scheduled Task to run at logon of any user (requires admin).

.PARAMETER UseRunKey
Use the HKCU Run registry key instead of a Scheduled Task.

.PARAMETER Elevated
Register the Scheduled Task with RunLevel Highest (app launches as
administrator; requires an elevated shell and an admin logon account).

.EXAMPLE
.\register-startup.ps1 -AppExe "C:\Program Files\HALISY WORKStudio\HalisyWorkStudio.exe"

.EXAMPLE
.\register-startup.ps1 -Elevated

.EXAMPLE
.\register-startup.ps1 -UseRunKey
#>
[CmdletBinding()]
param(
  [string]$AppExe = "",
  [switch]$AllUsers,
  [switch]$UseRunKey,
  [switch]$Elevated
)

$ErrorActionPreference = "Stop"

$productName = "HALISY WORKStudio"
$taskName = "HALISY WORKStudio"
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
    (Join-Path $env:LOCALAPPDATA "Programs\HALISY WORKStudio\HalisyWorkStudio.exe"),
    (Join-Path ${env:ProgramFiles} "HALISY WORKStudio\HalisyWorkStudio.exe"),
    (Join-Path $PSScriptRoot "..\release\win-unpacked\HalisyWorkStudio.exe")
  )
  $AppExe = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (-not $AppExe) {
    throw "Could not locate 'HalisyWorkStudio.exe'. Pass -AppExe with the full path."
  }
}
if (-not (Test-Path -LiteralPath $AppExe)) {
  throw "App executable not found at: $AppExe"
}
Write-Host "Using app executable: $AppExe"

# --- Register -------------------------------------------------------------
if ($UseRunKey) {
  if ($Elevated) {
    throw "-Elevated cannot be combined with -UseRunKey: the Run key cannot elevate the app at logon. Drop -UseRunKey (a Scheduled Task) or drop -Elevated."
  }
  Set-ItemProperty -Path $runKey -Name $productName -Value ('"' + $AppExe + '"') -Type String
  Write-Host "[Run key] Registered '$productName' at $runKey"
  Write-Host "[Run key] This applies to the current user ($env:USERNAME) only."
  exit 0
}

if ($Elevated -and -not (Test-Elevated)) {
  throw "-Elevated requires an elevated (Run as Administrator) shell, because creating a highest-privilege Scheduled Task needs admin rights. Re-run elevated."
}

if ($AllUsers) {
  if (-not (Test-Elevated)) {
    throw "-AllUsers requires an elevated (Run as Administrator) shell, because an 'any user logon' Scheduled Task needs admin rights. Re-run elevated, or omit -AllUsers to register for the current user only."
  }
  $quoted = '"' + $AppExe + '"'
  if ($Elevated) {
    & schtasks.exe /Create /TN $taskName /TR $quoted /SC ONLOGON /RL HIGHEST /F
  } else {
    & schtasks.exe /Create /TN $taskName /TR $quoted /SC ONLOGON /F
  }
  if ($LASTEXITCODE -ne 0) {
    throw "schtasks failed with exit code $LASTEXITCODE"
  }
  Write-Host "[Scheduled Task] Created '$taskName' to run at logon of any user."
  if ($Elevated) {
    Write-Host "[Scheduled Task] RunLevel: Highest -- the app launches elevated (Wi-Fi panel works)."
  }
  exit 0
}

# Default: Scheduled Task for the current user (no admin required).
$user = "$env:USERDOMAIN\$env:USERNAME"
$action = New-ScheduledTaskAction -Execute $AppExe
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
if ($Elevated) {
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal `
    -Description "Launches HALISY WORKStudio at logon of $user (elevated)" -Force | Out-Null
  Write-Host "[Scheduled Task] Created '$taskName' to run at logon of $user (current user)."
  Write-Host "[Scheduled Task] RunLevel: Highest -- the app launches elevated (Wi-Fi panel works)."
  Write-Host "[Scheduled Task] Note: the logon account must be an administrator for Highest to take effect."
} else {
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
    -Description "Launches HALISY WORKStudio at logon of $user" -Force | Out-Null
  Write-Host "[Scheduled Task] Created '$taskName' to run at logon of $user (current user)."
  Write-Host "[Scheduled Task] RunLevel: Limited -- the app itself does not need admin rights at runtime."
}