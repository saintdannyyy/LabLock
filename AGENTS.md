# HEWStudio — Agent Guide

## Project overview
Hand-built kiosk browser for school lab PCs (Win10/11 Pro/Home, no Enterprise licensing). Shows a whitelisted-site grid; blocks all other navigation. Five phases:
- Phase 1: core browser + whitelist enforcement (done)
- Phase 2: window lockdown + startup registration (done)
- Phase 3: shell replacement + global keyboard hook + DisableTaskMgr (done)
- Phase 4: admin escape hatch + admin console (whitelist manager + activity log) + watchdog (done)
- Phase 5: per-child profiles, screen-time limits + usage hours, planner (done)

## Essential commands
```
npm install                    # install deps
npm run build                  # tsc + copy renderer assets
npm run typecheck              # type-check only (no emit)
npm start                      # build + launch via `electron .`
npm run dev                    # tsc -w (watch); run `electron .` in separate terminal
npm run package:win            # build signed/unsigned Windows installer (release/)
```

## Architecture (Phase 1)
One `BrowserWindow` with five `WebContentsView`s:
- **Toolbar** (fixed 48px strip) — brand, site tabs, Back/Home pills, power
  buttons; never reloaded. Its own preload (`toolbar-preload.js`) exposes
  `getWhitelist`, `navigateTo`, `goHome`, `goBack`, `shutdown`, `restart`,
  `onUiState`
- **Content view** — home grid / "Site not allowed" screen / picker / off-hours
  screen; has preload (`content-preload.js`) exposing `getWhitelist`,
  `navigateTo`, `goHome`, `getPlanner`, `saveTodos` via contextBridge
- **Site view** — actual external site; **no preload, zero exposed API**; navigation gated by `will-navigate`, `will-redirect`, `will-frame-navigate`, `setWindowOpenHandler` all delegating to `isUrlAllowed()` in `whitelist.ts`
- **Sidebar** (280px left column, only while a profile is active) — the child's
  plan as three Apple-style cards: an **interactive month calendar** (prev/next
  month, day dots for events/undone to-dos) whose selected day drives the
  Calendar (that day's events), Timetable (that day's weekday) and To-dos (dated
  + undated). To-dos added from the sidebar are stamped with the selected date;
  admin-created to-dos are undated and always show. Preload
  (`sidebar-preload.js`) exposes `getPlanner`, `saveTodos`, `getTheme`,
  `onThemeChanged`, `onWhitelistRefreshed`, `onPlannerChanged`

Single source of truth for whitelist logic: `src/main/whitelist.ts:129` (`isUrlAllowed`)

## Key files
```
src/main/main.ts          # app entry, window creation, session-end handler, escape hatch + admin gate + watchdog
src/main/window.ts        # KIOSK flag, window config, close prevention, view layout, activity logging hooks
src/main/whitelist.ts     # load/validate config/whitelist.json; isUrlAllowed(); atomic saveWhitelist()
src/main/history.ts       # append-only JSONL activity log at <userData>/history.jsonl
src/main/navigation-guard.ts # attaches all navigation interceptors to site view
src/main/ipc.ts           # ipcMain handlers (GET_WHITELIST, NAVIGATE_TO, GO_HOME)
src/main/paths.ts         # runtime path resolution (dev vs packaged)
src/main/input-hook.ts    # spawns InputHook.exe, returns PID for watchdog
src/main/system-status.ts # control-panel probes: Win32_Battery/network PowerShell + Add-Type C# master volume
src/main/profiles.ts      # per-child profile definitions (<userData>/profiles.json, migration from legacy whitelist.json)
src/main/screen-time.ts   # per-profile daily limit tracker + usage-hours windows; onChange ticks
src/main/planner.ts       # per-profile planner storage (events/timetable/todos), <userData>/planner-<profileId>.json
src/main/wifi.ts          # toolbar Wi-Fi panel: netsh wlan scan/connect/forget (needs elevation)
src/main/apps.ts          # installed-app enumeration (Start Menu .lnk) for the native-platform picker
src/preload/escape-preload.ts # sandboxed preload for escape dialog + admin console (escapeAPI + adminAPI)
src/preload/sidebar-preload.ts # sandboxed preload for the planner sidebar (getPlanner, saveTodos, theme, refresh events)
src/renderer/admin/       # admin console (Sites + Usage + Planner + Activity tabs), loaded by morphing the escape window
src/renderer/toolbar/     # toolbar + macOS-style control panel (status cluster, dropdown, volume, power)
src/renderer/sidebar/     # child planner sidebar (interactive month calendar + Calendar/Timetable/To-dos cards)
src/renderer/restricted/  # "off-hours" screen shown when outside the profile's usage hours
src/shared/types.ts       # shared types + IPC channel constants
config/whitelist.json     # site list (name, url, icon?, allowedHosts?, embedHosts?)
scripts/copy-assets.js    # copies renderer HTML/CSS to dist/ at build
src/inputhook/InputHook.cs      # C# WH_KEYBOARD_LL hook (Alt+F4, Alt+Tab, Win, Ctrl+Shift+Esc, Ctrl+Alt+Shift+F12)
src/watchdog/Watchdog.cs        # C# watchdog (monitors Electron + InputHook PIDs)
scripts/build-inputhook.ps1     # compiles InputHook.cs via csc.exe
scripts/build-watchdog.ps1      # compiles Watchdog.cs via csc.exe
bin/inputhook/InputHook.exe     # committed binary (extraResources)
bin/watchdog/Watchdog.exe       # committed binary (extraResources)
```

