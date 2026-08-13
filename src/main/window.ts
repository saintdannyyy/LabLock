import { app, BrowserWindow, WebContentsView, screen, dialog } from 'electron';
import { spawn } from 'child_process';
import * as path from 'path';
import type { ChildProcess } from 'child_process';
import { attachNavigationGuard } from './navigation-guard';
import { installContentFilter, loadFilterConfig } from './content-filter';
import { preloadFile, rendererFile, iconFileUrl } from './paths';
import { isUrlAllowed } from './whitelist';
import { getActiveProfile, setActiveProfile, loadProfiles, webApps, verifyProfilePassword, profileHasPassword } from './profiles';
import { appendActivity } from './history';
import { attachProfile, detach as detachScreenTime, getStatus as getScreenTimeStatusRaw, pause as pauseScreenTime, resume as resumeScreenTime } from './screen-time';
import { attachProfile as attachUsageProfile, detach as detachUsage, startTracking as startUsageTracking, stopTracking as stopUsageTracking, getPlatformSeconds } from './usage';
import { IPC } from '../shared/types';
import type { WhitelistFile, NavigateResult, Pane, UiState, ActivityEvent, PlatformEntry, ScreenTimeStatus, UsageSnapshot, UsageEntry } from '../shared/types';

// Height of the toolbar strip (matches .toolbar-strip in toolbar.css). The
// content/site/loading views sit below this line.
const TOOLBAR_HEIGHT = 48;

// Width of the planner sidebar on the left (matches the sidebar view bounds).
// The child's Calendar/Timetable/To-dos panels live here, Apple-style.
const SIDEBAR_WIDTH = 280;

// Whether the planner sidebar is currently collapsed (toolbar toggle). While
// collapsed the sidebar view is hidden and the content/site views take the full
// width. In-memory only — resets to expanded on every app start.
let sidebarCollapsed = false;

// Toggle the planner sidebar collapsed/expanded, re-layout the views and tell
// the toolbar so its toggle button reflects the new state.
export function toggleSidebar(): void {
  sidebarCollapsed = !sidebarCollapsed;
  layoutViews();
  pushUiState();
}

// Phase 2 lockdown mode. Active in any packaged (production) build, and
// additionally forceable in dev via LOCKDOWN_KIOSK=1 so the real locked
// window can be exercised on a dev machine without building an installer.
// (Safe to test in dev: until Phase 3 there is no shell replacement and no
// watchdog, so killing the electron process from the launching terminal
// still escapes.)
export const KIOSK = app.isPackaged || process.env.LOCKDOWN_KIOSK === '1';

let mainWindow: BrowserWindow | null = null;
let toolbarView: WebContentsView;
let sidebarView: WebContentsView;
let contentView: WebContentsView;
let siteView: WebContentsView;
let loaderView: WebContentsView;
let whitelist: WhitelistFile = { sites: [] };

// The live enforcement list is always the ACTIVE profile's web platforms.
// Navigation guards and the toolbar tabs read `whitelist` through closures, so
// re-syncing on profile switch / admin save re-enforces immediately without a
// restart.
function syncWhitelistFromProfile(): void {
  const profile = getActiveProfile();
  whitelist = { sites: profile ? webApps(profile) : [] };
}

// (Re)attach the screen-time monitor to the active profile so its allowed
// usage hours govern the session and the "used today" read-out ticks. Called on
// boot, profile select, and after an admin profiles save. With no active
// profile (picker), stop the ticker.
function applyScreenTimeForProfile(): void {
  const profile = getActiveProfile();
  if (!profile) {
    detachScreenTime();
    return;
  }
  attachProfile(profile.id, profile.usageHours);
}

// Keep the usage tracker pointed at the active profile (platform sessions
// accumulate into its per-day record). Also called on boot / select / refresh.
function applyUsageForProfile(): void {
  const profile = getActiveProfile();
  if (!profile) {
    detachUsage();
    return;
  }
  attachUsageProfile(profile.id);
}

export interface ProfileSummary {
  id: string;
  name: string;
  avatarColor: string;
  passwordSet: boolean;
}

// When true, the window's 'close' handler stops preventing the close. Set by
// the admin escape hatch (Phase 4) and by the Windows session-end hook so a
// system shutdown/logoff is never blocked by the kiosk.
let allowClose = false;

