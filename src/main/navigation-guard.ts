import type { WebContents } from 'electron';
import { isFrameUrlAllowed, isUrlAllowed } from './whitelist';
import type { WhitelistEntry } from '../shared/types';

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
 * Non-http(s) schemes are always blocked synchronously at every level.
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

  const strictGuard = (details: NavigationDetails): void => {
    const targetUrl = details.url;
    if (isUrlAllowed(targetUrl, getWhitelist())) return;
    if (isLooseHttpUrl(targetUrl)) return; // Cloudflare judges it downstream
    details.preventDefault();
    onBlocked(targetUrl);
  };

  const frameGuard = (details: NavigationDetails): void => {
    if (isFrameUrlAllowed(details.url, getWhitelist())) return;
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

  // Never let a site spawn a second OS window/popup. Whitelisted targets (and
  // loose-mode http(s) targets, judged by Cloudflare) are redirected into the
  // same site view instead; anything else shows the blocked screen. Either
  // way, always deny the new-window creation.
  siteWebContents.setWindowOpenHandler(({ url }) => {
    if (isUrlAllowed(url, getWhitelist()) || isLooseHttpUrl(url)) {
      siteWebContents.loadURL(url);
    } else {
      onBlocked(url);
    }
    return { action: 'deny' };
  });
}
