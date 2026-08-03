# Watchdog (not yet implemented — Phase 4)

This folder is a placeholder for the Phase 4 watchdog: a separate lightweight
process that monitors the main kiosk app and relaunches it within ~1-2
seconds if it terminates unexpectedly (crash, `taskkill`, etc.), while *not*
relaunching it after an intentional exit via the admin escape hatch.

Planned approach (subject to its own plan/review cycle before being built):
- Runs as its own process/Scheduled Task, independent of the main app, so
  killing the main app's process tree can't take the watchdog down with it.
- Polls for the main app's process; relaunches it if absent.
- Checks for an "intentional exit" flag file (written by the admin escape
  hatch flow right before it closes the app) before relaunching — if present,
  the watchdog consumes the flag and stays idle instead of relaunching.

No code here yet — see the main project plan for phasing.
