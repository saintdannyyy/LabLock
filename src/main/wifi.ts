// Toolbar Wi-Fi panel control (Phase 5). The network chip only displays the
// current connection (read-only); this module adds scan / connect / forget on
// top of the OS toolchain (`netsh wlan`), matching the project's "no native
// addons, use the OS toolchain" constraint.
//
// Note on privileges: `netsh wlan` needs elevation for connect/add-profile/
// delete-profile, and Location consent for scans/show on every Windows build.
// The consent has THREE independent switches that each deny a console app like
// netsh: (1) the master "Location services" toggle, (2) "Let apps access your
// location", and (3) "Let desktop apps access your location" -- the
// ConsentStore\location\NonPackaged value, which defaults to Deny and trips
// error 5 EVEN for an elevated process while Windows misleadingly suggests
// "run as administrator". This module probes elevation and the consent store
// at failure time so the panel explains the actual culprit instead of the
// stock netsh boilerplate. Failures are surfaced as plain error strings, never
// thrown.
import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { WifiNetwork, WifiScanResult, WifiActionResult } from '../shared/types';

function runExe(file: string, args: string[], timeout = 5000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout }, (error, stdout) => {
      let code = 0;
      if (error) {
        const errorCode = (error as NodeJS.ErrnoException).code;
        code = typeof errorCode === 'number' ? errorCode : 1;
      }
      resolve({ code, out: stdout ?? '' });
    });
  });
}

function runNetsh(args: string[]): Promise<{ code: number; out: string }> {
  return runExe('netsh.exe', args, 20000);
}

// Whether THIS process is elevated. Cached: it can't change while the app
// runs. `net session` exits 0 when elevated and 5 (access denied) otherwise.
let elevationChecked = false;
let processElevated = false;
async function isProcessElevated(): Promise<boolean> {
  if (!elevationChecked) {
    processElevated = (await runExe('net.exe', ['session'])).code === 0;
    elevationChecked = true;
  }
  return processElevated;
}

// Read the current user's Location consent store. The master switch lives in
// ConsentStore\location; the "desktop apps" switch (the one that gates netsh)
// lives in ...\location\NonPackaged. Each resolves to true/false when the
// registry value exists, else null (unknown).
async function locationConsent(): Promise<{ master: boolean | null; desktopApps: boolean | null }> {
  const readConsent = async (subKey: string): Promise<boolean | null> => {
    const res = await runExe('reg.exe', [
      'query',
      `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\location${subKey}`,
      '/v',
      'Value',
    ]);
    if (res.code !== 0) return null;
    const match = res.out.match(/REG_SZ\s+(Allow|Deny)/i);
    if (!match) return null;
    return /^allow$/i.test(match[1]);
  };
  return { master: await readConsent(''), desktopApps: await readConsent('\\NonPackaged') };
}

// One-time self-heal: the first time an access-denied failure is diagnosed,
// an ELEVATED kiosk flips the hidden "Let desktop apps access your location"
// consent (ConsentStore\location\NonPackaged) to Allow so netsh wlan works.
// Per-user HKCU, no UAC needed, persists for the account -- so no script has
// to be run on every lab machine. Deliberately skipped for standard (child)
// users and when the MASTER location switch is off (that one needs a human).
let consentHealAttempted = false;
async function ensureDesktopAppsLocationConsent(
  elevated: boolean,
  consent: { master: boolean | null; desktopApps: boolean | null },
): Promise<boolean> {
  if (consentHealAttempted) return false;
  consentHealAttempted = true;
  if (!elevated) return false;
  if (consent.desktopApps !== false || consent.master === false) return false;
  const res = await runExe('reg.exe', [
    'add',
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\location\\NonPackaged',
    '/v',
    'Value',
    '/t',
    'REG_SZ',
    '/d',
    'Allow',
    '/f',
  ]);
  return res.code === 0;
}

// Parse `netsh wlan show interfaces`: the SSID of the connected network (or
// null when disconnected / no wireless interface). Exported for scratchpad
// verification against live netsh output.
export function parseCurrentSsid(out: string): string | null {
  const match = out.match(/^\s*SSID\s*:\s*(.*)$/m);
  const value = match?.[1]?.trim();
  return value ? value : null;
}

