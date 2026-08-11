// Web-only platform shape, used by the navigation matchers (isUrlAllowed /
// isFrameUrlAllowed) and the toolbar tabs. Every web PlatformEntry is
// structurally compatible with this.
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

// A permitted "app" on a profile. `kind` decides how it opens:
//   - 'web'    -> a whitelisted web platform, opened in the kiosk site view
//   - 'native' -> an installed program launched as a separate process; the
//                 kiosk hides while it runs and returns to the grid on exit.
export interface PlatformEntry {
  id: string;
  name: string;
  icon?: string;
  kind: 'web' | 'native';
  // web platforms:
  url?: string;
  allowedHosts?: string[];
  embedHosts?: string[];
  // native platforms:
  exe?: string;
  args?: string[];
}

export interface WhitelistFile {
  sites: WhitelistEntry[];
}

// One allowed time-of-day window, "HH:MM" 24h strings. `end` may wrap past
// midnight ("22:00" -> "02:00").
export interface UsageWindow {
  start: string;
  end: string;
}

// A per-child (or default) profile. The kiosk shows a picker at boot; the
// selected profile scopes the app grid, navigation enforcement, screen-time
// policy and activity attribution.
export interface Profile {
  id: string;
  name: string;
  avatarColor: string;
  skinColor: string;
  dailyLimitMin: number; // 0 = unlimited
  usageHours: UsageWindow[]; // empty = anytime allowed
  apps: PlatformEntry[];
  // Profile login password. Stored as a salted SHA-256 hash; hashing and
  // verification happen ONLY in the main process (see src/main/profiles.ts), so
  // the raw password never touches disk or a renderer. A profile with no
  // password cannot be selected — the picker blocks it until an admin sets one.
  passwordHash?: string;
  passwordSalt?: string;
}

export interface ProfilesFile {
  profiles: Profile[];
}

// A pending "I forgot my password" request from the picker, stored in
// <userData>/reset-requests.json and surfaced to the admin in the admin
// console's pending-resets strip. The child only sends profileId + profileName
// (no password material); the admin grants a new password from the console.
export interface ResetRequest {
  profileId: string;
  profileName: string;
  requestedAt: string; // ISO timestamp
}

// A program discovered on this PC (a Start Menu shortcut) that the admin can
// grant a profile access to without typing an exe path. `id` is a stable hash
// of (exe + args) so usage tracking keeps attributing to the same platform
// across admin sessions; `args` come from the shortcut itself.
export interface InstalledApp {
  id: string;
  name: string;
  exe: string;
  args?: string[];
  // The app's real icon/logo, extracted from the exe at enumeration time as a
  // `data:image/png;base64,...` URL so it renders anywhere an <img> does (no
  // file protocol, no custom scheme). Absent when extraction failed.
  icon?: string;
}

// The per-child planner (calendar / timetable / to-do / skin color overrides).
// Stored per profile at <userData>/planner-<profileId>.json.
export interface PlannerEvent {
  id: string;
  date: string; // "YYYY-MM-DD"
  title: string;
}

export interface PlannerTodo {
  id: string;
  text: string;
  done: boolean;
  date?: string; // "YYYY-MM-DD" — undated to-dos are general / always visible
}

export interface PlannerFile {
  events: PlannerEvent[]; // calendar items (dated)
  timetable: { day: string; period: string; subject: string }[]; // day = Mon..Sun
  todos: PlannerTodo[];
}

export interface NavigateResult {
  ok: boolean;
  reason?: string;
}

// Result of a whitelist/profiles save. `path` is the config file written.
export type SaveResult = { ok: true; path: string } | { ok: false; error: string };