// Control panel open state. The toolbar page only drops its dropdown below the
// 48px strip if its WebContentsView covers the whole window, so the view is
// resized to full height while the panel is open and back to the 48px strip
// when it closes. The toolbar view + page background are transparent, so the
// home view below the strip stays visible (macOS-style floating panel).
let panelOpen = false;

export function setPanelOpen(open: boolean): void {
  if (panelOpen === open) return;
  panelOpen = open;
  layoutViews();
}

export function setAllowClose(value: boolean): void {
  allowClose = value;
}

// Unlock a child profile from the picker with its password. Every profile must
// have a password (the picker blocks passwordless accounts), so this never
// silently logs anyone in -- wrong or missing credentials log an 'auth-failed'
// activity event and return a friendly error the picker can show.
export function authProfile(id: string, password: string): { ok: boolean; error?: string } {
  const profile = loadProfiles().profiles.find((p) => p.id === id);
  if (!profile) return { ok: false, error: 'Profile not found.' };
  if (!profileHasPassword(profile)) {
    logActivity('auth-failed', `Login blocked for "${profile.name}" — no password set`, undefined, profile.id);
    return { ok: false, error: 'No password is set for this profile. Ask an administrator to set one.' };
  }
  if (!verifyProfilePassword(profile, password)) {
    logActivity('auth-failed', `Incorrect password for "${profile.name}"`, undefined, profile.id);
    return { ok: false, error: 'Incorrect password. Try again or ask an administrator to reset it.' };
  }
  activateProfile(profile.id);
  return { ok: true };
}

// Swap enforcement + UI to a profile's platforms and show its home grid. Only
// called after a successful password check (authProfile); showPicker() and
// refreshActiveProfile() handle the no-credential paths.
function activateProfile(id: string): void {
  const profile = setActiveProfile(id);
  if (!profile) return;
  syncWhitelistFromProfile();
  applyScreenTimeForProfile();
  applyUsageForProfile();
  activeSiteUrl = null;
  currentLoadedUrl = null;
  logActivity('profile-switch', `Switched to ${profile.name}`, undefined, profile.id);
  notifyWhitelistRefreshed();
  if (showRestrictedIfNeeded()) return; // outside allowed hours -> restricted screen
  setPane('home');
  loadContentView();
  layoutViews();
}

// Show the "who is using this?" picker (toolbar avatar click).
export function showPicker(): void {
  detachScreenTime();
  detachUsage();
  blockedFrom = null;
  activeSiteUrl = null;
  currentLoadedUrl = null;
  setPane('profile');
  loadContentView();
  layoutViews();
}

// Re-apply the active profile after an admin profiles save so the running
// kiosk enforces the new app list immediately. If the active profile was
// deleted, fall back to the first remaining one.
export function refreshActiveProfile(): void {
  const current = getActiveProfile();
  const profiles = loadProfiles().profiles;
  if (profiles.length === 0) return;
  const target = (current && profiles.find((p) => p.id === current.id)) || profiles[0];
  setActiveProfile(target.id);
  syncWhitelistFromProfile();
  applyScreenTimeForProfile();
  applyUsageForProfile();
  notifyWhitelistRefreshed();
  showRestrictedIfNeeded();
  if (pane === 'home') {
    activeSiteUrl = null;
    currentLoadedUrl = null;
    setPane('home');
    // The home grid re-renders itself from the WHITELIST_REFRESHED push above
    // (notifyWhitelistRefreshed) -- a full loadContentView() here is what made
    // the kiosk go blank/flash after every admin save.
  }
  layoutViews();
}

// The toolbar builds its site tabs once at load and the home grid renders its
// tiles once, so tell both to rebuild in place after a whitelist change (no
// page reloads -- a reload is what makes the kiosk blink blank for a moment).
// Also re-push UI state (a removed active site must clear its active-tab
// highlight).
export function notifyWhitelistRefreshed(): void {
  for (const view of [toolbarView, contentView, sidebarView]) {
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.send(IPC.WHITELIST_REFRESHED);
    }
  }
  pushUiState();
}

// Tell the planner sidebar to reload its plan after the admin saves a profile's
// planner (the child should see calendar/timetable edits without waiting for a
// profile switch).
export function notifyPlannerChanged(): void {
  if (sidebarView && !sidebarView.webContents.isDestroyed()) {
    sidebarView.webContents.send(IPC.PLANNER_CHANGED);
  }
}

