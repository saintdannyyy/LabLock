// Installed-app enumeration (Phase 5). The admin console grants a profile
// access to a native program by PICKING it from a list, never by typing an exe
// path — these machines are used by non-technical staff. The list is built from
// the user-visible apps: every *.lnk under the all-users + current-user Start
// Menu Programs folders, resolved via WScript.Shell (OS-bundled COM, no native
// addons). Each shortcut yields a real launchable exe + its own arguments.
//
// The enumeration is split in two so the picker is usable in ~half a second:
//   1. listInstalledApps()  — the lnk walk only (name/exe/args). Fast (~0.5s).
//   2. listInstalledAppIcons() — extracts each app's icon (the slow part,
//      ~6s+ on a busy machine) ONCE per unique exe, then caches the result in
//      <userData>/installed-app-icons.json so later opens are instant. The
//      admin console renders the letter badges immediately and swaps in the
//      real logos as the batch arrives.
// Both are cached for the process lifetime. Each entry gets a stable id hashed
// from (exe + args) so usage tracking keeps attributing seconds to the same
// platform across sessions.
import { app } from 'electron';
import { execFile } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { InstalledApp } from '../shared/types';

const POWERSHELL_BASE = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'] as const;

function runPowerShell(script: string, timeoutMs = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      [...POWERSHELL_BASE, '-Command', script],
      { windowsHide: true, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: timeoutMs },
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

// Embed a Windows path inside a PowerShell single-quoted string literal
// (doubling any embedded single quote).
function singleQuote(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

// Programs that show up in Start Menu but are not things an admin would grant a
// child (uninstallers, setup wizards, shell/script hosts, Windows admin tools).
const BLOCKED_APPS_SCRIPT = [
  "'explorer.exe','cmd.exe','powershell.exe','powershell_ise.exe','pwsh.exe','wscript.exe','cscript.exe','mshta.exe'," +
    "'rundll32.exe','regedit.exe','control.exe','taskmgr.exe','msconfig.exe','msinfo32.exe','winver.exe','mmc.exe','optionalfeatures.exe'",
].join('');

// Phase 1 of the split: the Start-Menu walk ONLY (no icon extraction). This is
// deliberately free of System.Drawing so the admin picker gets its list in
// well under a second; icons arrive separately from listInstalledAppIcons().
const ENUM_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  "$dirs = @(",
  "  (Join-Path $env:ProgramData 'Microsoft\\Windows\\Start Menu\\Programs'),",
  "  (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs')",
  ')',
  `$blocked = @(${BLOCKED_APPS_SCRIPT})`,
  '$shell = New-Object -ComObject WScript.Shell',
  '$results = New-Object System.Collections.ArrayList',
  'foreach ($d in $dirs) {',
  '  if (-not (Test-Path $d)) { continue }',
  '  Get-ChildItem -Path $d -Filter *.lnk -Recurse -File | ForEach-Object {',
  '    $target = ""',
  '    $argsText = ""',
  '    try {',
  '      $sc = $shell.CreateShortcut($_.FullName)',
  '      $target = [string]$sc.TargetPath',
  '      $argsText = [string]$sc.Arguments',
  '    } catch { return }',
  '    if ([string]::IsNullOrWhiteSpace($target)) { return }',
  '    if (-not $target.TrimEnd().ToLowerInvariant().EndsWith(".exe")) { return }',
  '    $name = $_.BaseName',
  '    if ([string]::IsNullOrWhiteSpace($name)) { return }',
  '    $target = $target.Trim()',
  '    $lower = $target.ToLowerInvariant()',
  '    $file = [System.IO.Path]::GetFileName($lower)',
  '    if ($blocked -contains $file) { return }',
  '    if ($file -like "unins*.exe" -or $file -like "uninst*.exe" -or $file -eq "setup.exe" -or $file -eq "install.exe") { return }',
  '    if ($lower -like "*\\windowsapps\\*") { return }',
  '    [void]$results.Add([PSCustomObject]@{',
  '      name = $name',
  '      exe = $target',
  '      args = $argsText',
  '    })',
  '  }',
  '}',
  '$seen = @{}',
  '$unique = New-Object System.Collections.ArrayList',
  'foreach ($r in $results) {',
  '  $key = ($r.exe + "|" + $r.args).ToLowerInvariant()',
  '  if ($seen.ContainsKey($key)) { continue }',
  '  $seen[$key] = $true',
  '  [void]$unique.Add($r)',
  '}',
  'ConvertTo-Json -InputObject @($unique | Sort-Object name) -Compress',
].join('\n');

// Phase 2 of the split: icon extraction for the unique exe paths produced by
// phase 1. The paths are passed in via a temp JSON file (argv length limits /
// quoting make a command-line array unreliable). Returns [{ exe, icon }].
function iconsScript(exesFile: string): string {
  const file = singleQuote(exesFile);
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'Add-Type -AssemblyName System.Drawing',
    'function Get-AppIconDataUrl([string]$exePath) {',
    '  try {',
    '    $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($exePath)',
    '    if ($null -eq $icon) { return "" }',
    '    try {',
    '      $bmp = $icon.ToBitmap()',
    '      $ms = New-Object System.IO.MemoryStream',
    '      $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)',
    '      $bytes = $ms.ToArray()',
    '      $ms.Dispose()',
    '      $bmp.Dispose()',
    '      $icon.Dispose()',
    '      if ($bytes.Length -gt 0) { return "data:image/png;base64," + [Convert]::ToBase64String($bytes) }',
    '    } catch {',
    '      try { $icon.Dispose() } catch {}',
    '    }',
    '  } catch {}',
    '  return ""',
    '}',
    '$out = New-Object System.Collections.ArrayList',
    // PS 5.1 does not unroll arrays piped out of ConvertFrom-Json; assign first.
    '$data = Get-Content -Raw ' + file + ' | ConvertFrom-Json',
    '$exes = @($data)',
    'foreach ($exe in $exes) {',
    '  if ([string]::IsNullOrWhiteSpace($exe)) { continue }',
    '  [void]$out.Add([PSCustomObject]@{ exe = $exe; icon = Get-AppIconDataUrl $exe })',
    '}',
    'ConvertTo-Json -InputObject @($out) -Compress',
  ].join('\n');
}

