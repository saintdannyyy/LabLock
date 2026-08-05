// Renderer pages are loaded as plain scripts (no bundler, file:// origin), so
// this file must not use import/export — tsc would emit a CommonJS wrapper that
// throws ("exports is not defined") in the browser context. UiState is kept in
// sync with src/shared/types.ts (and global.d.ts).
type UiState = {
  pane: 'home' | 'blocked' | 'site' | 'loading';
  canGoBack: boolean;
  activeSiteUrl: string | null;
  kiosk: boolean;
};

const backBtn = document.getElementById('back-btn') as HTMLButtonElement | null;
const tabsEl = document.getElementById('site-tabs') as HTMLElement | null;
const powerEl = document.getElementById('power-btns') as HTMLElement | null;

document.getElementById('home-btn')?.addEventListener('click', () => window.lockdown.goHome());
backBtn?.addEventListener('click', () => window.lockdown.goBack?.());
document.getElementById('shutdown-btn')?.addEventListener('click', () => window.lockdown.shutdown?.());
document.getElementById('restart-btn')?.addEventListener('click', () => window.lockdown.restart?.());

// Auto-fetch the site's favicon (same approach as the home grid). Falls back
// to a neutral letter chip when offline/unknown so tabs stay readable.
function tabFaviconUrl(siteUrl: string): string {
  try {
    const host = new URL(siteUrl).hostname;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
  } catch {
    return '';
  }
}

function makeTabIcon(name: string, url: string): HTMLElement {
  const img = document.createElement('img');
  img.className = 'site-tab-icon';
  img.alt = '';
  let faviconTried = false;
  img.src = tabFaviconUrl(url);
  img.onerror = () => {
    if (!faviconTried) {
      faviconTried = true;
      const favicon = tabFaviconUrl(url);
      if (favicon) {
        img.src = favicon;
        return;
      }
    }
    const letter = document.createElement('span');
    letter.className = 'site-tab-letter';
    letter.textContent = (name.trim()[0] || '?').toUpperCase();
    img.replaceWith(letter);
  };
  return img;
}

async function initTabs(): Promise<void> {
  if (!tabsEl) return;
  const getWhitelist = window.lockdown.getWhitelist;
  if (!getWhitelist) return;

  const { sites } = await getWhitelist();

  for (const site of sites) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'site-tab';
    tab.title = site.name;
    tab.setAttribute('aria-label', site.name);
    tab.dataset.url = site.url;
    tab.appendChild(makeTabIcon(site.name, site.url));
    const label = document.createElement('span');
    label.textContent = site.name;
    tab.appendChild(label);
    tab.addEventListener('click', () => window.lockdown.navigateTo?.(site.url));
    tabsEl.appendChild(tab);
  }
}

function applyUiState(state: UiState): void {
  if (backBtn) {
    // Universal back: enabled whenever main says there's somewhere to go
    // (works from the home grid, the blocked screen, and inside sites).
    backBtn.disabled = !state.canGoBack;
  }
  if (tabsEl) {
    // Tabs only make sense while a site is on screen; on the home grid the
    // tiles are right there and on the blocked screen there's no active site.
    tabsEl.hidden = state.pane !== 'site' && state.pane !== 'loading';
    for (const tab of tabsEl.querySelectorAll<HTMLElement>('.site-tab')) {
      tab.classList.toggle('is-active', tab.dataset.url === state.activeSiteUrl);
    }
  }
  if (powerEl) {
    powerEl.hidden = !state.kiosk;
  }
}

window.lockdown.onUiState?.(applyUiState);
initTabs();
