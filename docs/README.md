# Lockdown Kiosk Browser

A hand-built kiosk browser for school computer labs running standard Windows
10/11 Pro/Home (no Enterprise/Education licensing, so no Shell Launcher /
Assigned Access). Shows a home grid of whitelisted sites; blocks navigation
to anything else.

## Project status

**Phase 1 (core browser + whitelist enforcement) — done.**
**Phase 2 (window lockdown + startup registration) — done.**
Phase 3 (shell replacement + keyboard hook + Task Manager policy) and Phase 4
(admin escape hatch + watchdog) are **not yet implemented**.

Where things stand now:

- The window is a **kiosk window in packaged builds** — fullscreen, no frame,
  no window controls, always on top, close events swallowed (except during a
  Windows session end), DevTools disabled, app menu stripped.
- The app **registers to launch at logon** via a Scheduled Task (or Run key)
  using the scripts in `installer/`.
- There is **no escape hatch yet** (that's Phase 4): once running as a kiosk
  window, the only ways out are killing the process or logging off/shutting
  down. Do not deploy to a lab machine expecting a full lockdown yet —
  Phase 3's shell replacement, keyboard hooks, and Phase 4's admin escape are
  what complete the posture.

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
- `icon` is optional — a filename (not a path) resolved against
  `assets/icons/`. If omitted, or the file fails to load, the tile falls
  back to a plain initial-letter badge.
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
- **Iframes are checked against the same whitelist as the main page.** If a
  whitelisted site legitimately embeds content from another domain (e.g. a
  YouTube embed, a Google Docs viewer), that domain needs to be added to
  `allowedHosts` too, or the embed will show as blocked/blank. Test each
  real site you whitelist end-to-end — sites like Google Classroom often
  span several `*.google.com` subdomains for login/embedded content.
- **What this does *not* restrict:** subresource requests (images, scripts,
  `fetch`/XHR, fonts, CSS) made by an already-loaded whitelisted page. Only
  *navigation* (changing what page or frame is displayed) is gated. A
  whitelisted page can still load third-party assets/trackers in the
  background; it just can't navigate the visible page/frame to a
  non-whitelisted host. Full network-level filtering would need
  `session.webRequest` and wasn't part of this phase.

## Architecture (Phase 1)

One `BrowserWindow` containing three `WebContentsView`s:

- **Toolbar** — fixed strip, always visible, has a Home button. Never
  destroyed/reloaded.
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
  `setAllowClose(true)` was called. Today the only caller is the Windows
  session-end handler; the Phase 4 admin escape hatch will be the other.

**Shutdown/logoff is never blocked.** On Windows, `app`'s `query-session-end`
event fires before the window closes during shutdown/logoff; the app calls
`setAllowClose(true)` in response so the kiosk can't hang a machine that's
trying to shut down. (Note: electron.d.ts v43 doesn't type these events on
`app`, so the handler is registered via a cast — see the comment in
`src/main/main.ts`.)

**Escape-hatch caveat until Phase 4:** in a kiosk window there is currently no
supported way to exit to a desktop — killing the process is the only exit.
`LOCKDOWN_KIOSK=1` testing is safe in dev because killing the launching
process still works; don't leave a lab machine sitting in that state.

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
5. **Toolbar** — Home button works from the home grid, an active site, and
   the blocked screen; resizing the window keeps the toolbar full-width with
   no gaps.
6. **Blocked screen** — shows the attempted host as inert text (try a URL
   with markup-like characters in the path and confirm it renders as plain
   text, not executed); Return Home works.
7. **Config robustness** — malformed JSON in `whitelist.json` fails loudly
   at startup (error dialog + quit), not a silent empty whitelist; a
   malformed wildcard rule (e.g. `"**.com"`) is rejected at load time, not
   treated as match-all; a missing `icon` field falls back gracefully.
8. **State preservation** — leaving a site via Home and re-clicking the same
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

## Windows version notes

Phase 1 has no Windows-version-specific behavior. Phase 2's lockdown flags
and startup registration behave the same on Windows 10/11 and Home/Pro; the
per-user vs any-user registration distinction (above) is the main gotcha.
Version/edition differences become more significant in Phase 3 (Scheduled
Task edge cases, `Winlogon\Shell` replacement, low-level keyboard hooks,
`DisableTaskMgr` policy) — those will be documented when those phases are
built and tested.

## Security scope (through Phase 2)

This build enforces the site whitelist inside a kiosk-mode window that resists
closing and launches at logon. It does **not** yet: replace the Windows shell
(so the desktop/taskbar/Start menu are still present — a student can reach the
Task Manager and other tools), intercept global keyboard shortcuts (Alt+Tab,
the Win key, Ctrl+Alt+Del are all still functional), survive process kill
(no watchdog), or offer an admin escape hatch. All of that is Phases 3–4.
Phase 2 deters casual window-manipulation; it is explicitly NOT resistant to a
user with local admin rights, physical access, or a bootable USB.
