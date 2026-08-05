import { contextBridge, ipcRenderer } from 'electron';

// This preload serves the password dialog AND the admin console (the same
// full-screen window is morphed from one page to the other after a correct
// password). Sandboxed preloads can't require relative modules, so the IPC
// channel names are inlined here -- keep them in sync with the IPC constant in
// src/shared/types.ts (used by the main process, which isn't sandboxed).
const IPC = {
  GET_WHITELIST: 'lockdown:get-whitelist',
  SAVE_WHITELIST: 'lockdown:save-whitelist',
  ACTIVITY_GET: 'lockdown:activity-get',
  ACTIVITY_CLEAR: 'lockdown:activity-clear',
  ADMIN_CLOSE: 'lockdown:admin-close',
} as const;

contextBridge.exposeInMainWorld('escapeAPI', {
  sendPasswordResult: (password: string): void => {
    ipcRenderer.send('escape:password-result', password);
  },
});

contextBridge.exposeInMainWorld('adminAPI', {
  getWhitelist: (): Promise<unknown> => ipcRenderer.invoke(IPC.GET_WHITELIST),
  saveWhitelist: (file: unknown): Promise<unknown> => ipcRenderer.invoke(IPC.SAVE_WHITELIST, file),
  getActivity: (offset: number, limit: number): Promise<unknown> =>
    ipcRenderer.invoke(IPC.ACTIVITY_GET, offset, limit),
  clearActivity: (): Promise<unknown> => ipcRenderer.invoke(IPC.ACTIVITY_CLEAR),
  close: (): void => ipcRenderer.send(IPC.ADMIN_CLOSE),
});
