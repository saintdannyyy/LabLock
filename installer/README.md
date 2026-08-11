# Installer scripts

OS-level integration scripts for **HEWStudio**.

## Phase 2 — Launch at startup

Two scripts manage automatic launch at Windows logon:

- `register-startup.ps1` — creates the startup registration
- `unregister-startup.ps1` — removes it (also removes any leftover Run-key entry, so it's safe to run unconditionally)

### Usage

```
# Default: Scheduled Task that runs the app at the current user's logon.
# No admin rights required.
.\register-startup.ps1 -AppExe "C:\path\to\HewStudio.exe"

# Alternative: HKCU Run registry key (per-user, no admin).
.\register-startup.ps1 -UseRunKey -AppExe "C:\path\to\HewStudio.exe"

# Optional: run at ANY user's logon. Requires an elevated (Run as
# Administrator) shell.
.\register-startup.ps1 -AllUsers -AppExe "C:\path\to\HewStudio.exe"
```

`-AppExe` can be omitted; the script then searches common install locations
(NSIS per-user install dir, Program Files, and `release/win-unpacked`).

### Scheduled Task vs Run key (why the task is the default)

| | Scheduled Task (default) | Run key |
|---|---|---|
| Scope | Per-user by default; any-user via `-AllUsers` | Per-user only |
| Admin needed | No (per-user) / Yes (`-AllUsers`) | No |
| Launch timing | Early, before/at logon UI settles | After the shell has started |
| Extra features | Run level, conditions, logs | None |
| Visibility to students | Task Scheduler (harder to reach) | `regedit`/`HKCU\...\Run` |

### Important lab-machine note

The default Scheduled Task and the Run key are **per-user** registrations. If
students log in with their own accounts, startup registration must be applied
to each account (or the task created with `-AllUsers`, which needs admin). If
Phase 3's shell replacement is later enabled, the app becomes the shell and
launches itself at logon regardless — the startup registration becomes
redundant, which is one reason the spec prefers the shell approach for the
final posture.

---

## Phase 3 — Shell replacement + Task Manager policy

### Shell replacement

Two scripts replace the Windows shell (`explorer.exe`) with HEWStudio:

- `enable-shell.ps1` — sets `HKLM\...\Winlogon\Shell` to HewStudio.exe, backs up original value
- `disable-shell.ps1` — restores the original shell from backup

**Both require an elevated (Run as Administrator) PowerShell session.**

```
# Must run from elevated shell (Right-click PowerShell → Run as Administrator)
.\enable-shell.ps1 -AppExe "C:\Program Files\HEWStudio\HewStudio.exe"
# Log off / reboot → HEWStudio launches as shell (no explorer, no taskbar)

# To rollback (from Safe Mode if needed):
.\disable-shell.ps1
```

**Critical:** Test the rollback (`disable-shell.ps1`) in a disposable VM first.
A failed shell replacement can leave a machine unable to boot to a normal desktop.

### Task Manager policy

Two scripts control the `DisableTaskMgr` registry value (machine-wide, HKLM).
**Both require an elevated (Run as Administrator) PowerShell session.**

- `disable-taskmgr.ps1` — sets `DisableTaskMgr=1` (blocks Task Manager for all users)
- `enable-taskmgr.ps1` — removes the value (restores Task Manager)

```
# Must run from an elevated shell (Right-click PowerShell → Run as Administrator)
.\disable-taskmgr.ps1
.\enable-taskmgr.ps1
```

#### Why HKLM instead of HKCU

On Windows 11, `HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System`
has a restrictive ACL that denies write access even to the key's owner. The
machine-wide HKLM path is the supported, reliable location — it's what Group
Policy uses and it applies to every user on the lab machine.

#### Effect

When `DisableTaskMgr=1` is set, `taskmgr.exe` refuses to start from **any**
entry point: Ctrl+Shift+Esc, Ctrl+Alt+Del → Task Manager, Run dialog, Start
menu, command line. The low-level keyboard hook (Phase 3) cannot reliably
block Ctrl+Shift+Esc — Windows handles it as a system hotkey outside user-mode
hook reach — so this policy is the correct, documented mechanism.