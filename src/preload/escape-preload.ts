import { contextBridge, ipcRenderer } from 'electron';

// This preload serves the password dialog AND the admin console (the same
// full-screen window is morphed from one page to the other after a correct
// password). Sandboxed preloads can't require relative modules, so the IPC
// channel names are inlined here -- keep them in sync with the IPC constant in
// src/shared/types.ts (used by the main process, which isn't sandboxed).
const IPC = {
  PROFILES_GET: 'lockdown:profiles-get',
  PROFILES_SAVE: 'lockdown:profiles-save',
  INSTALLED_APPS_GET: 'lockdown:installed-apps-get',
  INSTALLED_APPS_ICONS_GET: 'lockdown:installed-apps-icons-get',
  ACTIVITY_GET: 'lockdown:activity-get',
  ACTIVITY_CLEAR: 'lockdown:activity-clear',
  USAGE_GET: 'lockdown:usage-get',
  PLANNER_GET: 'lockdown:planner-get',
  PLANNER_SAVE: 'lockdown:planner-save',
  RESET_REQUESTS_GET: 'lockdown:reset-requests-get',
  RESET_REQUESTS_CLEAR: 'lockdown:reset-requests-clear',
  PROFILE_SET_PASSWORD: 'lockdown:profile-set-password',
  ADMIN_CLOSE: 'lockdown:admin-close',
  THEME_GET: 'lockdown:theme-get',
  THEME_CHANGED: 'lockdown:theme-changed',
} as const;

contextBridge.exposeInMainWorld('escapeAPI', {
  sendPasswordResult: (password: string): void => {
    ipcRenderer.send('escape:password-result', password);
  },
  // Screen-time extend dialog (same escape page loaded with ?mode=extend). Main
  // grants extra minutes on a correct password instead of opening the console.
  sendExtendResult: (password: string): void => {
    ipcRenderer.send('extend:password-result', password);
  },
  // UI theme mirror (escape dialog + admin console both load this preload).
  getTheme: (): Promise<'light' | 'dark'> => ipcRenderer.invoke(IPC.THEME_GET),
  onThemeChanged: (callback: (theme: 'light' | 'dark') => void): void => {
    ipcRenderer.on(IPC.THEME_CHANGED, (_event, theme: 'light' | 'dark') => callback(theme));
  },
});

contextBridge.exposeInMainWorld('adminAPI', {
  getProfiles: (): Promise<unknown> => ipcRenderer.invoke(IPC.PROFILES_GET),
  saveProfiles: (file: unknown): Promise<unknown> => ipcRenderer.invoke(IPC.PROFILES_SAVE, file),
  getInstalledApps: (): Promise<unknown> => ipcRenderer.invoke(IPC.INSTALLED_APPS_GET),
  getInstalledAppIcons: (): Promise<unknown> => ipcRenderer.invoke(IPC.INSTALLED_APPS_ICONS_GET),
  getActivity: (offset: number, limit: number, date?: string): Promise<unknown> =>
    ipcRenderer.invoke(IPC.ACTIVITY_GET, offset, limit, date),
  clearActivity: (): Promise<unknown> => ipcRenderer.invoke(IPC.ACTIVITY_CLEAR),
  getUsage: (): Promise<unknown> => ipcRenderer.invoke(IPC.USAGE_GET),
  getPlanner: (profileId: string): Promise<unknown> => ipcRenderer.invoke(IPC.PLANNER_GET, profileId),
  savePlanner: (profileId: string, file: unknown): Promise<unknown> => ipcRenderer.invoke(IPC.PLANNER_SAVE, profileId, file),
  getResetRequests: (): Promise<unknown> => ipcRenderer.invoke(IPC.RESET_REQUESTS_GET),
  clearResetRequests: (profileId?: string): Promise<unknown> => ipcRenderer.invoke(IPC.RESET_REQUESTS_CLEAR, profileId ?? ''),
  setProfilePassword: (profileId: string, password: string): Promise<unknown> =>
    ipcRenderer.invoke(IPC.PROFILE_SET_PASSWORD, profileId, password),
  close: (): void => ipcRenderer.send(IPC.ADMIN_CLOSE),
});
