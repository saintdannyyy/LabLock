import 'dotenv/config';
import { app, dialog, BrowserWindow, Menu, ipcMain, powerMonitor, net } from 'electron';
import { loadProfiles, saveProfiles, setProfilePassword, getActiveProfile, seedDefaultProfilePassword } from './profiles';
import { createMainWindow, getWhitelistForRenderer, getPlatformsForRenderer, getProfilesForRenderer, authProfile, showPicker, launchApp, navigateToSite, goHome, goBack, shutdownComputer, restartComputer, refreshActiveProfile, notifyWhitelistRefreshed, notifyPlannerChanged, KIOSK, setAllowClose, setPanelOpen, sendToToolbar, onToolbarReady, getScreenTimeStatus, pauseScreenTimeForAdmin, resumeScreenTimeForAdmin, getUsageForAdmin, enforceUsageHours, broadcastTheme } from './window';
import { setHandlers as setScreenTimeHandlers } from './screen-time';
import { detach as detachUsage } from './usage';
import { loadPlanner, savePlanner, validatePlanner } from './planner';
import { requestReset, getPendingRequests, clearRequestForProfile, clearAllRequests } from './reset-requests';
import { registerIpcHandlers } from './ipc';
import { appendActivity, readActivity, clearActivity } from './history';
import { startInputHook, stopInputHook } from './input-hook';
import { getSystemStatus, setSystemVolume } from './system-status';
import { scanWifi, connectWifi, forgetWifi } from './wifi';
import { listInstalledApps, listInstalledAppIcons } from './apps';
import { getTheme, setTheme, subscribeTheme } from './settings';
import { preloadFile, rendererFile, watchdogExePath } from './paths';
import { IPC } from '../shared/types';
import { createServer } from 'net';
import { spawn } from 'child_process';
import type { SaveResult, ActivityPage, ActivityEvent, VolumeRequest, ProfilesFile, PlatformEntry, ScreenTimeStatus, UsageSnapshot, PlannerFile, WifiScanResult, WifiActionResult, WifiConnectRequest, InstalledApp, Theme, ResetRequest } from '../shared/types';

// electron-builder strips `productName` from the packaged package.json inside
// app.asar, leaving only the lowercase npm `name` ("hewstudio").
// Electron uses that name for the per-user data folder, so without this the
// installed app writes to %APPDATA%\hewstudio instead of
// %APPDATA%\HEWStudio. Pin the branded name early so
// app.getPath('userData') (activity log, profiles, session data) uses it.
app.setName('HEWStudio');

const ESCAPE_PIPE_NAME = 'lockdown-escape';
const ADMIN_PASSWORD = process.env.LOCKDOWN_ADMIN_PASSWORD || 'admin123'; // default for dev; override in production

let escapePipeServer: ReturnType<typeof createServer> | null = null;
let escapePromptWindow: BrowserWindow | null = null;

// Set only after a correct admin password. Every privileged IPC handler
// (whitelist save, activity read/clear) refuses to act without it, so a
// compromised non-admin renderer cannot write the whitelist or read history.
let adminAuthenticated = false;

function pushScreenTimeStatus(): void {
  sendToToolbar(IPC.SCREEN_TIME_EVENT, getScreenTimeStatus());
}

function logActivity(kind: ActivityEvent['kind'], detail: string, url?: string): void {
  appendActivity({ ts: new Date().toISOString(), kind, detail, url, profile: getActiveProfile()?.id });
}

