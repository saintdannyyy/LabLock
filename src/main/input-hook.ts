import { app, BrowserWindow } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import { inputHookExePath } from './paths';

let hookProcess: ChildProcess | null = null;
let stopped = false;
let quitting = false;

app.on('before-quit', () => {
  quitting = true;
});

function spawnHook(): void {
  if (stopped) return;
  const exe = inputHookExePath();
  hookProcess = spawn(exe, [], {
    stdio: 'ignore',
    windowsHide: true,
  });
  hookProcess.on('exit', (code) => {
    hookProcess = null;
    if (!stopped && !quitting) {
      // Restart after a brief delay to avoid tight loop on persistent failure
      setTimeout(spawnHook, 500);
    }
  });
  hookProcess.on('error', (err) => {
    hookProcess = null;
    if (!stopped && !quitting) {
      setTimeout(spawnHook, 500);
    }
  });
}

export function startInputHook(mainWindow: BrowserWindow): void {
  if (!mainWindow) return;
  stopped = false;
  spawnHook();
}

export function stopInputHook(): void {
  stopped = true;
  if (hookProcess) {
    hookProcess.kill();
    hookProcess = null;
  }
}