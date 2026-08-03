import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('escapeAPI', {
  sendPasswordResult: (password: string) => {
    ipcRenderer.send('escape:password-result', password);
  },
});