// Control-panel status probing. Electron exposes no battery-percentage API and
// netsh's WLAN info requires elevation/location, so these fields come from
// OS-bundled PowerShell queries (Win32_Battery + Get-NetConnectionProfile +
// Get-NetAdapter), matching the project's "no native addons, use csc.exe / the
// OS toolchain" constraint. The volume probe uses the standard IMMDevice COM
// interfaces compiled at runtime via Add-Type (the same csc approach as
// InputHook.cs) because there is no built-in master-volume API either.
import { app } from 'electron';
import { execFile } from 'child_process';
import os from 'os';
import type { SystemStatus, VolumeRequest, VolumeStatus, BatteryState } from '../shared/types';

const POWERSHELL_BASE = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'] as const;

// Windows BatteryStatus codes (Win32_Battery): 1=discharging, 2=on AC,
// 3=fully charged, 6-9=charging states.
function mapBatteryState(status: number | null, percent: number | null): BatteryState {
  if (status === 1) return 'discharging';
  if (status === 3) return 'full';
  if (status === 2) return 'ac';
  if (status !== null && status >= 6 && status <= 9) return 'charging';
  if (percent === 100) return 'full';
  return 'unknown';
}

function runPowerShell(script: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      [...POWERSHELL_BASE, '-Command', script],
      { windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: timeoutMs },
      (err, stdout) => {
        if (err && !stdout) {
          reject(err);
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}

interface RawBatteryNetwork {
  battery?: { present?: boolean; percent?: number | null; status?: number | null };
  profiles?: Array<{ alias?: string; name?: string; conn?: string }>;
  adapters?: Array<{ alias?: string; media?: string; status?: string; speed?: string }>;
}

const DISCONNECTED_NETWORK = {
  connected: false,
  online: false,
  type: 'unknown' as const,
  name: null,
  linkSpeed: null,
};

function mapBattery(raw: RawBatteryNetwork): SystemStatus['battery'] {
  const b = raw.battery;
  if (!b || b.present !== true) return { present: false, percent: null, state: 'unknown' };
  const percent = typeof b.percent === 'number' ? Math.max(0, Math.min(100, b.percent)) : null;
  const status = typeof b.status === 'number' ? b.status : null;
  return { present: true, percent, state: mapBatteryState(status, percent) };
}

function mapNetwork(raw: RawBatteryNetwork): SystemStatus['network'] {
  const profiles = Array.isArray(raw.profiles) ? raw.profiles : [];
  const adapters = Array.isArray(raw.adapters) ? raw.adapters : [];
  // Prefer a profile that has Internet connectivity; fall back to any
  // connected profile (local-network / no traffic yet).
  const ranked = [...profiles].sort((a, b) => (a.conn === 'Internet' ? 0 : 1) - (b.conn === 'Internet' ? 0 : 1));
  const profile = ranked.find((p) => p?.name) || ranked[0];
  if (!profile) return DISCONNECTED_NETWORK;

  const conn = profile.conn ?? '';
  const connected = conn !== 'Disconnected' && conn !== '';
  if (!connected) return DISCONNECTED_NETWORK;

  const adapter = adapters.find((a) => a.alias === profile.alias);
  const media = adapter?.media ?? '';
  const type: SystemStatus['network']['type'] = /802\.11|wireless|wi-?fi/i.test(media)
    ? 'wifi'
    : /802\.3|ethernet/i.test(media)
      ? 'ethernet'
      : 'unknown';

  return {
    connected: true,
    online: conn === 'Internet',
    type,
    name: profile.name || null,
    linkSpeed: adapter?.status === 'Up' && adapter.speed ? adapter.speed : null,
  };
}

function mapBatteryNetwork(out: string): Pick<SystemStatus, 'battery' | 'network'> {
  const raw = JSON.parse(out) as RawBatteryNetwork;
  return { battery: mapBattery(raw), network: mapNetwork(raw) };
}

async function probeBatteryAndNetwork(): Promise<Pick<SystemStatus, 'battery' | 'network'>> {
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$b = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1',
    '$batt = if ($null -eq $b) { @{ present=$false; percent=$null; status=$null } } else { @{ present=$true; percent=[int]$b.EstimatedChargeRemaining; status=[int]$b.BatteryStatus } }',
    '$profiles = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue | ForEach-Object { @{ alias=$_.InterfaceAlias; name=$_.Name; conn=[string]$_.IPv4Connectivity } })',
    '$adapters = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | ForEach-Object { @{ alias=$_.Name; media=[string]$_.MediaType; status=[string]$_.Status; speed=[string]$_.LinkSpeed } })',
    '@{ battery=$batt; profiles=$profiles; adapters=$adapters } | ConvertTo-Json -Compress -Depth 5',
  ].join('\n');
  try {
    const out = await runPowerShell(script, 8000);
    return mapBatteryNetwork(out);
  } catch {
    return { battery: { present: false, percent: null, state: 'unknown' }, network: DISCONNECTED_NETWORK };
  }
}

// Master volume via the IMMDevice/IAudioEndpointVolume COM interfaces. All the
// COM work happens inside C# (compiled at runtime via Add-Type, the same csc
// approach as InputHook.cs) because PowerShell's COM late-binding cannot call
// IUnknown-only interface methods. Each invocation recompiles (~0.5-1s), so the
// toolbar only requests it when the control panel is open and sends volume
// changes on slider-release, not on every drag tick.
const AUDIO_CS = [
  'using System;',
  'using System.Runtime.InteropServices;',
  '',
  '[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]',
  'public class MMDeviceEnumeratorComObject { }',
  '',
  '[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
  'public interface IMMDeviceEnumerator {',
  '  int NotImpl1();',
  '  IMMDevice GetDefaultAudioEndpoint(int dataFlow, int role);',
  '}',
  '',
  '[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
  'public interface IMMDevice {',
  '  IAudioEndpointVolume Activate(Guid iid, int clsCtx, IntPtr activationParams);',
  '}',
  '',
  '[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
  'public interface IAudioEndpointVolume {',
  '  int RegisterControlChangeNotify(IntPtr p);',
  '  int UnregisterControlChangeNotify(IntPtr p);',
  '  int GetChannelCount(out uint count);',
  '  int SetMasterVolumeLevel(float level, ref Guid eventContext);',
  '  int SetMasterVolumeLevelScalar(float level, ref Guid eventContext);',
  '  int GetMasterVolumeLevel(out float level);',
  '  int GetMasterVolumeLevelScalar(out float level);',
  '  int SetChannelVolumeLevel(uint channel, float level, ref Guid eventContext);',
  '  int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid eventContext);',
  '  int GetChannelVolumeLevel(uint channel, out float level);',
  '  int GetChannelVolumeLevelScalar(uint channel, out float level);',
  '  int SetMute(bool isMuted, ref Guid eventContext);',
  '  int GetMute(out bool isMuted);',
  '}',
  '',
  'public static class LockdownAudio {',
  '  private static IAudioEndpointVolume Endpoint() {',
  '    var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();',
  '    var device = enumerator.GetDefaultAudioEndpoint(0, 0);',
  '    return device.Activate(typeof(IAudioEndpointVolume).GUID, 1, IntPtr.Zero);',
  '  }',
  '',
  '  public static string Get() {',
  '    var volume = Endpoint();',
  '    float level;',
  '    volume.GetMasterVolumeLevelScalar(out level);',
  '    bool muted;',
  '    volume.GetMute(out muted);',
  '    return "{\\"volume\\":" + (int)Math.Round(level * 100.0) + ",\\"muted\\":" + (muted ? "true" : "false") + "}";',
  '  }',
  '',
  '  public static string Set(int? percent, bool? muted) {',
  '    var volume = Endpoint();',
  '    var ctx = Guid.Empty;',
  '    if (percent.HasValue) volume.SetMasterVolumeLevelScalar((float)(percent.Value / 100.0), ref ctx);',
  '    if (muted.HasValue) volume.SetMute(muted.Value, ref ctx);',
  '    return Get();',
  '  }',
  '}',
].join('\n');

function buildAudioScript(percent?: number, muted?: boolean): string {
  let call: string;
  if (percent !== undefined && muted === undefined) call = `[LockdownAudio]::Set(${percent}, $null)`;
  else if (muted !== undefined && percent === undefined) call = `[LockdownAudio]::Set($null, ${muted ? '$true' : '$false'})`;
  else if (percent !== undefined && muted !== undefined) call = `[LockdownAudio]::Set(${percent}, ${muted ? '$true' : '$false'})`;
  else call = '[LockdownAudio]::Get()';
  return [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'try {',
    'Add-Type -TypeDefinition @\'',
    AUDIO_CS,
    "'@",
    `Write-Output (${call})`,
    '} catch {',
    "@{ error=[string]$_.Exception.Message } | ConvertTo-Json -Compress",
    '}',
  ].join('\n');
}

function mapVolume(out: string): VolumeStatus {
  try {
    const data = JSON.parse(out) as { volume?: unknown; muted?: unknown; error?: string };
    if (typeof data.volume === 'number') {
      const percent = Math.max(0, Math.min(100, Math.round(data.volume)));
      return { available: true, percent, muted: data.muted === true };
    }
    return { available: false, percent: null, muted: null };
  } catch {
    return { available: false, percent: null, muted: null };
  }
}

async function probeVolume(req: VolumeRequest): Promise<VolumeStatus> {
  const { percent, muted } = req;
  try {
    const out = await runPowerShell(buildAudioScript(percent, muted), 15000);
    return mapVolume(out);
  } catch {
    return { available: false, percent: null, muted: null };
  }
}

function systemInfo(): SystemStatus['system'] {
  let ipv4: string | null = null;
  // Prefer a routable address; skip APIPA (169.254.x.x) link-local addresses
  // that show up when DHCP fails.
  const candidates = Object.values(os.networkInterfaces());
  for (const addrs of candidates) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) {
        ipv4 = a.address;
        break;
      }
    }
    if (ipv4) break;
  }
  if (!ipv4) {
    for (const addrs of candidates) {
      for (const a of addrs ?? []) {
        if (a.family === 'IPv4' && !a.internal) {
          ipv4 = a.address;
          break;
        }
      }
      if (ipv4) break;
    }
  }
  return { hostname: os.hostname(), ipv4, version: app.getVersion(), uptimeSec: Math.floor(os.uptime()) };
}

