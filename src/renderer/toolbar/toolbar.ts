// Renderer pages are loaded as plain scripts (no bundler, file:// origin), so
// this file must not use import/export — tsc would emit a CommonJS wrapper that
// throws ("exports is not defined") in the browser context. The types below are
// kept in sync with src/shared/types.ts (and global.d.ts).
type UiState = {
  pane: 'profile' | 'home' | 'blocked' | 'site' | 'loading' | 'restricted';
  canGoBack: boolean;
  activeSiteUrl: string | null;
  kiosk: boolean;
  profile: { id: string; name: string; avatarColor: string; skinColor: string } | null;
};

type BatteryState = 'discharging' | 'charging' | 'full' | 'ac' | 'unknown';
type VolumeStatus = { available: boolean; percent: number | null; muted: boolean | null };
type VolumeRequest = { percent?: number; muted?: boolean };
type ScreenTimeStatus = {
  usedSec: number;
  limitSec: number;
  limitReached: boolean;
  overrideSec: number;
  inUsageWindow: boolean;
  countdownSec?: number;
};
type SystemStatus = {
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
  volume: VolumeStatus;
};
type WifiNetwork = { ssid: string; signal: number; security: string; saved: boolean };
type WifiActionResult = { ok: boolean; error?: string };

const backBtn = document.getElementById('back-btn') as HTMLButtonElement | null;
const tabsEl = document.getElementById('site-tabs') as HTMLElement | null;
const profileChip = document.getElementById('profile-chip') as HTMLButtonElement | null;
const profileChipAvatar = document.getElementById('profile-chip-avatar') as HTMLElement | null;

const clusterEl = document.getElementById('status-cluster') as HTMLElement | null;
const panelEl = document.getElementById('status-panel') as HTMLElement | null;
const wifiPanelEl = document.getElementById('wifi-panel') as HTMLElement | null;
const networkChip = document.getElementById('status-network') as HTMLButtonElement | null;
const networkIcon = document.getElementById('status-network-icon') as HTMLElement | null;
const batteryChip = document.getElementById('status-battery') as HTMLButtonElement | null;
const clockChip = document.getElementById('status-clock') as HTMLButtonElement | null;
const batteryPct = document.getElementById('status-battery-pct') as HTMLElement | null;
const batteryFill = document.getElementById('status-battery-fill') as HTMLElement | null;
const clockTime = document.getElementById('status-clock-time') as HTMLElement | null;
const clockDate = document.getElementById('status-clock-date') as HTMLElement | null;
const panelClock = document.getElementById('panel-clock') as HTMLElement | null;
const panelDate = document.getElementById('panel-date') as HTMLElement | null;
const panelNetworkIcon = document.getElementById('panel-network-icon') as HTMLElement | null;
const panelNetworkValue = document.getElementById('panel-network-value') as HTMLElement | null;
const panelBatteryFill = document.getElementById('panel-battery-fill') as HTMLElement | null;
const panelBatteryValue = document.getElementById('panel-battery-value') as HTMLElement | null;
const volumeMuteBtn = document.getElementById('volume-mute-btn') as HTMLButtonElement | null;
const volumeSlider = document.getElementById('volume-slider') as HTMLInputElement | null;
const volumePct = document.getElementById('volume-pct') as HTMLElement | null;
const panelDevice = document.getElementById('panel-device') as HTMLElement | null;
const panelIp = document.getElementById('panel-ip') as HTMLElement | null;
const panelVersion = document.getElementById('panel-version') as HTMLElement | null;
const panelScreenTime = document.getElementById('panel-screen-time') as HTMLElement | null;
const panelPower = document.getElementById('panel-power') as HTMLElement | null;
const panelShutdown = document.getElementById('panel-shutdown') as HTMLButtonElement | null;
const panelRestart = document.getElementById('panel-restart') as HTMLButtonElement | null;
const wifiState = document.getElementById('wifi-state') as HTMLElement | null;
const wifiList = document.getElementById('wifi-list') as HTMLElement | null;
const wifiRefresh = document.getElementById('wifi-refresh') as HTMLButtonElement | null;
const screenTimeBanner = document.getElementById('screen-time-banner') as HTMLElement | null;
const screenTimeCountdown = document.getElementById('screen-time-countdown') as HTMLElement | null;
const screenTimeExtendBtn = document.getElementById('screen-time-extend') as HTMLButtonElement | null;
const themeLight = document.getElementById('theme-light') as HTMLButtonElement | null;
const themeDark = document.getElementById('theme-dark') as HTMLButtonElement | null;

