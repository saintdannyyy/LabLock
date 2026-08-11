import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type {
  Profile,
  ProfilesFile,
  WhitelistEntry,
  PlatformEntry,
  SaveResult,
} from '../shared/types';

// Per-profile + platform configuration lives in the WRITABLE per-user data dir
// (NOT next to the app under resources/, which Program Files installs can make
// read-only). One-time migration seeds a default profile from the old
// config/whitelist.json if one exists.
const PROFILES_FILE = 'profiles.json';

function profilesPath(): string {
  return path.join(app.getPath('userData'), PROFILES_FILE);
}

// The currently selected child profile. Scopes app grid, navigation guard,
// screen-time policy and activity attribution. null = no profile picked yet.
export let activeProfile: Profile | null = null;

export function getActiveProfile(): Profile | null {
  return activeProfile;
}

export function setActiveProfile(id: string | null): Profile | null {
  if (id === null) {
    activeProfile = null;
    return null;
  }
  const found = loadProfiles().profiles.find((p) => p.id === id) ?? null;
  activeProfile = found;
  return found;
}

// The web-only subset of a profile's platforms, shaped for the whitelist
// matchers (isUrlAllowed / isFrameUrlAllowed) and the toolbar tabs.
export function webApps(profile: Profile): WhitelistEntry[] {
  return profile.apps
    .filter((p): p is PlatformEntry & { url: string; kind: 'web' } => p.kind === 'web' && typeof p.url === 'string')
    .map((p) => ({
      name: p.name,
      url: p.url,
      icon: p.icon,
      allowedHosts: p.allowedHosts,
      embedHosts: p.embedHosts,
    }));
}

/**
 * Loads <userData>/profiles.json. On first run (no file) it migrates any old
 * config/whitelist.json sites into a default profile so an upgraded install
 * doesn't lose its app list. A file with zero profiles is seeded with an empty
 * default profile rather than failing -- the kiosk must always have at least
 * one profile to log into.
 */
export function loadProfiles(): ProfilesFile {
  const file = profilesPath();
  let parsed: unknown;

  if (fs.existsSync(file)) {
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (err) {
      throw new Error(`Profiles config at ${file} is not valid JSON: ${(err as Error).message}`);
    }
  } else {
    parsed = migrateFromWhitelistConfig();
  }

  const profiles = validateProfiles(parsed, `config at ${file}`).profiles;
  if (profiles.length === 0) {
    return { profiles: [defaultProfile([])] };
  }
  return { profiles };
}

// One-time migration: seed a default profile with the old whitelist's web
// sites. Best-effort -- a missing/broken old config just yields an empty app
// list (the admin console can rebuild it).
function migrateFromWhitelistConfig(): ProfilesFile {
  const apps: PlatformEntry[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { loadWhitelist } = require('./whitelist') as typeof import('./whitelist');
    const old = loadWhitelist();
    apps.push(
      ...old.sites.map((s) => ({
        id: `app-${s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Math.random().toString(36).slice(2, 7)}`,
        name: s.name,
        kind: 'web' as const,
        url: s.url,
        icon: s.icon,
        allowedHosts: s.allowedHosts,
        embedHosts: s.embedHosts,
      })),
    );
  } catch {
    // no legacy config to migrate
  }
  return { profiles: [defaultProfile(apps)] };
}

function defaultProfile(apps: PlatformEntry[]): Profile {
  return {
    id: 'default',
    name: 'My Workspace',
    avatarColor: '#4285f4',
    skinColor: '#0b57d0',
    dailyLimitMin: 0,
    usageHours: [],
    apps,
  };
}

export function defaultProfileFor(name: string): Profile {
  return {
    id: randomUUID(),
    name: name || 'My Workspace',
    avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
    skinColor: '#0b57d0',
    dailyLimitMin: 0,
    usageHours: [],
    apps: [],
  };
}

const AVATAR_COLORS = ['#4285f4', '#ea4335', '#fbbc05', '#34a853', '#f4511e', '#0097a7', '#7c4dff', '#00897b'];

/**
 * Validates and atomically writes profiles.json from the admin console.
 * Never allowed to leave a half-written file behind.
 */
export function saveProfiles(payload: unknown): SaveResult {
  const file = profilesPath();

  let validated: ProfilesFile;
  try {
    validated = validateProfiles(payload, 'save payload');
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  if (validated.profiles.length === 0) {
    return { ok: false, error: 'At least one profile is required.' };
  }

  const json = JSON.stringify(validated, null, 2) + '\n';
  const tmpPath = file + '.tmp';
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmpPath, json, 'utf-8');
    fs.renameSync(tmpPath, file);
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // best-effort temp cleanup
    }
    return { ok: false, error: `Failed to write profiles config: ${(err as Error).message}` };
  }

  return { ok: true, path: file };
}

// Single source of truth for profile/platform validation -- used both at load
// and save so the admin console can never write a file the kiosk would refuse.
export function validateProfiles(parsed: unknown, source: string): ProfilesFile {
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as Record<string, unknown>).profiles)) {
    throw new Error(`Profiles ${source} must be an object with a "profiles" array.`);
  }

  const raw = (parsed as { profiles: unknown[] }).profiles;
  const profiles = raw.map((entry, index) => validateProfile(entry, index));
  const ids = new Set(profiles.map((p) => p.id));
  if (ids.size !== profiles.length) {
    throw new Error(`Profiles ${source} has duplicate profile ids.`);
  }
  return { profiles };
}

