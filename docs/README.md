# Lockdown Kiosk Browser

A hand-built kiosk browser for school computer labs running standard Windows
10/11 Pro/Home (no Enterprise/Education licensing, so no Shell Launcher /
Assigned Access). Shows a home grid of whitelisted sites; blocks navigation
to anything else.

## Project status

**Phase 1 (core browser + whitelist enforcement) — done.**
**Phase 2 (window lockdown + startup registration) — done.**
**Phase 3 (shell replacement + keyboard hook + Task Manager policy) — done.**
**Phase 4 (admin escape hatch + watchdog) — done.**

Where things stand now:

- The window is a **kiosk window in packaged builds** — fullscreen, no frame,
  no window controls, always on top, close events swallowed (except during a
  Windows session end), DevTools disabled, app menu stripped.
- The app **registers to launch at logon** via a Scheduled Task (or Run key)
  using the scripts in `installer/`.
- **Global keyboard hook** (C# `WH_KEYBOARD_LL`): swallows Alt+F4, Alt+Tab,
  Win key (L/R), Ctrl+Shift+Esc. Electron's `globalShortcut` cannot register
  these system-level combos; the hook runs as a companion process
  (`bin/inputhook/InputHook.exe`) built with the OS-bundled `csc.exe`.
- **Shell replacement** scripts (`installer/enable-shell.ps1` /
  `disable-shell.ps1`) set `HKLM\...\Winlogon\Shell` to the app exe with a
  tested rollback.
- **Task Manager policy** scripts (`installer/disable-taskmgr.ps1` /
  `enable-taskmgr.ps1`) set `DisableTaskMgr=1` at HKLM (machine-wide, requires
  admin; HKCU Policies ACL is protected on Win11).
- **Admin console** (reached via the escape hatch): `Ctrl+Alt+Shift+F12`
  opens a password prompt (default `admin123`, override via
  `LOCKDOWN_ADMIN_PASSWORD`). A correct password morphs the full-screen dialog
  into the admin console with two tabs:
  - **Sites** — whitelist manager: add/edit/remove sites (name, URL,
    allowedHosts). Saves atomically to `config/whitelist.json` and applies
    **live** to the running kiosk (toolbar tabs rebuild, enforcement updates)
    with no restart.
  - **Activity** — history viewer: append-only JSONL log of every user
    movement (navigation, blocked attempts, home/back, power, escape/auth
    events, whitelist saves, app lifecycle) at `<userData>/history.jsonl`
    (dev: the `--user-data-dir`; packaged: `%APPDATA%/LabLock/`). Paged
    newest-first, searchable by kind/text, cleared only by an admin.
  "Done" closes the console and returns to the kiosk — LabLock is the shell,
  so the app **never quits** from the console. Privileged IPC (whitelist
  save, history read/clear) is password-gated in the main process and refused
  on the unauthenticated password page.
- **Watchdog** (C# `bin/watchdog/Watchdog.exe`): monitors Electron + InputHook
  PIDs; restarts Electron on unexpected exit; respects clean shutdown (exit 0).
- **Control panel** (Phase 4 status cluster): a macOS-style cluster at the top
  right of the toolbar (Wi-Fi, battery, clock). Clicking it opens a dropdown
  with the current time/date, network details (SSID/type/link speed,
  online state), battery charge state, a master-volume slider + mute toggle,
  system info (device name, IPv4, kiosk version, uptime), and — in kiosk mode —
  the Shutdown/Restart buttons (moved out of the toolbar). Data comes from
  OS-bundled PowerShell probes (`Win32_Battery`, `Get-NetConnectionProfile`,
  `Get-NetAdapter`) plus a runtime-`Add-Type` C# COM helper for the master
  volume; there are no native addons. The volume is only probed while the panel
  is open (each probe compiles ~0.5–1s), so slider changes apply on release.
- This is a **complete lockdown posture** for lab deployment. Remaining
  escape vectors: Ctrl+Alt+Del (OS-protected), local admin rights, physical
  access, bootable USB.

## Setup & build

Requires Node.js 22+.

```
npm install
npm start          # builds (tsc + copies renderer assets) and launches via `electron .`
npm run typecheck  # type-check only, no build output
npm run package:win  # builds an unsigned Windows installer (release/) via electron-builder
```

`npm run dev` runs `tsc -w` for incremental compilation while iterating; run
`electron .` separately in another terminal to pick up changes (you'll need
to relaunch Electron manually after each change — there's no hot reload).

## Deploying to a lab PC

The packaged app auto-enables its in-app lockdown (kiosk/frameless window, no
DevTools, menu stripped, close prevented, escape hatch + watchdog) with no
extra setup — but the OS-level lockdown is **one-time per PC**, applied after
installing `release/`'s installer. It only needs repeating on a *new* machine;
rebuilding/repackaging doesn't undo it.

From an elevated PowerShell on each PC:

```powershell
# Shell replacement — the app becomes the login shell and starts at every
# logon automatically (makes startup registration redundant). Prefer this for
# the final posture; test the rollback in a VM first.
.\installer\enable-shell.ps1 -AppExe "C:\Program Files\LabLock\LabLock.exe"

# Blocks Task Manager for everyone (needed either way)
.\installer\disable-taskmgr.ps1
```

And set the admin escape password (skipped → default `admin123`):

```powershell
[Environment]::SetEnvironmentVariable('LOCKDOWN_ADMIN_PASSWORD','yourpass','Machine')
```

If you skip shell replacement, use startup registration instead
(`installer/register-startup.ps1 -AppExe "..."`, or `-AllUsers` with admin) so
the app still launches at logon. You always need `disable-taskmgr.ps1`. See
`installer/README.md` for the full usage and the shell-vs-startup tradeoff.

### Recovering from a failed shell replacement

`enable-shell.ps1` changes a single registry value (`Winlogon\Shell`). If the
kiosk never comes up and you're stuck at a black screen, you don't need Safe
Mode — boot into the Windows Recovery Environment and edit the offline hive:

1. Power-cycle 3× (on → wait ~5s → hold power to force off, repeat) until
   "Preparing Automatic Repair" appears, then **Advanced options →
   Command Prompt**.
2. Find the Windows drive (in WinRE it's often *not* `C:`):
   `dir C:\Windows\System32\config\SOFTWARE` — repeat with `D:`, `E:` until
   the file is found.
3. Load the offline registry hive (use the drive found in step 2):
   ```
   reg load HKLM\OFFLINE C:\Windows\System32\config\SOFTWARE
   ```
4. Restore the shell:
   ```
   reg add HKLM\OFFLINE\Microsoft\Windows NT\CurrentVersion\Winlogon /v Shell /t REG_SZ /d explorer.exe /f
   ```
5. Unload and reboot:
   ```
   reg unload HKLM\OFFLINE
   exit
   ```

Note: **Safe Mode is not reliable for this.** In some Windows builds Winlogon
still honors `Winlogon\Shell` in Safe Mode, so the kiosk simply relaunches and
it looks like "normal mode". The offline-hive edit above works unconditionally.
A Windows install USB is an equivalent fallback: boot it → "Repair your
computer" → Troubleshoot → Command Prompt → run the same commands (SOFTWARE
will be under `System32\config` on the OS partition).

## Configuring the whitelist

Edit `config/whitelist.json`:

```json
{
  "sites": [
    {
      "name": "Google Classroom",
      "url": "https://classroom.google.com",
      "icon": "classroom.png",
      "allowedHosts": ["classroom.google.com", "*.google.com"]
    },
    {
      "name": "Khan Academy",
      "url": "https://khanacademy.org",
      "allowedHosts": ["khanacademy.org", "*.khanacademy.org"]
    }
  ]
}
```

- `name` / `url` are required. `url` is what the home-grid tile opens and
  must be `http://` or `https://`.
- Tile icons are **fetched automatically from the site's favicon** (via
  Google's favicon service) — no icon files to download or ship. The tile
  falls back to a plain initial-letter badge if the favicon can't be loaded
  (offline, unknown domain).
- `icon` is an optional per-site override — a filename (not a path) resolved
  against `assets/icons/`. If set, it is tried first, then the favicon, then
  the letter badge.
- `allowedHosts` is optional. **If omitted, only the exact hostname from
  `url` is allowed** — no subdomain access. To allow subdomains, add a
  wildcard rule explicitly, e.g. `"*.google.com"`.

### Matching rules (read this before whitelisting a real site)

- `"example.com"` (no `*`) matches **only** `example.com` exactly — not
  `www.example.com`, not any subdomain.
- `"*.example.com"` matches subdomains **only** (`accounts.example.com`,
  `a.b.example.com`) — it does **not** implicitly include the bare
  `example.com` apex. This mirrors TLS wildcard-certificate semantics. List
  both explicitly (`["example.com", "*.example.com"]`) if you need both.
- Matching is case-insensitive and scheme-restricted: `javascript:`,
  `file:`, `data:`, `chrome:`, `about:`, and any other non-`http(s)` scheme
  is always blocked, regardless of whitelist content.
- **Iframes are checked separately from the main page.** A whitelisted site's
  embeds (e.g. a YouTube embed, a Google Maps frame, a Disqus comment thread)
  are blocked unless the embed's host is licensed. Two ways to allow an
  iframe host:
  - **`allowedHosts`** — the host becomes *browseable*: it can load as a
    main page, in a frame, via popups, everything. Use only when users
    should be able to visit that host directly.
  - **`embedHosts`** — the host may load **only inside an iframe** on a
    whitelisted page. It can never be navigated to as a top-level page,
    opened as a popup, or appear as a tile. This is the right tool for
    embeds you want working without making the embedded site browsable
    (e.g. `["youtube.com", "*.youtube.com", "google.com", "*.google.com",
    "disqus.com", "*.disqus.com"]`).
  Test each real site you whitelist end-to-end — sites like Google Classroom
  often span several `*.google.com` subdomains for login/embedded content.
- **What this does *not* restrict:** subresource requests (images, scripts,
  `fetch`/XHR, fonts, CSS) made by an already-loaded whitelisted page. Only
  *navigation* (changing what page or frame is displayed) is gated. A
  whitelisted page can still load third-party assets/trackers in the
  background; it just can't navigate the visible page/frame to a
  non-whitelisted host. Full network-level filtering would need
  `session.webRequest` and wasn't part of this phase.

## Architecture (Phase 1)

One `BrowserWindow` containing three `WebContentsView`s:

- **Toolbar** — fixed 48px strip, always visible, never destroyed/reloaded.
  Own preload/contextBridge API (`toolbar-preload.ts`): `getWhitelist`,
  `navigateTo`, `goHome`, `goBack`, `shutdown`, `restart`, plus `onUiState`
  so main can push the current UI state (`{ pane, canGoBack, activeSiteUrl,
  kiosk }`). The toolbar renderer is trusted; the site view never gets any of
  this API.
- **Content view** — shows the home grid or the "Site not allowed" screen.
  Has a preload/contextBridge API (`getWhitelist`, `navigateTo`, `goHome`).
- **Site view** — shows the actual whitelisted external site. Has **no**
  preload / no exposed API at all, so untrusted page JavaScript has nothing
  to call into. Navigation is intercepted here via `will-navigate`,
  `will-redirect`, `will-frame-navigate` (iframes), and
  `setWindowOpenHandler` (which always denies new windows/popups — an
  allowed popup target is redirected into the same site view instead of
  opening a second window).

Clicking Home hides the site view without destroying it, so in-progress
work in a whitelisted site (e.g. a doc open inside Classroom) survives a
Home tap. Clicking the *same* tile again resumes that view; a *different*
tile does a fresh load.

All whitelist matching logic lives in one place, `src/main/whitelist.ts`,
imported by every interception point — there's no second copy of the rules
to drift out of sync.

### Toolbar UI

The toolbar (`src/renderer/toolbar/`) is laid out as: brand ("Halisy
Lablock") + site tabs on the left, Back + Home pill centered, and the control
panel status cluster on the right (Wi-Fi icon, battery, clock).

- **Back** — a *universal* back button, enabled whenever any pane can move
  back: on a site it drives the natural browser history
  (`webContents.navigationHistory.goBack()`) so it can step back across the
  whitelisted sites the user visited; once the view history is exhausted it
  pops a main-side `backStack` of previously-visited locations; from the
  blocked screen it restores the page that was up before the blocked
  navigation; on the home grid with nothing to return to it is disabled.
  Disabled purely on `state.canGoBack`.
- **Site tabs** — one pill per whitelisted site, built once at toolbar load
  from `getWhitelist()`. Visible only while a site (or the loading skeleton)
  is on screen; hidden on the home grid and blocked screen. The active tab
  follows the live site URL (matched against `allowedHosts`), so it tracks
  Back/forward movement across sites. Clicking a tab calls `navigateTo`.
  Tab icons are the same Google favicon service the home grid uses, with a
  letter-chip fallback; many sites overflow-scroll horizontally.
- **Control panel** — macOS-style status cluster at the top right. The clock is
  always visible (renderer `setInterval`, updates every second); the Wi-Fi and
  battery chips refresh every 60s. Clicking the cluster opens a dropdown
  (Scrim-below-strip; clicking outside or pressing Escape closes it):
  - **Time/date** header (long date).
  - **Network** — connected network name (SSID), Wi-Fi vs Ethernet, link speed,
    online/offline. Offline/no-connection shows a "cloud-off" glyph and a red
    warning tint on the toolbar chip.
  - **Battery** — percent + state (Charging / On AC power / On battery /
    Fully charged / No battery on desktops). Chip hidden entirely when no
    battery. Red warning under 20% while discharging.
  - **Volume** — master-volume slider + mute toggle. Every change spawns a
    `powershell.exe` that `Add-Type`-compiles a small C# COM helper
    (IMMDeviceEnumerator → IAudioEndpointVolume) and reads/writes the master
    volume; the slider applies on *release* (`change`), not per drag tick.
  - **System info** — device name, routable IPv4 (APIPA skipped), kiosk
    version, OS uptime.
  - **Power** (kiosk only) — Shutdown / Restart, moved here from the toolbar.
    Each shows a native confirm dialog before main spawns
    `shutdown.exe /s|/r /t 1` (Electron 43's `powerMonitor` dropped
    `shutdown()`/`restart()`). Gated in main too (`confirmPowerAction` returns
    early unless KIOSK), so a stray IPC can't power-cycle the machine from a dev
    window.
  - **Data sources**: `src/main/system-status.ts`. Battery/network come from
    one fast PowerShell query (`Win32_Battery`, `Get-NetConnectionProfile`,
    `Get-NetAdapter`) — no elevation or Location permission needed (netsh is
    *not* used). Volume uses the Add-Type C# helper because PowerShell's COM
    late binding can't call IUnknown-only vtable methods.
  - **View resize**: the toolbar WebContentsView grows to the full window while
    the panel is open (via `IPC.PANEL_RESIZE` → `setPanelOpen` in
    `src/main/window.ts`) so the dropdown + scrim can render and swallow clicks
    below the 48px strip; it shrinks back to 48px on close.

Main pushes state to the toolbar on every pane change and on site
`did-navigate` / `did-navigate-in-page`, so Back's enabled state, tab
visibility, and the active tab are always in sync.

**Dev-mode note:** the repo `.env` (loaded by `import 'dotenv/config'` at the
top of `main.ts`) sets `LOCKDOWN_KIOSK=1`, so `npm start` runs in kiosk mode
on this machine by default. To run as a normal dev window instead, launch with
`LOCKDOWN_KIOSK=0` (non-empty, so dotenv won't override it) or remove that
line from `.env`. Renderer toolbar script must stay a plain script — an
`import` would compile to a CommonJS `exports` wrapper that throws in the
browser context (see comment in `toolbar.ts`).

## Phase 2 — Window lockdown & startup

### Window behavior

In a **packaged build** (`app.isPackaged`), the window is created locked:
`kiosk: true` (fullscreen), `frame: false`, `closable/minimizable/maximizable/
resizable: false`, `alwaysOnTop: true`. In a **dev run** (`electron .`), the
window stays a normal resizable window so iteration is painless — the real
locked window can be exercised in dev by launching with `LOCKDOWN_KIOSK=1`.

In kiosk mode:

- `Menu.setApplicationMenu(null)` removes the whole app menu, so the default
  accelerators (Ctrl+W, Ctrl+Shift+I, Alt+F4 via menu) are gone.
- `webPreferences.devTools: false` disables DevTools on every WebContents
  (toolbar, content, and the untrusted site view).
- The window's `close` event is swallowed (`event.preventDefault()`) unless
  `setAllowClose(true)` was called. The only caller is the Windows session-end
  handler — the admin escape hatch no longer closes the window at all (the
  password dialog morphs into the admin console instead).

**Shutdown/logoff is never blocked.** On Windows, `app`'s `query-session-end`
event fires before the window closes during shutdown/logoff; the app calls
`setAllowClose(true)` in response so the kiosk can't hang a machine that's
trying to shut down. (Note: electron.d.ts v43 doesn't type these events on
`app`, so the handler is registered via a cast — see the comment in
`src/main/main.ts`.)

**Testing caveat:** in a kiosk window there is no supported way to exit to a
desktop — the escape hatch opens the admin console and "Done" returns to the
kiosk, so killing the process is the only exit. `LOCKDOWN_KIOSK=1` testing is
safe in dev because killing the launching process still works; don't leave a
lab machine sitting in that state.

### Launch at startup

`installer/register-startup.ps1` creates a Scheduled Task that runs the app
at the current user's logon (no admin needed). `-UseRunKey` writes the HKCU
Run key instead; `-AllUsers` registers for any user (requires admin).
`installer/unregister-startup.ps1` removes either. See `installer/README.md`.

Windows-version notes for Phase 2:

- Scheduled Tasks and the Run key behave the same on Windows 10 and 11, and
  on Home and Pro editions.
- Per-user registrations follow the user, not the machine — on a lab machine
  where students use their own accounts, register per account or use
  `-AllUsers`.

## Manual test checklist

### Phase 1 — whitelisting (dev run)

Run `npm start`, then walk through:

1. **Whitelist enforcement** — each home tile loads; internal links within a
   site work; a lookalike host (`notgoogle-classroom.com`,
   `evilclassroom.google.com.attacker.com`) is blocked, not matched; a true
   subdomain of an exact-match-only entry is blocked; host matching is
   case-insensitive.
2. **Scheme blocking** — `javascript:`, `file:`, `data:`, `chrome:` URLs are
   blocked regardless of whitelist content.
3. **Popups** — `target="_blank"`/`window.open()` to an allowed host loads
   in the same pane (no second OS window); to a disallowed host shows the
   blocked screen with no navigation.
4. **Iframes** — an iframe pointed at a non-whitelisted host inside an
   otherwise-whitelisted page is blocked.
5. **Toolbar** — brand shows "Halisy Lablock"; Back is disabled on the home
   grid when there's nothing to return to, and enabled on any active site and
   on the blocked screen; on a site it steps back through natural browser
   history, and once that's exhausted it returns to the last place you were
   (Home or the previous site); from the blocked screen it restores the page
   that was up before the block; tabs appear once a site is open (one per
   whitelisted site) with the active site highlighted, and clicking a tab
   switches sites; tabs hide again on Home/blocked; Home works from the grid,
   an active site, and the blocked screen; resizing the window keeps the
   toolbar full-width with no gaps.
6. **Power buttons (kiosk run only)** — with `LOCKDOWN_KIOSK=1` (or packaged)
   Shutdown/Restart appear at the right of the toolbar as blue pills with
   text labels, and each confirms via dialog before acting; in a plain dev run
   (`LOCKDOWN_KIOSK=0`) they stay hidden.
7. **Blocked screen** — shows the attempted host as inert text (try a URL
   with markup-like characters in the path and confirm it renders as plain
   text, not executed); Return Home works.
8. **Config robustness** — malformed JSON in `whitelist.json` fails loudly
   at startup (error dialog + quit), not a silent empty whitelist; a
   malformed wildcard rule (e.g. `"**.com"`) is rejected at load time, not
   treated as match-all; a missing `icon` field falls back gracefully.
9. **State preservation** — leaving a site via Home and re-clicking the same
   tile resumes the same view; clicking a different tile does a fresh load.

### Phase 2 — window lockdown & startup

1. **Dev window unchanged** — `npm start` (no env vars) still shows a normal,
   resizable, closable window.
2. **Kiosk window** — launch with `LOCKDOWN_KIOSK=1` (or a packaged build):
   window is fullscreen with no title bar/controls, no app menu, and stays on
   top.
3. **Cannot close** — Alt+F4 and the window's close path do not close it; the
   process must be killed (safe in dev since there's no watchdog yet).
4. **DevTools absent** — in kiosk mode, Ctrl+Shift+I does nothing and no menu
   offers DevTools.
5. **Session-end not blocked** — from a kiosk run, Start → Shut down / Log off
   completes instead of hanging (test in a disposable session).
6. **Startup registration** — run
   `installer/register-startup.ps1 -AppExe "<app exe>"`, log off and back on,
   confirm the app launches automatically; then
   `installer/unregister-startup.ps1` and confirm it no longer does.
7. **Run-key alternative** — `register-startup.ps1 -UseRunKey`, verify the
   value under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, then
   unregister and confirm removal.

### Phase 3 — shell replacement, keyboard hook, Task Manager policy

**Requires a test machine/VM — these change boot behavior.**

1. **DisableTaskMgr** — from elevated PowerShell:
   `installer/disable-taskmgr.ps1` → verify `taskmgr.exe` refuses to launch
   (Ctrl+Shift+Esc, Ctrl+Alt+Del, Run dialog, Start menu all do nothing).
   `installer/enable-taskmgr.ps1` restores it.

2. **Keyboard hook** — launch kiosk (`LOCKDOWN_KIOSK=1` or packaged):
   - Alt+F4 → window stays open
   - Alt+Tab → foreground does not change
   - Win key (L/R) → Start menu does not open
   - Ctrl+Shift+Esc → Task Manager does not launch (blocked by policy)
   - Regular typing / Ctrl+C / Ctrl+V / Ctrl+Shift+I (in dev) still work

3. **Shell replacement** — from elevated PowerShell:
   `installer/enable-shell.ps1 -AppExe "<app exe>"` → log off → app launches
   as shell (no explorer, no taskbar, no Start menu).
   `installer/disable-shell.ps1` (or the WinRE recovery in "Deploying to a lab
   PC" → "Recovering from a failed shell replacement" if the desktop never
   comes back) → restores explorer.exe.
   **Test the rollback in a disposable VM first.**

4. **Combined** — enable shell + hook + policy, reboot, verify full lockdown.
    Exit = Ctrl+Alt+Del → Sign out (only escape until Phase 4).

### Phase 4 — admin escape hatch + admin console + watchdog

1. **Escape hatch / admin console** — launch kiosk (`LOCKDOWN_KIOSK=1` or
   packaged):
   - Press `Ctrl+Alt+Shift+F12` → password dialog appears over the kiosk.
   - Enter the correct password (`LOCKDOWN_ADMIN_PASSWORD` or default
     `admin123`) → the dialog morphs into the full-screen admin console (the
     app stays running).
   - Wrong password → error dialog, kiosk stays locked.
   - Cancel button → dialog closes, kiosk stays locked.

2. **Sites tab** — add a site, save, confirm `config/whitelist.json` is
   rewritten atomically and the toolbar/home tabs rebuild **without a restart**
   (live apply). Edit and remove a site the same way; verify enforcement
   updates immediately (a site removed is blocked on next navigation).

3. **Activity tab** — confirm events appear for navigation, blocked attempts,
   home/back, escape/auth, whitelist saves, and app start/quit; newest-first
   with paging and search; "Clear history" wipes the log.

4. **Auth gating** — on the unauthenticated password page, a direct
   `window.adminAPI.saveWhitelist(...)`/`getActivity(...)` call is refused
   (`{ok:false, ...}` / empty page). After authenticating, the same calls
   succeed. Pressing **Done** closes the console back to the kiosk and drops
   auth so the gate is closed again.

5. **Watchdog** — launch kiosk, verify three processes run:
   - Electron (main app)
   - InputHook.exe (keyboard hook)
   - Watchdog.exe (monitor)
   - Kill InputHook.exe → Watchdog restarts Electron (new PIDs for all three).
   - Kill Electron → Watchdog restarts it.
   - A clean exit (code 0) → Watchdog does NOT restart.

6. **Env override** — `LOCKDOWN_ADMIN_PASSWORD=mysecret npm start` (with
   `LOCKDOWN_KIOSK=1`) → escape hatch accepts `mysecret`.

7. **Control panel** — in the toolbar, top right:
   - Clock shows live time + date; Wi-Fi and battery chips appear ~1s after
     launch. The main process owns the refresh cadence (a 60s push over IPC)
     and pushes an update immediately on AC/battery power switches, wake-from-
     suspend, and network up/down flips — the toolbar has no polling timer.
   - Click the cluster → dropdown opens (time/date, network name + type + link
     speed, battery state, volume slider, device/IP/version/uptime); the screen
     below the strip is dimmed; clicking outside or pressing Escape closes it.
     The toolbar strip stays pinned to the top while the view grows for the
     dropdown.
   - Move the volume slider to release → level changes (audible on a speaker);
     mute toggle mutes/unmutes.
   - In kiosk mode the panel shows Shutdown / Restart (confirm dialogs gate the
     actual power cycle); in dev mode (`LOCKDOWN_KIOSK=0`) they are hidden.
   - Battery chip hides on desktop hardware with no battery; Wi-Fi chip turns
     red/cloud-off when the network drops.
   - Volume probe is slow (~0.5–1s) only on first panel open / each slider
     release — the 60s icon refresh does not probe volume.

## Windows version notes

Phase 1 has no Windows-version-specific behavior. Phase 2's lockdown flags
and startup registration behave the same on Windows 10/11 and Home/Pro; the
per-user vs any-user registration distinction (above) is the main gotcha.
Phase 3's shell replacement (`Winlogon\Shell`), low-level keyboard hook
(`WH_KEYBOARD_LL`), and `DisableTaskMgr` policy are all standard Windows
mechanisms that work on Windows 10/11 Home/Pro. The HKCU Policies ACL
restriction on Windows 11 is why `DisableTaskMgr` uses HKLM (machine-wide,
requires admin). The low-level keyboard hook and watchdog are compiled with
the OS-bundled `csc.exe` (no MSVC/Build Tools needed). Named pipes for the
escape hatch work on all supported Windows versions.

## Security scope (through Phase 4)

This build enforces the site whitelist inside a kiosk-mode window that resists
closing, blocks global escape combos (Alt+F4, Alt+Tab, Win key, Ctrl+Shift+Esc),
blocks Task Manager via policy, can replace the Windows shell so the app
launches as the shell at logon, provides an admin escape hatch
(`Ctrl+Alt+Shift+F12` + password), and survives process kill via a watchdog
that restarts the app on unexpected exit. The only remaining escape vectors
are Ctrl+Alt+Del (OS-protected Secure Attention Sequence — cannot be
intercepted by any user-mode mechanism), local admin rights, physical access,
or a bootable USB. This is a complete lockdown posture for lab deployment.
