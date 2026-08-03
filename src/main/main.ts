import { app, dialog, BrowserWindow, Menu } from 'electron';
import { loadWhitelist } from './whitelist';
import { createMainWindow, getWhitelistForRenderer, navigateToSite, goHome, KIOSK, setAllowClose } from './window';
import { registerIpcHandlers } from './ipc';
import { startInputHook, stopInputHook } from './input-hook';
import type { WhitelistFile } from '../shared/types';

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
    startInputHook(mainWindow);
  }

  registerIpcHandlers({
    getWhitelistForRenderer,
    navigateToSite,
    goHome,
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
});
app.on('will-quit', () => {
  stopInputHook();
});