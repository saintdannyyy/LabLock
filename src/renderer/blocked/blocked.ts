const params = new URLSearchParams(window.location.search);
const attemptedUrl = params.get('url') ?? '';

const hostEl = document.getElementById('attempted-host');
if (hostEl) {
  let display = attemptedUrl;
  try {
    display = new URL(attemptedUrl).hostname || attemptedUrl;
  } catch {
    // Not a parsable URL (e.g. a malformed scheme) -- fall back to the raw
    // string. Always set via textContent below, never innerHTML, so this
    // can't be used to inject markup.
  }
  hostEl.textContent = display || 'The requested site';
}

document.getElementById('home-btn')?.addEventListener('click', () => {
  window.lockdown.goHome();
});

// Mirror the app-wide theme (light/dark) off the main process.
window.lockdown.getTheme?.().then((theme) => {
  document.documentElement.dataset.theme = theme;
}).catch(() => {});
window.lockdown.onThemeChanged?.((theme) => {
  document.documentElement.dataset.theme = theme;
});
