// Loading overlay theme mirror. The loader view carries the content preload so
// this page can read the app-wide theme (light/dark) and flip <html data-theme>
// for shared.css. No favicon fetch, no navigation here -- it is just a spinner.
(() => {
  window.lockdown.getTheme?.().then((theme) => {
    document.documentElement.dataset.theme = theme;
  }).catch(() => {});
  window.lockdown.onThemeChanged?.((theme) => {
    document.documentElement.dataset.theme = theme;
  });
})();
