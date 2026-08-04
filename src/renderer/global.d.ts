import type { WhitelistFile, NavigateResult } from '../shared/types';

export {};

declare global {
  interface Window {
    // Shape exposed by content-preload.ts (home/blocked) or
    // toolbar-preload.ts (toolbar, goHome only) via contextBridge.
    lockdown: {
      getWhitelist?(): Promise<WhitelistFile>;
      navigateTo?(url: string): Promise<NavigateResult>;
      goHome(): void;
    };
    // Exposed by escape-preload.ts (admin escape dialog) via contextBridge.
    escapeAPI: {
      sendPasswordResult(password: string): void;
    };
  }
}
