import { ipcMain } from 'electron';
import { IPC } from '../shared/types';
import type { WhitelistFile, NavigateResult, PlatformEntry, ScreenTimeStatus } from '../shared/types';
import type { ProfileSummary } from './window';

interface WindowControls {
  getWhitelistForRenderer(): WhitelistFile;
  getPlatformsForRenderer(): PlatformEntry[];
  getProfilesForRenderer(): ProfileSummary[];
  authProfile(id: string, password: string): { ok: boolean; error?: string };
  showPicker(): void;
  launchApp(id: string): { ok: boolean; error?: string };
  getScreenTimeStatus(): ScreenTimeStatus;
  navigateToSite(url: string): NavigateResult;
  goHome(): void;
  goBack(): void;
  shutdownComputer(): void;
  restartComputer(): void;
}

export function registerIpcHandlers(controls: WindowControls): void {
  ipcMain.handle(IPC.GET_WHITELIST, () => controls.getWhitelistForRenderer());
  ipcMain.handle(IPC.GET_PLATFORMS, () => controls.getPlatformsForRenderer());
  ipcMain.handle(IPC.GET_PROFILES, () => controls.getProfilesForRenderer());
  ipcMain.handle(IPC.AUTH_PROFILE, (_event, id: string, password: string) => controls.authProfile(id, password));
  ipcMain.handle(IPC.LAUNCH_APP, (_event, id: string) => controls.launchApp(id));
  ipcMain.handle(IPC.SCREEN_TIME_GET, () => controls.getScreenTimeStatus());
  // Toolbar avatar -> open the picker (no target id; the picker owns selection).
  ipcMain.on(IPC.SWITCH_PROFILE, () => controls.showPicker());
  ipcMain.handle(IPC.NAVIGATE_TO, (_event, url: string) => controls.navigateToSite(url));
  ipcMain.on(IPC.GO_HOME, () => controls.goHome());
  ipcMain.on(IPC.BACK, () => controls.goBack());
  ipcMain.on(IPC.SHUTDOWN, () => controls.shutdownComputer());
  ipcMain.on(IPC.RESTART, () => controls.restartComputer());
}