// Every logged user/admin action. `ts` is an ISO timestamp; `kind` drives the
// activity-log badge/filter; `url` is the URL involved when there is one;
// `detail` is a short human-readable description; `profile` is the active
// child profile id when one was logged in.
export type ActivityKind =
  | 'app-start'
  | 'app-quit'
  | 'navigate'
  | 'home'
  | 'back'
  | 'blocked'
  | 'power'
  | 'escape'
  | 'whitelist-save'
  | 'whitelist-change'
  | 'profile-switch'
  | 'app-launch'
  | 'app-exit'
  | 'screen-time-limit'
  | 'override'
  | 'restricted'
  | 'wifi-connect'
  | 'auth-failed'
  | 'reset-request'
  | 'password-reset';

export interface ActivityEvent {
  ts: string;
  kind: ActivityKind;
  url?: string;
  detail: string;
  profile?: string;
}

// One page of the activity log, newest-first. `total` is the count of all
// matching events on disk so the UI can page through with (offset, limit).
export interface ActivityPage {
  total: number;
  events: ActivityEvent[];
}

// Which view fills the pane below the toolbar. Mirrors the `Pane` union in
// src/main/window.ts. `profile` = the "who is using this?" picker shown before
// a profile is selected; `home` = the app grid of the active profile;
// `restricted` = the outside-allowed-hours screen. (The per-child planner now
// lives in the persistent left sidebar, so there is no planner pane.)
export type Pane = 'profile' | 'home' | 'blocked' | 'site' | 'loading' | 'restricted';

// Push-state sent from the main process to the toolbar so it can drive its
// back-button enabled state, site-tab visibility/active highlight, and the
// kiosk-only power buttons.
export interface UiState {
  pane: Pane;
  canGoBack: boolean;
  activeSiteUrl: string | null;
  kiosk: boolean;
  profile: { id: string; name: string; avatarColor: string; skinColor: string } | null;
}

// Per-platform screen-time usage for one profile on one day, as reported to the
// admin console. `seconds` is cumulative active time (web = site open in the
// kiosk, native = the spawned program running).
export interface UsageEntry {
  id: string;
  name: string;
  kind: 'web' | 'native';
  seconds: number;
}

// Snapshot of all profiles' platform usage for one day (admin Usage tab).
export interface UsageSnapshot {
  date: string; // YYYY-MM-DD
  profiles: {
    id: string;
    name: string;
    avatarColor: string;
    totalSec: number;
    entries: UsageEntry[];
  }[];
}

