import type { WhitelistFile, NavigateResult, UiState, SaveResult, ActivityPage } from '../shared/types';

export {};

declare global {
  interface Window {
    // Shape exposed by content-preload.ts (home/blocked) or
    // toolbar-preload.ts (toolbar) via contextBridge.
    lockdown: {
      getWhitelist?(): Promise<WhitelistFile>;
      navigateTo?(url: string): Promise<NavigateResult>;
      goHome(): void;
      // Toolbar-only additions (optional here because the home/blocked
      // preload doesn't expose them).
      goBack?(): void;
      shutdown?(): void;
      restart?(): void;
      onUiState?(callback: (state: UiState) => void): void;
      onWhitelistRefreshed?(callback: () => void): void;
    };
    // Exposed by escape-preload.ts (admin escape dialog + admin console)
    // via contextBridge.
    escapeAPI: {
      sendPasswordResult(password: string): void;
    };
    adminAPI: {
      getWhitelist(): Promise<WhitelistFile>;
      saveWhitelist(file: WhitelistFile): Promise<SaveResult>;
      getActivity(offset: number, limit: number): Promise<ActivityPage>;
      clearActivity(): Promise<{ ok: boolean }>;
      close(): void;
    };
  }
}
