# HEWStudio — Locked-down Kiosk Workspace

A hand-built kiosk workspace for children's computers running standard Windows
10/11 Pro/Home (no Enterprise/Education licensing, so no Shell Launcher /
Assigned Access). Shows a home grid of permitted apps and web platforms; blocks
navigation to anything else.

## Features

- **Kiosk window** — in packaged builds the window is fullscreen, frameless,
  always on top, with close/minimize/maximize/resize disabled, DevTools off,
  and the app menu stripped. Close events are swallowed except during a
  Windows session end, so shutdown/logoff is never blocked.
- **Whitelist enforcement** — a single source of truth
  (`src/main/whitelist.ts`) gates top-level navigation, redirects, iframes,
  and popups against a per-site `allowedHosts`/`embedHosts` rule set.
- **Home grid + toolbar** — a home grid of whitelisted sites (favicons
  auto-fetched, letter-badge fallback), a universal Back button, one pill tab
  per site, and a macOS-style control panel (Wi-Fi, battery, clock, volume,
  system info, power) at the top right.
- **Global keyboard hook** — a C# `WH_KEYBOARD_LL` companion process
  (`bin/inputhook/InputHook.exe`) swallows Alt+F4, Alt+Tab, Win key (L/R),
  and Ctrl+Shift+Esc — system combos Electron's `globalShortcut` cannot
  register. Built with the OS-bundled `csc.exe`.
- **Shell replacement** — `installer/enable-shell.ps1` / `disable-shell.ps1`
  set `HKLM\...\Winlogon\Shell` to the app exe so it launches as the login
  shell, with a tested rollback.
- **Task Manager policy** — `installer/disable-taskmgr.ps1` /
  `enable-taskmgr.ps1` set `DisableTaskMgr=1` at HKLM (machine-wide, requires
  admin; the HKCU Policies ACL is protected on Win11).
- **Admin console** — `Ctrl+Alt+Shift+F12` opens a password prompt (default
  `admin123`, override via `LOCKDOWN_ADMIN_PASSWORD`). A correct password
  morphs the dialog into a full-screen admin console with four tabs:
  - **Sites** — "Permitted platforms" manager per profile: add/edit/remove web
    platforms (name, URL, allowedHosts/embedHosts) and grant **native programs**
    by picking them from the machine's installed apps (Start Menu) — no exe
    paths are ever typed, so non-technical staff can use it. The profile
    add/edit dialog sets the child's **login password** (required when adding;
    blank keeps the current one in edit; "Remove this password" clears it, which
    blocks the profile at the picker). Saves atomically to
    `<userData>/profiles.json` and applies **live** to the running kiosk with no
    restart.
  - **Pending password resets** — a strip above the tabs lists "forgot
    password" requests from the picker (profile + when). "Set password" opens
    that profile's edit dialog; "Dismiss" drops the request. Setting a password
    clears the matching request automatically.
  - **Usage** — per-day, per-profile screen-time totals.
  - **Planner** — per-child planner: calendar events (date + title), a weekly
    timetable (per-day period/subject rows), and checkable to-dos. Saved to
    `<userData>/planner-<profileId>.json` (one file per profile).
  - **Activity** — history viewer: an append-only JSONL log of every user
    movement (navigation, blocked attempts, home/back, power, escape/auth,
    whitelist saves, screen-time events, app lifecycle) at
    `<userData>/history.jsonl`. Paged newest-first, searchable by kind/text,
    day-navigable (‹/›/Today per local day), cleared only by an admin.
    "Done" closes the console and returns to the kiosk — HEWStudio is
    the shell, so the app **never quits** from the console. Privileged IPC
    (whitelist save, planner read/write, history read/clear) is password-gated
    in the main process.
- **Per-child profiles** — `<userData>/profiles.json` defines children with an
  avatar, platform membership, and allowed usage hours (per-weekday
  `{ day, start, end }`). One
  profile is active at a time; the boot-time picker (shown whenever there are
  2+ profiles) or the toolbar chip switches it. **Every profile requires a
  password** (salted SHA-256, hashed only in the main process) — the picker
  blocks accounts without one until the admin sets it, and the child signs in
  with a password each time. A "Forgot password?" link records a request
  (`<userData>/reset-requests.json`) that the admin acts on from a "Pending
  password resets" strip in the admin console.
