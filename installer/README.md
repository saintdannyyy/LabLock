# Installer scripts

OS-level integration scripts. **Phase 2 (startup registration) is
implemented.** Phase 3 (shell replacement + Task Manager policy) is **not yet
implemented** — see the note at the bottom.

## Phase 2 — Launch at startup

Two scripts manage automatic launch at Windows logon:

- `register-startup.ps1` — creates the startup registration
- `unregister-startup.ps1` — removes it (also removes any leftover Run-key
  entry, so it's safe to run unconditionally)

### Usage

```
# Default: Scheduled Task that runs the app at the current user's logon.
# No admin rights required.
.\register-startup.ps1 -AppExe "C:\path\to\Lockdown Kiosk Browser.exe"

# Alternative: HKCU Run registry key (per-user, no admin).
.\register-startup.ps1 -UseRunKey -AppExe "C:\path\to\Lockdown Kiosk Browser.exe"

# Optional: run at ANY user's logon. Requires an elevated (Run as
# Administrator) shell.
.\register-startup.ps1 -AllUsers -AppExe "C:\path\to\Lockdown Kiosk Browser.exe"
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

## Phase 3 — (not yet implemented)

To be added in Phase 3, each with its own plan/review cycle because they
change a real machine's boot behavior:

- A script that sets
  `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\Shell` to this
  app's executable instead of `explorer.exe`, **plus a matching, tested
  rollback script** that restores `explorer.exe` — required before any shell
  replacement ships, since a mistake here can leave a machine unable to boot
  to a normal desktop.
- A script to set `DisableTaskMgr` under
  `HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System`.