// Human-readable audit of what an admin profiles save actually changed, so the
// activity log records additions/removals explicitly (a removal must never be
// invisible). Keyed by profileId:platformId so a rename + identical re-add is
// reported as remove + add rather than silently skipped.
function describePlatformChanges(prev: ProfilesFile, next: ProfilesFile): string {
  const key = (p: { id: string }, a: PlatformEntry): string => `${p.id}:${a.id}`;
  const before = new Map<string, { name: string; profile: string }>();
  for (const p of prev.profiles) {
    for (const a of p.apps) before.set(key(p, a), { name: a.name, profile: p.name });
  }
  const after = new Map<string, { name: string; profile: string }>();
  for (const p of next.profiles) {
    for (const a of p.apps) after.set(key(p, a), { name: a.name, profile: p.name });
  }

  const added: string[] = [];
  const removed: string[] = [];
  for (const [k, v] of after) {
    if (!before.has(k)) added.push(`${v.name} (${v.profile})`);
  }
  for (const [k, v] of before) {
    if (!after.has(k)) removed.push(`${v.name} (${v.profile})`);
  }

  const parts: string[] = [];
  if (added.length > 0) parts.push(`Added ${added.length}: ${added.join(', ')}`);
  if (removed.length > 0) parts.push(`Removed ${removed.length}: ${removed.join(', ')}`);
  if (parts.length === 0) parts.push(`Saved ${next.profiles.length} profile(s) without platform changes`);
  return parts.join(' · ');
}

function closeEscapeWindow(): void {
  if (escapePromptWindow) {
    escapePromptWindow.close();
    escapePromptWindow = null;
  }
}

function startEscapePipeServer(mainWindow: BrowserWindow): void {
  escapePipeServer = createServer((socket) => {
    let data = '';
    socket.on('data', (chunk) => {
      data += chunk.toString();
    });
    socket.on('end', () => {
      if (data.trim() === 'ESCAPE') {
        showAdminEscapeDialog(mainWindow);
      }
    });
  });

  escapePipeServer.on('error', (err) => {
    console.error('Escape pipe server error:', err);
  });

  // Retry once if pipe is in use (leftover from previous unclean shutdown)
  let attempts = 0;
  const tryListen = () => {
    escapePipeServer!.listen(`\\\\.\\pipe\\${ESCAPE_PIPE_NAME}`, () => {
      console.log(`Escape hatch pipe server listening on \\\\.\\pipe\\${ESCAPE_PIPE_NAME}`);
    });
  };
  escapePipeServer.once('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' && attempts === 0) {
      attempts++;
      // Try to connect and close the stale pipe, then retry
      const net = require('net');
      const client = net.createConnection(`\\\\.\\pipe\\${ESCAPE_PIPE_NAME}`, () => {
        client.destroy();
        setTimeout(tryListen, 100);
      });
      client.on('error', () => {
        // Pipe doesn't accept connections, force retry
        setTimeout(tryListen, 100);
      });
    }
  });
  tryListen();
}

function showAdminEscapeDialog(mainWindow: BrowserWindow): void {
  if (escapePromptWindow) return; // Prevent multiple dialogs

  escapePromptWindow = new BrowserWindow({
    width: 400,
    height: 340,
    parent: mainWindow,
    modal: true,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    // closable must stay true: with closable:false, win.close() becomes a no-op
    // and the dialog would never close when the admin confirms/cancels. Alt+F4
    // on the dialog is blocked by InputHook in production anyway, and this is a
    // frame-less window so there is no close button to click.
    closable: true,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: preloadFile('escape-preload.js'),
    },
  });

  // Cover the whole kiosk display so the escape page's dark scrim dims the
  // entire screen behind the dialog. A 400x340 box with the scrim only inside
  // it looked like a broken "background behind the modal" floating on the
  // bright kiosk.
  escapePromptWindow.setBounds(mainWindow.getBounds());

  escapePromptWindow.loadFile(rendererFile('escape', 'escape.html'));

  escapePromptWindow.once('ready-to-show', () => escapePromptWindow?.show());

  // Admin time is not child screen time: don't count the escape dialog / admin
  // console session against the profile's daily quota.
  pauseScreenTimeForAdmin();

  escapePromptWindow.on('closed', () => {
    escapePromptWindow = null;
    adminAuthenticated = false;
    resumeScreenTimeForAdmin();
  });

  // Listen for password result
  const channel = 'escape:password-result';
  const handler = (_evt: Electron.IpcMainEvent, enteredPassword: string) => {
    ipcMain.removeListener(channel, handler);
    if (enteredPassword === '__CANCEL__') {
      closeEscapeWindow();
      return;
    }
    if (enteredPassword === ADMIN_PASSWORD) {
      // Authenticated: keep the same full-screen dialog window open and morph
      // it into the admin console (whitelist manager + activity log) instead
      // of exiting. With shell replacement there is no explorer to exit to.
      logActivity('escape', 'Admin authenticated');
      adminAuthenticated = true;
      if (escapePromptWindow) {
        escapePromptWindow.loadFile(rendererFile('admin', 'admin.html'));
      }
    } else {
      logActivity('escape', 'Incorrect password attempt');
      closeEscapeWindow();
      dialog.showErrorBox('Incorrect Password', 'The password you entered is incorrect.');
    }
  };
  ipcMain.once(channel, handler);
}

