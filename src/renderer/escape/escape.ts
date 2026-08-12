// Escape-hatch password dialog (window uses escape-preload.js, which exposes
// window.escapeAPI.sendPasswordResult via contextBridge). Kept out of the HTML
// so the page can keep a strict CSP with no inline scripts. Wrapped in an IIFE
// so top-level identifiers don't collide with the other global-script renderer
// files (e.g. home.ts also defines `init`).
(() => {
  const passwordInput = document.getElementById('password') as HTMLInputElement | null;
  const toggleBtn = document.getElementById('toggle-visibility') as HTMLButtonElement | null;
  const iconEye = document.querySelector<HTMLElement>('.icon-eye');
  const iconEyeOff = document.querySelector<HTMLElement>('.icon-eye-off');
  const cancelBtn = document.getElementById('cancelBtn') as HTMLButtonElement | null;
  const exitBtn = document.getElementById('exitBtn') as HTMLButtonElement | null;
  const errorEl = document.getElementById('escape-error');
  const form = document.getElementById('escape-form') as HTMLFormElement | null;

  if (!passwordInput || !toggleBtn || !cancelBtn || !exitBtn || !errorEl || !form) return;

  const input = passwordInput; // narrowed non-null alias for use inside closures
  const toggle = toggleBtn;
  const error = errorEl;

  const send = window.escapeAPI.sendPasswordResult;

  let submitted = false;
  let passwordVisible = false;

  function submit(): void {
    if (submitted) return;
    submitted = true;
    send(input.value);
  }

  function clearError(): void {
    input.classList.remove('error');
    error.classList.remove('visible');
  }

  exitBtn.addEventListener('click', submit);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
    clearError();
  });

  input.addEventListener('input', clearError);

  cancelBtn.addEventListener('click', () => {
    send('__CANCEL__');
  });

  toggle.addEventListener('click', () => {
    passwordVisible = !passwordVisible;
    input.type = passwordVisible ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(passwordVisible));
    toggle.setAttribute('aria-label', passwordVisible ? 'Hide password' : 'Show password');
    if (iconEye) iconEye.style.display = passwordVisible ? 'none' : 'block';
    if (iconEyeOff) iconEyeOff.style.display = passwordVisible ? 'block' : 'none';
  });

  input.focus();

  // Mirror the app-wide theme (light/dark) off the main process.
  window.escapeAPI.getTheme?.().then((theme) => {
    document.documentElement.dataset.theme = theme;
  }).catch(() => {});
  window.escapeAPI.onThemeChanged?.((theme) => {
    document.documentElement.dataset.theme = theme;
  });
})();