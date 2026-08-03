import { contextBridge, ipcRenderer } from 'electron';

// Sandboxed preload scripts (sandbox: true) run through a restricted loader
// that only allows a small set of built-ins -- requiring local relative
// modules like '../shared/types' fails at runtime ("module not found"), so
// the IPC channel name is inlined here rather than imported. Keep in sync
// with the IPC constant in src/shared/types.ts.
const GO_HOME_CHANNEL = 'lockdown:go-home';

contextBridge.exposeInMainWorld('lockdown', {
  goHome: (): void => ipcRenderer.send(GO_HOME_CHANNEL),
});
