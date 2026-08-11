// Profile picker ("Who's using this workspace?"). Chrome-style: one card per
// child profile; clicking one activates it and main switches the whole kiosk
// to that profile's permitted-app grid. Loaded as a plain browser script over
// file://, so no import/export; ProfileSummary comes from global.d.ts. Wrapped
// in an IIFE so its top-level identifiers don't collide with the other
// global-script renderers (home.ts, toolbar.ts, ...).
(() => {
  function makeAvatar(p: ProfileSummary): HTMLElement {
    const avatar = document.createElement('span');
    avatar.className = 'profile-avatar';
    avatar.style.background = p.avatarColor;
    avatar.textContent = (p.name.trim()[0] || '?').toUpperCase();
    return avatar;
  }

  function initPicker(): void {
    const list = document.getElementById('profile-list');
    const getProfiles = window.lockdown.getProfiles;
    const selectProfile = window.lockdown.selectProfile;
    if (!list || !getProfiles || !selectProfile) return;

    getProfiles()
      .then((profiles) => {
        if (profiles.length === 0) {
          const empty = document.createElement('p');
          empty.className = 'picker-empty';
          empty.textContent = 'No profiles are configured yet. Ask an administrator to add one.';
          list.appendChild(empty);
          return;
        }
        for (const profile of profiles) {
          const card = document.createElement('button');
          card.type = 'button';
          card.className = 'profile-card';
          card.title = profile.name;
          card.appendChild(makeAvatar(profile));
          const name = document.createElement('span');
          name.className = 'profile-name';
          name.textContent = profile.name;
          card.appendChild(name);
          card.addEventListener('click', () => {
            void selectProfile(profile.id);
          });
          list.appendChild(card);
        }
      })
      .catch(() => {
        const empty = document.createElement('p');
        empty.className = 'picker-empty';
        empty.textContent = 'Could not load profiles.';
        list.appendChild(empty);
      });
  }

  function initTheme(): void {
    window.lockdown.getTheme?.().then((theme) => {
      document.documentElement.dataset.theme = theme;
    }).catch(() => {});
    window.lockdown.onThemeChanged?.((theme) => {
      document.documentElement.dataset.theme = theme;
    });
  }

  initTheme();
  initPicker();
})();
