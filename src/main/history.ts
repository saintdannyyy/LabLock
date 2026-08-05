import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { ActivityEvent, ActivityPage } from '../shared/types';

// Append-only JSONL activity log (one event object per line) living in the
// writable per-user data dir -- NOT next to the whitelist config, which in a
// packaged install sits under resources/ where Program Files installs may be
// read-only. app.getPath('userData') also follows the --user-data-dir override
// used in dev.
const HISTORY_FILE = 'history.jsonl';

function historyPath(): string {
  return path.join(app.getPath('userData'), HISTORY_FILE);
}

/**
 * Records one activity event. Deliberately fire-and-forget: a failing disk
 * write must never crash or throttle the kiosk. Writes are synchronous so an
 * event logged right before a `shutdown.exe /t 1` power-cycle or app quit is
 * actually on disk before the process dies.
 */
export function appendActivity(event: ActivityEvent): void {
  try {
    const file = historyPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(event) + '\n', 'utf-8');
  } catch (err) {
    console.error('Failed to append activity event:', err);
  }
}

/**
 * Returns one page of history, newest-first. `offset` is how many newest
 * events to skip (paging), `limit` is the page size. The full file is read so
 * `total` is exact and paging is stable.
 */
export function readActivity(offset: number, limit: number): ActivityPage {
  const all = readAllEvents();
  const end = all.length - offset;
  const start = Math.max(end - limit, 0);
  return {
    total: all.length,
    events: all.slice(start, end).reverse(),
  };
}

function readAllEvents(): ActivityEvent[] {
  let raw: string;
  try {
    raw = fs.readFileSync(historyPath(), 'utf-8');
  } catch {
    return [];
  }

  const events: ActivityEvent[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as ActivityEvent;
      if (parsed && typeof parsed.ts === 'string' && typeof parsed.kind === 'string') {
        events.push(parsed);
      }
    } catch {
      // Skip a corrupt line rather than losing the whole history.
    }
  }
  return events;
}

/** Wipes the entire activity log (admin action, password-gated at the IPC). */
export function clearActivity(): void {
  try {
    const file = historyPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '', 'utf-8');
  } catch (err) {
    console.error('Failed to clear activity history:', err);
  }
}
