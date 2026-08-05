import { contextBridge, ipcRenderer } from 'electron';
import type { WhitelistFile, NavigateResult, UiState } from '../shared/types';

// Sandboxed preload scripts (sandbox: true) run through a restricted loader
// that only allows a small set of built-ins -- requiring local relative
// modules like '../shared/types' fails at runtime ("module not found"), so
// the IPC channel names are inlined here rather than imported. Keep in sync
// with the IPC constant in src/shared/types.ts.
const IPC = {
  GET_WHITELIST: 'lockdown:get-whitelist',
  NAVIGATE_TO: 'lockdown:navigate-to',
  GO_HOME: 'lockdown:go-home',
  BACK: 'lockdown:back',
  SHUTDOWN: 'lockdown:shutdown',
  RESTART: 'lockdown:restart',
  UI_STATE: 'lockdown:ui-state',
} as const;

contextBridge.exposeInMainWorld('lockdown', {
  getWhitelist: (): Promise<WhitelistFile> => ipcRenderer.invoke(IPC.GET_WHITELIST),
  navigateTo: (url: string): Promise<NavigateResult> => ipcRenderer.invoke(IPC.NAVIGATE_TO, url),
  goHome: (): void => ipcRenderer.send(IPC.GO_HOME),
  goBack: (): void => ipcRenderer.send(IPC.BACK),
  shutdown: (): void => ipcRenderer.send(IPC.SHUTDOWN),
  restart: (): void => ipcRenderer.send(IPC.RESTART),
  onUiState: (callback: (state: UiState) => void): void => {
    ipcRenderer.on(IPC.UI_STATE, (_event, state: UiState) => callback(state));
  },
});
