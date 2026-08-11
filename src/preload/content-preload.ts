import { contextBridge, ipcRenderer } from 'electron';
import type { WhitelistFile, NavigateResult, PlatformEntry, PlannerTodo, SaveResult } from '../shared/types';
// Sandboxed preload scripts (sandbox: true) run through a restricted loader
// that only allows a small set of built-ins -- requiring local relative
// modules like '../shared/types' fails at runtime ("module not found"), so
// the IPC channel names are inlined here rather than imported. Keep these in
// sync with the IPC constant in src/shared/types.ts (used by the main
// process, which isn't sandboxed and can import it normally).
const IPC = {
  GET_WHITELIST: 'lockdown:get-whitelist',
  NAVIGATE_TO: 'lockdown:navigate-to',
  GO_HOME: 'lockdown:go-home',
  GET_PROFILES: 'lockdown:get-profiles',
  AUTH_PROFILE: 'lockdown:auth-profile',
  PASSWORD_RESET_REQUEST: 'lockdown:password-reset-request',
  GET_PLATFORMS: 'lockdown:get-platforms',
  LAUNCH_APP: 'lockdown:launch-app',
  SWITCH_PROFILE: 'lockdown:switch-profile',
  PLANNER_ACTIVE_GET: 'lockdown:planner-active-get',
  PLANNER_TODOS_UPDATE: 'lockdown:planner-todos-update',
  THEME_GET: 'lockdown:theme-get',
  THEME_CHANGED: 'lockdown:theme-changed',
  WHITELIST_REFRESHED: 'lockdown:whitelist-refreshed',
} as const;

// Attached ONLY to the trusted content view (home grid / picker / blocked
// screen / restricted screen / planner), never to the site view that loads real
// external whitelisted sites.
contextBridge.exposeInMainWorld('lockdown', {
  getWhitelist: (): Promise<WhitelistFile> => ipcRenderer.invoke(IPC.GET_WHITELIST),
  navigateTo: (url: string): Promise<NavigateResult> => ipcRenderer.invoke(IPC.NAVIGATE_TO, url),
  goHome: (): void => ipcRenderer.send(IPC.GO_HOME),
  getProfiles: (): Promise<unknown> => ipcRenderer.invoke(IPC.GET_PROFILES),
  authProfile: (id: string, password: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.AUTH_PROFILE, id, password),
  requestPasswordReset: (profileId: string): void => ipcRenderer.send(IPC.PASSWORD_RESET_REQUEST, profileId),
  getPlatforms: (): Promise<PlatformEntry[]> => ipcRenderer.invoke(IPC.GET_PLATFORMS),
  launchApp: (id: string): Promise<unknown> => ipcRenderer.invoke(IPC.LAUNCH_APP, id),
  switchProfile: (): void => ipcRenderer.send(IPC.SWITCH_PROFILE),
  getPlanner: (): Promise<unknown> => ipcRenderer.invoke(IPC.PLANNER_ACTIVE_GET),
  saveTodos: (todos: PlannerTodo[]): Promise<SaveResult> => ipcRenderer.invoke(IPC.PLANNER_TODOS_UPDATE, todos),
  getTheme: (): Promise<'light' | 'dark'> => ipcRenderer.invoke(IPC.THEME_GET),
  onThemeChanged: (callback: (theme: 'light' | 'dark') => void): void => {
    ipcRenderer.on(IPC.THEME_CHANGED, (_event, theme: 'light' | 'dark') => callback(theme));
  },
  onWhitelistRefreshed: (callback: () => void): void => {
    ipcRenderer.on(IPC.WHITELIST_REFRESHED, () => callback());
  },
});
