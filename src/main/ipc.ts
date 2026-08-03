import { ipcMain } from 'electron';
import { IPC } from '../shared/types';
import type { WhitelistFile, NavigateResult } from '../shared/types';

interface WindowControls {
  getWhitelistForRenderer(): WhitelistFile;
  navigateToSite(url: string): NavigateResult;
  goHome(): void;
}

export function registerIpcHandlers(controls: WindowControls): void {
  ipcMain.handle(IPC.GET_WHITELIST, () => controls.getWhitelistForRenderer());
  ipcMain.handle(IPC.NAVIGATE_TO, (_event, url: string) => controls.navigateToSite(url));
  ipcMain.on(IPC.GO_HOME, () => controls.goHome());
}