## Phase 2 lockdown (active in packaged builds or `LOCKDOWN_KIOSK=1`)
- `fullscreen: true, kiosk: true, frame: false, alwaysOnTop: true`
- `closable/minimizable/maximizable/resizable: false`
- `Menu.setApplicationMenu(null)` — strips app menu, removes default accelerators
- `devTools: false` on all WebContents
- `close` event swallowed unless `setAllowClose(true)` called
- Session-end never blocked: `app.on('query-session-end', () => setAllowClose(true))` (registered via EventEmitter cast — electron.d.ts v43 lacks these events on `App`)

## Phase 3 additions
- **C# WH_KEYBOARD_LL hook** (`InputHook.exe`): swallows Alt+F4, Alt+Tab, Win keys (L/R), Ctrl+Shift+Esc. Electron `globalShortcut` tested and **cannot** register these system combos. Adds `Ctrl+Alt+Shift+F12` → named pipe `\\.\pipe\lockdown-escape` signal.
- **Shell replacement**: `installer/enable-shell.ps1` / `disable-shell.ps1` set `HKLM\...\Winlogon\Shell` with backup/rollback.
- **DisableTaskMgr**: `installer/disable-taskmgr.ps1` / `enable-taskmgr.ps1` set HKLM `DisableTaskMgr=1` (HKCU Policies ACL protected on Win11).

## Phase 4 additions
- **Admin escape hatch + admin console**: `Ctrl+Alt+Shift+F12` → InputHook signals via named pipe → main process shows a password dialog → correct password morphs that same full-screen window into the **admin console** (never quits the app — HEWStudio is the shell). Two tabs:
  - **Sites**: "Permitted platforms" manager per profile — add/edit/remove web platforms (name, URL, allowedHosts/embedHosts) and grant native programs by picking them from the machine's installed apps (`src/main/apps.ts`); changes go through the profile save path (`<userData>/profiles.json`), then re-`loadWhitelist()`, `updateWhitelist()`, and `notifyWhitelistRefreshed()` so the running kiosk applies changes **live** (no restart).
  - **Activity**: append-only JSONL log (`<userData>/history.jsonl`, sync appends, fire-and-forget) — navigation, blocked attempts, home/back, power, escape/auth, whitelist saves, app start/quit; paged newest-first, searchable, admin-clearable.
  - **Auth gating**: `adminAuthenticated` flag set only on correct password; `SAVE_WHITELIST`/`ACTIVITY_GET`/`ACTIVITY_CLEAR` refuse without it; flag drops on console close/"Done" (`ADMIN_CLOSE`) and window `closed`. Password via `LOCKDOWN_ADMIN_PASSWORD` env (default `admin123`).
- **Watchdog** (`Watchdog.exe`): spawned with `--electron-pid --hook-pid --app-exe`. Polls both PIDs; restarts app exe on unexpected exit; clean shutdown (exit code 0) = no restart.

