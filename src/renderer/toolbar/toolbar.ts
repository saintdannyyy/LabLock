// Renderer pages are loaded as plain scripts (no bundler, file:// origin), so
// this file must not use import/export — tsc would emit a CommonJS wrapper that
// throws ("exports is not defined") in the browser context. The types below are
// kept in sync with src/shared/types.ts (and global.d.ts).
type UiState = {
  pane: 'home' | 'blocked' | 'site' | 'loading';
  canGoBack: boolean;
  activeSiteUrl: string | null;
  kiosk: boolean;
};

type BatteryState = 'discharging' | 'charging' | 'full' | 'ac' | 'unknown';
type VolumeStatus = { available: boolean; percent: number | null; muted: boolean | null };
type VolumeRequest = { percent?: number; muted?: boolean };
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

const backBtn = document.getElementById('back-btn') as HTMLButtonElement | null;
const tabsEl = document.getElementById('site-tabs') as HTMLElement | null;

const clusterEl = document.getElementById('status-cluster') as HTMLElement | null;
const panelEl = document.getElementById('status-panel') as HTMLElement | null;
const networkChip = document.getElementById('status-network') as HTMLButtonElement | null;
const networkIcon = document.getElementById('status-network-icon') as HTMLElement | null;
const batteryChip = document.getElementById('status-battery') as HTMLButtonElement | null;
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
const panelUptime = document.getElementById('panel-uptime') as HTMLElement | null;
const panelPower = document.getElementById('panel-power') as HTMLElement | null;
const panelShutdown = document.getElementById('panel-shutdown') as HTMLButtonElement | null;
const panelRestart = document.getElementById('panel-restart') as HTMLButtonElement | null;

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
   Control panel open/close. Opening grows the toolbar WebContentsView to the
   full window (via PANEL_RESIZE) so the dropdown can render below the 48px
   strip; the view + page are transparent there, so the panel floats over the
   home view with no overlay. Closing shrinks it back.
   --------------------------------------------------------------------------- */
let panelOpen = false;

function setPanelHidden(hidden: boolean): void {
  if (panelEl) panelEl.hidden = hidden;
}

function openPanel(): void {
  if (panelOpen) return;
  panelOpen = true;
  setPanelHidden(false);
  window.lockdown.setPanelOpen?.(true);
  // Fresh data including the (slow) volume probe the moment the panel opens.
  void refreshStatus(true);
}

function closePanel(): void {
  if (!panelOpen) return;
  panelOpen = false;
  setPanelHidden(true);
  window.lockdown.setPanelOpen?.(false);
}

clusterEl?.addEventListener('click', () => {
  if (panelOpen) closePanel();
  else openPanel();
});

// macOS-style dismiss: a click anywhere outside the cluster and the panel
// closes it (the grown toolbar view owns the whole window, so clicks below the
// strip land here instead of on the home view).
document.addEventListener('click', (e) => {
  if (!panelOpen) return;
  const target = e.target as Node;
  if (panelEl && panelEl.contains(target)) return;
  if (clusterEl && clusterEl.contains(target)) return;
  closePanel();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePanel();
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

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function renderSystem(s: SystemStatus['system']): void {
  if (panelDevice) panelDevice.textContent = s.hostname || '—';
  if (panelIp) panelIp.textContent = s.ipv4 || '—';
  if (panelVersion) panelVersion.textContent = s.version || '—';
  if (panelUptime) panelUptime.textContent = formatUptime(s.uptimeSec);
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
   Power controls (kiosk only, moved into the control panel)
   --------------------------------------------------------------------------- */
panelShutdown?.addEventListener('click', () => {
  closePanel();
  window.lockdown.shutdown?.();
});
panelRestart?.addEventListener('click', () => {
  closePanel();
  window.lockdown.restart?.();
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
      closePanel();
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

function applyUiState(state: UiState): void {
  if (state.pane !== lastPane) closePanel();
  lastPane = state.pane;
  if (backBtn) {
    // Universal back: enabled whenever main says there's somewhere to go
    // (works from the home grid, the blocked screen, and inside sites).
    backBtn.disabled = !state.canGoBack;
  }
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
  closePanel();
  window.lockdown.goHome();
});
backBtn?.addEventListener('click', () => {
  closePanel();
  window.lockdown.goBack?.();
});

window.lockdown.onUiState?.(applyUiState);
window.lockdown.onWhitelistRefreshed?.(rebuildTabs);
// The main process owns the status cadence: it pushes fresh network/battery
// snapshots over IPC (and immediately on power/network transitions), so the
// toolbar has no polling timer of its own.
window.lockdown.onSystemStatus?.((status) => handleStatus(status, false));
initTabs();
tickClock();
setInterval(tickClock, 1000);
