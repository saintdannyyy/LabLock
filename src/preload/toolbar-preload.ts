import { contextBridge, ipcRenderer } from 'electron';
import type { WhitelistFile, NavigateResult, UiState, SystemStatus, VolumeStatus, VolumeRequest } from '../shared/types';

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
  WHITELIST_REFRESHED: 'lockdown:whitelist-refreshed',
  GET_SYSTEM_STATUS: 'lockdown:get-system-status',
  SET_VOLUME: 'lockdown:set-volume',
  PANEL_RESIZE: 'lockdown:panel-resize',
  SYSTEM_STATUS: 'lockdown:system-status',
} as const;

contextBridge.exposeInMainWorld('lockdown', {
  getWhitelist: (): Promise<WhitelistFile> => ipcRenderer.invoke(IPC.GET_WHITELIST),
  navigateTo: (url: string): Promise<NavigateResult> => ipcRenderer.invoke(IPC.NAVIGATE_TO, url),
  goHome: (): void => ipcRenderer.send(IPC.GO_HOME),
  goBack: (): void => ipcRenderer.send(IPC.BACK),
  shutdown: (): void => ipcRenderer.send(IPC.SHUTDOWN),
  restart: (): void => ipcRenderer.send(IPC.RESTART),
  getSystemStatus: (includeVolume: boolean): Promise<SystemStatus> => ipcRenderer.invoke(IPC.GET_SYSTEM_STATUS, includeVolume),
  setVolume: (req: VolumeRequest): Promise<VolumeStatus> => ipcRenderer.invoke(IPC.SET_VOLUME, req),
  setPanelOpen: (open: boolean): void => ipcRenderer.send(IPC.PANEL_RESIZE, open),
  onUiState: (callback: (state: UiState) => void): void => {
    ipcRenderer.on(IPC.UI_STATE, (_event, state: UiState) => callback(state));
  },
  onWhitelistRefreshed: (callback: () => void): void => {
    ipcRenderer.on(IPC.WHITELIST_REFRESHED, () => callback());
  },
  onSystemStatus: (callback: (status: SystemStatus) => void): void => {
    ipcRenderer.on(IPC.SYSTEM_STATUS, (_event, status: SystemStatus) => callback(status));
  },
});