// Parse `netsh wlan show networks mode=bssid`: one entry per visible network
// with the strongest signal across its BSSIDs. Exported for scratchpad
// verification against live netsh output.
export function parseNetworks(out: string): WifiNetwork[] {
  const networks: WifiNetwork[] = [];
  const blocks = out.split(/\r?\n\s*SSID \d+ :/);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const ssid = (lines[0] ?? '').replace(/^\s*SSID \d+ :\s*/, '').trim();
    if (!ssid) continue;
    const authLine = lines.find((l) => /^\s*Authentication\s*:/.test(l));
    const signalLines = lines.filter((l) => /^\s*Signal\s*:/.test(l));
    let signal = 0;
    for (const sl of signalLines) {
      const pct = Number.parseInt(sl.replace(/^\s*Signal\s*:\s*/, '').replace(/%.*$/, '').trim(), 10);
      if (Number.isFinite(pct)) signal = Math.max(signal, pct);
    }
    networks.push({
      ssid,
      signal: Math.max(0, Math.min(100, signal)),
      security: normalizeSecurity(authLine?.split(':')[1]?.trim() ?? ''),
      saved: false,
    });
  }
  return networks;
}

function normalizeSecurity(auth: string): string {
  const lower = auth.toLowerCase();
  if (!auth || lower === 'open') return 'Open';
  if (lower.includes('wpa3')) return 'WPA3';
  if (lower.includes('wpa2')) return 'WPA2';
  if (lower.includes('wpa')) return 'WPA';
  if (lower.includes('wep')) return 'WEP';
  if (lower.includes('enterprise')) return 'Enterprise';
  return auth;
}

// Parse `netsh wlan show profiles`: names of saved (known) networks. Exported
// for scratchpad verification against live netsh output.
export function parseSavedProfiles(out: string): Set<string> {
  const saved = new Set<string>();
  for (const line of out.split(/\r?\n/)) {
    const match = line.match(/^\s+.+?\s+:\s*(.+)$/);
    const name = match?.[1]?.trim();
    if (name) saved.add(name);
  }
  return saved;
}