const NET_WIFI_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M5 12.55a11 11 0 0 1 14.08 0"></path>' +
  '<path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>' +
  '<line x1="12" y1="20" x2="12.01" y2="20"></line></svg>';
const NET_ETHERNET_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M12 22v-5"></path>' +
  '<path d="M9 8V2"></path>' +
  '<path d="M15 8V2"></path>' +
  '<path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z"></path></svg>';
const NET_OFFLINE_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M22.61 16.95A5 5 0 0 0 18 10h-1.26a8 8 0 0 0-7.05-6M5 5a8 8 0 0 0 4 15h9a5 5 0 0 0 1.7-.3"></path>' +
  '<line x1="1" y1="1" x2="23" y2="23"></line></svg>';
const VOL_UNMUTED_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>' +
  '<path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>' +
  '<path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>';
const VOL_MUTED_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>' +
  '<line x1="23" y1="9" x2="17" y2="15"></line>' +
  '<line x1="17" y1="9" x2="23" y2="15"></line></svg>';

let lastStatus: SystemStatus | null = null;
let lastPane: UiState['pane'] | null = null;
let lastScreenTimeStatus: ScreenTimeStatus | null = null;
let hasActiveProfile = false;

/* ---------------------------------------------------------------------------
   Clock
   --------------------------------------------------------------------------- */
function tickClock(): void {
  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const shortDate = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const longDate = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  if (clockTime) clockTime.textContent = time;
  if (clockDate) clockDate.textContent = shortDate;
  if (panelClock) panelClock.textContent = time;
  if (panelDate) panelDate.textContent = longDate;
}

/* ---------------------------------------------------------------------------
   Panels. Two floating cards can be shown below the strip:
     - the control panel (clock / battery chips): status rows + volume + power
     - the Wi-Fi panel (network chip): network scan / connect / forget
   Opening one closes the other. Opening either grows the toolbar
   WebContentsView to the full window (via PANEL_RESIZE) so the dropdown can
   render below the 48px strip; the view + page are transparent there, so the
   panel floats over the home view with no overlay. Closing all shrinks it back.
   --------------------------------------------------------------------------- */
let controlPanelOpen = false;
let wifiPanelOpen = false;

function setControlPanelHidden(hidden: boolean): void {
  if (panelEl) panelEl.hidden = hidden;
}

function setWifiPanelHidden(hidden: boolean): void {
  if (wifiPanelEl) wifiPanelEl.hidden = hidden;
}

function syncOverlay(): void {
  window.lockdown.setPanelOpen?.(controlPanelOpen || wifiPanelOpen);
}

function openControlPanel(): void {
  if (controlPanelOpen) return;
  controlPanelOpen = true;
  wifiPanelOpen = false;
  setWifiPanelHidden(true);
  setControlPanelHidden(false);
  syncOverlay();
  // Fresh data including the (slow) volume probe the moment the panel opens.
  void refreshStatus(true);
}

function closeControlPanel(): void {
  if (!controlPanelOpen) return;
  controlPanelOpen = false;
  setControlPanelHidden(true);
  syncOverlay();
}

function openWifiPanel(): void {
  if (wifiPanelOpen) return;
  wifiPanelOpen = true;
  controlPanelOpen = false;
  setControlPanelHidden(true);
  setWifiPanelHidden(false);
  syncOverlay();
  void loadWifi();
}

function closeWifiPanel(): void {
  if (!wifiPanelOpen) return;
  wifiPanelOpen = false;
  setWifiPanelHidden(true);
  syncOverlay();
}

function closePanels(): void {
  closeControlPanel();
  closeWifiPanel();
}

// Each cluster chip opens its own panel: the network chip is the shortcut to
// the Wi-Fi controls; the battery and clock chips open the control panel.
networkChip?.addEventListener('click', () => {
  if (wifiPanelOpen) closeWifiPanel();
  else openWifiPanel();
});
batteryChip?.addEventListener('click', () => {
  if (controlPanelOpen) closeControlPanel();
  else openControlPanel();
});
clockChip?.addEventListener('click', () => {
  if (controlPanelOpen) closeControlPanel();
  else openControlPanel();
});

