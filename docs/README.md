# Lockdown Kiosk Browser

A hand-built kiosk browser for school computer labs running standard Windows
10/11 Pro/Home (no Enterprise/Education licensing, so no Shell Launcher /
Assigned Access). Shows a home grid of whitelisted sites; blocks navigation
to anything else.

## Project status

**Phase 1 (this build): core browser + whitelist enforcement — done.**
Phases 2–4 (window lockdown, shell replacement + keyboard hook, admin escape
hatch + watchdog) are **not yet implemented**. Right now this is a normal,
resizable, closable window — it does **not** lock down the machine yet. Do
not deploy this to a lab machine expecting kiosk lockdown; that's Phases 2–4.

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

## Manual test checklist (Phase 1)

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

## Windows version notes

Phase 1 has no known Windows-version-specific behavior — it's a standard
Electron app and should run identically on Windows 10/11, Home/Pro. Version
and edition differences become relevant starting in Phase 2/3 (Scheduled
Task behavior, `Winlogon\Shell` replacement, low-level keyboard hooks,
`DisableTaskMgr` policy) — those will be documented when those phases are
built and tested.

## Security scope (Phase 1 only)

This build only enforces the site whitelist inside a normal, unlocked
window. It does **not** yet: prevent the window from being closed/minimized,
survive process kill, replace the Windows shell, block Alt+Tab/Win
key/Task Manager, or provide an admin escape hatch — all of that is
Phases 2–4, not yet implemented. Treat this build as a whitelisted-browsing
prototype, not a deployable kiosk lockdown.
