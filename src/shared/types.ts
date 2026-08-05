export interface WhitelistEntry {
  name: string;
  url: string;
  icon?: string;
  allowedHosts?: string[];
  // Hosts allowed ONLY inside iframes on whitelisted pages (YouTube/Google
  // Maps/Disqus embeds, etc.). Never browseable as a top-level page: main-frame
  // navigation, redirects, popups and tiles all ignore this list.
  embedHosts?: string[];
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

// Battery charge state. 'ac' = plugged in but not actively charging,
// 'charging' = plugged in and charging, 'discharging' = running on battery.
export type BatteryState = 'discharging' | 'charging' | 'full' | 'ac' | 'unknown';

// One probe snapshot for the control panel. `ts` is epoch ms. `volume` is only
// populated when the caller asked for it (the audio probe is slow) -- the
// toolbar renders icons from the network/battery fields on the periodic fetch
// and requests the volume only when the panel is open.
export interface SystemStatus {
  ts: number;
  battery: { present: boolean; percent: number | null; state: BatteryState };
  network: {
    connected: boolean;
    online: boolean;
    type: 'wifi' | 'ethernet' | 'unknown';
    name: string | null;
    linkSpeed: string | null;
  };
  system: { hostname: string; ipv4: string | null; version: string; uptimeSec: number };
  volume: { available: boolean; percent: number | null; muted: boolean | null };
}

export interface VolumeRequest {
  percent?: number;
  muted?: boolean;
}

export interface VolumeStatus {
  available: boolean;
  percent: number | null;
  muted: boolean | null;
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
  GET_SYSTEM_STATUS: 'lockdown:get-system-status',
  SET_VOLUME: 'lockdown:set-volume',
  PANEL_RESIZE: 'lockdown:panel-resize',
  // Main-process push of a fresh SystemStatus (icons/panel data). `volume` is
  // absent (probe skipped) so the renderer keeps its last volume view.
  SYSTEM_STATUS: 'lockdown:system-status',
} as const;
