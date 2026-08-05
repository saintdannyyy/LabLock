export interface WhitelistEntry {
  name: string;
  url: string;
  icon?: string;
  allowedHosts?: string[];
}

export interface WhitelistFile {
  sites: WhitelistEntry[];
}

export interface NavigateResult {
  ok: boolean;
  reason?: string;
}

// Which view fills the pane below the toolbar. Mirrors the `Pane` union
// in src/main/window.ts.
export type Pane = 'home' | 'blocked' | 'site' | 'loading';

// Push-state sent from the main process to the toolbar so it can drive its
// back-button enabled state, site-tab visibility/active highlight, and the
// kiosk-only power buttons.
export interface UiState {
  pane: Pane;
  canGoBack: boolean;
  activeSiteUrl: string | null;
  kiosk: boolean;
}

export const IPC = {
  GET_WHITELIST: 'lockdown:get-whitelist',
  NAVIGATE_TO: 'lockdown:navigate-to',
  GO_HOME: 'lockdown:go-home',
  BACK: 'lockdown:back',
  SHUTDOWN: 'lockdown:shutdown',
  RESTART: 'lockdown:restart',
  UI_STATE: 'lockdown:ui-state',
} as const;
