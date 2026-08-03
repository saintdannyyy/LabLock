# Manual verification harness for InputHook.exe (WH_KEYBOARD_LL hook).
#
# Opens a Notepad window, starts InputHook.exe, then synthesizes each escape
# combo and reports whether the hook swallowed it:
#   Alt+F4          -> Notepad must stay open
#   Alt+Tab         -> foreground must not change
#   Ctrl+Shift+Esc  -> taskmgr.exe must not launch
#   Win key         -> foreground must not change (Start menu must not open)
#
# Usage:  powershell -ExecutionPolicy Bypass -File scripts/test-inputhook.ps1

$ErrorActionPreference = 'Stop'

Add-Type -Namespace LockdownHookTest -Name Win32 -MemberDefinition @'
[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int maxCount);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
'@

function Send-Combo([byte[]]$down, [byte[]]$up) {
    foreach ($vk in $down) { [LockdownHookTest.Win32]::keybd_event($vk, 0, 0, [UIntPtr]::Zero) | Out-Null; Start-Sleep -Milliseconds 40 }
    Start-Sleep -Milliseconds 60
    foreach ($vk in $up)  { [LockdownHookTest.Win32]::keybd_event($vk, 0, 2, [UIntPtr]::Zero) | Out-Null; Start-Sleep -Milliseconds 40 }
    Start-Sleep -Milliseconds 60
}

function Get-FgText {
    $h = [LockdownHookTest.Win32]::GetForegroundWindow()
    $sb = New-Object System.Text.StringBuilder 256
    [LockdownHookTest.Win32]::GetWindowText($h, $sb, 256) | Out-Null
    return $sb.ToString()
}

$VK_TAB = 0x09; $VK_SHIFT = 0x10; $VK_CTRL = 0x11; $VK_ALT = 0x12; $VK_ESC = 0x1B
$VK_LWIN = 0x5B; $VK_F4 = 0x73

$wsh = New-Object -ComObject WScript.Shell
$hookExe = Join-Path $PSScriptRoot '..\bin\inputhook\InputHook.exe'
if (-not (Test-Path -LiteralPath $hookExe)) { throw "Missing $hookExe - run scripts/build-inputhook.ps1 first" }

# --- 1. Open the victim window -------------------------------------------------
$tmpFile = Join-Path $env:TEMP ("lockdown-hook-test-{0}.txt" -f [guid]::NewGuid().ToString('N'))
Set-Content -LiteralPath $tmpFile -Value 'hook test' -Encoding UTF8
$notepad = Start-Process notepad -ArgumentList "`"$tmpFile`"" -PassThru
$notepad.WaitForInputIdle(5000) | Out-Null
Start-Sleep -Milliseconds 800

# --- 2. Start the hook ---------------------------------------------------------
$hook = Start-Process -FilePath $hookExe -PassThru
Start-Sleep -Milliseconds 800
if ($hook.HasExited) { throw "InputHook.exe exited with code $($hook.ExitCode)" }

$results = [System.Collections.Generic.List[string]]::new()

function Focus-Notepad {
    [LockdownHookTest.Win32]::SetForegroundWindow($notepad.MainWindowHandle) | Out-Null
    Start-Sleep -Milliseconds 400
}

try {
    # --- 3. Alt+F4 -------------------------------------------------------------
    Focus-Notepad
    $fgBefore = Get-FgText
    Send-Combo -down @($VK_ALT) -up @($VK_F4)
    Start-Sleep -Milliseconds 900
    $notepad.Refresh()
    if ($notepad.HasExited) {
        $results.Add('Alt+F4     => NOT swallowed (Notepad was closed)')
    } else {
        $results.Add('Alt+F4     => swallowed (Notepad stayed open)')
    }

    # --- 4. Alt+Tab ------------------------------------------------------------
    Focus-Notepad
    $fgBefore = Get-FgText
    Send-Combo -down @($VK_ALT, $VK_TAB) -up @($VK_TAB, $VK_ALT)
    Start-Sleep -Milliseconds 900
    $fgAfter = Get-FgText
    if ($fgAfter -eq $fgBefore) {
        $results.Add('Alt+Tab    => swallowed (foreground unchanged)')
    } else {
        $results.Add("Alt+Tab    => NOT swallowed (foreground: '$fgBefore' -> '$fgAfter')")
    }

    # --- 5. Ctrl+Shift+Esc -----------------------------------------------------
    $taskmgr = Get-Process -Name taskmgr -ErrorAction SilentlyContinue
    Send-Combo -down @($VK_CTRL, $VK_SHIFT, $VK_ESC) -up @($VK_ESC, $VK_SHIFT, $VK_CTRL)
    Start-Sleep -Milliseconds 1200
    $taskmgrAfter = Get-Process -Name taskmgr -ErrorAction SilentlyContinue
    if ($null -eq $taskmgrAfter) {
        $results.Add('CtrlShiftEsc => swallowed (taskmgr did not start)')
    } else {
        $results.Add('CtrlShiftEsc => NOT swallowed (taskmgr started)')
    }

    # --- 6. Win key ------------------------------------------------------------
    Focus-Notepad
    $fgBefore = Get-FgText
    Send-Combo -down @($VK_LWIN) -up @($VK_LWIN)
    Start-Sleep -Milliseconds 1200
    $fgAfter = Get-FgText
    if ($fgAfter -eq $fgBefore) {
        $results.Add('Win key    => swallowed (Start menu did not open)')
    } else {
        $results.Add("Win key    => NOT swallowed (foreground: '$fgBefore' -> '$fgAfter')")
    }
}
finally {
    if (-not $hook.HasExited) { $hook.Kill(); $hook.WaitForExit() }
    if (-not $notepad.HasExited) { $notepad.CloseMainWindow(); Start-Sleep -Milliseconds 500 }
    if (-not $notepad.HasExited) { $notepad.Kill() }
    Remove-Item -LiteralPath $tmpFile -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host 'InputHook.exe verification results:'
$results | ForEach-Object { Write-Host "  $_" }
