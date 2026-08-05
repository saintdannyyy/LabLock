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

// Result of a whitelist save. `path` is the config file written to disk.
export type SaveResult = { ok: true; path: string } | { ok: false; error: string };

// Every logged user/admin action. `ts` is an ISO timestamp; `kind` drives the
// activity-log badge/filter; `url` is the URL involved when there is one;
// `detail` is a short human-readable description.
export type ActivityKind =
  | 'app-start'
  | 'app-quit'
  | 'navigate'
  | 'home'
  | 'back'
  | 'blocked'
  | 'power'
  | 'escape'
  | 'whitelist-save';

export interface ActivityEvent {
  ts: string;
  kind: ActivityKind;
  url?: string;
  detail: string;
}

// One page of the activity log, newest-first. `total` is the count of all
// events on disk so the UI can page through with (offset, limit).
export interface ActivityPage {
  total: number;
  events: ActivityEvent[];
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
  SAVE_WHITELIST: 'lockdown:save-whitelist',
  WHITELIST_REFRESHED: 'lockdown:whitelist-refreshed',
  ACTIVITY_GET: 'lockdown:activity-get',
  ACTIVITY_CLEAR: 'lockdown:activity-clear',
  ADMIN_CLOSE: 'lockdown:admin-close',
} as const;
