import { app, dialog, BrowserWindow } from 'electron';
import { loadWhitelist } from './whitelist';
import { createMainWindow, getWhitelistForRenderer, navigateToSite, goHome } from './window';
import { registerIpcHandlers } from './ipc';
import type { WhitelistFile } from '../shared/types';

app.whenReady().then(() => {
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

  createMainWindow(whitelist);
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