// macOS-style dismiss: a click anywhere outside the chips and the open panel
// closes it (the grown toolbar view owns the whole window, so clicks below the
// strip land here instead of on the home view).
document.addEventListener('click', (e) => {
  if (!controlPanelOpen && !wifiPanelOpen) return;
  const target = e.target as Node;
  if (panelEl && panelEl.contains(target)) return;
  if (wifiPanelEl && wifiPanelEl.contains(target)) return;
  if (clusterEl && clusterEl.contains(target)) return;
  closePanels();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePanels();
});

/* ---------------------------------------------------------------------------
   Status rendering
   --------------------------------------------------------------------------- */
function clampBatteryPercent(percent: number | null): number {
  return Math.max(5, Math.min(100, percent ?? 5));
}

function batteryLabel(b: SystemStatus['battery']): string {
  if (!b.present) return 'No battery';
  const p = b.percent !== null ? ` · ${b.percent}%` : '';
  switch (b.state) {
    case 'charging': return `Charging${p}`;
    case 'full': return 'Fully charged';
    case 'ac': return `On AC power${p}`;
    case 'discharging': return `On battery${p}`;
    default: return `Battery${p}`;
  }
}

function networkTypeLabel(type: SystemStatus['network']['type']): string {
  if (type === 'wifi') return 'Wi-Fi';
  if (type === 'ethernet') return 'Ethernet';
  return 'Network';
}

function renderNetwork(n: SystemStatus['network']): void {
  const icon = n.connected ? (n.type === 'wifi' ? NET_WIFI_SVG : NET_ETHERNET_SVG) : NET_OFFLINE_SVG;
  if (networkIcon) networkIcon.innerHTML = icon;
  if (networkChip) {
    // is-warn + tooltip belong on the button (the chip); the span inside only
    // carries the glyph.
    networkChip.classList.toggle('is-warn', !n.connected || !n.online);
    const title = n.connected
      ? `${networkTypeLabel(n.type)}${n.name ? ` · ${n.name}` : ''}${n.online ? '' : ' · offline'}`
      : 'No connection';
    networkChip.title = title;
    networkChip.setAttribute('aria-label', title);
  }
  if (panelNetworkIcon) panelNetworkIcon.innerHTML = icon;
  if (panelNetworkValue) {
    if (!n.connected) panelNetworkValue.textContent = 'No connection';
    else if (!n.online) panelNetworkValue.textContent = `${n.name ?? 'Connected'} · offline`;
    else if (n.linkSpeed) panelNetworkValue.textContent = `${n.name ?? ''} · ${n.linkSpeed}`;
    else panelNetworkValue.textContent = n.name ?? 'Connected';
  }
}

function renderBattery(b: SystemStatus['battery']): void {
  const label = batteryLabel(b);
  if (batteryChip) {
    batteryChip.hidden = !b.present;
    batteryChip.classList.toggle('is-warn', b.present && b.state === 'discharging' && (b.percent ?? 100) <= 20);
    batteryChip.classList.toggle('is-charging', b.present && (b.state === 'charging' || b.state === 'ac' || b.state === 'full'));
    batteryChip.title = label;
    batteryChip.setAttribute('aria-label', label);
  }
  if (batteryPct) batteryPct.textContent = b.present && b.percent !== null ? `${b.percent}%` : '';
  const width = `${clampBatteryPercent(b.percent)}%`;
  if (batteryFill) batteryFill.style.width = width;
  if (panelBatteryFill) panelBatteryFill.style.width = width;
  if (panelBatteryValue) panelBatteryValue.textContent = b.present ? label : 'No battery';
}

function renderSystem(s: SystemStatus['system']): void {
  if (panelDevice) panelDevice.textContent = s.hostname || '—';
  if (panelIp) panelIp.textContent = s.ipv4 || '—';
  if (panelVersion) panelVersion.textContent = s.version || '—';
}

function renderVolume(v: VolumeStatus): void {
  if (volumePct) volumePct.textContent = v.available ? `${v.percent ?? 0}%` : '—';
  const muted = v.available ? (v.muted ?? false) : false;
  if (volumeMuteBtn) {
    volumeMuteBtn.innerHTML = muted ? VOL_MUTED_SVG : VOL_UNMUTED_SVG;
    volumeMuteBtn.title = muted ? 'Unmute' : 'Mute';
    volumeMuteBtn.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
  }
  if (volumeSlider) {
    volumeSlider.disabled = !v.available;
    if (document.activeElement !== volumeSlider) {
      volumeSlider.value = String(v.available ? v.percent ?? 0 : 0);
    }
  }
}

