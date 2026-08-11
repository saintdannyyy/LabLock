import { contextBridge, ipcRenderer } from 'electron';
import type { PlannerFile, PlannerTodo, SaveResult } from '../shared/types';

// Sandboxed preload for the planner sidebar (sidebar.html). Like the other
// sandboxed preloads it cannot require relative modules, so the IPC channel
// names are inlined here — keep in sync with the IPC constant in
// src/shared/types.ts.
const IPC = {
  PLANNER_ACTIVE_GET: 'lockdown:planner-active-get',
  PLANNER_TODOS_UPDATE: 'lockdown:planner-todos-update',
  PLANNER_CHANGED: 'lockdown:planner-changed',
  THEME_GET: 'lockdown:theme-get',
  THEME_CHANGED: 'lockdown:theme-changed',
  WHITELIST_REFRESHED: 'lockdown:whitelist-refreshed',
} as const;

contextBridge.exposeInMainWorld('lockdown', {
  getPlanner: (): Promise<PlannerFile> => ipcRenderer.invoke(IPC.PLANNER_ACTIVE_GET),
  saveTodos: (todos: PlannerTodo[]): Promise<SaveResult> => ipcRenderer.invoke(IPC.PLANNER_TODOS_UPDATE, todos),
  getTheme: (): Promise<'light' | 'dark'> => ipcRenderer.invoke(IPC.THEME_GET),
  onThemeChanged: (callback: (theme: 'light' | 'dark') => void): void => {
    ipcRenderer.on(IPC.THEME_CHANGED, (_event, theme: 'light' | 'dark') => callback(theme));
  },
  onWhitelistRefreshed: (callback: () => void): void => {
    ipcRenderer.on(IPC.WHITELIST_REFRESHED, () => callback());
  },
  onPlannerChanged: (callback: () => void): void => {
    ipcRenderer.on(IPC.PLANNER_CHANGED, () => callback());
  },
});
