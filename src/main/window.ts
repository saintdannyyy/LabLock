import { app, BrowserWindow, WebContentsView, screen, dialog } from 'electron';
import { spawn } from 'child_process';
import { attachNavigationGuard } from './navigation-guard';
import { preloadFile, rendererFile, iconFileUrl } from './paths';
import { isUrlAllowed } from './whitelist';
import { appendActivity } from './history';
import { IPC } from '../shared/types';
import type { WhitelistFile, NavigateResult, Pane, UiState, ActivityEvent } from '../shared/types';

const TOOLBAR_HEIGHT = 44;

// Phase 2 lockdown mode. Active in any packaged (production) build, and
// additionally forceable in dev via LOCKDOWN_KIOSK=1 so the real locked
// window can be exercised on a dev machine without building an installer.
// (Safe to test in dev: until Phase 3 there is no shell replacement and no
// watchdog, so killing the electron process from the launching terminal
// still escapes.)
export const KIOSK = app.isPackaged || process.env.LOCKDOWN_KIOSK === '1';

let mainWindow: BrowserWindow | null = null;
let toolbarView: WebContentsView;
let contentView: WebContentsView;
let siteView: WebContentsView;
let loaderView: WebContentsView;
let whitelist: WhitelistFile = { sites: [] };

// When true, the window's 'close' handler stops preventing the close. Set by
// the admin escape hatch (Phase 4) and by the Windows session-end hook so a
// system shutdown/logoff is never blocked by the kiosk.
let allowClose = false;

// Control panel open state. The toolbar page only drops its dropdown below the
// 48px strip if its WebContentsView covers the whole window, so the view is
// resized to full height while the panel is open (the panel's scrim then
// swallows clicks on the area below the strip) and back to the 48px strip when
// it closes.
let panelOpen = false;

export function setPanelOpen(open: boolean): void {
  if (panelOpen === open) return;
  panelOpen = open;
  layoutViews();
}

export function setAllowClose(value: boolean): void {
  allowClose = value;
}

// Swap the live whitelist after a successful admin save. Navigation guards and
// the home grid read it through live closures (attachNavigationGuard gets
// () => whitelist.sites), so enforcement updates immediately without a restart.
export function updateWhitelist(file: WhitelistFile): void {
  whitelist = file;
}

// The toolbar builds its site tabs once at load, so tell it to rebuild after a
// whitelist change. Also re-push UI state (a removed active site must clear its
// active-tab highlight).
export function notifyWhitelistRefreshed(): void {
  if (toolbarView && !toolbarView.webContents.isDestroyed()) {
    toolbarView.webContents.send(IPC.WHITELIST_REFRESHED);
  }
  pushUiState();
}

// Send an arbitrary payload to the toolbar renderer. Used by the main-process
// system-status push (IPC.SYSTEM_STATUS).
export function sendToToolbar(channel: string, payload: unknown): void {
  if (toolbarView && !toolbarView.webContents.isDestroyed()) {
    toolbarView.webContents.send(channel, payload);
  }
}

// Run a callback once the toolbar page has finished loading (also fires on
// reload). Used by main.ts to seed the very first system-status push.
export function onToolbarReady(callback: () => void): void {
  toolbarView.webContents.on('did-finish-load', callback);
}

function logActivity(kind: ActivityEvent['kind'], detail: string, url?: string): void {
  appendActivity({ ts: new Date().toISOString(), kind, detail, url });
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

export function createMainWindow(loadedWhitelist: WhitelistFile): BrowserWindow {
  whitelist = loadedWhitelist;

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
  loaderView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: !KIOSK,
    },
  });

  mainWindow.contentView.addChildView(toolbarView);
  mainWindow.contentView.addChildView(contentView);
  mainWindow.contentView.addChildView(siteView);
  mainWindow.contentView.addChildView(loaderView);

  if (KIOSK) {
    // Pin the window to the primary display explicitly. kiosk: true normally
    // fills the screen on Windows, but it has been observed to leave a gap
    // (window smaller than the display) in some DPI-scaled configurations, so
    // enforce the exact display bounds as well. screen bounds are in DIPs, so
    // this maps to a full physical coverage at any display scaling.
    mainWindow.setBounds(screen.getPrimaryDisplay().bounds);
  }

  toolbarView.webContents.loadFile(rendererFile('toolbar', 'toolbar.html'));
  contentView.webContents.loadFile(rendererFile('home', 'home.html'));
  siteView.setVisible(false);
  loaderView.webContents.loadFile(rendererFile('loading', 'loading.html'));
  loaderView.setVisible(false);

  attachNavigationGuard(siteView.webContents, () => whitelist.sites, showBlocked);

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

  return mainWindow;
}

function layoutViews(): void {
  if (!mainWindow) return;
  const [width, height] = mainWindow.getContentSize();
  // The toolbar view grows to cover the whole window while the control panel
  // is open so its dropdown + scrim can render (and intercept clicks) below
  // the 48px strip.
  const toolbarHeight = panelOpen ? height : TOOLBAR_HEIGHT;
  toolbarView.setBounds({ x: 0, y: 0, width, height: toolbarHeight });
  const paneBounds = { x: 0, y: TOOLBAR_HEIGHT, width, height: Math.max(height - TOOLBAR_HEIGHT, 0) };
  contentView.setBounds(paneBounds);
  siteView.setBounds(paneBounds);
  loaderView.setBounds(paneBounds);
}

function setPane(next: Pane): void {
  pane = next;
  contentView.setVisible(next === 'home' || next === 'blocked');
  siteView.setVisible(next === 'site');
  loaderView.setVisible(next === 'loading');
  pushUiState();
}

// Push the current kiosk UI state to the toolbar so it can enable/disable the
// back button, show/hide the site tabs, highlight the active tab, and decide
// whether the power buttons are visible.
function pushUiState(): void {
  if (toolbarView.webContents.isDestroyed()) return;
  const state: UiState = {
    pane,
    canGoBack: computeCanGoBack(),
    activeSiteUrl,
    kiosk: KIOSK,
  };
  toolbarView.webContents.send(IPC.UI_STATE, state);
}

// The Back button is universal: enabled whenever pressing it would do
// something sensible in the current pane.
function computeCanGoBack(): boolean {
  if (pane === 'loading') return false;
  if (pane === 'blocked') return true; // always restores the previous location
  if (pane === 'site') {
    return siteView.webContents.navigationHistory.canGoBack() || backStack.length > 0;
  }
  return backStack.length > 0; // home
}

function currentLocation(): BackTarget {
  if (pane === 'blocked') return blockedFrom ?? { pane: 'home' };
  if (pane === 'site') return { pane: 'site', url: currentLoadedUrl ?? '' };
  return { pane: 'home' };
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

// Move to a recorded Back target without pushing it back onto the stack.
function restoreLocation(target: BackTarget): void {
  blockedFrom = null;
  if (target.pane === 'site') {
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
    activeSiteUrl = null;
    currentLoadedUrl = null;
    setPane('home');
    contentView.webContents.loadFile(rendererFile('home', 'home.html'));
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
  logActivity('home', 'Returned to home grid');
  const loc = currentLocation();
  if (loc.pane === 'site') pushBackIfNew(loc);
  blockedFrom = null;
  activeSiteUrl = null;
  currentLoadedUrl = null;
  setPane('home');
  contentView.webContents.loadFile(rendererFile('home', 'home.html'));
}

export function navigateToSite(url: string): NavigateResult {
  if (!isUrlAllowed(url, whitelist.sites)) {
    showBlocked(url);
    return { ok: false, reason: 'Site is not on the whitelist.' };
  }

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
