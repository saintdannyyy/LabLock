import { BrowserWindow, WebContentsView } from 'electron';
import { attachNavigationGuard } from './navigation-guard';
import { preloadFile, rendererFile, iconFileUrl } from './paths';
import { isUrlAllowed } from './whitelist';
import type { WhitelistFile, NavigateResult } from '../shared/types';

const TOOLBAR_HEIGHT = 44;

let mainWindow: BrowserWindow | null = null;
let toolbarView: WebContentsView;
let contentView: WebContentsView;
let siteView: WebContentsView;
let whitelist: WhitelistFile = { sites: [] };

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
  });

  toolbarView = new WebContentsView({
    webPreferences: {
      preload: preloadFile('toolbar-preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  contentView = new WebContentsView({
    webPreferences: {
      preload: preloadFile('content-preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // No preload: this view only ever loads real, untrusted external sites,
  // so it must have zero exposed API surface for page JS to reach.
  siteView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  mainWindow.contentView.addChildView(toolbarView);
  mainWindow.contentView.addChildView(contentView);
  mainWindow.contentView.addChildView(siteView);

  toolbarView.webContents.loadFile(rendererFile('toolbar', 'toolbar.html'));
  contentView.webContents.loadFile(rendererFile('home', 'home.html'));
  siteView.setVisible(false);

  attachNavigationGuard(siteView.webContents, () => whitelist.sites, showBlocked);

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

  return mainWindow;
}

function layoutViews(): void {
  if (!mainWindow) return;
  const [width, height] = mainWindow.getContentSize();
  toolbarView.setBounds({ x: 0, y: 0, width, height: TOOLBAR_HEIGHT });
  const paneBounds = { x: 0, y: TOOLBAR_HEIGHT, width, height: Math.max(height - TOOLBAR_HEIGHT, 0) };
  contentView.setBounds(paneBounds);
  siteView.setBounds(paneBounds);
}

function showBlocked(attemptedUrl: string): void {
  siteView.setVisible(false);
  contentView.setVisible(true);
  contentView.webContents.loadFile(rendererFile('blocked', 'blocked.html'), {
    query: { url: attemptedUrl },
  });
}

export function goHome(): void {
  siteView.setVisible(false);
  contentView.setVisible(true);
  contentView.webContents.loadFile(rendererFile('home', 'home.html'));
}

export function navigateToSite(url: string): NavigateResult {
  if (!isUrlAllowed(url, whitelist.sites)) {
    showBlocked(url);
    return { ok: false, reason: 'Site is not on the whitelist.' };
  }

  contentView.setVisible(false);
  siteView.setVisible(true);

  if (currentLoadedUrl !== url) {
    siteView.webContents.loadURL(url);
    currentLoadedUrl = url;
  }

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