function stopEscapePipeServer(): void {
  if (escapePipeServer) {
    escapePipeServer.close();
    escapePipeServer = null;
  }
}

app.whenReady().then(() => {
  logActivity('app-start', 'App started');

  // Strip the application menu entirely in kiosk/production builds -- no
  // File/Edit/View menu, no default accelerators (Ctrl+W, Alt+F4 via menu,
  // Ctrl+Shift+I, ...). In dev the menu is kept so DevTools stays reachable
  // while iterating.
  if (KIOSK) {
    Menu.setApplicationMenu(null);
  }

  try {
    loadProfiles();
    // Make the built-in "My Workspace" profile loggable with the admin
    // password until an admin sets its own password.
    seedDefaultProfilePassword(ADMIN_PASSWORD);
  } catch (err) {
    // Fail loud: never silently start with a broken profiles config.
    dialog.showErrorBox(
      'HEWStudio — Configuration Error',
      `The profiles configuration could not be loaded:\n\n${(err as Error).message}\n\n` +
        'The app will now exit. Fix the profiles.json config and restart.',
    );
    app.quit();
    return;
  }

  // No profile is auto-selected at boot: every account now requires a password,
  // so the kiosk always lands on the "who is using this?" picker.
  const mainWindow = createMainWindow();

  if (KIOSK) {
    const hookPid = startInputHook(mainWindow);
    startEscapePipeServer(mainWindow);

    // Spawn watchdog to monitor Electron + InputHook
    if (hookPid) {
      const watchdog = spawn(watchdogExePath(), [
        '--electron-pid', process.pid.toString(),
        '--hook-pid', hookPid.toString(),
        '--app-exe', process.execPath,
      ], { stdio: 'ignore', windowsHide: true });
      watchdog.unref(); // Don't keep the process alive for the watchdog
    }
  }

  registerIpcHandlers({
    getWhitelistForRenderer,
    getPlatformsForRenderer,
    getProfilesForRenderer,
    authProfile,
    showPicker,
    launchApp,
    getScreenTimeStatus,
    navigateToSite,
    goHome,
    goBack,
    shutdownComputer,
    restartComputer,
  });

  // UI theme (dark mode). The toolbar toggle sets it; main persists it and
  // pushes the new value to every app renderer (toolbar, content pages, loading
  // overlay, escape/admin windows) so the whole kiosk flips together.
  ipcMain.handle(IPC.THEME_GET, (): Theme => getTheme());
  ipcMain.handle(IPC.THEME_SET, (_event, theme: unknown): Theme => setTheme(theme));
  subscribeTheme((theme) => {
    broadcastTheme(theme);
    if (escapePromptWindow && !escapePromptWindow.isDestroyed()) {
      escapePromptWindow.webContents.send(IPC.THEME_CHANGED, theme);
    }
  });

  // Screen-time ticker callbacks. onChange streams every per-second status
  // update (used-time read-out) and re-checks the allowed usage hours so the
  // content pane routes to/from the restricted screen the moment a window
  // opens or closes.
  setScreenTimeHandlers({
    onChange: (status) => {
      enforceUsageHours(status.inUsageWindow);
      pushScreenTimeStatus();
    },
  });

  // Admin-console IPC (profiles save, activity log). Every handler is gated on
  // adminAuthenticated so only a correctly-authenticated escape window can
  // mutate profiles or read history. The window controls above are for the
  // toolbar/content views and stay ungated (they only affect navigation).
  ipcMain.handle(IPC.PROFILES_GET, (): ProfilesFile => {
    if (!adminAuthenticated) return { profiles: [] };
    return loadProfiles();
  });

  ipcMain.handle(IPC.PROFILES_SAVE, (_event, payload: unknown): SaveResult => {
    if (!adminAuthenticated) return { ok: false, error: 'Admin authentication required.' };
    const before = loadProfiles();
    const result = saveProfiles(payload);
    if (result.ok) {
      // Re-load what was actually written (single source of truth), swap it
      // into window.ts's live copies, and rebuild the toolbar tabs + home grid
      // so the running kiosk enforces the new app list immediately.
      const after = loadProfiles();
      refreshActiveProfile();
      notifyWhitelistRefreshed();
      logActivity('whitelist-change', `Profiles saved — ${describePlatformChanges(before, after)}`);
    }
    return result;
  });

  // "Forgot password" from the picker. Deliberately UNGATED: it only records a
  // request (profileId + name, no password material) for the admin to act on --
  // gating it would break the lockout-recovery path this feature exists for.
  ipcMain.on(IPC.PASSWORD_RESET_REQUEST, (_event, profileId: unknown) => {
    const id = typeof profileId === 'string' && profileId.trim() !== '' ? profileId.trim() : '';
    if (!id) return;
    const profile = loadProfiles().profiles.find((p) => p.id === id);
    requestReset(id, profile?.name ?? id);
    appendActivity({ ts: new Date().toISOString(), kind: 'reset-request', detail: `Password reset requested for "${profile?.name ?? id}"`, profile: id });
  });

  // Pending password-reset requests + granting a new profile password (admin
  // console). Both are admin-gated like the other console IPC.
  ipcMain.handle(IPC.RESET_REQUESTS_GET, (): ResetRequest[] => {
    if (!adminAuthenticated) return [];
    return getPendingRequests();
  });

  ipcMain.handle(IPC.RESET_REQUESTS_CLEAR, (_event, profileId: unknown) => {
    if (!adminAuthenticated) return { ok: false, error: 'Admin authentication required.' };
    if (typeof profileId === 'string' && profileId !== '') {
      clearRequestForProfile(profileId);
    } else {
      clearAllRequests();
    }
    return { ok: true };
  });

  ipcMain.handle(IPC.PROFILE_SET_PASSWORD, (_event, profileId: unknown, password: unknown): SaveResult => {
    if (!adminAuthenticated) return { ok: false, error: 'Admin authentication required.' };
    const id = typeof profileId === 'string' ? profileId : '';
    const pass = typeof password === 'string' ? password : '';
    const result = setProfilePassword(id, pass);
    if (result.ok) {
      const name = loadProfiles().profiles.find((p) => p.id === id)?.name ?? id;
      clearRequestForProfile(id);
      logActivity('password-reset', pass === '' ? `Password cleared for "${name}"` : `Password set/reset for "${name}"`);
      notifyWhitelistRefreshed();
    }
    return result;
  });

  // Installed programs (Start Menu) so the admin can grant a native platform by
  // picking it from a list instead of typing an exe path. Admin-gated: only the
  // authenticated console ever asks for the installed-app list.
  ipcMain.handle(IPC.INSTALLED_APPS_GET, (): Promise<InstalledApp[]> => {
    if (!adminAuthenticated) return Promise.resolve([]);
    return listInstalledApps();
  });

  // The icon batch runs on its own (disk-cached) IPC so the picker can show the
  // fast list first and stream the real logos in as they're extracted.
  ipcMain.handle(IPC.INSTALLED_APPS_ICONS_GET, (): Promise<Record<string, string>> => {
    if (!adminAuthenticated) return Promise.resolve({});
    return listInstalledAppIcons();
  });

  ipcMain.handle(IPC.ACTIVITY_GET, (_event, offset: number, limit: number, date?: unknown): ActivityPage => {
    if (!adminAuthenticated) return { total: 0, events: [] };
    const safeOffset = Math.max(0, Math.trunc(Number(offset)) || 0);
    const safeLimit = Math.max(1, Math.min(Math.trunc(Number(limit)) || 100, 500));
    const safeDate = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
    return readActivity(safeOffset, safeLimit, safeDate);
  });

  ipcMain.handle(IPC.ACTIVITY_CLEAR, () => {
    if (!adminAuthenticated) return { ok: false, error: 'Admin authentication required.' };
    clearActivity();
    logActivity('escape', 'History cleared by admin');
    return { ok: true };
  });

  ipcMain.handle(IPC.USAGE_GET, (): UsageSnapshot => {
    if (!adminAuthenticated) return { date: '', profiles: [] };
    return getUsageForAdmin();
  });

  // Per-profile planner (calendar / timetable / to-dos). Admin reads/writes are
  // password-gated; the child view reads only the ACTIVE profile's planner and
  // is deliberately ungated (read-only, no profileId is even accepted from the
  // renderer, so a compromised child page cannot read another profile's plan).
  ipcMain.handle(IPC.PLANNER_GET, (_event, profileId: unknown): PlannerFile => {
    if (!adminAuthenticated) return { events: [], timetable: [], todos: [] };
    const id = typeof profileId === 'string' ? profileId : '';
    if (!id) return { events: [], timetable: [], todos: [] };
    return loadPlanner(id);
  });

  ipcMain.handle(IPC.PLANNER_SAVE, (_event, profileId: unknown, payload: unknown): SaveResult => {
    if (!adminAuthenticated) return { ok: false, error: 'Admin authentication required.' };
    const id = typeof profileId === 'string' ? profileId : '';
    if (!id) return { ok: false, error: 'A profile id is required.' };
    const result = savePlanner(id, payload);
    if (result.ok) {
      logActivity('whitelist-change', 'Planner saved');
      notifyPlannerChanged();
    }
    return result;
  });

  ipcMain.handle(IPC.PLANNER_ACTIVE_GET, (): PlannerFile => {
    const active = getActiveProfile();
    if (!active) return { events: [], timetable: [], todos: [] };
    return loadPlanner(active.id);
  });

  // Child-side to-do edits (check off / add / remove). Ungated and deliberately
  // scoped to the ACTIVE profile: the renderer never sends a profileId, so a
  // compromised child page can only mutate the active child's own to-dos --
  // events/timetable are preserved from the on-disk planner, never touched.
  ipcMain.handle(IPC.PLANNER_TODOS_UPDATE, (_event, todos: unknown): SaveResult => {
    const active = getActiveProfile();
    if (!active) return { ok: false, error: 'No active profile.' };
    if (!Array.isArray(todos)) return { ok: false, error: 'todos must be an array.' };
    try {
      const current = loadPlanner(active.id);
      const validated = validatePlanner({ ...current, todos }, 'to-do update');
      return savePlanner(active.id, validated);
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  // Toolbar Wi-Fi panel (Phase 5). Ungated like the volume control: it only
  // works when the kiosk process has the rights netsh needs (elevation), and
  // every successful connect/forget is written to the activity log.
  ipcMain.handle(IPC.WIFI_SCAN, (): Promise<WifiScanResult> => scanWifi());
  ipcMain.handle(IPC.WIFI_CONNECT, (_event, req: unknown): Promise<WifiActionResult> => {
    const raw = (req ?? {}) as Partial<WifiConnectRequest>;
    const ssid = typeof raw.ssid === 'string' ? raw.ssid.trim() : '';
    if (!ssid) return Promise.resolve({ ok: false, error: 'A network name is required.' });
    const password = typeof raw.password === 'string' && raw.password.length > 0 ? raw.password : null;
    return connectWifi(ssid, password).then((result) => {
      if (result.ok) logActivity('wifi-connect', `Connected to Wi-Fi network "${ssid}"`);
      return result;
    });
  });
  ipcMain.handle(IPC.WIFI_FORGET, (_event, ssid: unknown): Promise<WifiActionResult> => {
    const name = typeof ssid === 'string' ? ssid.trim() : '';
    if (!name) return Promise.resolve({ ok: false, error: 'A network name is required.' });
    return forgetWifi(name).then((result) => {
      if (result.ok) logActivity('wifi-connect', `Forgot Wi-Fi network "${name}"`);
      return result;
    });
  });

  ipcMain.on(IPC.ADMIN_CLOSE, () => {
    // Done button: return to the kiosk (HEWStudio IS the shell in production),
    // and drop admin privileges so privileged IPC is gated again.
    adminAuthenticated = false;
    closeEscapeWindow();
  });

  // Control panel (Phase 4 status cluster). Status probing is ungated: it only
  // reads battery/network/system info. SET_VOLUME mutates the master volume,
  // which is equivalent to what the OS volume keys do, so it is also ungated.
  ipcMain.handle(IPC.GET_SYSTEM_STATUS, (_event, includeVolume: unknown) => getSystemStatus(includeVolume === true));
  ipcMain.handle(IPC.SET_VOLUME, (_event, req: unknown): ReturnType<typeof setSystemVolume> => {
    const raw = (req ?? {}) as Partial<VolumeRequest>;
    const percent = typeof raw.percent === 'number' && Number.isFinite(raw.percent) ? Math.max(0, Math.min(100, raw.percent)) : undefined;
    const muted = typeof raw.muted === 'boolean' ? raw.muted : undefined;
    return setSystemVolume({ percent, muted });
  });
  ipcMain.on(IPC.PANEL_RESIZE, (_event, open: unknown) => setPanelOpen(open === true));

  // System-status push (control-panel icons). The main process owns the cadence
  // and pushes snapshots over IPC -- the toolbar is a pure listener with no
  // renderer-side polling timer. Windows has no event stream for battery
  // percentage or SSID changes, so a 60s timer is the floor; real transitions
  // push immediately via the events below (AC/battery switch, wake-from-suspend,
  // and a lightweight net.isOnline() flip watcher).
  const STATUS_PUSH_MS = 60_000;
  let statusPushTimer: NodeJS.Timeout | null = null;
  let statusPushInFlight = false;
  const pushSystemStatus = async (force = false): Promise<void> => {
    if (statusPushInFlight) return; // coalesce; the 60s cadence keeps it fresh
    statusPushInFlight = true;
    try {
      const status = await getSystemStatus(false, force);
      sendToToolbar(IPC.SYSTEM_STATUS, status);
    } catch {
      // probe failures already degrade to "unknown" inside system-status.ts
    } finally {
      statusPushInFlight = false;
    }
  };

  onToolbarReady(() => {
    void pushSystemStatus(true); // seed first snapshot once the toolbar is up
    if (!statusPushTimer) {
      statusPushTimer = setInterval(() => void pushSystemStatus(), STATUS_PUSH_MS);
    }
  });
  // electron.d.ts v43 only types the macOS powerMonitor events, so register the
  // Windows events through the raw EventEmitter (same cast as query-session-end).
  (powerMonitor as NodeJS.EventEmitter).on('on-ac', () => void pushSystemStatus(true));
  (powerMonitor as NodeJS.EventEmitter).on('on-battery', () => void pushSystemStatus(true));
  (powerMonitor as NodeJS.EventEmitter).on('resume', () => void pushSystemStatus(true));
  // net has no connectivity events (only net.isOnline()), so watch the flip.
  let lastOnline = net.isOnline();
  const onlineWatcher = setInterval(() => {
    const online = net.isOnline();
    if (online !== lastOnline) {
      lastOnline = online;
      void pushSystemStatus(true);
    }
  }, 10_000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Windows is shutting down or logging off (start-menu shutdown, session end,
// reboot). Without this, the kiosk's close-prevention handler would swallow
// the close and hang the session. 'query-session-end' fires before the close,
// so we flag the close as allowed and let the shutdown proceed. This works on
// both Windows 10 and 11.
//
// Note: electron.d.ts (v43) declares 'query-session-end'/'session-end' outside
// the App interface's typed 'on' overloads even though they are real App events
// at runtime on Windows (see the Electron docs for app.on('query-session-end')).
(app as NodeJS.EventEmitter).on('query-session-end', () => {
  setAllowClose(true);
});

// Clean up the input hook on app quit
app.on('before-quit', () => {
  logActivity('app-quit', 'App quit');
  detachUsage(); // flush any in-flight platform session to its daily record
  stopInputHook();
  stopEscapePipeServer();
});
app.on('will-quit', () => {
  stopInputHook();
  stopEscapePipeServer();
});