## Phase 5 additions
- **Per-child profiles** (`<userData>/profiles.json`, `src/main/profiles.ts`): name, avatar (emoji or `assets/...`), `dailyLimitMin` (0 = unlimited), `usageHours` (array of `{ day, start, end }`, `day` = `Mon`..`Sun`), platform membership. One profile active at a time (`selectProfile`); boot auto-selects when exactly one profile exists, else shows the picker.
- **Native platform grants** (`src/main/apps.ts`): admin never types exe paths — a multi-select, searchable picker of installed Start Menu apps (`InstalledApp { id, name, exe, args? }`, stable id = hash of lowercased `exe|args`) maps each checked app to a `PlatformEntry` (`kind: 'native'`); `window.ts` `launchApp(id)` spawns the exe and hides the kiosk until it exits. Usage tracked per platform like web apps.
- **Screen-time limits** (`src/main/screen-time.ts`): per-profile daily used-seconds ledger (`<userData>/screen-time-<profileId>.json`, resets daily); ticker emits status every second; reaching the limit shows the toolbar countdown banner and a 60s shutdown (blocked by `Extend time` → admin password override, logged as `override`).
- **Usage-hours enforcement**: outside the profile's usage window the content pane switches to the **restricted** screen (`src/renderer/restricted/`, "off-hours" activity logged). `screen-time.ts` `onChange` → `enforceUsageHours(inWindow)` in `window.ts`; on window close it routes home; reopening a site while off-hours kicks back to the restricted screen.
- **Planner** (per-child): admin console **Planner tab** edits calendar events (date + title), a weekly timetable (per-day period/subject rows) and checkable to-dos; Save → `savePlanner()` validates via `validatePlanner()` and atomic-writes `<userData>/planner-<profileId>.json` (admin-gated IPC). The child sees their plan in a **persistent left sidebar** (`src/renderer/sidebar/`, `SIDEBAR_WIDTH = 280` in `window.ts`) — a pinned 280px column under the toolbar with no separator line. It shows an **interactive month calendar** (prev/next month nav, today ring, event + to-do day dots) whose **selected day drives every section**: Calendar shows that day's events, Timetable shows that day's weekday schedule, and To-dos shows undated (general) to-dos plus to-dos dated to the selected day. To-dos added from the sidebar are stamped with the currently selected date (`PlannerTodo.date?: "YYYY-MM-DD"`, validated in `validatePlanner`); admin-console to-dos are undated and always visible. Selecting a date affects events, timetable, and todos; profile switch resets to today. Preload (`sidebar-preload.js`) reads the ACTIVE profile via `PLANNER_ACTIVE_GET` and refreshes on `WHITELIST_REFRESHED` (profile switch / admin save) and `PLANNER_CHANGED` (main → sidebar push after an admin planner save). Events/timetable are read-only for the child; to-dos are interactive — the child checks off/adds/removes them via the ungated `PLANNER_TODOS_UPDATE` channel, which is scoped to the ACTIVE profile (no profileId accepted from the renderer) and only ever rewrites the to-dos array (events/timetable preserved). Theme follows the toolbar via `getTheme`/`onThemeChanged`.
- **Activity log** gains `screen-time-limit`, `override`, `restricted`, `wifi-connect` kinds; admin Usage tab shows per-day per-profile usage.
- **Wi-Fi control** (dedicated network-chip panel, `src/main/wifi.ts`): scan / connect / forget over `netsh wlan` (parse helpers exported for scratchpad verification). Ungated like the volume control, so it realistically needs the kiosk to run elevated (connect/add-profile/delete-profile and scans hit error 5 / Location consent as a standard user); failures surface as **friendly, untruncated** error messages (`describeNetshFailure()`), never a bare netsh code. Successful connects/forgets log `wifi-connect`.

## Startup registration (Phase 2)
`installer/register-startup.ps1` — Scheduled Task (default, per-user, no admin) or Run key (`-UseRunKey`) or all-users (`-AllUsers`, needs admin).
`installer/unregister-startup.ps1` — removes both.

Per-user registrations follow the user; on lab machines with per-student accounts, apply per account or use `-AllUsers`.

## Whitelist matching rules (from docs/README.md)
- `"example.com"` → matches ONLY `example.com` (not `www`, not subdomains)
- `"*.example.com"` → matches subdomains ONLY (`a.example.com`), NOT bare `example.com`
- Must list both explicitly if both needed: `["example.com", "*.example.com"]`
- `allowedHosts` = fully browseable (main page, frames, popups). `embedHosts` = iframe-only; never a top-level page/popup/tile (for YouTube/Google Maps/Disqus embeds that should NOT be visitable)
- Case-insensitive; scheme-restricted: non-http(s) always blocked
- Iframes checked via `allowedHosts` OR `embedHosts` (`isFrameUrlAllowed`); top-level nav/redirects/popups strictly via `isUrlAllowed` (ignores embedHosts)

## Dev environment quirks
- `ELECTRON_RUN_AS_NODE=1` may be set in shell profiles — must unset before launching GUI: `$env:ELECTRON_RUN_AS_NODE=$null`
- The repo `.env` (loaded via `import 'dotenv/config'` in `main.ts`) sets `LOCKDOWN_KIOSK=1`, so `npm start` runs **kiosk mode** here by default. For a normal dev window use `LOCKDOWN_KIOSK=0` (non-empty so dotenv won't override) or edit `.env`.
- Renderer scripts are loaded as plain browser scripts over `file://` — they must NOT use `import`/`export` (tsc would emit a CommonJS `exports` wrapper that throws). Types are declared structurally (see `toolbar.ts`).
- Electron on this machine needs: `--disable-gpu --disable-gpu-shader-disk-cache --user-data-dir=<writable>`
- TypeScript compiles to `dist/`; renderer assets copied by `scripts/copy-assets.js`

## Testing
No formal test suite. Manual checklist in `docs/README.md` (Phase 1–5 sections). Whitelist logic validated via scratchpad test (`scratchpad/verify/test-whitelist.js` in temp dir). Hook verified via `scripts/test-inputhook.ps1`.

## Important constraints
- No MSVC / node-gyp on target machines — native addons won't build; use OS-bundled `csc.exe` for companion processes
- `.gitignore` excludes `dist/`, `release/`, `node_modules/` — `bin/inputhook/InputHook.exe` and `bin/watchdog/Watchdog.exe` are committed (small, needed for packaging)
- Electron 43, Node 22+, TypeScript 7

## References
- `docs/README.md` — full status, architecture, manual test checklists, Windows notes
- `installer/README.md` — startup scripts usage, Phase 3 & 4 scripts
- `src/watchdog/README.md` — Phase 4 design notes