export async function scanWifi(): Promise<WifiScanResult> {
  const [interfaces, networks, profiles] = await Promise.all([
    runNetsh(['wlan', 'show', 'interfaces']),
    runNetsh(['wlan', 'show', 'networks', 'mode=bssid']),
    runNetsh(['wlan', 'show', 'profiles']),
  ]);

  if (interfaces.code !== 0 && networks.code !== 0) {
    return {
      ok: false,
      error: await describeNetshFailure(interfaces.out || networks.out, 'Could not scan for Wi-Fi networks.'),
      networks: [],
    };
  }

  if (networks.code !== 0) {
    // The interface may be fine while the scan itself is blocked (elevation /
    // Location consent); surface that instead of silently showing no networks.
    return { ok: false, error: await describeNetshFailure(networks.out, 'Could not scan for Wi-Fi networks.'), networks: [] };
  }

  const list = parseNetworks(networks.out);
  const saved = parseSavedProfiles(profiles.out);
  for (const n of list) {
    if (saved.has(n.ssid)) n.saved = true;
  }

  const current: { ssid: string | null } | null = interfaces.code === 0 ? { ssid: parseCurrentSsid(interfaces.out) } : null;
  return { ok: true, current, networks: list };
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Build a netsh profile XML for a network with no saved profile. Open networks
// use auth "open"; everything else assumes WPA2-PSK (the common home/lab case).
function buildProfileXml(ssid: string, password: string, open: boolean): string {
  const name = escapeXml(ssid);
  const security = open
    ? '<authEncryption><authentication>open</authentication><encryption>none</encryption><useOneX>false</useOneX></authEncryption>'
    : '<authEncryption><authentication>WPA2PSK</authentication><encryption>AES</encryption><useOneX>false</useOneX></authEncryption>' +
      `<sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>${escapeXml(password)}</keyMaterial></sharedKey>`;
  return (
    '<?xml version="1.0"?>' +
    '<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">' +
    `<name>${name}</name>` +
    `<SSIDConfig><SSID><hex>${Buffer.from(ssid, 'utf8').toString('hex')}</hex><name>${name}</name></SSID></SSIDConfig>` +
    '<connectionType>ESS</connectionType>' +
    '<connectionMode>auto</connectionMode>' +
    '<MSM><security>' +
    security +
    '</security></MSM>' +
    '</WLANProfile>'
  );
}

function isAccessDenied(code: number, out: string): boolean {
  return code !== 0 && /error 5\b|0x00000005|access is denied|requires elevation/i.test(out);
}

export async function connectWifi(ssid: string, password: string | null): Promise<WifiActionResult> {
  // If the network already has a saved profile, a plain connect is enough.
  const profiles = await runNetsh(['wlan', 'show', 'profiles']);
  if (profiles.code === 0 && parseSavedProfiles(profiles.out).has(ssid)) {
    const res = await runNetsh(['wlan', 'connect', `name=${ssid}`]);
    if (res.code === 0) return { ok: true };
    return { ok: false, error: await describeNetshFailure(res.out, 'Could not connect to this network.') };
  }

  // Determine open-ness from a scan rather than the password.
  const scan = await scanWifi();
  const network = scan.networks.find((n) => n.ssid === ssid);
  const isOpen = network?.security === 'Open';

  if (!password && !isOpen) {
    return { ok: false, error: 'This network needs a password (and netsh needs elevation to save it).' };
  }

  const xml = buildProfileXml(ssid, password ?? '', isOpen);
  const tmp = path.join(os.tmpdir(), `lockdown-wifi-${Date.now()}.xml`);
  try {
    fs.writeFileSync(tmp, xml, 'utf8');
  } catch (e) {
    return { ok: false, error: 'Could not write a temporary profile file.' };
  }

  const add = await runNetsh(['wlan', 'add', 'profile', `filename=${tmp}`, 'user=all']);
  fs.rmSync(tmp, { force: true });
  if (add.code !== 0) {
    return { ok: false, error: await describeNetshFailure(add.out, 'Could not add the Wi-Fi profile.') };
  }

  const res = await runNetsh(['wlan', 'connect', `name=${ssid}`]);
  if (res.code === 0) return { ok: true };
  return { ok: false, error: await describeNetshFailure(res.out, 'Could not connect to this network.') };
}

export async function forgetWifi(ssid: string): Promise<WifiActionResult> {
  const res = await runNetsh(['wlan', 'delete', 'profile', `name=${ssid}`, 'user=all']);
  if (res.code === 0) return { ok: true };
  return { ok: false, error: await describeNetshFailure(res.out, 'Could not forget the network.') };
}

// The first genuinely informative line of a netsh error block (the rest is a
// stack of "command failed" repetition and ms-settings boilerplate). Prefers
// the actionable hints — Location consent and elevation — over the raw
// "Function WlanQueryInterface returns error 5:" line. Never truncated.
function firstInformativeLine(out: string): string {
  const lines = out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const pick = (re: RegExp) => lines.find((l) => re.test(l));
  return (
    pick(/location permission|turn on location services|privacy-location/i) ??
    pick(/requires elevation|run as administrator/i) ??
    pick(/access is denied/i) ??
    pick(/error \d+|no wireless|no interface|radio.*off|not supported|failed/i) ??
    lines.find((l) => !/^there is \d+ interface|^here is the uri|^to open the location|^start ms-settings|^or, to open/i.test(l)) ??
    lines[0] ??
    ''
  );
}

// Friendly, complete failure message for the panel. Access-denied (error 5 /
// Location consent) gets a message tailored to what actually blocks the
// operation: the current process's elevation and the real Location consent
// switches, probed at failure time -- never the stock "run as administrator"
// that netsh prints even for an elevated process with a desktop-apps Deny.
// The underlying netsh hint is always appended so nothing is hidden.
async function describeNetshFailure(out: string, fallback: string): Promise<string> {
  const reason = firstInformativeLine(out);
  const detail = reason ? ` Windows said: ${reason}` : '';
  if (isAccessDenied(1, out)) {
    const [elevated, consent] = await Promise.all([isProcessElevated(), locationConsent()]);
    // Self-heal: an elevated admin kiosk enables the hidden "desktop apps"
    // location consent once, so the FIRST scan fixes the machine and every
    // later run just works -- nothing to configure per lab PC.
    if (await ensureDesktopAppsLocationConsent(elevated, consent)) {
      return "Wi-Fi control needs the 'Let desktop apps access your location' permission — the kiosk enabled it for this account. Please try again." + detail;
    }
    const remedies: string[] = [];
    if (consent.desktopApps === false) {
      remedies.push("turn on 'Let desktop apps access your location' (Settings → Privacy & security → Location)");
    } else if (consent.master === false) {
      remedies.push('turn on Location services (Settings → Privacy & security → Location)');
    }
    if (!elevated) {
      remedies.push('run the kiosk as an administrator');
    }
    const remedy =
      remedies.length > 0
        ? `Windows is blocking Wi-Fi control — ${remedies.join(', or ')}`
        : 'Windows is blocking Wi-Fi control — allow Location access for desktop apps (Settings → Privacy & security → Location)';
    return `${remedy}.${detail}`;
  }
  if (/no wireless|no interface|radio.*off|not available/i.test(out)) {
    return `No wireless adapter available.${detail}`;
  }
  return `${fallback}${detail}`;
}
