// Home grid — the active profile's permitted platforms. Web platforms open in
// the kiosk site view (navigateTo); native platforms launch as separate
// processes (launchApp). Loaded as a plain browser script over file://, so no
// import/export; types are declared structurally.
type Platform = {
  id: string;
  name: string;
  icon?: string;
  kind: 'web' | 'native';
  url?: string;
};

const TILE_COLORS = ['#4285f4', '#ea4335', '#fbbc05', '#34a853', '#f4511e', '#0097a7'];
let colorIndex = 0;

function makeFallbackIcon(name: string): HTMLElement {
  const div = document.createElement('div');
  div.className = 'tile-icon-fallback';
  div.style.background = TILE_COLORS[colorIndex++ % TILE_COLORS.length];
  div.textContent = (name.trim()[0] || '?').toUpperCase();
  return div;
}

// Auto-fetch the site's favicon (like a browser) instead of shipping icon
// files. Google's favicon service returns the site's real icon in a fixed
// size; it resolves the "best" icon including sites that only publish one
// via HTML <link> (no /favicon.ico on disk). Falls back to the letter badge
// on failure (offline, unknown domain).
function faviconUrl(siteUrl: string): string {
  try {
    const host = new URL(siteUrl).hostname;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
  } catch {
    return '';
  }
}

function buildTile(platform: Platform): HTMLElement {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'tile';

  const img = document.createElement('img');
  img.className = 'tile-icon';
  img.alt = '';
  if (platform.icon) {
    // A shipped custom icon may be non-square (e.g. a wide wordmark) — contain
    // it on a white tile instead of cover-cropping.
    img.style.objectFit = 'contain';
    img.style.background = 'var(--color-surface)';
  }
  if (platform.kind === 'web' && platform.url) {
    // Favicon fallback chain: configured icon -> auto-fetched favicon -> letter.
    let faviconTried = false;
    img.src = platform.icon || faviconUrl(platform.url);
    img.onerror = () => {
      if (!faviconTried) {
        faviconTried = true;
        const favicon = faviconUrl(platform.url || '');
        if (favicon) {
          img.src = favicon;
          return;
        }
      }
      img.replaceWith(makeFallbackIcon(platform.name));
    };
  } else {
    // Native apps without a shipped icon get a plain letter badge.
    img.hidden = true;
    tile.appendChild(makeFallbackIcon(platform.name));
  }
  tile.appendChild(img);

  const label = document.createElement('span');
  label.className = 'tile-name';
  label.textContent = platform.name;
  tile.appendChild(label);

  tile.addEventListener('click', () => {
    if (platform.kind === 'native') {
      window.lockdown.launchApp?.(platform.id);
    } else if (platform.url) {
      window.lockdown.navigateTo?.(platform.url);
    }
  });

  return tile;
}

// Tiles are built once at load AND re-rendered in place when main pushes a
// whitelist refresh (an admin save) -- never via a full page reload, which is
// what made the kiosk blink blank after every admin change. The generation
// counter drops stale renders if two refreshes race.
let gridGen = 0;

async function renderGrid(): Promise<void> {
  const grid = document.getElementById('grid');
  const getPlatforms = window.lockdown.getPlatforms;
  const navigateTo = window.lockdown.navigateTo;
  const launchApp = window.lockdown.launchApp;
  if (!grid || !getPlatforms || !navigateTo || !launchApp) return;

  const gen = ++gridGen;
  const platforms = await getPlatforms();
  if (gen !== gridGen) return;

  grid.replaceChildren();
  colorIndex = 0;
  if (platforms.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No permitted apps are configured for this profile yet. Ask your administrator to add some.';
    grid.appendChild(empty);
    return;
  }

  for (const platform of platforms) {
    grid.appendChild(buildTile(platform));
  }
}

// Mirror the app-wide theme (main owns the persisted value; shared.css flips
// its palette off <html data-theme>). The external site view is the only
// place not themed -- this is the home grid, which runs in the content view.
function initHomeTheme(): void {
  window.lockdown.getTheme?.().then((theme) => {
    document.documentElement.dataset.theme = theme;
  }).catch(() => {});
  window.lockdown.onThemeChanged?.((theme) => {
    document.documentElement.dataset.theme = theme;
  });
}

initHomeTheme();
renderGrid();
window.lockdown.onWhitelistRefreshed?.(renderGrid);