- **Usage hours** — a per-second ticker tracks each profile's used time
  (`<userData>/screen-time-<profileId>.json`, resets daily) and whether the
  current time is inside the profile's allowed usage hours. Outside the
  profile's allowed hours the content switches to an "off-hours" screen until
  the next allowed window.
- **Planner (child view)** — the toolbar **Plan** button opens the active
  profile's planner: today's events, today's timetable periods, and an
  interactive to-do list. Events/timetable are admin-authored (read-only for
  the child); to-dos can be checked off, added and removed by the child and
  save straight back to their own planner file (scoped to the active profile).
- **Wi-Fi control** — clicking the Wi-Fi chip in the toolbar opens its own
  floating **Wi-Fi panel** (network list, connect / forget, rescan), separate
  from the control panel. All over `netsh wlan`; ungated like the volume
  slider, so it only works when the kiosk runs elevated — as a standard child
  user, scans and connects hit error 5 / Location consent and the panel shows a
  friendly explanation with the underlying netsh detail (never truncated).
  Successful connects/forgets land in the activity log.
- **Watchdog** — C# `bin/watchdog/Watchdog.exe` monitors the Electron +
  InputHook PIDs and restarts Electron on unexpected exit; a clean shutdown
  (exit 0) is respected.

This is a complete lockdown posture for lab deployment. The only remaining
escape vectors are Ctrl+Alt+Del (OS-protected), local admin rights, physical
access, and a bootable USB.

## Setup & build

Requires Node.js 22+.

```
npm install
npm start          # builds (tsc + copies renderer assets) and launches via `electron .`
npm run typecheck  # type-check only, no build output
npm run package:win  # builds a Windows installer (release/) via electron-builder
```

`npm run dev` runs `tsc -w` for incremental compilation while iterating; run
`electron .` separately in another terminal to pick up changes (no hot
reload — relaunch Electron after each change).