// Apply a status snapshot. `includeVolume` is true only for the panel-open
// one-shot (and volume changes), where the slow audio probe ran; the periodic
// main-process push omits volume so it never clobbers the volume row the user
// is looking at with a stale "—".
function handleStatus(status: SystemStatus, includeVolume: boolean): void {
  lastStatus = status;
  renderNetwork(status.network);
  renderBattery(status.battery);
  renderSystem(status.system);
  if (includeVolume) renderVolume(status.volume);
}

async function refreshStatus(includeVolume: boolean): Promise<void> {
  const getStatus = window.lockdown.getSystemStatus;
  if (!getStatus) return;
  try {
    const status = await getStatus(includeVolume);
    handleStatus(status, includeVolume);
  } catch {
    // Transient probe failure: keep whatever we last had on screen.
  }
}

/* ---------------------------------------------------------------------------
   Volume controls
   --------------------------------------------------------------------------- */
function applyVolume(req: VolumeRequest): void {
  const setVolume = window.lockdown.setVolume;
  if (!setVolume) return;
  setVolume(req)
    .then((v) => {
      if (lastStatus) lastStatus = { ...lastStatus, volume: v };
      renderVolume(v);
    })
    .catch(() => {});
}

volumeMuteBtn?.addEventListener('click', () => {
  applyVolume({ muted: !(lastStatus?.volume.muted ?? false) });
});
volumeSlider?.addEventListener('input', () => {
  if (volumePct && volumeSlider) volumePct.textContent = `${volumeSlider.value}%`;
});
// Set on release, not on every drag tick: each volume change spawns a fresh
// PowerShell process (Add-Type compile) so mid-drag calls would be slow spam.
volumeSlider?.addEventListener('change', () => {
  if (volumeSlider) applyVolume({ percent: Number(volumeSlider.value) });
});

/* ---------------------------------------------------------------------------
   Appearance (light/dark theme). Main owns the persisted value; this page
   mirrors it onto <html data-theme> (shared.css flips its palette) and drives
   the control-panel toggle state.
   --------------------------------------------------------------------------- */
function applyTheme(theme: 'light' | 'dark'): void {
  document.documentElement.dataset.theme = theme;
  if (themeLight) {
    themeLight.classList.toggle('is-active', theme === 'light');
    themeLight.setAttribute('aria-pressed', String(theme === 'light'));
  }
  if (themeDark) {
    themeDark.classList.toggle('is-active', theme === 'dark');
    themeDark.setAttribute('aria-pressed', String(theme === 'dark'));
  }
}

function initTheme(): void {
  const getTheme = window.lockdown.getTheme;
  if (getTheme) getTheme().then(applyTheme).catch(() => {});
  window.lockdown.onThemeChanged?.(applyTheme);
}

themeLight?.addEventListener('click', () => {
  window.lockdown.setTheme?.('light');
});
themeDark?.addEventListener('click', () => {
  window.lockdown.setTheme?.('dark');
});

/* ---------------------------------------------------------------------------
   Wi-Fi panel (Phase 5). Scan / connect / forget over netsh via main. The
   main process surfaces elevation or no-adapter failures as plain errors.
   --------------------------------------------------------------------------- */
let wifiNetworks: WifiNetwork[] = [];
let wifiCurrentSsid: string | null = null;
let wifiScanError: string | null = null;
let wifiFlashError: string | null = null;
let wifiConnectingTo: string | null = null;
let wifiBusy = false;

function wifiBars(signal: number): string {
  const level = signal >= 75 ? 4 : signal >= 50 ? 3 : signal >= 25 ? 2 : 1;
  let html = '<span class="wifi-bars" aria-hidden="true">';
  for (let i = 1; i <= 4; i++) {
    html += `<span class="wifi-bar${i <= level ? ' is-on' : ''}"></span>`;
  }
  return html + '</span>';
}

