# Installer scripts (not yet implemented — Phase 2/3)

This folder is a placeholder for the install/uninstall scripts that will
handle OS-level integration once the shell/lockdown phases are built and
reviewed:

- **Phase 2**: Scheduled Task registration for launch-at-startup (preferred
  over the `Run` registry key), with the `Run` key documented as an
  alternative.
- **Phase 3**: a script that sets
  `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\Shell` to this
  app's executable instead of `explorer.exe`, plus a **matching, tested
  rollback script** that restores `explorer.exe` — required before any shell
  replacement ships, since a mistake here can leave a machine unable to boot
  to a normal desktop. Also: a script to set `DisableTaskMgr` under
  `HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System`.

No scripts here yet — these are higher-risk changes to a real machine's boot
behavior and will go through their own plan/review cycle, per the project's
phased rollout.
