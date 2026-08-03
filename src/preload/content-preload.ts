import { contextBridge, ipcRenderer } from 'electron';
import type { WhitelistFile, NavigateResult } from '../shared/types';

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
} as const;

// Attached ONLY to the trusted content view (home grid / blocked screen),
// never to the site view that loads real external whitelisted sites.
contextBridge.exposeInMainWorld('lockdown', {
  getWhitelist: (): Promise<WhitelistFile> => ipcRenderer.invoke(IPC.GET_WHITELIST),
  navigateTo: (url: string): Promise<NavigateResult> => ipcRenderer.invoke(IPC.NAVIGATE_TO, url),
  goHome: (): void => ipcRenderer.send(IPC.GO_HOME),
});