const UNAVAILABLE_VOLUME: VolumeStatus = { available: false, percent: null, muted: null };

// The non-volume probes run on a 60s cadence (icons). The volume probe is slow,
// so it is only included on demand (panel open / volume change). A short cache
// stops overlapping fetches from spawning duplicate PowerShell processes.
interface StatusCache {
  ts: number;
  battery: SystemStatus['battery'];
  network: SystemStatus['network'];
  system: SystemStatus['system'];
}

let cache: StatusCache | null = null;

// `force` bypasses the short cache. Used by event-driven pushes (battery-status-
// changed, online/offline) so a real state change is reflected immediately even
// if a cached snapshot is only a few seconds old.
export async function getSystemStatus(includeVolume: boolean, force = false): Promise<SystemStatus> {
  let base = cache;
  if (force || !base || Date.now() - base.ts > 5000) {
    const batteryNetwork = await probeBatteryAndNetwork();
    base = { ts: Date.now(), battery: batteryNetwork.battery, network: batteryNetwork.network, system: systemInfo() };
    cache = base;
  }
  const volume = includeVolume ? await probeVolume({}) : UNAVAILABLE_VOLUME;
  return { ts: Date.now(), battery: base.battery, network: base.network, system: base.system, volume };
}

export async function setSystemVolume(req: VolumeRequest): Promise<VolumeStatus> {
  return probeVolume(req);
}
