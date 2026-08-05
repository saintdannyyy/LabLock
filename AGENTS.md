# Lockdown Kiosk Browser — Agent Guide

## Project overview
Hand-built kiosk browser for school lab PCs (Win10/11 Pro/Home, no Enterprise licensing). Shows a whitelisted-site grid; blocks all other navigation. Four phases:
- Phase 1: core browser + whitelist enforcement (done)
- Phase 2: window lockdown + startup registration (done)
- Phase 3: shell replacement + global keyboard hook + DisableTaskMgr (done)
- Phase 4: admin escape hatch + watchdog (done)

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
One `BrowserWindow` with three `WebContentsView`s:
- **Toolbar** (fixed 48px strip) — brand, site tabs, Back/Home pills, power
  buttons; never reloaded. Its own preload (`toolbar-preload.js`) exposes
  `getWhitelist`, `navigateTo`, `goHome`, `goBack`, `shutdown`, `restart`,
  `onUiState`
- **Content view** — home grid / "Site not allowed" screen; has preload (`toolbar-preload.js`) exposing `getWhitelist`, `navigateTo`, `goHome` via contextBridge
- **Site view** — actual external site; **no preload, zero exposed API**; navigation gated by `will-navigate`, `will-redirect`, `will-frame-navigate`, `setWindowOpenHandler` all delegating to `isUrlAllowed()` in `whitelist.ts`

Single source of truth for whitelist logic: `src/main/whitelist.ts:129` (`isUrlAllowed`)

## Key files
```
src/main/main.ts          # app entry, window creation, session-end handler, escape hatch + watchdog
src/main/window.ts        # KIOSK flag, window config, close prevention, view layout
src/main/whitelist.ts     # load/validate config/whitelist.json; isUrlAllowed()
src/main/navigation-guard.ts # attaches all navigation interceptors to site view
src/main/ipc.ts           # ipcMain handlers (GET_WHITELIST, NAVIGATE_TO, GO_HOME)
src/main/paths.ts         # runtime path resolution (dev vs packaged)
src/main/input-hook.ts    # spawns InputHook.exe, returns PID for watchdog
src/shared/types.ts       # shared types + IPC channel constants
config/whitelist.json     # site list (name, url, icon?, allowedHosts?)
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
- **Admin escape hatch**: `Ctrl+Alt+Shift+F12` → InputHook signals via named pipe → main process shows password dialog → correct password → `setAllowClose(true)` + `window.close()`. Password via `LOCKDOWN_ADMIN_PASSWORD` env (default `admin123`).
- **Watchdog** (`Watchdog.exe`): spawned with `--electron-pid --hook-pid --app-exe`. Polls both PIDs; restarts app exe on unexpected exit; clean shutdown (exit code 0) = no restart.

## Startup registration (Phase 2)
`installer/register-startup.ps1` — Scheduled Task (default, per-user, no admin) or Run key (`-UseRunKey`) or all-users (`-AllUsers`, needs admin).
`installer/unregister-startup.ps1` — removes both.

Per-user registrations follow the user; on lab machines with per-student accounts, apply per account or use `-AllUsers`.

## Whitelist matching rules (from docs/README.md)
- `"example.com"` → matches ONLY `example.com` (not `www`, not subdomains)
- `"*.example.com"` → matches subdomains ONLY (`a.example.com`), NOT bare `example.com`
- Must list both explicitly if both needed: `["example.com", "*.example.com"]`
- Case-insensitive; scheme-restricted: non-http(s) always blocked
- Iframes checked against same whitelist; embedded content from other domains needs explicit `allowedHosts`
- Subresource requests (images, scripts, fetch, CSS) NOT restricted — only navigation

## Dev environment quirks
- `ELECTRON_RUN_AS_NODE=1` may be set in shell profiles — must unset before launching GUI: `$env:ELECTRON_RUN_AS_NODE=$null`
- The repo `.env` (loaded via `import 'dotenv/config'` in `main.ts`) sets `LOCKDOWN_KIOSK=1`, so `npm start` runs **kiosk mode** here by default. For a normal dev window use `LOCKDOWN_KIOSK=0` (non-empty so dotenv won't override) or edit `.env`.
- Renderer scripts are loaded as plain browser scripts over `file://` — they must NOT use `import`/`export` (tsc would emit a CommonJS `exports` wrapper that throws). Types are declared structurally (see `toolbar.ts`).
- Electron on this machine needs: `--disable-gpu --disable-gpu-shader-disk-cache --user-data-dir=<writable>`
- TypeScript compiles to `dist/`; renderer assets copied by `scripts/copy-assets.js`

## Testing
No formal test suite. Manual checklist in `docs/README.md` (Phase 1–4 sections). Whitelist logic validated via scratchpad test (`scratchpad/verify/test-whitelist.js` in temp dir). Hook verified via `scripts/test-inputhook.ps1`.

## Important constraints
- No MSVC / node-gyp on target machines — native addons won't build; use OS-bundled `csc.exe` for companion processes
- `.gitignore` excludes `dist/`, `release/`, `node_modules/` — `bin/inputhook/InputHook.exe` and `bin/watchdog/Watchdog.exe` are committed (small, needed for packaging)
- Electron 43, Node 22+, TypeScript 7

## References
- `docs/README.md` — full status, architecture, manual test checklists, Windows notes
- `installer/README.md` — startup scripts usage, Phase 3 & 4 scripts
- `src/watchdog/README.md` — Phase 4 design notes