function validateProfile(entry: unknown, index: number): Profile {
  if (typeof entry !== 'object' || entry === null) {
    throw new Error(`Profile #${index} must be an object.`);
  }
  const p = entry as Record<string, unknown>;

  if (typeof p.id !== 'string' || p.id.trim() === '') {
    throw new Error(`Profile #${index} is missing a valid "id".`);
  }
  if (typeof p.name !== 'string' || p.name.trim() === '') {
    throw new Error(`Profile #${index} is missing a valid "name".`);
  }
  // Local consts: TS resets property-access narrowing of the `p` record inside
  // nested closures (the .map callbacks below), which would break these types.
  const id: string = p.id;
  const name: string = p.name;

  const dailyLimitMin = typeof p.dailyLimitMin === 'number' && Number.isFinite(p.dailyLimitMin)
    ? Math.max(0, Math.trunc(p.dailyLimitMin))
    : 0;

  let usageHours: { start: string; end: string }[] = [];
  if (p.usageHours !== undefined) {
    if (!Array.isArray(p.usageHours)) {
      throw new Error(`Profile "${name}" "usageHours" must be an array.`);
    }
    usageHours = p.usageHours.map((w, wi) => {
      const raw = w as Record<string, unknown>;
      const start = raw?.start;
      const end = raw?.end;
      if (typeof start !== 'string' || typeof end !== 'string' || !validTime(start) || !validTime(end)) {
        throw new Error(`Profile "${name}" usage hour #${wi} must have "start" and "end" as HH:MM.`);
      }
      return { start, end };
    });
  }

  let apps: PlatformEntry[] = [];
  if (p.apps !== undefined) {
    if (!Array.isArray(p.apps)) {
      throw new Error(`Profile "${name}" "apps" must be an array.`);
    }
    apps = p.apps.map((a, ai) => validatePlatform(a, name, ai));
  }

  return {
    id,
    name,
    avatarColor: typeof p.avatarColor === 'string' ? p.avatarColor : '#4285f4',
    skinColor: typeof p.skinColor === 'string' ? p.skinColor : '#0b57d0',
    dailyLimitMin,
    usageHours,
    apps,
  };
}

function validatePlatform(entry: unknown, profileName: string, index: number): PlatformEntry {
  if (typeof entry !== 'object' || entry === null) {
    throw new Error(`Profile "${profileName}" app #${index} must be an object.`);
  }
  const e = entry as Record<string, unknown>;

  if (typeof e.id !== 'string' || e.id.trim() === '') {
    throw new Error(`Profile "${profileName}" app #${index} is missing a valid "id".`);
  }
  if (typeof e.name !== 'string' || e.name.trim() === '') {
    throw new Error(`Profile "${profileName}" app #${index} is missing a valid "name".`);
  }

  const kind = e.kind === 'native' ? 'native' : 'web';
  const base: PlatformEntry = {
    id: e.id,
    name: e.name,
    kind,
    icon: typeof e.icon === 'string' ? e.icon : undefined,
  };

  if (kind === 'native') {
    if (typeof e.exe !== 'string' || e.exe.trim() === '') {
      throw new Error(`Profile "${profileName}" native app #${index} ("${e.name}") is missing a valid "exe" path.`);
    }
    base.exe = e.exe;
    base.args = Array.isArray(e.args) ? e.args.filter((a): a is string => typeof a === 'string') : [];
    return base;
  }

  if (typeof e.url !== 'string') {
    throw new Error(`Profile "${profileName}" web app #${index} ("${e.name}") is missing a valid "url".`);
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(e.url);
  } catch {
    throw new Error(`Profile "${profileName}" web app #${index} ("${e.name}") has an unparsable "url": ${e.url}`);
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error(`Profile "${profileName}" web app #${index} ("${e.name}") "url" must be http:// or https://.`);
  }
  base.url = e.url;

  if (e.allowedHosts !== undefined) {
    if (!Array.isArray(e.allowedHosts) || !e.allowedHosts.every((h) => typeof h === 'string')) {
      throw new Error(`Profile "${profileName}" web app #${index} ("${e.name}") "allowedHosts" must be an array of strings.`);
    }
    for (const rule of e.allowedHosts as string[]) {
      if (!isValidHostRule(rule)) {
        throw new Error(`Profile "${profileName}" web app #${index} ("${e.name}") has a malformed "allowedHosts" rule: "${rule}".`);
      }
    }
    base.allowedHosts = e.allowedHosts as string[];
  }

  if (e.embedHosts !== undefined) {
    if (!Array.isArray(e.embedHosts) || !e.embedHosts.every((h) => typeof h === 'string')) {
      throw new Error(`Profile "${profileName}" web app #${index} ("${e.name}") "embedHosts" must be an array of strings.`);
    }
    for (const rule of e.embedHosts as string[]) {
      if (!isValidHostRule(rule)) {
        throw new Error(`Profile "${profileName}" web app #${index} ("${e.name}") has a malformed "embedHosts" rule: "${rule}".`);
      }
    }
    base.embedHosts = e.embedHosts as string[];
  }

  return base;
}

/**
 * Same rule as the whitelist matcher: bare hostname, optionally "*."-wildcarded.
 * Rejects schemes, ports, paths, queries and whitespace outright (fails closed)
 * so a rule like "https://web.toddleapp.com" or "j100coders.org/coder" can
 * never be stored -- such rules silently block every navigation.
 */
export function isValidHostRule(rule: string): boolean {
  if (rule.trim() === '') return false;
  if (/[/:?#\s]/.test(rule)) return false;
  if (rule.startsWith('*.')) {
    const base = rule.slice(2);
    return base !== '' && !base.includes('*') && !base.startsWith('.');
  }
  return !rule.includes('*');
}

function validTime(hhmm: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm);
}
