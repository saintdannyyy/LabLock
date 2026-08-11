import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { ScreenTimeStatus, UsageWindow } from '../shared/types';

// Per-profile daily screen time. One small JSON file per profile
// (<userData>/screen-time-<profileId>.json) recording TODAY's used seconds and
// any admin-granted override minutes. A 1s in-memory ticker accumulates while
// the profile is active; the file is written on a 15s cadence + on quit, so a
// power-cut costs at most 15s of usage. If the file's date is stale the record
// resets to a fresh day (a reboot the same day keeps the quota, which is what
// makes "re-banner on reboot until override" work).
const DIRTY_INTERVAL_MS = 15_000;

function todayKey(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

interface DayRecord {
  date: string; // YYYY-MM-DD
  usedSec: number;
  overrideSec: number; // admin-granted extra SECONDS today
}

let activeProfileId: string | null = null;
let dailyLimitMin = 0; // 0 = unlimited
let usageHours: UsageWindow[] = [];
let record: DayRecord = { date: todayKey(), usedSec: 0, overrideSec: 0 };
let paused = false;
let dirty = false;
let reachedFired = false; // fire the limit banner once per reached-state
let ticker: NodeJS.Timeout | null = null;
let persistTimer: NodeJS.Timeout | null = null;
let onChange: ((status: ScreenTimeStatus) => void) | null = null;
let onLimit: (() => void) | null = null;

function filePath(profileId: string): string {
  return path.join(app.getPath('userData'), `screen-time-${profileId}.json`);
}

function readRecord(profileId: string): DayRecord {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(profileId), 'utf-8')) as DayRecord;
    if (
      parsed &&
      typeof parsed.date === 'string' &&
      typeof parsed.usedSec === 'number' &&
      typeof parsed.overrideSec === 'number'
    ) {
      return parsed;
    }
  } catch {
    // no record yet
  }
  return { date: todayKey(), usedSec: 0, overrideSec: 0 };
}

function persist(): void {
  if (!activeProfileId || !dirty) return;
  try {
    const file = filePath(activeProfileId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(record, null, 2) + '\n', 'utf-8');
    dirty = false;
  } catch {
    // fire-and-forget: a failing stats write must never crash the kiosk
  }
}

// Start accumulating for a profile (re-attaching switches profile and re-reads
// that profile's record). Called on picker selection and after admin saves.
export function attachProfile(profileId: string, limitMin: number, hours: UsageWindow[]): void {
  detach();
  activeProfileId = profileId;
  dailyLimitMin = limitMin;
  usageHours = hours;
  record = readRecord(profileId);
  if (record.date !== todayKey()) {
    record = { date: todayKey(), usedSec: 0, overrideSec: 0 };
  }
  reachedFired = false;
  paused = false;
  dirty = true;
  ticker = setInterval(tick, 1000);
  persistTimer = setInterval(persist, DIRTY_INTERVAL_MS);
  tick();
}

export function detach(): void {
  persist();
  if (ticker) {
    clearInterval(ticker);
    ticker = null;
  }
  if (persistTimer) {
    clearInterval(persistTimer);
    persistTimer = null;
  }
  activeProfileId = null;
  // Clear any on-screen limit banner (e.g. when the profile picker opens): the
  // toolbar must never keep showing "limit reached" without an active profile.
  onChange?.({ usedSec: 0, limitSec: 0, limitReached: false, overrideSec: 0, inUsageWindow: true });
}

// Pause/resume while the admin console is open so admin time isn't counted as
// child screen time.
export function pause(): void {
  if (paused) return;
  persist();
  paused = true;
}

export function resume(): void {
  paused = false;
  tick();
}

export function setHandlers(handlers: { onChange?: (s: ScreenTimeStatus) => void; onLimit?: () => void }): void {
  onChange = handlers.onChange ?? null;
  onLimit = handlers.onLimit ?? null;
}

function timeToSec(hhmm: string): number {
  const parts = hhmm.split(':').map(Number);
  return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60;
}

function inAllowedWindow(): boolean {
  if (usageHours.length === 0) return true;
  const now = new Date();
  const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  for (const w of usageHours) {
    const start = timeToSec(w.start);
    const end = timeToSec(w.end);
    if (start <= end) {
      if (nowSec >= start && nowSec < end) return true;
    } else {
      // window wraps past midnight ("22:00" -> "02:00")
      if (nowSec >= start || nowSec < end) return true;
    }
  }
  return false;
}

function computeStatus(): ScreenTimeStatus {
  const limitSec = dailyLimitMin > 0 ? dailyLimitMin * 60 : 0;
  const usedSec = record.usedSec;
  const overrideSec = record.overrideSec;
  return {
    usedSec,
    limitSec,
    limitReached: limitSec > 0 && usedSec >= limitSec + overrideSec,
    overrideSec,
    inUsageWindow: inAllowedWindow(),
  };
}

export function getStatus(): ScreenTimeStatus {
  return computeStatus();
}

function tick(): void {
  if (!activeProfileId || paused) return;
  if (record.date !== todayKey()) {
    record = { date: todayKey(), usedSec: 0, overrideSec: 0 };
    reachedFired = false;
    dirty = true;
  }
  record.usedSec += 1;
  dirty = true;
  const status = computeStatus();
  onChange?.(status);
  if (status.limitReached && !reachedFired) {
    reachedFired = true;
    onLimit?.();
  }
}

// Admin grants extra time from the limit banner's password prompt. `minutes`
// is converted to seconds so `record.overrideSec` (and ScreenTimeStatus's
// overrideSec) stays consistent with usedSec/limitSec.
export function grantOverride(minutes: number): void {
  record.overrideSec += Math.max(0, Math.round(minutes * 60));
  reachedFired = false;
  dirty = true;
  persist();
  onChange?.(computeStatus());
}
