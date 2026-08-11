// Admin console (window uses escape-preload.js, which exposes window.adminAPI
// via contextBridge). Loaded as a plain browser script over file://, so no
// import/export -- tsc would emit a CommonJS wrapper that throws. Types are
// declared structurally (mirroring src/shared/types.ts). Wrapped in an IIFE so
// top-level identifiers don't collide with the other global-script renderers.
(() => {
  const api = window.adminAPI;

  type PlatformEntry = {
    id: string;
    name: string;
    icon?: string;
    kind: 'web' | 'native';
    url?: string;
    allowedHosts?: string[];
    embedHosts?: string[];
    exe?: string;
    args?: string[];
  };

  type Profile = {
    id: string;
    name: string;
    avatarColor: string;
    skinColor: string;
    dailyLimitMin: number;
    usageHours: { start: string; end: string }[];
    apps: PlatformEntry[];
  };

  type ProfilesFile = { profiles: Profile[] };

  type ActivityEvent = {
    ts: string;
    kind: string;
    url?: string;
    detail: string;
    profile?: string;
  };

  type UsageEntry = {
    id: string;
    name: string;
    kind: 'web' | 'native';
    seconds: number;
  };

  type UsageSnapshot = {
    date: string;
    profiles: {
      id: string;
      name: string;
      avatarColor: string;
      totalSec: number;
      entries: UsageEntry[];
    }[];
  };

  type InstalledApp = {
    id: string;
    name: string;
    exe: string;
    args?: string[];
    icon?: string;
  };

  const tabSites = document.getElementById('tab-sites') as HTMLElement | null;
  const tabUsage = document.getElementById('tab-usage') as HTMLElement | null;
  const tabActivity = document.getElementById('tab-activity') as HTMLElement | null;
  const tabBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('.admin-tab'));
  const usageProfileSelect = document.getElementById('usage-profile-select') as HTMLSelectElement | null;
  const usageDateEl = document.getElementById('usage-date') as HTMLElement | null;
  const usageList = document.getElementById('usage-list') as HTMLElement | null;
  const profileSelect = document.getElementById('profile-select') as HTMLSelectElement | null;
  const addProfileBtn = document.getElementById('add-profile-btn') as HTMLButtonElement | null;
  const editProfileBtn = document.getElementById('edit-profile-btn') as HTMLButtonElement | null;
  const deleteProfileBtn = document.getElementById('delete-profile-btn') as HTMLButtonElement | null;
  const sitesList = document.getElementById('sites-list') as HTMLElement | null;
  const addSiteBtn = document.getElementById('add-site-btn') as HTMLButtonElement | null;
  const saveBtn = document.getElementById('save-btn') as HTMLButtonElement | null;
  const discardBtn = document.getElementById('discard-btn') as HTMLButtonElement | null;
  const sitesStatus = document.getElementById('sites-status') as HTMLElement | null;
  const activityList = document.getElementById('activity-list') as HTMLElement | null;
  const searchInput = document.getElementById('activity-search') as HTMLInputElement | null;
  const filterSelect = document.getElementById('activity-filter') as HTMLSelectElement | null;
  const clearHistoryBtn = document.getElementById('clear-history-btn') as HTMLButtonElement | null;
  const loadMoreBtn = document.getElementById('load-more-btn') as HTMLButtonElement | null;
  const dayPrevBtn = document.getElementById('day-prev-btn') as HTMLButtonElement | null;
  const dayNextBtn = document.getElementById('day-next-btn') as HTMLButtonElement | null;
  const dayLabel = document.getElementById('day-label') as HTMLElement | null;
  const dayTodayBtn = document.getElementById('day-today-btn') as HTMLButtonElement | null;

  const modal = document.getElementById('edit-modal') as HTMLElement | null;
  const editForm = document.getElementById('edit-form') as HTMLFormElement | null;
  const editTitle = document.getElementById('edit-title') as HTMLElement | null;
  const fName = document.getElementById('edit-name') as HTMLInputElement | null;
  const fKindWeb = document.getElementById('edit-kind-web') as HTMLInputElement | null;
  const fKindNative = document.getElementById('edit-kind-native') as HTMLInputElement | null;
  const fUrl = document.getElementById('edit-url') as HTMLInputElement | null;
  const fHosts = document.getElementById('edit-hosts') as HTMLTextAreaElement | null;
  const fEmbedHosts = document.getElementById('edit-embed-hosts') as HTMLTextAreaElement | null;
  const fIcon = document.getElementById('edit-icon') as HTMLInputElement | null;
  const fAppsSearch = document.getElementById('apps-search') as HTMLInputElement | null;
  const appsListEl = document.getElementById('apps-list') as HTMLElement | null;
  const appsHint = document.getElementById('apps-hint') as HTMLElement | null;
  const editError = document.getElementById('edit-error') as HTMLElement | null;
  const modalCancelBtn = document.getElementById('modal-cancel-btn') as HTMLButtonElement | null;

  const profileModal = document.getElementById('profile-modal') as HTMLElement | null;
  const profileForm = document.getElementById('profile-form') as HTMLFormElement | null;
  const profileModalTitle = document.getElementById('profile-modal-title') as HTMLElement | null;
  const fProfileName = document.getElementById('profile-name-input') as HTMLInputElement | null;
  const fProfileColor = document.getElementById('profile-color-input') as HTMLInputElement | null;
  const fProfileLimit = document.getElementById('profile-limit-input') as HTMLInputElement | null;
  const usageHoursEditor = document.getElementById('usage-hours-editor') as HTMLElement | null;
  const addHourBtn = document.getElementById('add-hour-btn') as HTMLButtonElement | null;
  const profileError = document.getElementById('profile-error') as HTMLElement | null;
  const profileModalCancelBtn = document.getElementById('profile-modal-cancel-btn') as HTMLButtonElement | null;

  const tabPlanner = document.getElementById('tab-planner') as HTMLElement | null;
  const plannerProfileSelect = document.getElementById('planner-profile-select') as HTMLSelectElement | null;
  const plannerStatus = document.getElementById('planner-status') as HTMLElement | null;
  const plannerEventsList = document.getElementById('planner-events-list') as HTMLElement | null;
  const plannerEventDate = document.getElementById('planner-event-date') as HTMLInputElement | null;
  const plannerEventTitle = document.getElementById('planner-event-title') as HTMLInputElement | null;
  const plannerEventAdd = document.getElementById('planner-event-add') as HTMLButtonElement | null;
  const plannerTimetableEl = document.getElementById('planner-timetable') as HTMLElement | null;
  const plannerTodoInput = document.getElementById('planner-todo-input') as HTMLInputElement | null;
  const plannerTodosList = document.getElementById('planner-todos-list') as HTMLElement | null;
  const plannerTodoAdd = document.getElementById('planner-todo-add') as HTMLButtonElement | null;
  const plannerSaveBtn = document.getElementById('planner-save-btn') as HTMLButtonElement | null;

  let profiles: Profile[] = [];
  let editingProfileId: string | null = null;
  let editingIndex = -1;
  let editingProfileMode: 'add' | 'edit' = 'add';
  let editingUsageHours: { start: string; end: string }[] = [];

  // Installed programs for the native-platform picker. The LIST loads fast
  // (start-menu walk) and icons stream in after; checkbox state lives here in a
  // Set (NOT the DOM) so typing in the search box — which re-renders the list —
  // never clears what's already checked.
  let installedApps: InstalledApp[] | null = null;
  let appsLoading = false;
  let selectedAppKeys = new Set<string>(); // app.id of the checked programs
  let pendingPreselectExe: string | null = null; // auto-checked once the list arrives
  let appsSearch = '';

  type PlannerEventItem = { id: string; date: string; title: string };
  type PlannerTodoItem = { id: string; text: string; done: boolean; date?: string };
  let planner: { events: PlannerEventItem[]; timetable: { day: string; period: string; subject: string }[]; todos: PlannerTodoItem[] } = {
    events: [],
    timetable: [],
    todos: [],
  };
  let plannerProfileId: string | null = null;

  let activityOffset = 0;
  const ACTIVITY_PAGE = 100;
  let allActivity: ActivityEvent[] = [];

  let usageSnapshot: UsageSnapshot | null = null;

  function localDateKey(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function todayKey(): string {
    return localDateKey(new Date());
  }

  let selectedDate: string = todayKey();

  function shiftDate(days: number): string {
    const d = new Date(`${selectedDate}T12:00:00`);
    d.setDate(d.getDate() + days);
    return localDateKey(d);
  }

  function renderDayLabel(): void {
    if (dayLabel) dayLabel.textContent = selectedDate === todayKey() ? 'Today' : selectedDate;
    if (dayNextBtn) dayNextBtn.disabled = selectedDate >= todayKey();
  }

  dayPrevBtn?.addEventListener('click', () => {
    selectedDate = shiftDate(-1);
    renderDayLabel();
    loadActivityPage(true).catch(() => {});
  });
  dayNextBtn?.addEventListener('click', () => {
    selectedDate = shiftDate(1);
    renderDayLabel();
    loadActivityPage(true).catch(() => {});
  });
  dayTodayBtn?.addEventListener('click', () => {
    selectedDate = todayKey();
    renderDayLabel();
    loadActivityPage(true).catch(() => {});
  });

  function activeProfile(): Profile | null {
    return profiles.find((p) => p.id === editingProfileId) ?? null;
  }

  // ---------- Tabs ----------

  function switchTab(name: string): void {
    tabBtns.forEach((b) => b.classList.toggle('is-active', b.dataset.tab === name));
    if (tabSites) tabSites.hidden = name !== 'sites';
    if (tabUsage) tabUsage.hidden = name !== 'usage';
    if (tabPlanner) tabPlanner.hidden = name !== 'planner';
    if (tabActivity) tabActivity.hidden = name !== 'activity';
    if (name === 'usage') loadUsage().catch(() => {});
    if (name === 'planner') loadPlannerData().catch(() => {});
  }
  tabBtns.forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab || 'sites')));

  // ---------- Shared helpers ----------

  function setStatus(el: HTMLElement | null, message: string, type: 'info' | 'success' | 'error' = 'info'): void {
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('is-success', type === 'success');
    el.classList.toggle('is-error', type === 'error');
  }

  function faviconUrl(siteUrl: string): string {
    try {
      const host = new URL(siteUrl).hostname;
      return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
    } catch {
      return '';
    }
  }

  // Icon for a platform card: web sites use the favicon service; native
  // programs use the icon extracted from their exe (a data URL set when the app
  // was granted); anything else falls back to a colored letter.
  function makePlatformIcon(name: string, kind: string, url: string | undefined, icon?: string): HTMLElement {
    if (icon) {
      const img = document.createElement('img');
      img.className = 'site-favicon';
      img.alt = '';
      img.src = icon;
      img.onerror = () => {
        const letter = document.createElement('span');
        letter.className = 'site-favicon-letter';
        letter.textContent = (name.trim()[0] || '?').toUpperCase();
        img.replaceWith(letter);
      };
      return img;
    }
    if (kind === 'web' && url) {
      const img = document.createElement('img');
      img.className = 'site-favicon';
      img.alt = '';
      img.src = faviconUrl(url);
      img.onerror = () => {
        const letter = document.createElement('span');
        letter.className = 'site-favicon-letter';
        letter.textContent = (name.trim()[0] || '?').toUpperCase();
        img.replaceWith(letter);
      };
      return img;
    }
    const letter = document.createElement('span');
    letter.className = 'site-favicon-letter';
    letter.textContent = (name.trim()[0] || '?').toUpperCase();
    return letter;
  }

  function makeAppIcon(name: string, icon?: string): HTMLElement {
    if (icon) {
      const img = document.createElement('img');
      img.className = 'apps-item-icon';
      img.alt = '';
      img.src = icon;
      img.onerror = () => {
        img.replaceWith(makeAppIcon(name));
      };
      return img;
    }
    const letter = document.createElement('span');
    letter.className = 'apps-item-icon apps-item-icon-letter';
    letter.textContent = (name.trim()[0] || '?').toUpperCase();
    return letter;
  }

  // ---------- Profile management ----------

  function renderProfileSelect(): void {
    if (!profileSelect) return;
    profileSelect.replaceChildren();
    for (const profile of profiles) {
      const opt = document.createElement('option');
      opt.value = profile.id;
      opt.textContent = profile.name;
      profileSelect.appendChild(opt);
    }
    if (editingProfileId && profiles.some((p) => p.id === editingProfileId)) {
      profileSelect.value = editingProfileId;
    } else {
      editingProfileId = profiles[0]?.id ?? null;
      profileSelect.value = editingProfileId ?? '';
    }
    if (deleteProfileBtn) deleteProfileBtn.disabled = profiles.length <= 1;

    // Planner tab follows the same profile list but keeps its own selection.
    if (plannerProfileSelect) {
      const prev = plannerProfileSelect.value;
      plannerProfileSelect.replaceChildren();
      for (const profile of profiles) {
        const opt = document.createElement('option');
        opt.value = profile.id;
        opt.textContent = profile.name;
        plannerProfileSelect.appendChild(opt);
      }
      if (profiles.some((p) => p.id === prev)) {
        plannerProfileSelect.value = prev;
      } else {
        plannerProfileSelect.value = profiles[0]?.id ?? '';
      }
      plannerProfileId = plannerProfileSelect.value || null;
    }
  }

  function renderUsageHoursEditor(): void {
    if (!usageHoursEditor) return;
    usageHoursEditor.replaceChildren();
    editingUsageHours.forEach((window_, index) => {
      const row = document.createElement('div');
      row.className = 'hour-row';

      const start = document.createElement('input');
      start.type = 'time';
      start.className = 'hour-input';
      start.value = window_.start;
      start.setAttribute('aria-label', `Window ${index + 1} start time`);
      start.addEventListener('change', () => {
        editingUsageHours[index] = { ...editingUsageHours[index], start: start.value };
      });

      const sep = document.createElement('span');
      sep.className = 'hour-sep';
      sep.textContent = 'to';

      const end = document.createElement('input');
      end.type = 'time';
      end.className = 'hour-input';
      end.value = window_.end;
      end.setAttribute('aria-label', `Window ${index + 1} end time`);
      end.addEventListener('change', () => {
        editingUsageHours[index] = { ...editingUsageHours[index], end: end.value };
      });

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'admin-btn admin-btn-sm admin-btn-danger';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => {
        editingUsageHours.splice(index, 1);
        renderUsageHoursEditor();
      });

      row.appendChild(start);
      row.appendChild(sep);
      row.appendChild(end);
      row.appendChild(remove);
      usageHoursEditor.appendChild(row);
    });
    if (editingUsageHours.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'hour-empty';
      empty.textContent = 'No windows set — the workspace is available at any time.';
      usageHoursEditor.appendChild(empty);
    }
  }

  addHourBtn?.addEventListener('click', () => {
    editingUsageHours.push({ start: '08:00', end: '14:00' });
    renderUsageHoursEditor();
  });

  function openProfileModal(mode: 'add' | 'edit'): void {
    editingProfileMode = mode;
    if (profileModalTitle) profileModalTitle.textContent = mode === 'add' ? 'Add profile' : 'Edit profile';
    if (profileError) profileError.textContent = '';
    const profile = mode === 'edit' ? activeProfile() : null;
    if (fProfileName) fProfileName.value = profile?.name ?? '';
    if (fProfileColor) fProfileColor.value = profile?.avatarColor ?? '#4285f4';
    if (fProfileLimit) fProfileLimit.value = String(profile?.dailyLimitMin ?? 0);
    editingUsageHours = profile ? profile.usageHours.map((w) => ({ ...w })) : [];
    renderUsageHoursEditor();
    if (profileModal) profileModal.hidden = false;
    fProfileName?.focus();
  }

  profileForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = (fProfileName?.value ?? '').trim();
    if (!name) {
      if (profileError) profileError.textContent = 'Name is required.';
      return;
    }
    const color = fProfileColor?.value || '#4285f4';
    const dailyLimitMin = Math.max(0, Math.trunc(Number(fProfileLimit?.value) || 0));

    const usageHours: { start: string; end: string }[] = [];
    for (const w of editingUsageHours) {
      const start = (w.start || '').trim();
      const end = (w.end || '').trim();
      if (!start && !end) continue; // untouched placeholder row
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end)) {
        if (profileError) profileError.textContent = 'Each usage window needs both a start and an end time (HH:MM).';
        return;
      }
      usageHours.push({ start, end });
    }

    if (editingProfileMode === 'add') {
      profiles.push({
        id: 'p-' + Math.random().toString(36).slice(2, 10),
        name,
        avatarColor: color,
        skinColor: color,
        dailyLimitMin,
        usageHours,
        apps: [],
      });
    } else if (activeProfile()) {
      const profile = activeProfile()!;
      profile.name = name;
      profile.avatarColor = color;
      profile.skinColor = color;
      profile.dailyLimitMin = dailyLimitMin;
      profile.usageHours = usageHours;
    }
    renderProfileSelect();
    renderPlatforms();
    if (profileModal) profileModal.hidden = true;
  });

  profileModalCancelBtn?.addEventListener('click', () => {
    if (profileModal) profileModal.hidden = true;
  });
  profileModal?.addEventListener('click', (e) => {
    if (e.target === profileModal) profileModal.hidden = true;
  });

  addProfileBtn?.addEventListener('click', () => openProfileModal('add'));
  editProfileBtn?.addEventListener('click', () => openProfileModal('edit'));
  deleteProfileBtn?.addEventListener('click', () => {
    const profile = activeProfile();
    if (!profile) return;
    if (!window.confirm(`Delete profile "${profile.name}" and all its platforms? This cannot be undone.`)) return;
    profiles = profiles.filter((p) => p.id !== profile.id);
    editingProfileId = null;
    renderProfileSelect();
    renderPlatforms();
  });
  profileSelect?.addEventListener('change', () => {
    editingProfileId = profileSelect.value || null;
    renderPlatforms();
  });

  // ---------- Platforms ----------

  function renderPlatforms(): void {
    if (!sitesList) return;
    const profile = activeProfile();
    sitesList.replaceChildren();
    if (!profile) {
      const empty = document.createElement('li');
      empty.className = 'activity-empty';
      empty.textContent = 'Add a profile to start configuring platforms.';
      sitesList.appendChild(empty);
      return;
    }
    if (profile.apps.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'activity-empty';
      empty.textContent = 'No platforms configured. Add one to get started.';
      sitesList.appendChild(empty);
      return;
    }
    profile.apps.forEach((platform, index) => {
      const li = document.createElement('li');
      li.className = 'site-card';

      li.appendChild(makePlatformIcon(platform.name, platform.kind, platform.url, platform.icon));

      const main = document.createElement('div');
      main.className = 'site-main';

      const nameRow = document.createElement('div');
      nameRow.className = 'site-name-row';
      const name = document.createElement('span');
      name.className = 'site-name';
      name.textContent = platform.name;
      nameRow.appendChild(name);
      const kind = document.createElement('span');
      kind.className = `platform-kind kind-${platform.kind}`;
      kind.textContent = platform.kind === 'web' ? 'Web' : 'Program';
      nameRow.appendChild(kind);
      main.appendChild(nameRow);

      const url = document.createElement('div');
      url.className = 'site-url';
      url.textContent = platform.kind === 'web' ? (platform.url ?? '') : (platform.exe ?? '');
      main.appendChild(url);

      if (platform.kind === 'web' && platform.allowedHosts && platform.allowedHosts.length > 0) {
        const hosts = document.createElement('div');
        hosts.className = 'site-hosts';
        for (const host of platform.allowedHosts) {
          const chip = document.createElement('span');
          chip.className = 'host-chip';
          chip.textContent = host;
          hosts.appendChild(chip);
        }
        main.appendChild(hosts);
      }

      const actions = document.createElement('div');
      actions.className = 'site-actions';
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'site-action';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => openEdit(index));
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'site-action site-action-remove';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        if (!window.confirm(`Remove platform "${platform.name}" from ${activeProfile()?.name ?? ''}?`)) return;
        profile.apps.splice(index, 1);
        renderPlatforms();
      });
      actions.appendChild(editBtn);
      actions.appendChild(removeBtn);

      li.appendChild(main);
      li.appendChild(actions);
      sitesList.appendChild(li);
    });
  }

  function syncKindFields(kind: 'web' | 'native'): void {
    const webFields = document.querySelectorAll<HTMLElement>('.web-only');
    const nativeFields = document.querySelectorAll<HTMLElement>('.native-only');
    webFields.forEach((el) => { el.hidden = kind !== 'web'; });
    nativeFields.forEach((el) => { el.hidden = kind !== 'native'; });
  }

  fKindWeb?.addEventListener('change', () => {
    syncKindFields('web');
    if (editError) editError.textContent = '';
  });
  fKindNative?.addEventListener('change', () => {
    syncKindFields('native');
    if (editError) editError.textContent = '';
    if (!installedApps) void loadInstalledApps();
  });

  async function loadInstalledApps(): Promise<void> {
    const getInstalledApps = api.getInstalledApps;
    if (!getInstalledApps) return;
    if (installedApps) {
      renderAppsPicker();
      return;
    }
    appsLoading = true;
    renderAppsPicker();
    try {
      const apps = await getInstalledApps();
      installedApps = Array.isArray(apps) ? apps : [];
    } catch {
      installedApps = [];
    }
    appsLoading = false;
    if (installedApps.length > 0) {
      seedSelectionFromExe(installedApps);
      void streamAppIcons();
    }
    renderAppsPicker();
  }

  // The picker list loads fast; real logos stream in afterwards so the admin
  // can start choosing before the slow extraction finishes. Rendered in place.
  async function streamAppIcons(): Promise<void> {
    const getInstalledAppIcons = api.getInstalledAppIcons;
    if (!getInstalledAppIcons) return;
    let icons: Record<string, string>;
    try {
      icons = (await getInstalledAppIcons()) ?? {};
    } catch {
      icons = {};
    }
    const apps = installedApps ?? [];
    for (const app of apps) {
      if (icons[app.exe.toLowerCase()] && app.icon !== icons[app.exe.toLowerCase()]) {
        app.icon = icons[app.exe.toLowerCase()];
      }
    }
    const cells = appsListEl?.querySelectorAll<HTMLElement>('[data-app-icon]');
    if (!cells) return;
    for (const cell of cells) {
      const app = apps[Number(cell.dataset.appIcon)];
      if (!app || !app.icon) continue;
      cell.replaceWith(makeAppIcon(app.name, app.icon));
    }
  }

  // Searchable, multi-select installed-apps list. Checked state always comes
  // from `selectedAppKeys` (NOT the DOM), so re-rendering for search keeps it.
  function renderAppsPicker(): void {
    if (!appsListEl) return;
    appsListEl.replaceChildren();
    const apps = installedApps ?? [];

    if (appsLoading) {
      const loading = document.createElement('div');
      loading.className = 'apps-picker-empty apps-picker-loading';
      loading.textContent = 'Loading installed programs…';
      appsListEl.appendChild(loading);
      if (appsHint) appsHint.textContent = '';
      return;
    }
    if (apps.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'apps-picker-empty';
      empty.textContent = 'No installed programs found.';
      appsListEl.appendChild(empty);
      if (appsHint) appsHint.textContent = '';
      return;
    }

    const q = appsSearch.trim().toLowerCase();
    const shown = q === '' ? apps : apps.filter((a) => a.name.toLowerCase().includes(q) || a.exe.toLowerCase().includes(q));
    if (shown.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'apps-picker-empty';
      empty.textContent = 'No programs match your search.';
      appsListEl.appendChild(empty);
      if (appsHint) appsHint.textContent = '';
      return;
    }

    let checkedCount = 0;
    for (const app of shown) {
      const index = apps.indexOf(app);
      const label = document.createElement('label');
      label.className = 'apps-item';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.appKey = app.id;
      cb.checked = selectedAppKeys.has(app.id);
      if (cb.checked) checkedCount++;
      const iconCell = document.createElement('span');
      iconCell.dataset.appIcon = String(index);
      iconCell.appendChild(makeAppIcon(app.name, app.icon));
      label.appendChild(cb);
      label.appendChild(iconCell);
      const body = document.createElement('span');
      body.className = 'apps-item-body';
      const name = document.createElement('span');
      name.className = 'apps-item-name';
      name.textContent = app.name;
      const exe = document.createElement('span');
      exe.className = 'apps-item-exe';
      exe.textContent = app.exe;
      body.appendChild(name);
      body.appendChild(exe);
      label.appendChild(body);
      appsListEl.appendChild(label);
    }

    updateAppsHint(shown.length, checkedCount);
  }

  function updateAppsHint(shownCount: number, checkedCount: number): void {
    if (!appsHint) return;
    const parts = [`${shownCount} program${shownCount === 1 ? '' : 's'}`];
    if (checkedCount > 0) parts.push(`${checkedCount} selected`);
    appsHint.textContent = parts.join(' · ');
  }

  fAppsSearch?.addEventListener('input', () => {
    appsSearch = fAppsSearch.value ?? '';
    renderAppsPicker();
  });

  appsListEl?.addEventListener('change', (e) => {
    const cb = e.target as HTMLInputElement | null;
    if (!cb?.dataset.appKey) return;
    const id = cb.dataset.appKey;
    if (cb.checked) selectedAppKeys.add(id);
    else selectedAppKeys.delete(id);
    updateAppsHint(installedApps?.length ?? 0, selectedAppKeys.size);
    if (editError) editError.textContent = '';
  });

  function openEdit(index: number): void {
    const profile = activeProfile();
    if (!profile) return;
    editingIndex = index;
    if (editTitle) editTitle.textContent = index >= 0 ? 'Edit platform' : 'Add platform';
    if (editError) editError.textContent = '';
    const platform = index >= 0 ? profile.apps[index] : undefined;
    const kind = platform?.kind ?? 'web';
    if (fName) fName.value = platform?.name ?? '';
    if (fKindWeb) fKindWeb.checked = kind === 'web';
    if (fKindNative) fKindNative.checked = kind === 'native';
    if (fUrl) fUrl.value = platform?.url ?? '';
    if (fHosts) fHosts.value = (platform?.allowedHosts ?? []).join('\n');
    if (fEmbedHosts) fEmbedHosts.value = (platform?.embedHosts ?? []).join('\n');
    if (fIcon) {
      // Auto-extracted native logos are data URLs; keep them out of the manual
      // field so admins only see the field when they actually want to override.
      const icon = platform?.icon;
      fIcon.value = icon && !icon.startsWith('data:image/png;base64,') ? icon : '';
    }
    if (fAppsSearch) {
      fAppsSearch.value = '';
      appsSearch = '';
    }
    syncKindFields(kind);
    if (kind === 'native') {
      // Pre-check the app(s) matching the edited platform's exe; the selection
      // Set is seeded so the checkbox survives the list (re)rendering.
      pendingPreselectExe = platform?.exe ? platform.exe.toLowerCase() : null;
      selectedAppKeys = new Set();
      if (installedApps) {
        seedSelectionFromExe(installedApps);
        renderAppsPicker();
      } else {
        void loadInstalledApps();
      }
    }
    if (modal) modal.hidden = false;
    if (kind === 'web') fName?.focus();
    else fAppsSearch?.focus();
  }

  function seedSelectionFromExe(apps: InstalledApp[]): void {
    if (!pendingPreselectExe) return;
    for (const app of apps) {
      if (app.exe.toLowerCase() === pendingPreselectExe) selectedAppKeys.add(app.id);
    }
  }

  function closeModal(): void {
    if (modal) modal.hidden = true;
    selectedAppKeys = new Set();
    pendingPreselectExe = null;
  }

  editForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const profile = activeProfile();
    if (!profile) return;

    const kind = fKindNative?.checked ? 'native' : 'web';
    const icon = (fIcon?.value ?? '').trim() || undefined;

    if (kind === 'native') {
      // Multi-select from the installed-apps list: no exe paths are ever typed.
      // Selections come from the Set (survives search re-renders), resolved to
      // InstalledApp[] in list order.
      const apps = installedApps ?? [];
      const selected: InstalledApp[] = [];
      for (const app of apps) {
        if (selectedAppKeys.has(app.id)) selected.push(app);
      }
      if (selected.length === 0) {
        if (editError) editError.textContent = 'Select at least one installed program.';
        return;
      }
      const existing = editingIndex >= 0 ? profile.apps[editingIndex] : undefined;
      const entries: PlatformEntry[] = selected.map((app, i) => {
        const entry: PlatformEntry = {
          id: i === 0 && existing ? existing.id : 'app-' + Math.random().toString(36).slice(2, 10),
          name: app.name,
          kind: 'native',
          exe: app.exe,
        };
        if (app.args && app.args.length > 0) entry.args = app.args;
        // An explicit icon in the field overrides; otherwise use the real icon
        // extracted from the app's exe, then the renderer's letter badge.
        if (icon) entry.icon = icon;
        else if (app.icon) entry.icon = app.icon;
        return entry;
      });
      if (editingIndex >= 0 && editingIndex < profile.apps.length) {
        profile.apps.splice(editingIndex, 1, ...entries);
      } else {
        profile.apps.push(...entries);
      }
      renderPlatforms();
      closeModal();
      return;
    }

    if (!fName) return;
    const name = fName.value.trim();
    if (!name) {
      if (editError) editError.textContent = 'Name is required.';
      return;
    }

    const id = profile.apps[editingIndex]?.id ?? 'app-' + Math.random().toString(36).slice(2, 10);

    const entry: PlatformEntry = { id, name, kind };
    if (icon) entry.icon = icon;

    const url = (fUrl?.value ?? '').trim();
    if (!url) {
      if (editError) editError.textContent = 'URL is required for web apps.';
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      if (editError) editError.textContent = 'URL must be a valid absolute http(s) address.';
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      if (editError) editError.textContent = 'URL must be http:// or https://.';
      return;
    }
    entry.url = url;
    const allowedHosts = (fHosts?.value ?? '')
      .split(/[\n,]/)
      .map((h) => h.trim())
      .filter((h) => h !== '');
    if (allowedHosts.length > 0) entry.allowedHosts = allowedHosts;
    const embedHosts = (fEmbedHosts?.value ?? '')
      .split(/[\n,]/)
      .map((h) => h.trim())
      .filter((h) => h !== '');
    if (embedHosts.length > 0) entry.embedHosts = embedHosts;

    if (editingIndex >= 0 && editingIndex < profile.apps.length) {
      profile.apps[editingIndex] = entry;
    } else {
      profile.apps.push(entry);
    }
    renderPlatforms();
    closeModal();
  });

  modalCancelBtn?.addEventListener('click', closeModal);
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  addSiteBtn?.addEventListener('click', () => openEdit(-1));

  saveBtn?.addEventListener('click', async () => {
    if (!saveBtn || !sitesStatus) return;
    if (profiles.length === 0) {
      setStatus(sitesStatus, 'At least one profile is required.', 'error');
      return;
    }
    saveBtn.disabled = true;
    setStatus(sitesStatus, 'Saving…');
    try {
      const result = await api.saveProfiles({ profiles });
      if (result.ok) {
        setStatus(sitesStatus, `Saved ${profiles.length} profile(s). Changes applied live.`, 'success');
      } else {
        setStatus(sitesStatus, result.error || 'Save failed.', 'error');
      }
    } catch {
      setStatus(sitesStatus, 'Save failed.', 'error');
    } finally {
      saveBtn.disabled = false;
    }
  });

  discardBtn?.addEventListener('click', () => api.close());

  // ---------- Usage ----------

  function formatDuration(totalSec: number): string {
    const s = Math.max(0, Math.round(totalSec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m`;
    return `${sec}s`;
  }

  async function loadUsage(): Promise<void> {
    if (!usageList) return;
    try {
      usageSnapshot = await api.getUsage();
    } catch {
      usageList.replaceChildren();
      const empty = document.createElement('li');
      empty.className = 'activity-empty';
      empty.textContent = 'Failed to load usage.';
      usageList.appendChild(empty);
      return;
    }
    renderUsage();
  }

  function renderUsage(): void {
    if (!usageList) return;
    const snapshot = usageSnapshot;
    if (!snapshot || snapshot.profiles.length === 0) {
      usageList.replaceChildren();
      const empty = document.createElement('li');
      empty.className = 'activity-empty';
      empty.textContent = 'No usage recorded yet.';
      usageList.appendChild(empty);
      return;
    }

    if (usageProfileSelect) {
      const prev = usageProfileSelect.value;
      usageProfileSelect.replaceChildren();
      for (const p of snapshot.profiles) {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        usageProfileSelect.appendChild(opt);
      }
      usageProfileSelect.value = snapshot.profiles.some((p) => p.id === prev) ? prev : snapshot.profiles[0].id;
    }
    if (usageDateEl) usageDateEl.textContent = `Usage for ${snapshot.date}`;

    const profile = snapshot.profiles.find((p) => p.id === usageProfileSelect?.value) ?? snapshot.profiles[0];
    if (!profile) return;

    usageList.replaceChildren();
    const header = document.createElement('li');
    header.className = 'usage-header';
    header.textContent = `${profile.name} — ${formatDuration(profile.totalSec)} total today`;
    usageList.appendChild(header);

    if (profile.entries.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'activity-empty';
      empty.textContent = 'No platform usage recorded for this profile today.';
      usageList.appendChild(empty);
      return;
    }

    const maxSec = Math.max(profile.entries[0].seconds, 1);
    for (const entry of profile.entries) {
      const li = document.createElement('li');
      li.className = 'usage-row';

      const name = document.createElement('span');
      name.className = 'usage-name';
      name.textContent = entry.name;

      const kind = document.createElement('span');
      kind.className = `platform-kind kind-${entry.kind}`;
      kind.textContent = entry.kind === 'web' ? 'Web' : 'Program';

      const barWrap = document.createElement('span');
      barWrap.className = 'usage-bar-wrap';
      const bar = document.createElement('span');
      bar.className = 'usage-bar';
      bar.style.width = `${Math.max(4, Math.round((entry.seconds / maxSec) * 100))}%`;
      barWrap.appendChild(bar);

      const value = document.createElement('span');
      value.className = 'usage-value';
      value.textContent = formatDuration(entry.seconds);

      li.appendChild(name);
      li.appendChild(kind);
      li.appendChild(barWrap);
      li.appendChild(value);
      usageList.appendChild(li);
    }
  }

  usageProfileSelect?.addEventListener('change', renderUsage);

  // ---------- Planner ----------

  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

  async function loadPlannerData(): Promise<void> {
    if (!plannerProfileId) return;
    try {
      planner = await api.getPlanner(plannerProfileId);
    } catch {
      if (plannerStatus) setStatus(plannerStatus, 'Failed to load planner.', 'error');
      return;
    }
    renderPlanner();
  }

  function renderPlanner(): void {
    renderPlannerEvents();
    renderPlannerTimetable();
    renderPlannerTodos();
  }

  function renderPlannerEvents(): void {
    if (!plannerEventsList) return;
    plannerEventsList.replaceChildren();
    if (planner.events.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'planner-empty';
      empty.textContent = 'No calendar events yet.';
      plannerEventsList.appendChild(empty);
      return;
    }
    const sorted = [...planner.events].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    for (const ev of sorted) {
      const li = document.createElement('li');
      li.className = 'planner-row';
      const date = document.createElement('span');
      date.className = 'planner-row-date';
      date.textContent = ev.date;
      const text = document.createElement('span');
      text.className = 'planner-row-text';
      text.textContent = ev.title;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'admin-btn admin-btn-sm admin-btn-danger planner-row-remove';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => {
        planner.events = planner.events.filter((e) => e.id !== ev.id);
        renderPlannerEvents();
      });
      li.appendChild(date);
      li.appendChild(text);
      li.appendChild(remove);
      plannerEventsList.appendChild(li);
    }
  }

  function renderPlannerTimetable(): void {
    if (!plannerTimetableEl) return;
    plannerTimetableEl.replaceChildren();
    for (const day of DAYS) {
      const group = document.createElement('div');
      group.className = 'timetable-day';

      const head = document.createElement('div');
      head.className = 'timetable-day-head';
      head.textContent = day;
      group.appendChild(head);

      const rows = document.createElement('div');
      rows.className = 'timetable-rows';
      const dayRows = planner.timetable.filter((t) => t.day === day);

      dayRows.forEach((row, index) => {
        const rowEl = document.createElement('div');
        rowEl.className = 'timetable-row';

        const period = document.createElement('input');
        period.type = 'text';
        period.className = 'planner-input timetable-period';
        period.value = row.period;
        period.setAttribute('aria-label', `${day} period ${index + 1}`);
        period.addEventListener('change', () => {
          row.period = period.value.trim();
        });

        const subject = document.createElement('input');
        subject.type = 'text';
        subject.className = 'planner-input timetable-subject';
        subject.value = row.subject;
        subject.setAttribute('aria-label', `${day} period ${index + 1} subject`);
        subject.addEventListener('change', () => {
          row.subject = subject.value.trim();
        });

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'admin-btn admin-btn-sm admin-btn-danger';
        remove.textContent = 'Remove';
        remove.addEventListener('click', () => {
          planner.timetable = planner.timetable.filter((t) => t !== row);
          renderPlannerTimetable();
        });

        rowEl.appendChild(period);
        rowEl.appendChild(subject);
        rowEl.appendChild(remove);
        rows.appendChild(rowEl);
      });

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'admin-btn admin-btn-sm timetable-add';
      addBtn.textContent = 'Add period';
      addBtn.addEventListener('click', () => {
        planner.timetable.push({ day, period: 'Period', subject: 'Subject' });
        renderPlannerTimetable();
      });
      rows.appendChild(addBtn);

      group.appendChild(rows);
      plannerTimetableEl.appendChild(group);
    }
  }

  function renderPlannerTodos(): void {
    if (!plannerTodosList) return;
    plannerTodosList.replaceChildren();
    if (planner.todos.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'planner-empty';
      empty.textContent = 'No to-dos yet.';
      plannerTodosList.appendChild(empty);
      return;
    }
    const sorted = [...planner.todos].sort((a, b) => Number(a.done) - Number(b.done));
    for (const todo of sorted) {
      const li = document.createElement('li');
      li.className = 'planner-row' + (todo.done ? ' is-done' : '');

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = todo.done;
      checkbox.setAttribute('aria-label', `Mark "${todo.text}" done`);
      checkbox.addEventListener('change', () => {
        todo.done = checkbox.checked;
        renderPlannerTodos();
      });

      const text = document.createElement('span');
      text.className = 'planner-row-text';
      text.textContent = todo.text;

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'admin-btn admin-btn-sm admin-btn-danger planner-row-remove';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => {
        planner.todos = planner.todos.filter((t) => t.id !== todo.id);
        renderPlannerTodos();
      });

      li.appendChild(checkbox);
      li.appendChild(text);
      li.appendChild(remove);
      plannerTodosList.appendChild(li);
    }
  }

  plannerEventAdd?.addEventListener('click', () => {
    const date = plannerEventDate?.value ?? '';
    const title = (plannerEventTitle?.value ?? '').trim();
    if (!date) {
      if (plannerStatus) setStatus(plannerStatus, 'Pick a date for the event.', 'error');
      return;
    }
    if (!title) {
      if (plannerStatus) setStatus(plannerStatus, 'Event title is required.', 'error');
      return;
    }
    planner.events.push({ id: 'ev-' + Math.random().toString(36).slice(2, 10), date, title });
    if (plannerEventDate) plannerEventDate.value = '';
    if (plannerEventTitle) plannerEventTitle.value = '';
    if (plannerStatus) setStatus(plannerStatus, '');
    renderPlannerEvents();
  });

  plannerTodoAdd?.addEventListener('click', () => {
    const text = (plannerTodoInput?.value ?? '').trim();
    if (!text) {
      if (plannerStatus) setStatus(plannerStatus, 'To-do text is required.', 'error');
      return;
    }
    planner.todos.push({ id: 'td-' + Math.random().toString(36).slice(2, 10), text, done: false });
    if (plannerTodoInput) plannerTodoInput.value = '';
    if (plannerStatus) setStatus(plannerStatus, '');
    renderPlannerTodos();
  });

  plannerProfileSelect?.addEventListener('change', () => {
    plannerProfileId = plannerProfileSelect.value || null;
    loadPlannerData().catch(() => {});
  });

  plannerSaveBtn?.addEventListener('click', async () => {
    if (!plannerSaveBtn || !plannerProfileId) return;
    plannerSaveBtn.disabled = true;
    if (plannerStatus) setStatus(plannerStatus, 'Saving…');
    try {
      const result = await api.savePlanner(plannerProfileId, planner);
      if (result.ok) {
        if (plannerStatus) setStatus(plannerStatus, 'Planner saved.', 'success');
      } else if (plannerStatus) {
        setStatus(plannerStatus, result.error || 'Save failed.', 'error');
      }
    } catch {
      if (plannerStatus) setStatus(plannerStatus, 'Save failed.', 'error');
    } finally {
      plannerSaveBtn.disabled = false;
    }
  });

  // ---------- Activity ----------

  const BADGE_LABELS: Record<string, string> = {
    'app-start': 'System',
    'app-quit': 'System',
    navigate: 'Nav',
    home: 'Home',
    back: 'Back',
    blocked: 'Blocked',
    power: 'Power',
    escape: 'Admin',
    'whitelist-save': 'Config',
    'whitelist-change': 'Config',
    'profile-switch': 'Profile',
    'app-launch': 'Launch',
    'app-exit': 'Exit',
    'screen-time-limit': 'Time',
    override: 'Override',
    restricted: 'Off-hours',
    'wifi-connect': 'Wi-Fi',
  };

  function renderActivity(): void {
    if (!activityList) return;
    const query = (searchInput?.value ?? '').toLowerCase().trim();
    const kind = filterSelect?.value ?? '';

    const filtered = allActivity.filter((ev) => {
      if (kind && ev.kind !== kind) return false;
      if (query) {
        const hay = `${ev.detail} ${ev.url ?? ''} ${ev.profile ?? ''}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });

    activityList.replaceChildren();
    if (filtered.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'activity-empty';
      if (allActivity.length === 0) {
        empty.textContent = selectedDate === todayKey() ? 'No activity yet today.' : `No activity on ${selectedDate}.`;
      } else {
        empty.textContent = 'No matching activity.';
      }
      activityList.appendChild(empty);
      return;
    }

    for (const ev of filtered) {
      const li = document.createElement('li');
      li.className = 'activity-row';

      const time = document.createElement('span');
      time.className = 'activity-time';
      let ts: string;
      try {
        ts = new Date(ev.ts).toLocaleTimeString();
      } catch {
        ts = ev.ts;
      }
      time.textContent = ts;

      const badge = document.createElement('span');
      badge.className = `activity-badge badge-${ev.kind}`;
      badge.textContent = BADGE_LABELS[ev.kind] || ev.kind;

      const detail = document.createElement('span');
      detail.className = 'activity-detail';
      detail.textContent = ev.detail;
      if (ev.profile) {
        const profileTag = document.createElement('span');
        profileTag.className = 'activity-profile';
        profileTag.textContent = ` [${ev.profile}]`;
        detail.appendChild(profileTag);
      }
      if (ev.url) {
        const url = document.createElement('span');
        url.className = 'activity-url';
        url.textContent = ` — ${ev.url}`;
        detail.appendChild(url);
      }

      li.appendChild(time);
      li.appendChild(badge);
      li.appendChild(detail);
      activityList.appendChild(li);
    }
  }

  async function loadActivityPage(reset: boolean): Promise<void> {
    if (reset) {
      activityOffset = 0;
      allActivity = [];
    }
    const page = await api.getActivity(activityOffset, ACTIVITY_PAGE, selectedDate);
    allActivity = allActivity.concat(page.events);
    activityOffset += page.events.length;
    if (loadMoreBtn) loadMoreBtn.hidden = activityOffset >= page.total;
    renderActivity();
  }

  searchInput?.addEventListener('input', renderActivity);
  filterSelect?.addEventListener('change', renderActivity);
  loadMoreBtn?.addEventListener('click', () => loadActivityPage(false));

  clearHistoryBtn?.addEventListener('click', async () => {
    if (!window.confirm('Clear the entire activity history? This cannot be undone.')) return;
    const result = await api.clearActivity();
    if (result.ok) {
      allActivity = [];
      activityOffset = 0;
      if (loadMoreBtn) loadMoreBtn.hidden = true;
      renderActivity();
    }
  });

  // ---------- Init ----------

  // Mirror the app-wide theme (light/dark) off the main process.
  window.escapeAPI.getTheme?.().then((theme) => {
    document.documentElement.dataset.theme = theme;
  }).catch(() => {});
  window.escapeAPI.onThemeChanged?.((theme) => {
    document.documentElement.dataset.theme = theme;
  });

  (async () => {
    try {
      const file = await api.getProfiles();
      profiles = file.profiles;
      editingProfileId = profiles[0]?.id ?? null;
    } catch {
      setStatus(sitesStatus, 'Failed to load profiles.', 'error');
    }
    renderProfileSelect();
    renderPlatforms();
    renderDayLabel();
    loadActivityPage(true).catch(() => {
      if (activityList) {
        activityList.replaceChildren();
        const empty = document.createElement('li');
        empty.className = 'activity-empty';
        empty.textContent = 'Failed to load activity.';
        activityList.appendChild(empty);
      }
    });
  })();
})();