// Send an arbitrary payload to the toolbar renderer. Used by the main-process
// system-status push (IPC.SYSTEM_STATUS).
export function sendToToolbar(channel: string, payload: unknown): void {
  if (toolbarView && !toolbarView.webContents.isDestroyed()) {
    toolbarView.webContents.send(channel, payload);
  }
}

// Push the UI theme to the app's own views (toolbar strip, content pages,
// loading overlay). The external site view is intentionally skipped -- it must
// never be sent anything from our process.
export function broadcastTheme(theme: 'light' | 'dark'): void {
  for (const view of [toolbarView, contentView, loaderView, sidebarView]) {
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.send(IPC.THEME_CHANGED, theme);
    }
  }
}

// Run a callback once the toolbar page has finished loading (also fires on
// reload). Used by main.ts to seed the very first system-status push.
export function onToolbarReady(callback: () => void): void {
  toolbarView.webContents.on('did-finish-load', callback);
}

function logActivity(kind: ActivityEvent['kind'], detail: string, url?: string, profile?: string): void {
  appendActivity({ ts: new Date().toISOString(), kind, detail, url, profile: profile ?? getActiveProfile()?.id });
}

function siteNameFor(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return url;
  }
  for (const site of whitelist.sites) {
    try {
      if (new URL(site.url).hostname === host) return site.name;
    } catch {
      // skip entries with unparseable urls
    }
  }
  return url;
}

// Tracks the whitelist entry's configured url currently shown in siteView
// (not siteView's live navigated URL, which may drift as the user clicks
// around within the site) so re-clicking the same tile resumes the existing
// view instead of reloading and losing state, while switching tiles does a
// fresh load.
let currentLoadedUrl: string | null = null;

// Which whitelist entry is conceptually active in the site view. Drives the
// active-tab highlight in the toolbar. Starts null (home screen).
let activeSiteUrl: string | null = null;

// App-level session history backing the *universal* Back button. The site
// view's own webContents history handles in-site and cross-site back; this
// stack remembers the stable locations (home grid / whitelisted site) the user
// left, so Back also works from the home grid and the blocked screen, and as a
// fallback once the site view's history is exhausted.
type BackTarget = { pane: 'home' } | { pane: 'site'; url: string };
const backStack: BackTarget[] = [];

// Where the user was before the current blocked screen, so Back can restore it
// (blocked is a transient overlay, not a stable location of its own).
let blockedFrom: BackTarget | null = null;

// Which view fills the pane below the toolbar. Driving visibility from a single
// place avoids races (e.g. did-stop-loading flipping the site view back on top
// of the home/blocked screen after the user pressed Home mid-load).
let pane: Pane = 'home';

