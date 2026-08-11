// Outside-allowed-hours screen. Loaded by main in the content view when the
// active profile is outside its configured usage windows (or a window just
// closed). Read-only, plus a button back to the profile picker. Plain browser
// script over file://, wrapped in an IIFE like the other content views.
(() => {
  const message = document.getElementById('restricted-message') as HTMLElement | null;
  const hoursEl = document.getElementById('restricted-hours') as HTMLElement | null;
  const switchBtn = document.getElementById('switch-profile-btn') as HTMLButtonElement | null;

  const params = new URLSearchParams(location.search);
  const profile = params.get('profile');
  const hoursRaw = params.get('hours');

  if (message && profile) {
    message.textContent = `This profile's allowed usage hours don't include right now${profile ? ` (${profile})` : ''}.`;
  }

  if (hoursEl && hoursRaw) {
    try {
      const hours = JSON.parse(hoursRaw) as { start: string; end: string }[];
      if (hours.length > 0) {
        hoursEl.hidden = false;
        hoursEl.textContent = 'Available hours: ' + hours.map((w) => `${w.start} – ${w.end}`).join(', ');
      }
    } catch {
      // malformed hours payload; just leave the generic message
    }
  }

  switchBtn?.addEventListener('click', () => {
    window.lockdown.switchProfile?.();
  });

  // Mirror the app-wide theme (light/dark) off the main process.
  window.lockdown.getTheme?.().then((theme) => {
    document.documentElement.dataset.theme = theme;
  }).catch(() => {});
  window.lockdown.onThemeChanged?.((theme) => {
    document.documentElement.dataset.theme = theme;
  });
})();
