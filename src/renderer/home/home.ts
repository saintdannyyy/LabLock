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

async function init(): Promise<void> {
  const grid = document.getElementById('grid');
  const getWhitelist = window.lockdown.getWhitelist;
  const navigateTo = window.lockdown.navigateTo;
  if (!grid || !getWhitelist || !navigateTo) return;

  const { sites } = await getWhitelist();

  if (sites.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No sites are configured. Edit config/whitelist.json to add some.';
    grid.appendChild(empty);
    return;
  }

  for (const site of sites) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'tile';

    const img = document.createElement('img');
    img.className = 'tile-icon';
    img.alt = '';
    let faviconTried = false;
    img.src = site.icon || faviconUrl(site.url);
    img.onerror = () => {
      if (!faviconTried) {
        faviconTried = true;
        const favicon = faviconUrl(site.url);
        if (favicon) {
          img.src = favicon;
          return;
        }
      }
      img.replaceWith(makeFallbackIcon(site.name));
    };
    tile.appendChild(img);

    const label = document.createElement('span');
    label.className = 'tile-name';
    label.textContent = site.name;
    tile.appendChild(label);

    tile.addEventListener('click', () => navigateTo(site.url));

    grid.appendChild(tile);
  }
}

init();