export function createMainWindow(): BrowserWindow {
  syncWhitelistFromProfile();
  applyScreenTimeForProfile();
  applyUsageForProfile();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    // Phase 2 lockdown: fullscreen kiosk, no frame, no window controls,
    // always on top. In dev (KIOSK false) this stays a normal window so the
    // app remains usable for iteration -- the locked behavior is testable via
    // LOCKDOWN_KIOSK=1 or a packaged build.
    fullscreen: KIOSK,
    kiosk: KIOSK,
    frame: !KIOSK,
    // closable stays TRUE even in kiosk: closable:false makes win.close() a
    // no-op (no 'close' event, no destroy), which would break the admin escape
    // hatch (mainWindow.close() after setAllowClose(true)) and the session-end
    // path. Closing is actually controlled by the 'close' handler below, which
    // preventDefaults every close unless allowClose is set.
    closable: true,
    minimizable: !KIOSK,
    maximizable: !KIOSK,
    resizable: !KIOSK,
    alwaysOnTop: KIOSK,
    webPreferences: {
      // DevTools off in production -- the site view (untrusted external
      // content) must never be inspectable, and there is no dev menu to
      // reopen it from in a packaged build anyway.
      devTools: !KIOSK,
    },
  });

  toolbarView = new WebContentsView({
    webPreferences: {
      preload: preloadFile('toolbar-preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: !KIOSK,
    },
  });

  // Transparent background so the grown (panel-open) view only paints the
  // strip and the floating dropdown — the home view shows through below.
  toolbarView.setBackgroundColor('#00000000');

  // Planner sidebar (Calendar / Timetable / To-dos), pinned under the toolbar
  // on the left. Opaque surface, always visible while a profile is active; the
  // content/site/loading views are shifted right of it in layoutViews().
  sidebarView = new WebContentsView({
    webPreferences: {
      preload: preloadFile('sidebar-preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: !KIOSK,
    },
  });

  contentView = new WebContentsView({
    webPreferences: {
      preload: preloadFile('content-preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: !KIOSK,
    },
  });

  // No preload: this view only ever loads real, untrusted external sites,
  // so it must have zero exposed API surface for page JS to reach.
  siteView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: !KIOSK,
    },
  });

  // Loading overlay. Sits above siteView in z-order. Shown whenever the site
  // view is loading so the student never sees a blank flash or a stale page
  // (e.g. Khan Academy still painted while Google Classroom loads underneath).
  // Carries the content preload only so loading.html can mirror the UI theme.
  loaderView = new WebContentsView({
    webPreferences: {
      preload: preloadFile('content-preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: !KIOSK,
    },
  });

  // Children stack in addition order — LAST added is topmost. The toolbar view
  // must be on top: when the control panel opens it grows to the full window so
  // its dropdown renders over the content below the strip (if it sat below the
  // content view, the grown toolbar would be hidden behind it and the panel
  // would be invisible). The loadView overlay stays above the site view.
  mainWindow.contentView.addChildView(sidebarView);
  mainWindow.contentView.addChildView(contentView);
  mainWindow.contentView.addChildView(siteView);
  mainWindow.contentView.addChildView(loaderView);
  mainWindow.contentView.addChildView(toolbarView);

  if (KIOSK) {
    // Pin the window to the primary display explicitly. kiosk: true normally
    // fills the screen on Windows, but it has been observed to leave a gap
    // (window smaller than the display) in some DPI-scaled configurations, so
    // enforce the exact display bounds as well. screen bounds are in DIPs, so
    // this maps to a full physical coverage at any display scaling.
    mainWindow.setBounds(screen.getPrimaryDisplay().bounds);
  }

  toolbarView.webContents.loadFile(rendererFile('toolbar', 'toolbar.html'));
  sidebarView.webContents.loadFile(rendererFile('sidebar', 'sidebar.html'));
  pane = getActiveProfile() ? 'home' : 'profile';
  loadContentView();
  siteView.setVisible(false);
  loaderView.webContents.loadFile(rendererFile('loading', 'loading.html'));
  loaderView.setVisible(false);

  attachNavigationGuard(siteView.webContents, () => whitelist.sites, showBlocked, () => loadFilterConfig().enabled);

  // Cloudflare content filter: with the whitelist loosened for embedded
  // content AND top-level navigation (the "loose policy"), this is the middle
  // man that cancels any request -- iframe, subresource or main frame -- whose
  // host its policy blocks (adult, gambling/betting, malware, ...). Strictly
  // whitelisted hosts bypass the lookup entirely (no DoH latency).
  installContentFilter(() => whitelist.sites, (url) => logActivity('filter-block', 'Content filter blocked', url));

  // The loading skeleton is raised by navigateToSite() (a tile click) and
  // hidden as soon as the new page's MAIN frame commits -- did-frame-navigate
  // fires for the main frame at commit, when the new document is actually
  // available. This deliberately does NOT use did-stop-loading: heavy sites
  // (e.g. Google Classroom's landing page) keep a subresource hanging forever,
  // so did-stop-loading never fires and the spinner would spin forever. It also
  // ignores subframe loads, so embedded iframes can never flicker the overlay
  // back up over an already-loaded page.
  siteView.webContents.on('did-frame-navigate', (_event, _url, _httpCode, _statusText, isMainFrame) => {
    if (isMainFrame && pane === 'loading') setPane('site');
  });

  // A failed navigation never commits a main frame, so clear the overlay there
  // too -- the Chromium error page is shown instead of a forever-spinner.
  siteView.webContents.on('did-fail-load', (_event, _code, _desc, _url, isMainFrame) => {
    if (isMainFrame && pane === 'loading') setPane('site');
  });

  // Loose policy: when the Cloudflare filter cancels a non-whitelisted
  // top-level load, the request fails with ERR_BLOCKED_BY_CLIENT (-32000).
  // Turn that into the normal blocked screen instead of Chromium's error page.
  siteView.webContents.on('did-fail-load', (_event, code, _desc, url, isMainFrame) => {
    if (isMainFrame && code === -32000) showBlocked(url);
  });

  siteView.webContents.on('did-navigate', (_event, url) => {
    refreshActiveSite(url);
    pushUiState();
  });

  // In-page navigations (hash changes, history.pushState, history back) also
  // affect whether the back button should be enabled.
  siteView.webContents.on('did-navigate-in-page', (_event, url) => {
    refreshActiveSite(url);
    pushUiState();
  });

  layoutViews();
  mainWindow.on('resize', layoutViews);

  // The toolbar never reloads, but push the initial state once it has loaded
  // so back/tabs/power are correct from the first paint.
  toolbarView.webContents.on('did-finish-load', pushUiState);

  // The BrowserWindow's own root webContents never loads anything (all real
  // content lives in the child WebContentsViews above), so its 'ready-to-show'
  // event never fires -- show once the actual visible content (the home grid)
  // has finished loading instead.
  contentView.webContents.once('did-finish-load', () => mainWindow?.show());

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Kiosk windows cannot be closed through normal means. In dev mode the
  // window stays closable so iteration is painless; in kiosk mode every
  // close attempt (Alt+F4, Task Manager "End task", app.quit()) is swallowed
  // unless setAllowClose(true) was called -- which only the Phase 4 admin
  // escape hatch and the Windows session-end handler in main.ts do.
  mainWindow.on('close', (event) => {
    if (KIOSK && !allowClose) {
      event.preventDefault();
    }
  });

  // Boot: if the auto-selected (single-profile) or first profile is outside
  // its allowed usage hours, land on the restricted screen instead of the grid.
  // The pre-window screen-time attach fires before the views exist, so the
  // first post-window tick would route anyway -- routing here is instant.
  showRestrictedIfNeeded();

  return mainWindow;
}

