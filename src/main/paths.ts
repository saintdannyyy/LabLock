import { app } from 'electron';
import * as path from 'path';
import { pathToFileURL } from 'url';

/**
 * dist/main is __dirname at runtime (this file compiles to dist/main/paths.js),
 * so renderer/preload paths are always siblings of dist/main regardless of
 * dev vs packaged mode -- only config/ and assets/ (which live outside dist/,
 * copied via electron-builder's extraResources when packaged) need branching.
 */
const DIST_MAIN_DIR = __dirname;

export function rendererFile(...segments: string[]): string {
  return path.join(DIST_MAIN_DIR, '..', 'renderer', ...segments);
}

export function preloadFile(fileName: string): string {
  return path.join(DIST_MAIN_DIR, '..', 'preload', fileName);
}

export function whitelistConfigPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'config', 'whitelist.json');
  }
  return path.join(app.getAppPath(), 'config', 'whitelist.json');
}

function iconsDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'assets', 'icons');
  }
  return path.join(app.getAppPath(), 'assets', 'icons');
}

export function iconFileUrl(iconFileName: string): string {
  return pathToFileURL(path.join(iconsDir(), iconFileName)).toString();
}

export function inputHookExePath(): string {
  if (app.isPackaged) {
    // extraResources copies bin/inputhook -> resources/bin/inputhook
    return path.join(process.resourcesPath, 'bin', 'inputhook', 'InputHook.exe');
  }
  // dev: bin/inputhook is at project root
  return path.join(app.getAppPath(), 'bin', 'inputhook', 'InputHook.exe');
}
