import 'dotenv/config';
import { app, dialog, BrowserWindow, Menu, ipcMain } from 'electron';
import { loadWhitelist } from './whitelist';
import { createMainWindow, getWhitelistForRenderer, navigateToSite, goHome, goBack, shutdownComputer, restartComputer, KIOSK, setAllowClose } from './window';
import { registerIpcHandlers } from './ipc';
import { startInputHook, stopInputHook } from './input-hook';
import { preloadFile, rendererFile, watchdogExePath } from './paths';
import { createServer } from 'net';
import { spawn } from 'child_process';
import type { WhitelistFile } from '../shared/types';

const ESCAPE_PIPE_NAME = 'lockdown-escape';
const ADMIN_PASSWORD = process.env.LOCKDOWN_ADMIN_PASSWORD || 'admin123'; // default for dev; override in production

let escapePipeServer: ReturnType<typeof createServer> | null = null;
let escapePromptWindow: BrowserWindow | null = null;

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
  });

  // Listen for password result
  const channel = 'escape:password-result';
  const handler = (_evt: Electron.IpcMainEvent, enteredPassword: string) => {
    ipcMain.removeListener(channel, handler);
    if (escapePromptWindow) {
      escapePromptWindow.close();
      escapePromptWindow = null;
    }
    if (enteredPassword === '__CANCEL__') return;
    if (enteredPassword === ADMIN_PASSWORD) {
      setAllowClose(true);
      mainWindow.close();
    } else {
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
  stopInputHook();
  stopEscapePipeServer();
});
app.on('will-quit', () => {
  stopInputHook();
  stopEscapePipeServer();
});