function layoutViews(): void {
  if (!mainWindow) return;
  const [width, height] = mainWindow.getContentSize();
  // The toolbar view grows to cover the whole window while the control panel is
  // open so its dropdown can render (and intercept clicks) below the 48px
  // strip; the transparent view background keeps the home view visible.
  const toolbarHeight = panelOpen ? height : TOOLBAR_HEIGHT;
  toolbarView.setBounds({ x: 0, y: 0, width, height: toolbarHeight });

  // The planner sidebar owns the left column while a profile is active; the
  // content views shift right of it. On the picker (no active profile) it hides
  // so the picker gets the full width.
  const hasProfile = getActiveProfile() !== null;
  const sidebarVisible = hasProfile && !sidebarCollapsed;
  const sidebarWidth = sidebarVisible ? SIDEBAR_WIDTH : 0;
  sidebarView.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width: SIDEBAR_WIDTH, height: Math.max(height - TOOLBAR_HEIGHT, 0) });
  sidebarView.setVisible(sidebarVisible);

  const paneBounds = { x: sidebarWidth, y: TOOLBAR_HEIGHT, width: Math.max(width - sidebarWidth, 0), height: Math.max(height - TOOLBAR_HEIGHT, 0) };
  contentView.setBounds(paneBounds);
  siteView.setBounds(paneBounds);
  loaderView.setBounds(paneBounds);
}

function setPane(next: Pane): void {
  pane = next;
  contentView.setVisible(next === 'home' || next === 'blocked' || next === 'profile' || next === 'restricted');
  siteView.setVisible(next === 'site');
  loaderView.setVisible(next === 'loading');
  pushUiState();
}

// Reload the content view below the toolbar. The picker (no profile selected
// yet), the home grid, the restricted screen and the blocked screen are the
// "page" views; the blocked screen loads its own page via showBlocked().
function loadContentView(): void {
  let name: string;
  if (pane === 'profile') name = 'picker';
  else if (pane === 'restricted') name = 'restricted';
  else name = 'home';
  contentView.webContents.loadFile(rendererFile(name, `${name}.html`));
}

// ---------- Usage-hours enforcement ----------

// True when the active profile's allowed usage windows don't cover right now.
// Only meaningful while a profile is attached (the picker is never restricted).
function outsideUsageHours(): boolean {
  const profile = getActiveProfile();
  if (!profile) return false;
  return !getScreenTimeStatusRaw().inUsageWindow;
}

// Route the content view to the "outside allowed hours" screen when the active
// profile is outside its usage windows. Returns true if the restricted screen
// is (now) showing. No-ops when already there, and during boot before the
// views exist (the first tick after the window is up routes instead).
function showRestrictedIfNeeded(): boolean {
  if (!mainWindow) return false;
  if (pane === 'restricted') return true;
  if (!outsideUsageHours()) return false;
  logActivity('restricted', 'Outside allowed usage hours');
  stopUsageTracking();
  blockedFrom = null;
  activeSiteUrl = null;
  currentLoadedUrl = null;
  const profile = getActiveProfile();
  setPane('restricted');
  contentView.webContents.loadFile(rendererFile('restricted', 'restricted.html'), {
    query: {
      profile: profile?.name ?? '',
      hours: JSON.stringify(profile?.usageHours ?? []),
    },
  });
  return true;
}

