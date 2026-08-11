import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

// Per-profile, per-day platform usage. One JSON file per profile
// (<userData>/usage-<profileId>.json) mapping "YYYY-MM-DD" -> { platformId: sec }.
// Time is accumulated when a platform session ENDS (site left, app closed,
// profile switched, app quit), so a student hammering tabs mid-session can't
// bloat the counter; a crash mid-session loses at most that one session.
const RETAIN_DAYS = 90;

interface UsageFile {
  days: Record<string, Record<string, number>>;
}

let activeProfileId: string | null = null;
let activePlatformId: string | null = null;
let sessionStartedAt = 0;

function filePath(profileId: string): string {
  return path.join(app.getPath('userData'), `usage-${profileId}.json`);
}

function readFile(profileId: string): UsageFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(profileId), 'utf-8')) as UsageFile;
    if (parsed && typeof parsed.days === 'object' && parsed.days !== null) return parsed;
  } catch {
    // no record yet
  }
  return { days: {} };
}

function writeFile(profileId: string, file: UsageFile): void {
  const cutoff = Date.now() - RETAIN_DAYS * 86_400_000;
  const cutoffKey = new Date(cutoff).toISOString().slice(0, 10);
  for (const day of Object.keys(file.days)) {
    if (day < cutoffKey) delete file.days[day];
  }
  try {
    const filePath_ = filePath(profileId);
    fs.mkdirSync(path.dirname(filePath_), { recursive: true });
    const tmp = `${filePath_}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(file), 'utf-8');
    fs.renameSync(tmp, filePath_);
  } catch {
    // fire-and-forget: a failing usage write must never crash the kiosk
  }
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

// Move the accumulated session (if any) into the running profile's record.
function flushSession(): void {
  if (!activeProfileId || !activePlatformId) return;
  const elapsedSec = Math.max(1, Math.round((Date.now() - sessionStartedAt) / 1000));
  const file = readFile(activeProfileId);
  const day = file.days[todayKey()] ?? {};
  day[activePlatformId] = (day[activePlatformId] ?? 0) + elapsedSec;
  file.days[todayKey()] = day;
  writeFile(activeProfileId, file);
  activePlatformId = null;
  sessionStartedAt = 0;
}

// Switch the active usage record to a profile. Ends any in-flight session
// against the previous profile first.
export function attachProfile(profileId: string): void {
  if (activeProfileId === profileId) return;
  flushSession();
  activeProfileId = profileId;
}

// End tracking entirely (picker shown, app quitting).
export function detach(): void {
  flushSession();
  activeProfileId = null;
}

// A platform became the active surface (web tile opened or native app launched).
export function startTracking(platformId: string): void {
  if (activePlatformId === platformId) return;
  flushSession();
  activePlatformId = platformId;
  sessionStartedAt = Date.now();
}

// The active surface was left (home/back/picker/app exit).
export function stopTracking(): void {
  flushSession();
}

// Raw seconds per platform for one profile on one date.
export function getPlatformSeconds(profileId: string, date: string): Record<string, number> {
  const file = readFile(profileId);
  return file.days[date] ?? {};
}
