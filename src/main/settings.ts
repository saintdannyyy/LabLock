// Persisted app preferences (<userData>/settings.json). Currently just the UI
// theme (dark mode); kept as a small JSON object so future prefs slot in
// without churn. The value is owned here (single source of truth) and pushed to
// every renderer on change so all pages flip together.
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import type { Theme } from '../shared/types';

interface SettingsFile {
  theme: Theme;
}

// Lazy-loaded: app.getPath('userData') is only valid after `app.setName(...)`
// ran (import order), so the file is read on first access rather than at module
// load.
let cachedTheme: Theme | null = null;
const subscribers = new Set<(theme: Theme) => void>();

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readSettings(): Theme {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<SettingsFile>;
    if (parsed.theme === 'light' || parsed.theme === 'dark') return parsed.theme;
  } catch {
    // missing / corrupt settings.json -> light default
  }
  return 'light';
}

function current(): Theme {
  if (cachedTheme === null) cachedTheme = readSettings();
  return cachedTheme;
}

function writeSettings(theme: Theme): void {
  try {
    const file = settingsPath();
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ theme }, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  } catch {
    // Non-fatal: the preference just won't survive the next launch.
  }
}

export function getTheme(): Theme {
  return current();
}

export function setTheme(theme: unknown): Theme {
  const next: Theme = theme === 'dark' ? 'dark' : 'light';
  if (next === current()) return next;
  cachedTheme = next;
  writeSettings(next);
  for (const cb of subscribers) cb(next);
  return next;
}

// Main subscribes so it can broadcast THEME_CHANGED to every renderer.
export function subscribeTheme(cb: (theme: Theme) => void): void {
  subscribers.add(cb);
}
