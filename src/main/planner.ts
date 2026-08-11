import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { PlannerFile, PlannerEvent, PlannerTodo, SaveResult } from '../shared/types';

// Per-child planner (calendar events, weekly timetable, to-dos). One JSON file
// per profile at <userData>/planner-<profileId>.json. Stored in the writable
// per-user data dir (NOT next to the app under resources/, which Program Files
// installs can make read-only).
function plannerPath(profileId: string): string {
  return path.join(app.getPath('userData'), `planner-${profileId}.json`);
}

// Loading is deliberately tolerant: a missing/broken file yields an empty plan
// rather than failing the kiosk (the planner is an optional aid, never a boot
// dependency). Strictness lives in validatePlanner (save path).
export function loadPlanner(profileId: string): PlannerFile {
  const file = plannerPath(profileId);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return emptyPlanner();
  }
  try {
    return validatePlanner(parsed, `planner for profile ${profileId}`);
  } catch {
    return emptyPlanner();
  }
}

function emptyPlanner(): PlannerFile {
  return { events: [], timetable: [], todos: [] };
}

/**
 * Validates and atomically writes a profile's planner from the admin console.
 * Never allowed to leave a half-written file behind.
 */
export function savePlanner(profileId: string, payload: unknown): SaveResult {
  if (typeof profileId !== 'string' || profileId.trim() === '') {
    return { ok: false, error: 'A profile id is required.' };
  }

  let validated: PlannerFile;
  try {
    validated = validatePlanner(payload, 'save payload');
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  const file = plannerPath(profileId);
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
    return { ok: false, error: `Failed to write planner config: ${(err as Error).message}` };
  }

  return { ok: true, path: file };
}

// Single source of truth for planner validation -- used at both load and save
// so the admin console can never write a file the kiosk would choke on.
export function validatePlanner(parsed: unknown, source: string): PlannerFile {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`Planner ${source} must be an object.`);
  }
  const p = parsed as Record<string, unknown>;

  let events: PlannerEvent[] = [];
  if (p.events !== undefined) {
    if (!Array.isArray(p.events)) throw new Error(`Planner ${source} "events" must be an array.`);
    events = p.events.map((raw, i) => {
      const e = (raw ?? {}) as Record<string, unknown>;
      if (typeof e.id !== 'string' || e.id.trim() === '') {
        throw new Error(`Planner ${source} event #${i} is missing a valid "id".`);
      }
      if (typeof e.title !== 'string' || e.title.trim() === '') {
        throw new Error(`Planner ${source} event #${i} is missing a valid "title".`);
      }
      if (typeof e.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) {
        throw new Error(`Planner ${source} event #${i} ("${e.title}") must have a "date" as YYYY-MM-DD.`);
      }
      return { id: e.id, date: e.date, title: e.title.trim() };
    });
  }

  let timetable: PlannerFile['timetable'] = [];
  if (p.timetable !== undefined) {
    if (!Array.isArray(p.timetable)) throw new Error(`Planner ${source} "timetable" must be an array.`);
    timetable = p.timetable.map((raw, i) => {
      const t = (raw ?? {}) as Record<string, unknown>;
      const day = normalizeDay(t.day);
      if (!day) throw new Error(`Planner ${source} timetable row #${i} has an invalid "day" (use Mon..Sun).`);
      if (typeof t.period !== 'string' || t.period.trim() === '') {
        throw new Error(`Planner ${source} timetable row #${i} is missing a "period".`);
      }
      if (typeof t.subject !== 'string' || t.subject.trim() === '') {
        throw new Error(`Planner ${source} timetable row #${i} is missing a "subject".`);
      }
      return { day, period: t.period.trim(), subject: t.subject.trim() };
    });
  }

  let todos: PlannerTodo[] = [];
  if (p.todos !== undefined) {
    if (!Array.isArray(p.todos)) throw new Error(`Planner ${source} "todos" must be an array.`);
    todos = p.todos.map((raw, i) => {
      const t = (raw ?? {}) as Record<string, unknown>;
      if (typeof t.id !== 'string' || t.id.trim() === '') {
        throw new Error(`Planner ${source} to-do #${i} is missing a valid "id".`);
      }
      if (typeof t.text !== 'string' || t.text.trim() === '') {
        throw new Error(`Planner ${source} to-do #${i} is missing a valid "text".`);
      }
      const hasDate = t.date !== undefined && t.date !== null && t.date !== '';
      if (hasDate && (typeof t.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(t.date))) {
        throw new Error(`Planner ${source} to-do #${i} ("${t.text}") has an invalid "date" (use YYYY-MM-DD).`);
      }
      return {
        id: t.id,
        text: t.text.trim(),
        done: t.done === true,
        ...(hasDate ? { date: t.date as string } : {}),
      };
    });
  }

  return { events, timetable, todos };
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

function normalizeDay(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const cap = trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
  const exact = DAYS.find((d) => d === cap);
  if (exact) return exact;
  // Accept full day names too (Monday -> Mon).
  const short = cap.slice(0, 3);
  return DAYS.find((d) => d === short) ?? null;
}
