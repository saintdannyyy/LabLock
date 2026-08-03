function makeFallbackIcon(name: string): HTMLElement {
  const div = document.createElement('div');
  div.className = 'tile-icon-fallback';
  div.textContent = (name.trim()[0] || '?').toUpperCase();
  return div;
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

    if (site.icon) {
      const img = document.createElement('img');
      img.className = 'tile-icon';
      img.src = site.icon;
      img.alt = '';
      img.onerror = () => img.replaceWith(makeFallbackIcon(site.name));
      tile.appendChild(img);
    } else {
      tile.appendChild(makeFallbackIcon(site.name));
    }

    const label = document.createElement('span');
    label.className = 'tile-name';
    label.textContent = site.name;
    tile.appendChild(label);

    tile.addEventListener('click', () => navigateTo(site.url));

    grid.appendChild(tile);
  }
}

init();