interface RawShortcut {
  name?: unknown;
  exe?: unknown;
  args?: unknown;
  icon?: unknown;
}

let cached: InstalledApp[] | null = null;
let cachedIcons: Map<string, string> | null = null;

const ICONS_CACHE_FILE = 'installed-app-icons.json';

function iconsCachePath(): string {
  return path.join(app.getPath('userData'), ICONS_CACHE_FILE);
}

// Phase 1: the fast list (no icons). Cached in memory for the process lifetime.
export async function listInstalledApps(): Promise<InstalledApp[]> {
  if (cached) return cached;

  let raw: RawShortcut[] = [];
  try {
    const out = await runPowerShell(ENUM_SCRIPT);
    const parsed: unknown = JSON.parse(out);
    if (Array.isArray(parsed)) raw = parsed as RawShortcut[];
  } catch {
    cached = [];
    return cached;
  }

  cached = raw.map(normalizeShortcut).filter((a): a is InstalledApp => a !== null);
  return cached;
}

// Phase 2: real logos for the apps in the list. Icon extraction is the slow
// part of enumeration (~6s+), so the result is cached to disk (icons only —
// the app list itself is deliberately NOT cached across sessions so newly
// installed programs show up). Falls back to letter badges when extraction
// fails; never throws.
export async function listInstalledAppIcons(): Promise<Record<string, string>> {
  if (cachedIcons) return Object.fromEntries(cachedIcons);

  const disk = readIconsCache();
  if (disk) {
    cachedIcons = disk;
    return Object.fromEntries(disk);
  }

  const apps = await listInstalledApps();
  const exes = [...new Set(apps.map((a) => a.exe))].filter((e) => e.trim() !== '');
  const map = new Map<string, string>();
  if (exes.length > 0) {
    const tmp = path.join(os.tmpdir(), `lockdown-exes-${process.pid}-${Date.now()}.json`);
    try {
      fs.writeFileSync(tmp, JSON.stringify(exes), 'utf8');
      const out = await runPowerShell(iconsScript(tmp), 60000);
      const parsed: unknown = JSON.parse(out);
      if (Array.isArray(parsed)) {
        for (const row of parsed as { exe?: unknown; icon?: unknown }[]) {
          if (typeof row.exe === 'string' && typeof row.icon === 'string' && row.icon.startsWith('data:image/png;base64,')) {
            map.set(row.exe.toLowerCase(), row.icon);
          }
        }
      }
    } catch {
      // extraction failure leaves letter badges; never crash the console
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  cachedIcons = map;
  if (map.size > 0) writeIconsCache(map);
  return Object.fromEntries(map);
}

function readIconsCache(): Map<string, string> | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(iconsCachePath(), 'utf8')) as Record<string, unknown>;
    const map = new Map<string, string>();
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && value.startsWith('data:image/png;base64,')) map.set(key, value);
    }
    return map.size > 0 ? map : null;
  } catch {
    return null;
  }
}

function writeIconsCache(map: Map<string, string>): void {
  try {
    const file = iconsCachePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(map)), 'utf8');
    fs.renameSync(tmp, file);
  } catch {
    // non-fatal: the cache just won't survive the next launch
  }
}

// In-memory only (tests / scratchpad). Resetting lets a later call re-enumerate.
export function resetInstalledAppsCache(): void {
  cached = null;
  cachedIcons = null;
}

function normalizeShortcut(raw: RawShortcut): InstalledApp | null {
  const exe = typeof raw.exe === 'string' ? raw.exe.trim() : '';
  if (!exe) return null;
  const name =
    (typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : null) ??
    path.basename(exe).replace(/\.exe$/i, '');
  const args = splitArgs(typeof raw.args === 'string' ? raw.args : '');
  const icon = typeof raw.icon === 'string' && raw.icon.startsWith('data:image/png;base64,') ? raw.icon : undefined;
  const app: InstalledApp = { id: stableAppId(exe, args), name, exe, args: args.length > 0 ? args : undefined };
  if (icon) app.icon = icon;
  return app;
}

// Windows command-line tokenization that honours double quotes ("C:\Program
// Files\App\app.exe" stays one token) so shortcut Arguments survive intact.
function splitArgs(line: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}

function stableAppId(exe: string, args: string[]): string {
  const key = `${exe.toLowerCase()}|${args.join(' ').toLowerCase()}`;
  return 'app-' + createHash('sha1').update(key).digest('hex').slice(0, 12);
}