// A per-profile, per-day screen-time snapshot for the control panel / admin.
export interface ScreenTimeStatus {
  usedSec: number;
  limitSec: number; // dailyLimitMin * 60; 0 = unlimited
  limitReached: boolean;
  overrideSec: number; // extra seconds granted today via admin override
  inUsageWindow: boolean;
  // Seconds remaining before the auto-shutdown fires the moment the limit is
  // hit. Present (> 0) only while the banner countdown is running; 0/absent
  // means no countdown in flight (either not reached or an override landed).
  countdownSec?: number;
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

// A visible Wi-Fi network from `netsh wlan show networks`.
export interface WifiNetwork {
  ssid: string;
  signal: number; // 0-100
  security: string; // "Open" or the auth type
  saved: boolean;
}

export interface WifiScanResult {
  ok: boolean;
  error?: string;
  current?: { ssid: string | null } | null;
  networks: WifiNetwork[];
}

// Result of a connect / forget request (toolbar Wi-Fi panel, netsh-based).
export interface WifiActionResult {
  ok: boolean;
  error?: string;
}

// Toolbar -> main connect request. `password` is only sent for networks that
// have no saved profile; null/empty means "use the saved profile".
export interface WifiConnectRequest {
  ssid: string;
  password?: string | null;
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

// UI appearance preference, persisted by the main process in
// <userData>/settings.json and broadcast to every renderer on change. The
// toolbar control panel exposes Light/Dark; each page mirrors it onto
// <html data-theme> so shared.css can flip its palette.
export type Theme = 'light' | 'dark';

export const IPC = {
  GET_WHITELIST: 'lockdown:get-whitelist',
  NAVIGATE_TO: 'lockdown:navigate-to',
  GO_HOME: 'lockdown:go-home',
  BACK: 'lockdown:back',
  SHUTDOWN: 'lockdown:shutdown',
  RESTART: 'lockdown:restart',
  UI_STATE: 'lockdown:ui-state',
  WHITELIST_REFRESHED: 'lockdown:whitelist-refreshed',
  ACTIVITY_GET: 'lockdown:activity-get',
  ACTIVITY_CLEAR: 'lockdown:activity-clear',
  ADMIN_CLOSE: 'lockdown:admin-close',
  GET_SYSTEM_STATUS: 'lockdown:get-system-status',
  SET_VOLUME: 'lockdown:set-volume',
  PANEL_RESIZE: 'lockdown:panel-resize',
  // Toolbar <-> main handshake for the screen-time limit banner: the toolbar
  // tells main when the banner is visible so the (transparent) toolbar view can
  // grow below the 48px strip to actually render it.
  BANNER_RESIZE: 'lockdown:banner-resize',
  // Main-process push of a fresh SystemStatus (icons/panel data). `volume` is
  // absent (probe skipped) so the renderer keeps its last volume view.
  SYSTEM_STATUS: 'lockdown:system-status',
  // Phase 5: profiles, platforms, apps
  GET_PROFILES: 'lockdown:get-profiles',
  AUTH_PROFILE: 'lockdown:auth-profile', // picker -> main: unlock a profile with its password
  PASSWORD_RESET_REQUEST: 'lockdown:password-reset-request', // picker -> main: "forgot password" (ungated)
  GET_PLATFORMS: 'lockdown:get-platforms',
  LAUNCH_APP: 'lockdown:launch-app',
  SWITCH_PROFILE: 'lockdown:switch-profile',
  PROFILES_GET: 'lockdown:profiles-get',
  PROFILES_SAVE: 'lockdown:profiles-save',
  // Admin console -> main: pending password-reset requests + password reset.
  RESET_REQUESTS_GET: 'lockdown:reset-requests-get',
  RESET_REQUESTS_CLEAR: 'lockdown:reset-requests-clear',
  PROFILE_SET_PASSWORD: 'lockdown:profile-set-password',
  // Admin console -> main: enumerate installed programs (Start Menu) so native
  // platforms can be granted by picking from a list instead of typing a path.
  INSTALLED_APPS_GET: 'lockdown:installed-apps-get',
  // Admin console -> main: the (slow) per-exe icon batch for the list above,
  // cached to disk so it only ever runs once per machine.
  INSTALLED_APPS_ICONS_GET: 'lockdown:installed-apps-icons-get',
  // Phase 5: screen time
  SCREEN_TIME_GET: 'lockdown:screen-time-get',
  SCREEN_TIME_EVENT: 'lockdown:screen-time-event', // main -> toolbar push
  SCREEN_TIME_EXTEND: 'lockdown:screen-time-extend', // toolbar -> main: show extend dialog
  // Phase 5: per-platform usage (admin Usage tab)
  USAGE_GET: 'lockdown:usage-get',
  // Phase 5: planner (per-child)
  PLANNER_GET: 'lockdown:planner-get',
  PLANNER_SAVE: 'lockdown:planner-save',
  PLANNER_ACTIVE_GET: 'lockdown:planner-active-get', // sidebar / child read-only view
  PLANNER_TODOS_UPDATE: 'lockdown:planner-todos-update', // sidebar to-do check/add/remove (own profile only)
  PLANNER_CHANGED: 'lockdown:planner-changed', // main -> sidebar: reload the plan after an admin planner save
  // Phase 5: wifi control
  WIFI_SCAN: 'lockdown:wifi-scan',
  WIFI_CONNECT: 'lockdown:wifi-connect',
  WIFI_FORGET: 'lockdown:wifi-forget',
  // UI theme (dark mode). Ungated like the volume control: a cosmetic
  // preference, persisted by main and pushed to every renderer on change.
  THEME_GET: 'lockdown:theme-get',
  THEME_SET: 'lockdown:theme-set',
  THEME_CHANGED: 'lockdown:theme-changed',
} as const;
