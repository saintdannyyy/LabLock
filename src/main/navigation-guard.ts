import type { BrowserWindow, WebContents } from 'electron';
import { isFrameUrlAllowed, isUrlAllowed } from './whitelist';
import type { WhitelistEntry } from '../shared/types';

// Window options applied to a popup created via window.open() (target=_blank,
// "Sign in with Google" style OAuth flows). The popup is a REAL window so the
// opener relationship survives -- Google Identity Services completes auth by
// postMessage-ing back to window.opener, which is destroyed if the popup is
// loaded into the main site view instead. In kiosk mode it is a plain, pinned
// child window; in dev it keeps normal chrome so iteration is painless.
export interface PopupWindowOptions {
  kiosk: boolean;
  getParentWindow(): BrowserWindow | null;
}

interface NavigationDetails {
  url: string;
  isMainFrame: boolean;
  preventDefault(): void;
}

/**
 * Wires the single site-content WebContents to restrict navigation. There are
 * two gates, depending on whether the Cloudflare content filter is enabled
 * (the "loose policy"):
 *
 *  - Loose policy OFF: the whitelist is the ONLY gate. Main-frame
 *    navigation, redirects and window.open must pass isUrlAllowed(); anything
 *    else is blocked. This is the strict, whitelist-only kiosk.
 *  - Loose policy ON: the whitelist still hard-allows its hosts with zero
 *    latency, but a non-whitelisted http(s) top-level target is NOT blocked
 *    here -- it proceeds to the network layer, where content-filter.ts's
 *    onBeforeRequest judges it against Cloudflare and cancels it if the
 *    policy blocks it (surfacing as a did-fail-load ERR_BLOCKED_BY_CLIENT ->
 *    blocked screen in window.ts). Whitelisted tiles stay the home grid; the
 *    filter becomes the top-level gate.
 *
 * Sub-frames follow the same pattern: isFrameUrlAllowed (honoring embedHosts)
 * passes instantly, unknown iframe hosts pass through in loose mode for
 * Cloudflare to judge, and are blocked synchronously when the filter is off.
 * Non-http(s) schemes are always blocked synchronously at every level -- the
 * one exception is about:blank / about:srcdoc, which carry no content and are
 * allowed as inert placeholder documents (see isBlankDocument below).
 *
 * window.open()/target=_blank popups are opened as REAL child windows (never
 * redirected into the site view): an OAuth popup (Google Identity Services,
 * the "Sign in with Google" button on Toddle etc.) completes by sending its
 * token to window.opener, so it must remain a separate window. Each popup is
 * itself guarded by this same guard (recursively), filtered by Cloudflare, and
 * parented to the main kiosk window so it dies with it. Popups are denied --
 * with no side effects on the main view -- when the target is blocked.
 *
 * Note (documented limitation): this restricts *navigation* (what page/frame
 * is displayed). Subresource network requests (images, scripts, fetch/XHR,
 * fonts, CSS) are judged by the same Cloudflare filter via
 * session.webRequest.onBeforeRequest (content-filter.ts).
 */
export function attachNavigationGuard(
  siteWebContents: WebContents,
  getWhitelist: () => WhitelistEntry[],
  onBlocked: (attemptedUrl: string) => void,
  getLoosePolicy?: () => boolean,
  popupOptions?: PopupWindowOptions,
): void {
  // A non-whitelisted target is only ever released to the network layer when
  // the loose policy is on AND the target is plain http(s) -- Cloudflare's
  // filter is the judge in that case. Everything else (filter off, or a
  // javascript:/file:/data: scheme) is blocked here, synchronously.
  const isLooseHttpUrl = (url: string): boolean => {
    if (!getLoosePolicy?.()) return false;
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  };

  // about:blank / about:srcdoc carry NO content, so there is nothing to filter
  // -- they're inert placeholders (iframes' initial document, empty
  // window.open() targets that pages later script or navigate, the hop some
  // OAuth flows take before window.close()). They are always allowed to EXIST;
  // every subsequent navigation out of them still goes through the same
  // guards, so they can never smuggle content past the policy. Allowing them
  // also stops a site's innocent window.open('about:blank') from flipping the
  // main kiosk view to the blocked screen.
  const isBlankDocument = (url: string): boolean => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'about:' && (parsed.pathname === 'blank' || parsed.pathname === 'srcdoc');
    } catch {
      return false;
    }
  };

  const strictGuard = (details: NavigationDetails): void => {
    const targetUrl = details.url;
    if (isUrlAllowed(targetUrl, getWhitelist())) return;
    if (isBlankDocument(targetUrl)) return;
    if (isLooseHttpUrl(targetUrl)) return; // Cloudflare judges it downstream
    details.preventDefault();
    onBlocked(targetUrl);
  };

  const frameGuard = (details: NavigationDetails): void => {
    if (isFrameUrlAllowed(details.url, getWhitelist())) return;
    if (isBlankDocument(details.url)) return;
    // Loose policy: unknown iframe hosts pass through to Cloudflare.
    if (getLoosePolicy?.()) return;
    details.preventDefault();
    onBlocked(details.url);
  };

  // Top-level (main frame) navigation.
  siteWebContents.on('will-navigate', strictGuard);

  // Server redirects: main frame goes through the strict check; sub-frame
  // redirects use the frame check too (a YouTube/Google embed often bounces
  // between subdomains before settling).
  siteWebContents.on('will-redirect', (details: NavigationDetails) => {
    if (details.isMainFrame) {
      strictGuard(details);
    } else {
      frameGuard(details);
    }
  });

  // Sub-frame (iframe) navigation -- will-frame-navigate also fires for the
  // main frame, so it's filtered to sub-frames only here to avoid double
  // handling the same main-frame navigation twice.
  siteWebContents.on('will-frame-navigate', (details: NavigationDetails) => {
    if (details.isMainFrame) return;
    frameGuard(details);
  });

  // window.open()/target=_blank: whitelisted targets (and loose-mode http(s)
  // targets, judged by Cloudflare) become a REAL popup window so the opener
  // relationship survives -- this is what makes OAuth popup flows (Toddle's
  // "Sign in with Google", Google Identity Services) work at all. Anything else
  // is denied; the main view is never touched. The popup is created through
  // Electron's native window.open path (action: 'allow') so window.opener and
  // postMessage to the opener both work inside it.
  siteWebContents.setWindowOpenHandler(({ url }) => {
    if (isUrlAllowed(url, getWhitelist()) || isLooseHttpUrl(url) || isBlankDocument(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 760,
          height: 640,
          center: true,
          frame: true,
          resizable: false,
          minimizable: false,
          maximizable: false,
          fullscreenable: false,
          autoHideMenuBar: true,
          ...(popupOptions?.kiosk ? { alwaysOnTop: true, skipTaskbar: true } : {}),
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            devTools: !popupOptions?.kiosk,
          },
        },
      };
    }
    onBlocked(url);
    return { action: 'deny' };
  });

  // Guard every popup this webContents spawns, exactly like the main site
  // view. Blocks inside a popup are SILENT (a denied popup must never flip the
  // main view to the blocked screen), and the popup is parented to the kiosk
  // window so it stays on top and is destroyed with it.
  siteWebContents.on('did-create-window', (window, details) => {
    attachNavigationGuard(window.webContents, getWhitelist, () => {}, getLoosePolicy, popupOptions);
    const parent = popupOptions?.getParentWindow();
    if (parent && !window.isDestroyed() && !parent.isDestroyed()) {
      window.setParentWindow(parent);
    }
  });
}
