# Lockdown Kiosk Browser — Agent Guide

## Project overview
Hand-built kiosk browser for school lab PCs (Win10/11 Pro/Home, no Enterprise licensing). Shows a whitelisted-site grid; blocks all other navigation. Four phases:
- Phase 1: core browser + whitelist enforcement (done)
- Phase 2: window lockdown + startup registration (done)
- Phase 3: shell replacement + global keyboard hook + DisableTaskMgr (in progress)
- Phase 4: admin escape hatch + watchdog (planned)

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
- **Toolbar** (fixed 44px strip) — Home button, never reloaded
- **Content view** — home grid / "Site not allowed" screen; has preload (`toolbar-preload.js`) exposing `getWhitelist`, `navigateTo`, `goHome` via contextBridge
- **Site view** — actual external site; **no preload, zero exposed API**; navigation gated by `will-navigate`, `will-redirect`, `will-frame-navigate`, `setWindowOpenHandler` all delegating to `isUrlAllowed()` in `whitelist.ts`

Single source of truth for whitelist logic: `src/main/whitelist.ts:129` (`isUrlAllowed`)

## Key files
```
src/main/main.ts          # app entry, window creation, session-end handler
src/main/window.ts        # KIOSK flag, window config, close prevention, view layout
src/main/whitelist.ts     # load/validate config/whitelist.json; isUrlAllowed()
src/main/navigation-guard.ts # attaches all navigation interceptors to site view
src/main/ipc.ts           # ipcMain handlers (GET_WHITELIST, NAVIGATE_TO, GO_HOME)
src/main/paths.ts         # runtime path resolution (dev vs packaged)
src/shared/types.ts       # shared types + IPC channel constants
config/whitelist.json     # site list (name, url, icon?, allowedHosts?)
scripts/copy-assets.js    # copies renderer HTML/CSS to dist/ at build
```

## Phase 2 lockdown (active in packaged builds or `LOCKDOWN_KIOSK=1`)
- `fullscreen: true, kiosk: true, frame: false, alwaysOnTop: true`
- `closable/minimizable/maximizable/resizable: false`
- `Menu.setApplicationMenu(null)` — strips app menu, removes default accelerators
- `devTools: false` on all WebContents
- `close` event swallowed unless `setAllowClose(true)` called
- Session-end never blocked: `app.on('query-session-end', () => setAllowClose(true))` (registered via EventEmitter cast — electron.d.ts v43 lacks these events on `App`)

**Escape caveat:** No admin escape hatch until Phase 4. Exit in dev = kill process.

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
- Electron on this machine needs: `--disable-gpu --disable-gpu-shader-disk-cache --user-data-dir=<writable>`
- TypeScript compiles to `dist/`; renderer assets copied by `scripts/copy-assets.js`

## Phase 3 (in progress) — what's being added
- **C# WH_KEYBOARD_LL hook** (`src/inputhook/InputHook.cs`, compiled via `scripts/build-inputhook.ps1` to `bin/inputhook/InputHook.exe`): swallows Alt+F4, Alt+Tab, Win keys, Ctrl+Shift+Esc. Electron's `globalShortcut` tested and **cannot** register these system-level combos.
- **Shell replacement**: `HKLM\...\Winlogon\Shell` → this app's exe (with tested rollback script)
- **DisableTaskMgr**: registry policy to block Task Manager (HKLM machine-wide, requires admin; HKCU Policies ACL is protected on Win11)

## Testing
No formal test suite. Manual checklist in `docs/README.md` (Phase 1 & 2 sections). Whitelist logic validated via scratchpad test (`scratchpad/verify/test-whitelist.js` in temp dir).

## Important constraints
- No MSVC / node-gyp on target machines — native addons won't build; use OS-bundled `csc.exe` for companion processes
- `.gitignore` excludes `dist/`, `release/`, `node_modules/` — `bin/inputhook/InputHook.exe` is committed (small, needed for packaging)
- `tsconfig.json` excludes `src/watchdog/` (Phase 4, not yet built)
- Electron 43, Node 22+, TypeScript 7

## References
- `docs/README.md` — full status, architecture, manual test checklists, Windows notes
- `installer/README.md` — startup scripts usage, Phase 3 planned scripts
- `src/watchdog/README.md` — Phase 4 design notes (not yet implemented)