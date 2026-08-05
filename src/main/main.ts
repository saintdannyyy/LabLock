import 'dotenv/config';
import { app, dialog, BrowserWindow, Menu, ipcMain } from 'electron';
import { loadWhitelist, saveWhitelist } from './whitelist';
import { createMainWindow, getWhitelistForRenderer, navigateToSite, goHome, goBack, shutdownComputer, restartComputer, updateWhitelist, notifyWhitelistRefreshed, KIOSK, setAllowClose } from './window';
import { registerIpcHandlers } from './ipc';
import { appendActivity, readActivity, clearActivity } from './history';
import { startInputHook, stopInputHook } from './input-hook';
import { preloadFile, rendererFile, watchdogExePath } from './paths';
import { IPC } from '../shared/types';
import { createServer } from 'net';
import { spawn } from 'child_process';
import type { WhitelistFile, SaveResult, ActivityPage, ActivityEvent } from '../shared/types';

const ESCAPE_PIPE_NAME = 'lockdown-escape';
const ADMIN_PASSWORD = process.env.LOCKDOWN_ADMIN_PASSWORD || 'admin123'; // default for dev; override in production

let escapePipeServer: ReturnType<typeof createServer> | null = null;
let escapePromptWindow: BrowserWindow | null = null;

// Set only after a correct admin password. Every privileged IPC handler
// (whitelist save, activity read/clear) refuses to act without it, so a
// compromised non-admin renderer cannot write the whitelist or read history.
let adminAuthenticated = false;

function logActivity(kind: ActivityEvent['kind'], detail: string, url?: string): void {
  appendActivity({ ts: new Date().toISOString(), kind, detail, url });
}

function closeEscapeWindow(): void {
  if (escapePromptWindow) {
    escapePromptWindow.close();
    escapePromptWindow = null;
  }
}

function startEscapePipeServer(mainWindow: BrowserWindow): void {
  escapePipeServer = createServer((socket) => {
    let data = '';
    socket.on('data', (chunk) => {
      data += chunk.toString();
    });
    socket.on('end', () => {
      if (data.trim() === 'ESCAPE') {
        showAdminEscapeDialog(mainWindow);
      }
    });
  });

  escapePipeServer.on('error', (err) => {
    console.error('Escape pipe server error:', err);
  });

  // Retry once if pipe is in use (leftover from previous unclean shutdown)
  let attempts = 0;
  const tryListen = () => {
    escapePipeServer!.listen(`\\\\.\\pipe\\${ESCAPE_PIPE_NAME}`, () => {
      console.log(`Escape hatch pipe server listening on \\\\.\\pipe\\${ESCAPE_PIPE_NAME}`);
    });
  };
  escapePipeServer.once('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' && attempts === 0) {
      attempts++;
      // Try to connect and close the stale pipe, then retry
      const net = require('net');
      const client = net.createConnection(`\\\\.\\pipe\\${ESCAPE_PIPE_NAME}`, () => {
        client.destroy();
        setTimeout(tryListen, 100);
      });
      client.on('error', () => {
        // Pipe doesn't accept connections, force retry
        setTimeout(tryListen, 100);
      });
    }
  });
  tryListen();
}

function showAdminEscapeDialog(mainWindow: BrowserWindow): void {
  if (escapePromptWindow) return; // Prevent multiple dialogs

  escapePromptWindow = new BrowserWindow({
    width: 400,
    height: 340,
    parent: mainWindow,
    modal: true,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    // closable must stay true: with closable:false, win.close() becomes a no-op
    // and the dialog would never close when the admin confirms/cancels. Alt+F4
    // on the dialog is blocked by InputHook in production anyway, and this is a
    // frame-less window so there is no close button to click.
    closable: true,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: preloadFile('escape-preload.js'),
    },
  });

  // Cover the whole kiosk display so the escape page's dark scrim dims the
  // entire screen behind the dialog. A 400x340 box with the scrim only inside
  // it looked like a broken "background behind the modal" floating on the
  // bright kiosk.
  escapePromptWindow.setBounds(mainWindow.getBounds());

  escapePromptWindow.loadFile(rendererFile('escape', 'escape.html'));

  escapePromptWindow.once('ready-to-show', () => escapePromptWindow?.show());

  escapePromptWindow.on('closed', () => {
    escapePromptWindow = null;
    adminAuthenticated = false;
  });

  // Listen for password result
  const channel = 'escape:password-result';
  const handler = (_evt: Electron.IpcMainEvent, enteredPassword: string) => {
    ipcMain.removeListener(channel, handler);
    if (enteredPassword === '__CANCEL__') {
      closeEscapeWindow();
      return;
    }
    if (enteredPassword === ADMIN_PASSWORD) {
      // Authenticated: keep the same full-screen dialog window open and morph
      // it into the admin console (whitelist manager + activity log) instead
      // of exiting. With shell replacement there is no explorer to exit to.
      logActivity('escape', 'Admin authenticated');
      adminAuthenticated = true;
      if (escapePromptWindow) {
        escapePromptWindow.loadFile(rendererFile('admin', 'admin.html'));
      }
    } else {
      logActivity('escape', 'Incorrect password attempt');
      closeEscapeWindow();
      dialog.showErrorBox('Incorrect Password', 'The password you entered is incorrect.');
    }
  };
  ipcMain.once(channel, handler);
}