**Dev-mode note:** the repo `.env` (loaded by `import 'dotenv/config'` at the
top of `main.ts`) sets `LOCKDOWN_KIOSK=1`, so `npm start` runs in kiosk mode
on this machine by default. To run as a normal dev window instead, launch with
`LOCKDOWN_KIOSK=0` (non-empty, so dotenv won't override it) or remove that
line from `.env`. Renderer scripts must stay plain browser scripts — an
`import` would compile to a CommonJS `exports` wrapper that throws in the
browser context (see comment in `toolbar.ts`).

## Deploying to a lab PC

The packaged app auto-enables its in-app lockdown (kiosk/frameless window, no
DevTools, menu stripped, close prevented, escape hatch + watchdog) with no
extra setup — but the OS-level lockdown is **one-time per PC**, applied after
installing `release/`'s installer. It only needs repeating on a _new_ machine;
rebuilding/repackaging doesn't undo it.

From an elevated PowerShell on each PC:

```powershell
# Shell replacement — the app becomes the login shell and starts at every
# logon automatically (makes startup registration redundant). Prefer this for
# the final posture; test the rollback in a VM first.
.\installer\enable-shell.ps1 -AppExe "C:\Program Files\HEWStudio\HewStudio.exe"

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
kiosk never comes up and you're stuck at a black screen, don't power-cycle —
use **Ctrl+Alt+Del**. The secure attention sequence is handled by Windows
itself, so it works even when the shell is broken, and neither the kiosk nor
the keyboard hook can intercept it.

1. Press **Ctrl+Alt+Del** — this brings up the Windows Security screen.
2. Click the **power button** (bottom-right corner) and hold **Shift** while
   choosing **Restart** → **Troubleshoot → Advanced options → Command Prompt**.
3. Find the Windows drive (in WinRE it's often _not_ `C:`):
   `dir C:\Windows\System32\config\SOFTWARE` — repeat with `D:`, `E:` until
   the file is found.
4. Load the offline registry hive (use the drive found in step 3):
   ```
   reg load HKLM\OFFLINE C:\Windows\System32\config\SOFTWARE
   ```
5. Restore the shell:
   ```
   reg add HKLM\OFFLINE\Microsoft\Windows NT\CurrentVersion\Winlogon /v Shell /t REG_SZ /d explorer.exe /f
   ```
6. Unload and reboot:
   ```
   reg unload HKLM\OFFLINE
   exit
   ```

**Safe Mode is not reliable for this** — in some Windows builds Winlogon
still honors `Winlogon\Shell` in Safe Mode, so the kiosk simply relaunches and
it looks like "normal mode". The WinRE Command Prompt path above works
unconditionally. A Windows install USB is an equivalent fallback: boot it →
"Repair your computer" → Troubleshoot → Command Prompt → run the same
commands (SOFTWARE will be under `System32\config` on the OS partition).

## Configuring the whitelist

Edit `config/whitelist.json`:

```json
{
  "sites": [
    {
      "name": "Google Classroom",
      "url": "https://classroom.google.com",
      "icon": "classroom.png",
      "allowSubdomains": true,
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
- `allowSubdomains` (optional boolean, also available per platform in the
  admin console) is the low-friction way to cover an entire site family:
  `true` allows the entry's own host **and every `*.host` subdomain**
  (dot-anchored, same semantics as `"*."`). A single "google.com" entry then
  covers `docs.google.com`, `drive.google.com`, `meet.google.com`, etc.
  without the admin listing each.

### Matching rules (read this before whitelisting a real site)

- Every rule in `allowedHosts` / `embedHosts` must be a **bare hostname**,
  optionally `*.`-wildcarded. Do not put a URL or path in a rule —
  `"https://web.toddleapp.com"` and `"j100coders.org/coder"` are invalid.
  A path-scoped rule can never match a hostname, so it silently blocks every
  page of that site. The admin console and config loader reject such rules at
  save/load time, and once a host is allowed, the user can roam freely across
  all its pages (any path, any subdomain covered by the rules).

- `"example.com"` (no `*`) matches **only** `example.com` exactly — not
  `www.example.com`, not any subdomain.
- `"*.example.com"` matches subdomains **only** (`accounts.example.com`,
  `a.b.example.com`) — it does **not** implicitly include the bare
  `example.com` apex. This mirrors TLS wildcard-certificate semantics. List
  both explicitly (`["example.com", "*.example.com"]`) if you need both.
- `"allowSubdomains": true` is equivalent to listing the entry's host plus
  `"*.host"` — the apex **and** every subdomain, dot-anchored (so
  `notgoogle.com` can never match a `google.com` entry).
- Matching is case-insensitive and scheme-restricted: `javascript:`,
  `file:`, `data:`, `chrome:`, `about:`, and any other non-`http(s)` scheme
  is always blocked, regardless of whitelist content.
- **Iframes are checked separately from the main page.** A whitelisted site's
  embeds (e.g. a YouTube embed, a Google Maps frame, a Disqus comment thread)
  are blocked unless the embed's host is licensed. Two ways to allow an
  iframe host:
  - **`allowedHosts`** — the host becomes _browseable_: it can load as a
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
- **What this does _not_ restrict by default:** subresource requests (images,
  scripts, `fetch`/XHR, fonts, CSS) made by an already-loaded whitelisted
  page. Only _navigation_ (changing what page or frame is displayed) is
  gated. A whitelisted page can still load third-party assets/trackers in the
  background; it just can't navigate the visible page/frame to a
  non-whitelisted host. **With the Cloudflare content filter enabled**
  (below), those subresource requests and unknown iframe hosts are instead
  checked against Cloudflare's resolver and cancelled when its policy blocks
  them.

### Cloudflare content filter (the "loose zone" middle man)

When the filter is enabled, the whitelist becomes the home grid and the
zero-latency fast path; Cloudflare becomes the real gate. Every http(s)
request whose host is **not** strictly whitelisted — iframes, third-party
subresources, and top-level navigation (login redirects to
`accounts.google.com`, links off an approved page, popups) — is looked up
against a Cloudflare **DNS-over-HTTPS** resolver and cancelled when its
policy blocks the host. That's what lets the admin approve one site without
enumerating every CDN, embed host or auth endpoint, and lets Google/Office
sign-in work without whitelisting the identity provider.

- **Where it sits:** `session.webRequest.onBeforeRequest` in
  `src/main/content-filter.ts`. Strictly-whitelisted hosts bypass the lookup
  entirely, so approved pages see zero extra latency. The navigation guard
  (`navigation-guard.ts`) releases a non-whitelisted http(s) top-level load
  to the network layer only while the filter is on; a Cloudflare-cancelled
  main frame surfaces as `did-fail-load` with `ERR_BLOCKED_BY_CLIENT` and is
  shown as the normal blocked screen (`window.ts`). Non-http(s) schemes are
  always blocked synchronously.
- **Filter off = strict whitelist:** with the filter disabled the guard falls
  back to the Phase-1 behaviour — only whitelisted hosts can ever load as a
  page.
- **Two resolver modes** (`<userData>/filter.json`, admin console → Content
  Filter tab):
  - **Families** — the built-in `1.1.1.3` resolver. Zero setup, no account;
    blocks malware + adult content only. Good out-of-the-box default.
  - **Zero Trust Gateway** — the admin pastes their
    `https://<org-id>.cloudflare-gateway.com/dns-query` endpoint. Adds the
    dashboard-managed categories (**gambling/betting**, weapons, violence,
    etc.) and centralises policy in the Cloudflare dashboard instead of the
    kiosk. Free up to 50 users.
- **Blocked vs nonexistent:** a blocked host is answered with Cloudflare's
  block markers — `0.0.0.0`/`::` with RCODE 0 under Families, NXDOMAIN (empty
  answer) under Gateway — so the kiosk can't report _why_ a host was
  cancelled; the reason lives in the Cloudflare dashboard logs. The admin
  console has a "Test a domain" box for live verdict checks. DoH is sent as
  RFC 8484 wire format (`application/dns-message`): the JSON API
  (`application/dns-json`) on Cloudflare's filtered resolvers serves
  **unfiltered** answers and is deliberately not used.
- **Fail-open:** a Cloudflare outage or offline kiosk never bricks approved
  sites — lookup errors allow the request. Verdicts are cached per host for
  10 minutes with in-flight coalescing, so only the first request to a new
  host pays the DoH round-trip. A+AAAA are both checked so AAAA-only hosts
  aren't false-blocked.
- **Activity:** blocked hosts are logged once each (kind `filter-block`) to
  keep the log readable; top-level blocks additionally log kind `blocked`
  via the blocked screen.

## Architecture

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
   `setWindowOpenHandler` (which only ever opens a guarded child window for an
   allowed popup target — the opener relationship must survive so OAuth popup
   flows like Toddle's "Sign in with Google" can postMessage the token back;
   a blocked popup target is denied silently).

Clicking Home hides the site view without destroying it, so in-progress
work in a whitelisted site (e.g. a doc open inside Classroom) survives a
Home tap. Clicking the _same_ tile again resumes that view; a _different_
tile does a fresh load.

All whitelist matching logic lives in one place, `src/main/whitelist.ts`,
imported by every interception point — there's no second copy of the rules
to drift out of sync.

### Toolbar UI

The toolbar (`src/renderer/toolbar/`) is laid out as: brand ("HEWStudio")
+ site tabs on the left, Back + Home pill centered, and the control
panel status cluster on the right (Wi-Fi icon, battery, clock).

- **Back** — a _universal_ back button, enabled whenever any pane can move
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
  battery chips refresh every 60s. The **Wi-Fi chip** opens the dedicated
  Wi-Fi panel (see above); the battery/clock chips open the control panel
  dropdown (clicking outside or pressing Escape closes either):
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
    volume; the slider applies on _release_ (`change`), not per drag tick.
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
    _not_ used). Volume uses the Add-Type C# helper because PowerShell's COM
    late binding can't call IUnknown-only vtable methods.
  - **View resize**: the toolbar WebContentsView grows to the full window while
    the panel is open (via `IPC.PANEL_RESIZE` → `setPanelOpen` in
    `src/main/window.ts`) so the dropdown can render and swallow clicks below
    the 48px strip; it shrinks back to 48px on close. The view + page
    background are transparent, so the home view shows through below the strip
    — a macOS-style floating panel with no dimming overlay. Clicking outside
    the panel (or pressing Escape) dismisses it.

Main pushes state to the toolbar on every pane change and on site
`did-navigate` / `did-navigate-in-page`, so Back's enabled state, tab
visibility, and the active tab are always in sync.

## Window lockdown

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

Windows-version notes:

- Scheduled Tasks and the Run key behave the same on Windows 10 and 11, and
  on Home and Pro editions.
- Per-user registrations follow the user, not the machine — on a lab machine
  where students use their own accounts, register per account or use
  `-AllUsers`.

## Manual test checklist

### Whitelisting (dev run)

Run `npm start`, then walk through:

1. **Whitelist enforcement** — each home tile loads; internal links within a
   site work; a lookalike host (`notgoogle-classroom.com`,
   `evilclassroom.google.com.attacker.com`) is blocked, not matched; a true
   subdomain of an exact-match-only entry is blocked; host matching is
   case-insensitive. With `allowSubdomains` set on a platform, its subdomains
   (e.g. `docs.google.com` under a `google.com` entry) load without listing
   each.
2. **Scheme blocking** — `javascript:`, `file:`, `data:`, `chrome:` URLs are
   blocked regardless of whitelist content.
3. **Popups** — `target="_blank"`/`window.open()` to an allowed or
   loose-allowed host opens a small guarded child window (parented to the
   kiosk, destroyed with it) so OAuth flows keep their opener; to a disallowed
   host it is denied with no navigation and no effect on the main view.
4. **Iframes** — an iframe pointed at a non-whitelisted host inside an
   otherwise-whitelisted page is blocked.
5. **Toolbar** — brand shows "HEWStudio"; Back is disabled on the home
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

### Cloudflare content filter

1. **Config UI** — admin console → Content Filter tab shows the filter card;
   toggling Gateway reveals the DoH URL field; saving reports "Applied live"
   with no restart.
2. **Enabled + families** — enable the filter (Families mode), open an
   approved site that embeds something, and confirm the site still works. A
   known adult site's asset/embed host (e.g. a `*.tube` ad host) is dropped —
   check the Activity log for a `filter-block` entry (logged once per host).
3. **Gateway mode** — paste a Zero Trust Gateway DoH URL (with a policy that
   blocks gambling), use "Test a domain" against a betting site → "Blocked";
   a normal educational domain → "Allowed". Malformed / non-Cloudflare URLs
   are rejected on save.
4. **Fail-open** — disconnect the network; approved sites still load (no
   bricked kiosk) and the filter test reports an error rather than a verdict.
5. **Top-level stays strict** — with the filter on, navigating to a
   non-whitelisted page still shows the blocked screen; the filter never
   licenses a browseable page.
6. **Cache** — the first request to a new third-party host pays one DoH
   round-trip; repeat requests within 10 minutes hit the cache (watch the
   filter-block count stay flat while a page with a blocked host reloads).

### Window lockdown & startup

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

### Shell replacement, keyboard hook, Task Manager policy

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
   `installer/disable-shell.ps1` → restores explorer.exe. If the desktop
   never comes back, use the Ctrl+Alt+Del recovery in "Deploying to a lab
   PC" → "Recovering from a failed shell replacement" (never power-cycle).
   **Test the rollback in a disposable VM first.**

4. **Combined** — enable shell + hook + policy, reboot, verify full lockdown.
   Exit = Ctrl+Alt+Del → Sign out.

### Admin console, watchdog & control panel

1. **Escape hatch / admin console** — launch kiosk (`LOCKDOWN_KIOSK=1` or
   packaged):
   - Press `Ctrl+Alt+Shift+F12` → password dialog appears over the kiosk.
   - Enter the correct password (`LOCKDOWN_ADMIN_PASSWORD` or default
     `admin123`) → the dialog morphs into the full-screen admin console (the
     app stays running).
   - Wrong password → error dialog, kiosk stays locked.
   - Cancel button → dialog closes, kiosk stays locked.

2. **Sites tab** — add a site, save, confirm `<userData>/profiles.json` is
   rewritten atomically and the toolbar/home tabs rebuild **without a restart**
   (live apply). Edit and remove a site the same way; verify enforcement
   updates immediately (a site removed is blocked on next navigation). Grant a
   native program via the installed-apps picker and check it appears on the
   child's home grid and launches.

3. **Activity tab** — confirm events appear for navigation, blocked attempts,
   home/back, escape/auth, whitelist saves, and app start/quit; newest-first
   with paging and search; "Clear history" wipes the log. Day navigator:
   `‹`/`›` move one local day, "Today" jumps back, Next is disabled beyond
   today, and an empty day shows "No activity on YYYY-MM-DD." Timestamps are
   time-only since every row is within the selected day.

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

### Profiles, screen-time, usage hours & planner

1. **Profile picker + sign-in** — boot always shows the "who is using this?"
   picker (no profile is auto-selected — every account now requires a
   password). Cards show a lock badge: a closed lock means a password is set,
   an open lock means the account can't be signed into until an admin sets one.
   Clicking a card opens the password form; wrong passwords show an inline
   error and log an `auth-failed` activity event. "Forgot password?" sends a
   reset request to the admin console's pending-resets strip and shows a
   confirmation. Switching profile via the toolbar chip goes back through the
   same sign-in, then changes the app grid and resets the screen-time ticker to
   that child's ledger.
2. **Installed-apps picker (native platforms)** — admin console → Permitted
   Platforms → Add platform → **Installed program**: a searchable list of the
   machine's installed apps (Start Menu) appears with checkboxes and the exe
   path shown read-only underneath each name — no path is ever typed. Select
   several and Apply: each becomes its own "Program" platform with the app's
   own name/launcher args, then Save applies them live; the home grid launches
   them (kiosk hides, returns on exit). A program with no Start Menu shortcut
   won't be listed.
3. **Admin profile fields** — admin console → Sites tab → edit a profile:
   add usage hours per weekday (`HH:MM` start/end, e.g. `08:30`–`16:00`); save
   and confirm `<userData>/profiles.json` is rewritten and the kiosk picks it
   up live.
4. **Usage-hours enforcement** — outside the active profile's hours, the
   content pane switches to the **off-hours** screen (shows the allowed hours
   and a "Choose a different profile" button); attempting to reopen a site
   kicks straight back; closing the window while off-hours routes Home.
   Inside the window, sites load normally. The off-hours switch is logged as
   `restricted` activity.
5. **Usage tab** — admin console → Usage tab shows per-day, per-profile used
   time matching the activity log.
6. **Admin planner** — admin console → Planner tab: pick a profile, add a
   calendar event (date + title), a couple of timetable periods for today's
   weekday, and a to-do; **Save** writes `planner-<profileId>.json`. Rows can
   be removed; to-dos toggle done.
7. **Child planner** — as the selected child, click **Plan** in the toolbar:
   the content view shows today's date, today's events, today's timetable
   periods and the to-do list (done items struck through). The child can tick
   a to-do done/undone, add a new one (type + Enter or Add), or Remove one —
   each change persists to `planner-<profileId>.json` on the spot and survives
   reopening the planner; events and timetable stay fixed. **Back to apps**
   returns Home. The Plan button is hidden on the picker and on the planner
   pane itself.
9. **Planner auth gating** — on the unauthenticated password page a direct
   `window.adminAPI.getPlanner(...)`/`savePlanner(...)` is refused; the child
   `PLANNER_ACTIVE_GET` read and `PLANNER_TODOS_UPDATE` write stay available
   ungated (the write is scoped to the active profile's to-dos only).
10. **Wi-Fi panel (network chip)** — click the Wi-Fi chip in the toolbar (not
    the clock): a dedicated floating **Wi-Fi** panel opens with a rescan
    button and the network list (signal bars, security, Connected badge). With
    the app running elevated (or a dev box with Location enabled), Connect on
    a saved network reconnects directly; on a new secured network an inline
    password prompt appears (Cancel dismisses); Open networks connect without
    one. Forget removes a saved profile. Successful connects/forgets appear
    in the admin Activity tab as Wi-Fi events. Run as a standard user and the
    panel instead shows a friendly explanation ("Windows is blocking Wi-Fi
    control — run the kiosk as an administrator…") with the full netsh detail
    wrapped below it — never truncated, never crashing.

## Windows version notes

The whitelist, window lockdown, and startup registration behave the same on
Windows 10/11 and Home/Pro; the per-user vs any-user registration distinction
(above) is the main gotcha. Shell replacement (`Winlogon\Shell`), the
low-level keyboard hook (`WH_KEYBOARD_LL`), and the `DisableTaskMgr` policy
are all standard Windows mechanisms that work on Windows 10/11 Home/Pro. The
HKCU Policies ACL restriction on Windows 11 is why `DisableTaskMgr` uses HKLM
(machine-wide, requires admin). The keyboard hook and watchdog are compiled
with the OS-bundled `csc.exe` (no MSVC/Build Tools needed). Named pipes for
the escape hatch work on all supported Windows versions.

## Security scope

This build enforces the site whitelist inside a kiosk-mode window that resists
closing, blocks global escape combos (Alt+F4, Alt+Tab, Win key, Ctrl+Shift+Esc),
blocks Task Manager via policy, can replace the Windows shell so the app
launches as the shell at logon, provides an admin escape hatch
(`Ctrl+Alt+Shift+F12` + password), and survives process kill via a watchdog
that restarts the app on unexpected exit. The only remaining escape vectors
are Ctrl+Alt+Del (OS-protected Secure Attention Sequence — cannot be
intercepted by any user-mode mechanism), local admin rights, physical access,
or a bootable USB. This is a complete lockdown posture for lab deployment.
