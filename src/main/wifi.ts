// Toolbar Wi-Fi panel control (Phase 5). The network chip only displays the
// current connection (read-only); this module adds scan / connect / forget on
// top of the OS toolchain (`netsh wlan`), matching the project's "no native
// addons, use the OS toolchain" constraint.
//
// Note on privileges: `netsh wlan` needs elevation for connect/add-profile/
// delete-profile and Location consent for scans on some Windows builds, so the
// panel realistically only works when the kiosk runs elevated (a standard
// child user usually hits "access denied"). Failures are surfaced to the panel
// as plain error strings, never thrown.
import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { WifiNetwork, WifiScanResult, WifiActionResult } from '../shared/types';

function runNetsh(args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile('netsh.exe', args, { windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 20000 }, (error, stdout) => {
      let code = 0;
      if (error) {
        const errorCode = (error as NodeJS.ErrnoException).code;
        code = typeof errorCode === 'number' ? errorCode : 1;
      }
      resolve({ code, out: stdout ?? '' });
    });
  });
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
      error: describeNetshFailure(interfaces.out || networks.out, 'Could not scan for Wi-Fi networks.'),
      networks: [],
    };
  }

  if (networks.code !== 0) {
    // The interface may be fine while the scan itself is blocked (elevation /
    // Location consent); surface that instead of silently showing no networks.
    return { ok: false, error: describeNetshFailure(networks.out, 'Could not scan for Wi-Fi networks.'), networks: [] };
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
    return { ok: false, error: describeNetshFailure(res.out, 'Could not connect to this network.') };
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
    return { ok: false, error: describeNetshFailure(add.out, 'Could not add the Wi-Fi profile.') };
  }

  const res = await runNetsh(['wlan', 'connect', `name=${ssid}`]);
  if (res.code === 0) return { ok: true };
  return { ok: false, error: describeNetshFailure(res.out, 'Could not connect to this network.') };
}

export async function forgetWifi(ssid: string): Promise<WifiActionResult> {
  const res = await runNetsh(['wlan', 'delete', 'profile', `name=${ssid}`, 'user=all']);
  if (res.code === 0) return { ok: true };
  return { ok: false, error: describeNetshFailure(res.out, 'Could not forget the network.') };
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
// Location consent) and no-adapter cases get a plain-language explanation with
// the underlying netsh hint appended so the user can see exactly what happened.
function describeNetshFailure(out: string, fallback: string): string {
  const reason = firstInformativeLine(out);
  const detail = reason ? ` Windows said: ${reason}` : '';
  if (isAccessDenied(1, out)) {
    const remedies: string[] = [];
    if (/requires elevation|run as administrator/i.test(out)) remedies.push('run the kiosk as an administrator');
    if (/location permission|turn on location|privacy-location/i.test(out))
      remedies.push('turn on Location services (Settings → Privacy & security → Location)');
    const remedy =
      remedies.length > 0
        ? `Windows is blocking Wi-Fi control — ${remedies.join(', or ')}`
        : 'Windows is blocking Wi-Fi control — run the kiosk as an administrator (or allow Location access)';
    return `${remedy}.${detail}`;
  }
  if (/no wireless|no interface|radio.*off|not available/i.test(out)) {
    return `No wireless adapter available.${detail}`;
  }
  return `${fallback}${detail}`;
}