function stopEscapePipeServer(): void {
  if (escapePipeServer) {
    escapePipeServer.close();
    escapePipeServer = null;
  }
}

app.whenReady().then(() => {
  logActivity('app-start', 'App started');

  // Strip the application menu entirely in kiosk/production builds -- no
  // File/Edit/View menu, no default accelerators (Ctrl+W, Alt+F4 via menu,
  // Ctrl+Shift+I, ...). In dev the menu is kept so DevTools stays reachable
  // while iterating.
  if (KIOSK) {
    Menu.setApplicationMenu(null);
  }

  let whitelist: WhitelistFile;
  try {
    whitelist = loadWhitelist();
  } catch (err) {
    // Fail loud: never silently start with an empty/broken whitelist.
    dialog.showErrorBox(
      'Lockdown Kiosk Browser — Configuration Error',
      `The whitelist configuration could not be loaded:\n\n${(err as Error).message}\n\n` +
        'The app will now exit. Fix config/whitelist.json and restart.',
    );
    app.quit();
    return;
  }

  const mainWindow = createMainWindow(whitelist);

  if (KIOSK) {
    const hookPid = startInputHook(mainWindow);
    startEscapePipeServer(mainWindow);

    // Spawn watchdog to monitor Electron + InputHook
    if (hookPid) {
      const watchdog = spawn(watchdogExePath(), [
        '--electron-pid', process.pid.toString(),
        '--hook-pid', hookPid.toString(),
        '--app-exe', process.execPath,
      ], { stdio: 'ignore', windowsHide: true });
      watchdog.unref(); // Don't keep the process alive for the watchdog
    }
  }

  registerIpcHandlers({
    getWhitelistForRenderer,
    navigateToSite,
    goHome,
    goBack,
    shutdownComputer,
    restartComputer,
  });

  // Admin-console IPC (whitelist save, activity log). Every handler is gated
  // on adminAuthenticated so only a correctly-authenticated escape window can
  // mutate the whitelist or read history. The window controls above are for
  // the toolbar/content views and stay ungated (they only affect navigation).
  ipcMain.handle(IPC.SAVE_WHITELIST, (_event, payload: unknown): SaveResult => {
    if (!adminAuthenticated) return { ok: false, error: 'Admin authentication required.' };
    const result = saveWhitelist(payload);
    if (result.ok) {
      // Re-load what was actually written (single source of truth) and swap it
      // into both main's and window.ts's live copies so enforcement updates
      // immediately without a restart.
      whitelist = loadWhitelist();
      updateWhitelist(whitelist);
      notifyWhitelistRefreshed();
      logActivity('whitelist-save', `Saved ${whitelist.sites.length} site(s): ${whitelist.sites.map((s) => s.name).join(', ')}`);
    }
    return result;
  });

  ipcMain.handle(IPC.ACTIVITY_GET, (_event, offset: number, limit: number): ActivityPage => {
    if (!adminAuthenticated) return { total: 0, events: [] };
    const safeOffset = Math.max(0, Math.trunc(Number(offset)) || 0);
    const safeLimit = Math.max(1, Math.min(Math.trunc(Number(limit)) || 100, 500));
    return readActivity(safeOffset, safeLimit);
  });

  ipcMain.handle(IPC.ACTIVITY_CLEAR, () => {
    if (!adminAuthenticated) return { ok: false, error: 'Admin authentication required.' };
    clearActivity();
    logActivity('escape', 'History cleared by admin');
    return { ok: true };
  });

  ipcMain.on(IPC.ADMIN_CLOSE, () => {
    // Done button: return to the kiosk (LabLock IS the shell in production),
    // and drop admin privileges so privileged IPC is gated again.
    adminAuthenticated = false;
    closeEscapeWindow();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow(whitelist);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Windows is shutting down or logging off (start-menu shutdown, session end,
// reboot). Without this, the kiosk's close-prevention handler would swallow
// the close and hang the session. 'query-session-end' fires before the close,
// so we flag the close as allowed and let the shutdown proceed. This works on
// both Windows 10 and 11.
//
// Note: electron.d.ts (v43) declares 'query-session-end'/'session-end' outside
// the App interface's typed 'on' overloads even though they are real App events
// at runtime on Windows (see the Electron docs for app.on('query-session-end')).
(app as NodeJS.EventEmitter).on('query-session-end', () => {
  setAllowClose(true);
});

// Clean up the input hook on app quit
app.on('before-quit', () => {
  logActivity('app-quit', 'App quit');
  stopInputHook();
  stopEscapePipeServer();
});
app.on('will-quit', () => {
  stopInputHook();
  stopEscapePipeServer();
});