function renderWifi(): void {
  if (!wifiList) return;
  wifiList.replaceChildren();
  if (wifiFlashError) {
    if (wifiState) {
      wifiState.textContent = wifiFlashError;
      wifiState.classList.add('is-error');
    }
    wifiFlashError = null;
  } else if (wifiScanError) {
    if (wifiState) {
      wifiState.textContent = wifiScanError;
      wifiState.classList.add('is-error');
    }
  } else if (wifiConnectingTo) {
    if (wifiState) {
      wifiState.textContent = `Connecting to ${wifiConnectingTo}…`;
      wifiState.classList.remove('is-error');
    }
  } else {
    if (wifiState) {
      const current = wifiCurrentSsid ? `Connected to ${wifiCurrentSsid}` : 'Not connected';
      wifiState.textContent = `${current} · ${wifiNetworks.length} network${wifiNetworks.length === 1 ? '' : 's'} found`;
      wifiState.classList.remove('is-error');
    }
  }
  if (wifiRefresh) wifiRefresh.disabled = wifiBusy;

  const sorted = [...wifiNetworks].sort((a, b) => {
    if ((a.ssid === wifiCurrentSsid ? 1 : 0) !== (b.ssid === wifiCurrentSsid ? 1 : 0)) return b.ssid === wifiCurrentSsid ? 1 : -1;
    return b.signal - a.signal;
  });

  for (const net of sorted) {
    const li = document.createElement('li');
    li.className = 'wifi-item';
    li.dataset.ssid = net.ssid;

    const bars = document.createElement('span');
    bars.className = 'wifi-item-bars';
    bars.innerHTML = wifiBars(net.signal);

    const body = document.createElement('span');
    body.className = 'wifi-item-body';
    const name = document.createElement('span');
    name.className = 'wifi-item-name';
    name.textContent = net.ssid;
    const meta = document.createElement('span');
    meta.className = 'wifi-item-meta';
    meta.textContent = `${net.security} · ${net.signal}%`;
    body.appendChild(name);
    body.appendChild(meta);

    li.appendChild(bars);
    li.appendChild(body);

    if (net.ssid === wifiCurrentSsid) {
      const badge = document.createElement('span');
      badge.className = 'wifi-item-badge';
      badge.textContent = 'Connected';
      li.appendChild(badge);
    } else if (net.saved) {
      const connect = wifiActionBtn('Connect', 'wifi-item-btn-primary', () => void doConnect(net.ssid, undefined));
      const forget = wifiActionBtn('Forget', '', () => void doForget(net.ssid));
      li.appendChild(connect);
      li.appendChild(forget);
    } else {
      const connect = wifiActionBtn('Connect', 'wifi-item-btn-primary', () => void onConnectClicked(li, net));
      li.appendChild(connect);
    }

    wifiList.appendChild(li);
  }
}

function wifiActionBtn(label: string, extraClass: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `wifi-item-btn ${extraClass}`.trim();
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

// Connect to a non-saved network: open networks connect directly, secured ones
// expand an inline password prompt first.
function onConnectClicked(li: HTMLElement, net: WifiNetwork): void {
  if (net.security === 'Open') {
    void doConnect(net.ssid, undefined);
    return;
  }
  const existing = li.querySelector('.wifi-connect-form');
  if (existing) {
    (existing as HTMLElement).remove();
    return;
  }

  const form = document.createElement('form');
  form.className = 'wifi-connect-form';
  const input = document.createElement('input');
  input.type = 'password';
  input.placeholder = 'Network password';
  input.autocomplete = 'off';
  input.setAttribute('aria-label', `Password for ${net.ssid}`);
  const go = wifiActionBtn('Connect', 'wifi-item-btn-primary', () => {
    void doConnect(net.ssid, input.value || null);
  });
  const cancel = wifiActionBtn('Cancel', '', () => form.remove());
  form.appendChild(input);
  form.appendChild(go);
  form.appendChild(cancel);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void doConnect(net.ssid, input.value || null);
  });
  li.appendChild(form);
  input.focus();
}

async function doConnect(ssid: string, password?: string | null): Promise<void> {
  const connectWifi = window.lockdown.connectWifi;
  if (!connectWifi) return;
  wifiBusy = true;
  wifiConnectingTo = ssid;
  renderWifi();
  try {
    const result = await connectWifi(ssid, password);
    if (result.ok) {
      await Promise.all([loadWifi(), refreshStatus(true)]);
    } else {
      wifiFlashError = result.error || 'Connect failed.';
      await loadWifi();
    }
  } catch {
    wifiFlashError = 'Connect failed.';
  } finally {
    wifiBusy = false;
    wifiConnectingTo = null;
    renderWifi();
  }
}

