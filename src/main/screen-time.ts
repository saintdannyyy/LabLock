import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { ScreenTimeStatus, UsageWindow } from '../shared/types';

// Per-profile usage-hours enforcement + a "used today" read-out. One small JSON
// file per profile (<userData>/screen-time-<profileId>.json) records TODAY's
// signed-in seconds for the control-panel row. A 1s in-memory ticker also
// re-checks the allowed usage windows every second so the content pane routes
// to/from the restricted screen the moment a window opens or closes. The file
// is written on a 15s cadence + on quit, so a power-cut costs at most 15s of
// read-out. If the file's date is stale the record resets to a fresh day.
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
}

let activeProfileId: string | null = null;
let usageHours: UsageWindow[] = [];
let record: DayRecord = { date: todayKey(), usedSec: 0 };
let paused = false;
let dirty = false;
let ticker: NodeJS.Timeout | null = null;
let persistTimer: NodeJS.Timeout | null = null;
let onChange: ((status: ScreenTimeStatus) => void) | null = null;

function filePath(profileId: string): string {
  return path.join(app.getPath('userData'), `screen-time-${profileId}.json`);
}

function readRecord(profileId: string): DayRecord {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(profileId), 'utf-8')) as DayRecord;
    if (parsed && typeof parsed.date === 'string' && typeof parsed.usedSec === 'number') {
      return parsed;
    }
  } catch {
    // no record yet
  }
  return { date: todayKey(), usedSec: 0 };
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

// Start monitoring for a profile (re-attaching switches profile and re-reads
// that profile's record). Called on picker selection and after admin saves.
export function attachProfile(profileId: string, hours: UsageWindow[]): void {
  detach();
  activeProfileId = profileId;
  usageHours = hours;
  record = readRecord(profileId);
  if (record.date !== todayKey()) {
    record = { date: todayKey(), usedSec: 0 };
  }
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
  // Clear any on-screen usage state (e.g. when the profile picker opens): the
  // toolbar must never keep showing "used" without an active profile.
  onChange?.({ usedSec: 0, inUsageWindow: true });
}

// Pause/resume while the admin console is open so admin time isn't counted as
// child sign-in time.
export function pause(): void {
  if (paused) return;
  persist();
  paused = true;
}

export function resume(): void {
  paused = false;
  tick();
}

export function setHandlers(handlers: { onChange?: (s: ScreenTimeStatus) => void }): void {
  onChange = handlers.onChange ?? null;
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
  return {
    usedSec: record.usedSec,
    inUsageWindow: inAllowedWindow(),
  };
}

export function getStatus(): ScreenTimeStatus {
  return computeStatus();
}

function tick(): void {
  if (!activeProfileId || paused) return;
  if (record.date !== todayKey()) {
    record = { date: todayKey(), usedSec: 0 };
    dirty = true;
  }
  record.usedSec += 1;
  dirty = true;
  onChange?.(computeStatus());
}