// Called by the screen-time onChange handler (main.ts) every tick. Routes to
// the restricted screen the moment a window closes, and returns to the grid
// when one opens again. Cheap and idempotent.
export function enforceUsageHours(inWindow: boolean): void {
  if (pane === 'restricted' && inWindow) {
    goHome();
    return;
  }
  if (!inWindow) {
    showRestrictedIfNeeded();
  }
}

// The child's calendar + to-dos live in the toolbar's planner panel
// (src/renderer/toolbar), which reads the active profile's planner over IPC.
// The full-page planner pane was removed in favour of that panel.

// Push the current kiosk UI state to the toolbar so it can enable/disable the
// back button, show/hide the site tabs, highlight the active tab, and decide
// whether the power buttons are visible.
function pushUiState(): void {
  if (toolbarView.webContents.isDestroyed()) return;
  const active = getActiveProfile();
  const state: UiState = {
    pane,
    canGoBack: computeCanGoBack(),
    activeSiteUrl,
    kiosk: KIOSK,
    profile: active ? { id: active.id, name: active.name, avatarColor: active.avatarColor, skinColor: active.skinColor } : null,
    sidebarCollapsed,
  };
  toolbarView.webContents.send(IPC.UI_STATE, state);
}

// The Back button is universal: enabled whenever pressing it would do
// something sensible in the current pane.
function computeCanGoBack(): boolean {
  if (pane === 'loading' || pane === 'restricted') return false;
  if (pane === 'blocked') return true; // always restores the previous location
  if (pane === 'site') {
    return siteView.webContents.navigationHistory.canGoBack() || backStack.length > 0;
  }
  return backStack.length > 0; // home / picker
}

function currentLocation(): BackTarget {
  if (pane === 'blocked') return blockedFrom ?? { pane: 'home' };
  if (pane === 'site') return { pane: 'site', url: currentLoadedUrl ?? '' };
  return { pane: 'home' }; // home / picker / restricted
}

function sameBackTarget(a: BackTarget | undefined, b: BackTarget): boolean {
  if (!a) return false;
  if (a.pane !== b.pane) return false;
  if (a.pane === 'home') return true;
  return (a as { url: string }).url === (b as { url: string }).url;
}

function pushBackIfNew(loc: BackTarget): void {
  if (!sameBackTarget(backStack[backStack.length - 1], loc)) backStack.push(loc);
}

// Attribute the running surface to the web platform configured for `url` (the
// same lookup navigateToSite uses), so a site restored by Back keeps accruing
// usage. Falls back to the synthetic 'web' id exactly like navigateToSite.
function startUsageForUrl(url: string): void {
  const profile = getActiveProfile();
  const platform = profile?.apps.find((a) => a.kind === 'web' && a.url === url);
  startUsageTracking(platform?.id ?? 'web');
}

// Move to a recorded Back target without pushing it back onto the stack.
// Usage tracking follows the restored location: leaving a site for the home
// grid ends the platform session (goHome() does the same), and restoring a
// site resumes it -- otherwise a session ended with the Back button would
// never flush (staying in-flight until some other event stops it), so the
// admin Usage tab would show 0s for web-only profiles.
function restoreLocation(target: BackTarget): void {
  blockedFrom = null;
  if (target.pane === 'site') {
    startUsageForUrl(target.url);
    if (currentLoadedUrl === target.url) {
      // The view is still sitting on that site's page — just show it again.
      activeSiteUrl = target.url;
      setPane('site');
    } else {
      activeSiteUrl = target.url;
      currentLoadedUrl = target.url;
      setPane('loading');
      siteView.webContents.loadURL(target.url);
    }
  } else {
    stopUsageTracking();
    activeSiteUrl = null;
    currentLoadedUrl = null;
    setPane(getActiveProfile() ? 'home' : 'profile');
    loadContentView();
  }
}

// Best-match the live navigated URL to a whitelist entry so the toolbar's
// active-tab highlight follows Back/forward movement across sites. Falls back
// to the last tile-clicked url when the current page isn't a whitelist home.
function refreshActiveSite(url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return;
  }
  for (const site of whitelist.sites) {
    try {
      if (new URL(site.url).hostname === host) {
        activeSiteUrl = site.url;
        return;
      }
    } catch {
      // skip entries with unparseable urls
    }
  }
}

