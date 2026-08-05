// Admin console (window uses escape-preload.js, which exposes window.adminAPI
// via contextBridge). Loaded as a plain browser script over file://, so no
// import/export -- tsc would emit a CommonJS wrapper that throws. Types are
// declared structurally (mirroring src/shared/types.ts). Wrapped in an IIFE so
// top-level identifiers don't collide with the other global-script renderers.
(() => {
  const api = window.adminAPI;

  type WhitelistEntry = {
    name: string;
    url: string;
    icon?: string;
    allowedHosts?: string[];
    embedHosts?: string[];
  };

  type ActivityEvent = {
    ts: string;
    kind: string;
    url?: string;
    detail: string;
  };

  const tabSites = document.getElementById('tab-sites') as HTMLElement | null;
  const tabActivity = document.getElementById('tab-activity') as HTMLElement | null;
  const tabBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('.admin-tab'));
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

  const modal = document.getElementById('edit-modal') as HTMLElement | null;
  const editForm = document.getElementById('edit-form') as HTMLFormElement | null;
  const editTitle = document.getElementById('edit-title') as HTMLElement | null;
  const fName = document.getElementById('edit-name') as HTMLInputElement | null;
  const fUrl = document.getElementById('edit-url') as HTMLInputElement | null;
  const fHosts = document.getElementById('edit-hosts') as HTMLTextAreaElement | null;
  const fEmbedHosts = document.getElementById('edit-embed-hosts') as HTMLTextAreaElement | null;
  const fIcon = document.getElementById('edit-icon') as HTMLInputElement | null;
  const editError = document.getElementById('edit-error') as HTMLElement | null;
  const modalCancelBtn = document.getElementById('modal-cancel-btn') as HTMLButtonElement | null;

  let sites: WhitelistEntry[] = [];
  let editingIndex = -1;

  let activityOffset = 0;
  const ACTIVITY_PAGE = 100;
  let allActivity: ActivityEvent[] = [];

  // ---------- Tabs ----------

  function switchTab(name: string): void {
    tabBtns.forEach((b) => b.classList.toggle('is-active', b.dataset.tab === name));
    if (tabSites) tabSites.hidden = name !== 'sites';
    if (tabActivity) tabActivity.hidden = name !== 'activity';
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

  function makeFavicon(name: string, url: string): HTMLElement {
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

  // ---------- Sites ----------

  function renderSites(): void {
    if (!sitesList) return;
    sitesList.replaceChildren();
    if (sites.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'activity-empty';
      empty.textContent = 'No sites configured. Add one to get started.';
      sitesList.appendChild(empty);
      return;
    }
    sites.forEach((site, index) => {
      const li = document.createElement('li');
      li.className = 'site-card';

      li.appendChild(makeFavicon(site.name, site.url));

      const main = document.createElement('div');
      main.className = 'site-main';
      const name = document.createElement('div');
      name.className = 'site-name';
      name.textContent = site.name;
      const url = document.createElement('div');
      url.className = 'site-url';
      url.textContent = site.url;
      main.appendChild(name);
      main.appendChild(url);

      if (site.allowedHosts && site.allowedHosts.length > 0) {
        const hosts = document.createElement('div');
        hosts.className = 'site-hosts';
        for (const host of site.allowedHosts) {
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
        sites.splice(index, 1);
        renderSites();
      });
      actions.appendChild(editBtn);
      actions.appendChild(removeBtn);

      li.appendChild(main);
      li.appendChild(actions);
      sitesList.appendChild(li);
    });
  }

  function openEdit(index: number): void {
    editingIndex = index;
    if (editTitle) editTitle.textContent = index >= 0 ? 'Edit site' : 'Add site';
    if (editError) editError.textContent = '';
    const site = index >= 0 ? sites[index] : undefined;
    if (fName) fName.value = site?.name ?? '';
    if (fUrl) fUrl.value = site?.url ?? '';
    if (fHosts) fHosts.value = (site?.allowedHosts ?? []).join('\n');
    if (fEmbedHosts) fEmbedHosts.value = (site?.embedHosts ?? []).join('\n');
    if (fIcon) fIcon.value = site?.icon ?? '';
    if (modal) modal.hidden = false;
    fName?.focus();
  }

  function closeModal(): void {
    if (modal) modal.hidden = true;
  }

  editForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!fName || !fUrl) return;

    const name = fName.value.trim();
    const url = fUrl.value.trim();
    if (!name) {
      if (editError) editError.textContent = 'Name is required.';
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

    const allowedHosts = (fHosts?.value ?? '')
      .split(/[\n,]/)
      .map((h) => h.trim())
      .filter((h) => h !== '');

    const embedHosts = (fEmbedHosts?.value ?? '')
      .split(/[\n,]/)
      .map((h) => h.trim())
      .filter((h) => h !== '');

    const icon = (fIcon?.value ?? '').trim() || undefined;

    const entry: WhitelistEntry = { name, url };
    if (allowedHosts.length > 0) entry.allowedHosts = allowedHosts;
    if (embedHosts.length > 0) entry.embedHosts = embedHosts;
    if (icon) entry.icon = icon;

    if (editingIndex >= 0 && editingIndex < sites.length) {
      sites[editingIndex] = entry;
    } else {
      sites.push(entry);
    }
    renderSites();
    closeModal();
  });

  modalCancelBtn?.addEventListener('click', closeModal);
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  addSiteBtn?.addEventListener('click', () => openEdit(-1));

  saveBtn?.addEventListener('click', async () => {
    if (!saveBtn || !sitesStatus) return;
    saveBtn.disabled = true;
    setStatus(sitesStatus, 'Saving…');
    try {
      const result = await api.saveWhitelist({ sites });
      if (result.ok) {
        setStatus(sitesStatus, `Saved ${sites.length} site(s). Changes applied live.`, 'success');
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
  };

  function renderActivity(): void {
    if (!activityList) return;
    const query = (searchInput?.value ?? '').toLowerCase().trim();
    const kind = filterSelect?.value ?? '';

    const filtered = allActivity.filter((ev) => {
      if (kind && ev.kind !== kind) return false;
      if (query) {
        const hay = `${ev.detail} ${ev.url ?? ''}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });

    activityList.replaceChildren();
    if (filtered.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'activity-empty';
      empty.textContent = 'No matching activity.';
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
        ts = new Date(ev.ts).toLocaleString();
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
    const page = await api.getActivity(activityOffset, ACTIVITY_PAGE);
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

  (async () => {
    try {
      const whitelist = await api.getWhitelist();
      sites = whitelist.sites;
    } catch {
      setStatus(sitesStatus, 'Failed to load whitelist.', 'error');
    }
    renderSites();
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
