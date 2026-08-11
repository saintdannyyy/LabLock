// Profile picker ("Who's using this workspace?"). Chrome-style: one card per
// child profile; clicking one opens a password login (every profile must have a
// password — passwordless cards show a "contact an administrator" notice and
// can't be signed into). A correct password signs the child in and main swaps
// the whole kiosk to that profile's permitted-app grid. Loaded as a plain
// browser script over file://, so no import/export; ProfileSummary comes from
// global.d.ts. Wrapped in an IIFE so its top-level identifiers don't collide
// with the other global-script renderers (home.ts, toolbar.ts, ...).
(() => {
  function makeAvatar(p: ProfileSummary): HTMLElement {
    const avatar = document.createElement('span');
    avatar.className = 'profile-avatar';
    avatar.style.background = p.avatarColor;
    avatar.textContent = (p.name.trim()[0] || '?').toUpperCase();
    return avatar;
  }

  function makeLockBadge(set: boolean): HTMLElement {
    const badge = document.createElement('span');
    badge.className = 'profile-lock';
    badge.setAttribute('aria-hidden', 'true');
    badge.textContent = set ? '🔒' : '🔓';
    badge.title = set ? 'Password protected' : 'No password set — ask an administrator';
    return badge;
  }

  const list = document.getElementById('profile-list');
  const loginPanel = document.getElementById('login-panel') as HTMLElement | null;
  const loginAvatar = document.getElementById('login-avatar') as HTMLElement | null;
  const loginName = document.getElementById('login-name') as HTMLElement | null;
  const loginForm = document.getElementById('login-form') as HTMLFormElement | null;
  const passwordInput = document.getElementById('login-password') as HTMLInputElement | null;
  const loginError = document.getElementById('login-error') as HTMLElement | null;
  const loginSubmit = document.getElementById('login-submit') as HTMLButtonElement | null;
  const loginForgot = document.getElementById('login-forgot') as HTMLButtonElement | null;
  const loginNoPassword = document.getElementById('login-nopassword') as HTMLElement | null;
  const loginForgotDone = document.getElementById('login-forgot-done') as HTMLElement | null;
  const loginCancel = document.getElementById('login-cancel') as HTMLButtonElement | null;

  let currentProfile: ProfileSummary | null = null;

  function showList(): void {
    currentProfile = null;
    if (list) list.hidden = false;
    if (loginPanel) loginPanel.hidden = true;
    if (loginError) loginError.textContent = '';
    if (passwordInput) passwordInput.value = '';
    if (loginForgotDone) loginForgotDone.hidden = true;
  }

  function showLogin(profile: ProfileSummary): void {
    currentProfile = profile;
    if (list) list.hidden = true;
    if (loginPanel) loginPanel.hidden = false;
    if (loginAvatar) loginAvatar.replaceChildren(makeAvatar(profile));
    if (loginName) loginName.textContent = profile.name;
    if (loginError) loginError.textContent = '';
    if (loginForgotDone) loginForgotDone.hidden = true;
    const hasPassword = profile.passwordSet;
    if (loginForm) loginForm.hidden = !hasPassword;
    if (loginNoPassword) loginNoPassword.hidden = hasPassword;
    if (passwordInput) {
      passwordInput.value = '';
      if (hasPassword) passwordInput.focus();
    }
  }

  function initPicker(): void {
    const getProfiles = window.lockdown.getProfiles;
    if (!list || !getProfiles) return;

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
          card.appendChild(makeLockBadge(profile.passwordSet));
          card.appendChild(makeAvatar(profile));
          const name = document.createElement('span');
          name.className = 'profile-name';
          name.textContent = profile.name;
          card.appendChild(name);
          card.addEventListener('click', () => showLogin(profile));
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

  loginForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!currentProfile) return;
    const password = passwordInput?.value ?? '';
    if (loginSubmit) loginSubmit.disabled = true;
    window.lockdown
      .authProfile?.(currentProfile.id, password)
      .then((result) => {
        if (result.ok) {
          // Main swaps the pane to the profile's home grid; nothing to do here.
          return;
        }
        if (loginError) loginError.textContent = result.error || 'Sign-in failed.';
        if (passwordInput) {
          passwordInput.value = '';
          passwordInput.focus();
        }
      })
      .catch(() => {
        if (loginError) loginError.textContent = 'Sign-in failed.';
      })
      .finally(() => {
        if (loginSubmit) loginSubmit.disabled = false;
      });
  });

  loginForgot?.addEventListener('click', () => {
    if (!currentProfile) return;
    window.lockdown.requestPasswordReset?.(currentProfile.id);
    if (loginForm) loginForm.hidden = true;
    if (loginNoPassword) loginNoPassword.hidden = true;
    if (loginForgotDone) loginForgotDone.hidden = false;
  });

  loginCancel?.addEventListener('click', showList);

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