function showBlocked(attemptedUrl: string): void {
  let host: string;
  try {
    host = new URL(attemptedUrl).hostname;
  } catch {
    host = attemptedUrl;
  }
  logActivity('blocked', `Blocked: ${host}`, attemptedUrl);
  blockedFrom = currentLocation();
  activeSiteUrl = null;
  setPane('blocked');
  contentView.webContents.loadFile(rendererFile('blocked', 'blocked.html'), {
    query: { url: attemptedUrl },
  });
}

export function goHome(): void {
  if (showRestrictedIfNeeded()) return; // off-hours must stay on the restricted screen
  logActivity('home', 'Returned to home grid');
  stopUsageTracking();
  const loc = currentLocation();
  if (loc.pane === 'site') pushBackIfNew(loc);
  blockedFrom = null;
  activeSiteUrl = null;
  currentLoadedUrl = null;
  setPane(getActiveProfile() ? 'home' : 'profile');
  loadContentView();
}

export function navigateToSite(url: string): NavigateResult {
  if (showRestrictedIfNeeded()) {
    return { ok: false, reason: 'Outside allowed usage hours.' };
  }
  if (!isUrlAllowed(url, whitelist.sites)) {
    showBlocked(url);
    return { ok: false, reason: 'Site is not on the whitelist.' };
  }

  // Attribute the session to the active profile's web platform for this url.
  startUsageForUrl(url);

  // Resume an already-loaded site without reloading (preserves in-site state).
  if (currentLoadedUrl === url) {
    const loc = currentLocation();
    if (!(loc.pane === 'site' && loc.url === url)) pushBackIfNew(loc);
    blockedFrom = null;
    activeSiteUrl = url;
    setPane('site');
    logActivity('navigate', siteNameFor(url), url);
    return { ok: true };
  }

  pushBackIfNew(currentLocation());
  blockedFrom = null;
  currentLoadedUrl = url;
  activeSiteUrl = url;
  logActivity('navigate', siteNameFor(url), url);

  // Hide the old site immediately and raise the skeleton so the previous page
  // never flashes behind the new one. did-frame-navigate swaps the site back in.
  setPane('loading');
  siteView.webContents.loadURL(url);

  return { ok: true };
}

// Universal browser-style back. Works from any pane: inside a site it uses the
// site view's natural session history (so it steps back across sites the user
// visited); once that's exhausted, or from the home grid / blocked screen, it
// walks the app-level stack of locations the user left.
export function goBack(): void {
  if (pane === 'loading') return;
  if (pane === 'restricted') return; // off-hours: Back must not leave the restricted screen
  logActivity('back', 'Back');

  if (pane === 'blocked') {
    restoreLocation(blockedFrom ?? { pane: 'home' });
    return;
  }

  if (pane === 'site' && siteView.webContents.navigationHistory.canGoBack()) {
    siteView.webContents.navigationHistory.goBack();
    return;
  }

  while (backStack.length > 0) {
    const target = backStack.pop()!;
    if (sameBackTarget(target, currentLocation())) continue; // skip back-to-self
    restoreLocation(target);
    return;
  }
}