async function doForget(ssid: string): Promise<void> {
  const forgetWifi = window.lockdown.forgetWifi;
  if (!forgetWifi) return;
  wifiBusy = true;
  renderWifi();
  try {
    const result = await forgetWifi(ssid);
    if (!result.ok) wifiFlashError = result.error || 'Could not forget the network.';
    await loadWifi();
  } finally {
    wifiBusy = false;
    renderWifi();
  }
}

async function loadWifi(): Promise<void> {
  const scanWifi = window.lockdown.scanWifi;
  if (!scanWifi) return;
  try {
    const result = await scanWifi();
    if (result.ok) {
      wifiScanError = null;
      wifiNetworks = result.networks ?? [];
      wifiCurrentSsid = result.current?.ssid ?? null;
    } else {
      wifiScanError = result.error || 'Wi-Fi scan failed.';
      wifiNetworks = [];
      wifiCurrentSsid = null;
    }
  } catch {
    wifiScanError = 'Wi-Fi scan failed.';
    wifiNetworks = [];
    wifiCurrentSsid = null;
  }
  renderWifi();
}

wifiRefresh?.addEventListener('click', () => void loadWifi());

/* ---------------------------------------------------------------------------
   Power controls (kiosk only, moved into the control panel)
   --------------------------------------------------------------------------- */
panelShutdown?.addEventListener('click', () => {
  closePanels();
  window.lockdown.shutdown?.();
});
panelRestart?.addEventListener('click', () => {
  closePanels();
  window.lockdown.restart?.();
});

/* ---------------------------------------------------------------------------
   Screen-time limit banner
   --------------------------------------------------------------------------- */
let bannerOpen = false;

// Grow/shrink the toolbar view so the banner below the strip can paint. The
// main process owns the actual view size; this just tells it when to resize.
function setBannerOpen(open: boolean): void {
  if (bannerOpen === open) return;
  bannerOpen = open;
  window.lockdown.setBannerOpen?.(open);
}

