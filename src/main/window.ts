import { app, BrowserWindow, WebContentsView, screen } from 'electron';
import { attachNavigationGuard } from './navigation-guard';
import { preloadFile, rendererFile, iconFileUrl } from './paths';
import { isUrlAllowed } from './whitelist';
import type { WhitelistFile, NavigateResult } from '../shared/types';

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

export function setAllowClose(value: boolean): void {
  allowClose = value;
}

// Tracks the whitelist entry's configured url currently shown in siteView
// (not siteView's live navigated URL, which may drift as the user clicks
// around within the site) so re-clicking the same tile resumes the existing
// view instead of reloading and losing state, while switching tiles does a
// fresh load.
let currentLoadedUrl: string | null = null;

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

  layoutViews();
  mainWindow.on('resize', layoutViews);

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
  toolbarView.setBounds({ x: 0, y: 0, width, height: TOOLBAR_HEIGHT });
  const paneBounds = { x: 0, y: TOOLBAR_HEIGHT, width, height: Math.max(height - TOOLBAR_HEIGHT, 0) };
  contentView.setBounds(paneBounds);
  siteView.setBounds(paneBounds);
  loaderView.setBounds(paneBounds);
}

// Which view fills the pane below the toolbar. Driving visibility from a single
// place avoids races (e.g. did-stop-loading flipping the site view back on top
// of the home/blocked screen after the user pressed Home mid-load).
type Pane = 'home' | 'blocked' | 'site' | 'loading';
let pane: Pane = 'home';

function setPane(next: Pane): void {
  pane = next;
  contentView.setVisible(next === 'home' || next === 'blocked');
  siteView.setVisible(next === 'site');
  loaderView.setVisible(next === 'loading');
}

function showBlocked(attemptedUrl: string): void {
  setPane('blocked');
  contentView.webContents.loadFile(rendererFile('blocked', 'blocked.html'), {
    query: { url: attemptedUrl },
  });
}

export function goHome(): void {
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
    setPane('site');
    return { ok: true };
  }

  currentLoadedUrl = url;

  // Hide the old site immediately and raise the skeleton so the previous page
  // never flashes behind the new one. did-stop-loading swaps the site back in.
  setPane('loading');
  siteView.webContents.loadURL(url);

  return { ok: true };
}

export function getWhitelistForRenderer(): WhitelistFile {
  return {
    sites: whitelist.sites.map((entry) => ({
      ...entry,
      icon: entry.icon ? iconFileUrl(entry.icon) : undefined,
    })),
  };
}