// Kiosk-only power controls. Electron 43's powerMonitor no longer exposes
// shutdown()/restart(), so drive the OS shutdown via shutdown.exe. The
// session-end handler in main.ts sets allowClose so the kiosk never blocks the
// shutdown. The toolbar hides these buttons in dev; gate here too so a stray
// IPC from a dev window can't power-cycle the machine.
function confirmPowerAction(action: 'shutdown' | 'restart'): void {
  if (!KIOSK) return;
  const win = mainWindow;
  if (!win) return;

  const isShutdown = action === 'shutdown';
  dialog
    .showMessageBox(win, {
      type: 'question',
      buttons: [isShutdown ? 'Shut down' : 'Restart', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: isShutdown ? 'Shut down this computer?' : 'Restart this computer?',
      message: isShutdown ? 'Shut down this computer?' : 'Restart this computer?',
    })
    .then(({ response }) => {
      if (response !== 0) return;
      logActivity('power', isShutdown ? 'Shut down' : 'Restart');
      spawn('shutdown.exe', [isShutdown ? '/s' : '/r', '/t', '1'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    })
    .catch(() => {
      // Dialog failed to show (rare); do nothing rather than risk an
      // unexpected power-cycle.
    });
}

export function shutdownComputer(): void {
  confirmPowerAction('shutdown');
}

export function restartComputer(): void {
  confirmPowerAction('restart');
}

export function getWhitelistForRenderer(): WhitelistFile {
  return {
    sites: whitelist.sites.map((entry) => ({
      ...entry,
      icon: entry.icon ? iconFileUrl(entry.icon) : undefined,
    })),
  };
}

// The active profile's full platform list (web + native) for the home grid,
// with icon references resolved to file:// URLs.
export function getPlatformsForRenderer(): PlatformEntry[] {
  const profile = getActiveProfile();
  if (!profile) return [];
  return profile.apps.map((app) => ({
    ...app,
    icon: app.icon ? iconFileUrl(app.icon) : undefined,
  }));
}

// Summaries for the profile picker (id + avatar + name + whether a login
// password is set — passwordless profiles are blocked at picker click).
export function getProfilesForRenderer(): ProfileSummary[] {
  return loadProfiles().profiles.map((p) => ({
    id: p.id,
    name: p.name,
    avatarColor: p.avatarColor,
    passwordSet: profileHasPassword(p),
  }));
}

// Live usage-hours snapshot for the toolbar control panel.
export function getScreenTimeStatus(): ScreenTimeStatus {
  return getScreenTimeStatusRaw();
}

// Admin surfaces must not burn child sign-in time: main.ts pauses the ticker
// while the escape dialog / admin console are open and resumes on close.
export function pauseScreenTimeForAdmin(): void {
  pauseScreenTime();
}

export function resumeScreenTimeForAdmin(): void {
  resumeScreenTime();
}

// Today's per-platform usage for every profile, joined with platform names so
// the admin console can render a human-readable Usage tab.
export function getUsageForAdmin(): UsageSnapshot {
  const date = new Date().toISOString().slice(0, 10);
  const profiles = loadProfiles().profiles.map((p) => {
    const seconds = getPlatformSeconds(p.id, date);
    const entries: UsageEntry[] = [];
    for (const app of p.apps) {
      const secs = seconds[app.id] ?? 0;
      if (secs > 0) entries.push({ id: app.id, name: app.name, kind: app.kind, seconds: secs });
    }
    entries.sort((a, b) => b.seconds - a.seconds);
    return {
      id: p.id,
      name: p.name,
      avatarColor: p.avatarColor,
      totalSec: entries.reduce((sum, e) => sum + e.seconds, 0),
      entries,
    };
  });
  return { date, profiles };
}

// The currently running native (non-web) platform, if any. The kiosk hides its
// window while it runs and returns to the home grid when it exits, so the
// student only ever sees one full-screen surface at a time.
let nativeAppProcess: ChildProcess | null = null;

function showKioskAfterNativeApp(): void {
  nativeAppProcess = null;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
  }
}

export function launchApp(id: string): { ok: boolean; error?: string } {
  if (showRestrictedIfNeeded()) {
    return { ok: false, error: 'Outside allowed usage hours.' };
  }
  const profile = getActiveProfile();
  if (!profile) return { ok: false, error: 'No active profile.' };
  const entry = profile.apps.find((a) => a.id === id);
  if (!entry) return { ok: false, error: 'App not found.' };
  if (entry.kind !== 'native' || !entry.exe) {
    return { ok: false, error: 'This platform has no executable to launch.' };
  }
  if (nativeAppProcess) {
    return { ok: false, error: 'Another app is already running.' };
  }

  const win = mainWindow;
  if (win && !win.isDestroyed()) win.hide();

  logActivity('app-launch', `Launched ${entry.name}`, undefined, profile.id);
  startUsageTracking(entry.id);

  nativeAppProcess = spawn(entry.exe, entry.args ?? [], {
    cwd: path.dirname(entry.exe),
    stdio: 'ignore',
    windowsHide: false,
  });

  nativeAppProcess.on('error', (err) => {
    stopUsageTracking();
    logActivity('app-launch', `Failed to launch ${entry.name}: ${err.message}`, undefined, profile.id);
    showKioskAfterNativeApp();
  });

  nativeAppProcess.on('exit', (code) => {
    stopUsageTracking();
    logActivity('app-exit', `${entry.name} closed (exit ${code ?? 'unknown'})`, undefined, profile.id);
    showKioskAfterNativeApp();
    goHome();
  });

  return { ok: true };
}