function formatCountdown(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function formatUsage(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m`;
}

// Control-panel "Screen time" row: the active profile's daily usage vs its
// limit. Pushed by main every second, so the number ticks up live.
function renderScreenTimeRow(status: ScreenTimeStatus): void {
  if (!panelScreenTime) return;
  if (!hasActiveProfile) {
    panelScreenTime.textContent = '—';
    panelScreenTime.classList.remove('is-warn');
    panelScreenTime.title = '';
    return;
  }
  const used = formatUsage(status.usedSec);
  const limit = status.limitSec > 0 ? formatUsage(status.limitSec) : null;
  panelScreenTime.textContent = limit ? `${used} / ${limit}` : used;
  panelScreenTime.classList.toggle('is-warn', status.limitReached);
  panelScreenTime.title = status.limitSec > 0
    ? `Used ${used} of ${limit} today`
    : `Used ${used} today`;
}

function renderScreenTime(status: ScreenTimeStatus): void {
  lastScreenTimeStatus = status;
  renderScreenTimeRow(status);
  if (!screenTimeBanner) return;
  const show = status.limitReached;
  screenTimeBanner.hidden = !show;
  document.body.classList.toggle('screen-time-banner-visible', show);
  setBannerOpen(show);
  if (show && screenTimeCountdown) {
    screenTimeCountdown.textContent = status.countdownSec ? formatCountdown(status.countdownSec) : '--:--';
  }
}

screenTimeExtendBtn?.addEventListener('click', () => {
  closePanels();
  window.lockdown.extendScreenTime?.();
});

/* ---------------------------------------------------------------------------
   Site tabs
   --------------------------------------------------------------------------- */
// Auto-fetch the site's favicon (same approach as the home grid). Falls back
// to a neutral letter chip when offline/unknown so tabs stay readable.
function tabFaviconUrl(siteUrl: string): string {
  try {
    const host = new URL(siteUrl).hostname;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
  } catch {
    return '';
  }
}

function makeTabIcon(site: { name: string; url: string; icon?: string }): HTMLElement {
  const img = document.createElement('img');
  img.className = 'site-tab-icon';
  img.alt = '';
  let faviconTried = false;
  img.src = site.icon || tabFaviconUrl(site.url);
  img.onerror = () => {
    if (!faviconTried) {
      faviconTried = true;
      const favicon = tabFaviconUrl(site.url);
      if (favicon) {
        img.src = favicon;
        return;
      }
    }
    const letter = document.createElement('span');
    letter.className = 'site-tab-letter';
    letter.textContent = (site.name.trim()[0] || '?').toUpperCase();
    img.replaceWith(letter);
  };
  return img;
}

async function initTabs(): Promise<void> {
  if (!tabsEl) return;
  const getWhitelist = window.lockdown.getWhitelist;
  if (!getWhitelist) return;

  const { sites } = await getWhitelist();

  for (const site of sites) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'site-tab';
    tab.title = site.name;
    tab.setAttribute('aria-label', site.name);
    tab.dataset.url = site.url;
    tab.appendChild(makeTabIcon(site));
    const label = document.createElement('span');
    label.textContent = site.name;
    tab.appendChild(label);
    tab.addEventListener('click', () => {
      closePanels();
      window.lockdown.navigateTo?.(site.url);
    });
    tabsEl.appendChild(tab);
  }
}

// Rebuild the site tabs after an admin whitelist save (tabs are built once at
// load, so without this the toolbar would show a stale site list).
async function rebuildTabs(): Promise<void> {
  if (!tabsEl) return;
  tabsEl.replaceChildren();
  await initTabs();
}

// Active profile avatar chip in the status cluster. Clicking it opens the
// profile picker (main shows it in the content view).
function renderProfileChip(profile: UiState['profile']): void {
  if (profileChip) profileChip.hidden = !profile;
  if (profileChipAvatar && profile) {
    profileChipAvatar.style.background = profile.avatarColor;
    profileChipAvatar.textContent = (profile.name.trim()[0] || '?').toUpperCase();
  }
  if (profileChip && profile) {
    profileChip.title = `Switch profile · ${profile.name}`;
    profileChip.setAttribute('aria-label', `Switch profile · ${profile.name}`);
  }
}

function applyUiState(state: UiState): void {
  if (state.pane !== lastPane) closePanels();
  lastPane = state.pane;
  hasActiveProfile = !!state.profile;
  if (lastScreenTimeStatus) renderScreenTimeRow(lastScreenTimeStatus);
  if (backBtn) {
    // Universal back: enabled whenever main says there's somewhere to go
    // (works from the home grid, the blocked screen, and inside sites).
    backBtn.disabled = !state.canGoBack;
  }
  renderProfileChip(state.profile);
  if (tabsEl) {
    // Tabs only make sense while a site is on screen; on the home grid the
    // tiles are right there and on the blocked screen there's no active site.
    tabsEl.hidden = state.pane !== 'site' && state.pane !== 'loading';
    for (const tab of tabsEl.querySelectorAll<HTMLElement>('.site-tab')) {
      tab.classList.toggle('is-active', tab.dataset.url === state.activeSiteUrl);
    }
  }
  if (panelPower) {
    panelPower.hidden = !state.kiosk;
  }
}

document.getElementById('home-btn')?.addEventListener('click', () => {
  closePanels();
  window.lockdown.goHome();
});

profileChip?.addEventListener('click', () => {
  closePanels();
  window.lockdown.switchProfile?.();
});
backBtn?.addEventListener('click', () => {
  closePanels();
  window.lockdown.goBack?.();
});

window.lockdown.onUiState?.(applyUiState);
window.lockdown.onWhitelistRefreshed?.(rebuildTabs);
// The main process owns the status cadence: it pushes fresh network/battery
// snapshots over IPC (and immediately on power/network transitions), so the
// toolbar has no polling timer of its own.
window.lockdown.onSystemStatus?.((status) => handleStatus(status, false));
window.lockdown.onScreenTime?.(renderScreenTime);
// Fetch the current screen-time status once so the panel row is populated
// before the next 1s tick from main arrives.
window.lockdown.getScreenTimeStatus?.().then((s) => {
  lastScreenTimeStatus = s;
  renderScreenTime(s);
}).catch(() => {});
initTabs();
initTheme();
tickClock();
setInterval(tickClock, 1000);
