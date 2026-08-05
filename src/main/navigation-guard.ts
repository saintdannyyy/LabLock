import type { WebContents } from 'electron';
import { isFrameUrlAllowed, isUrlAllowed } from './whitelist';
import type { WhitelistEntry } from '../shared/types';

interface NavigationDetails {
  url: string;
  isMainFrame: boolean;
  preventDefault(): void;
}

/**
 * Wires the single site-content WebContents to block any navigation whose
 * hostname isn't on the whitelist. This is the only place navigation
 * restrictions are enforced -- every event handler here defers to
 * isUrlAllowed() so the matching rules never drift between call sites.
 *
 * Frames and top-level pages are treated differently on purpose:
 *  - Main-frame navigation, redirects and window.open must pass the STRICT
 *    check (isUrlAllowed) -- embedHosts never license a browseable page.
 *  - Sub-frame (iframe) navigation may also match isFrameUrlAllowed, which
 *    additionally honors embedHosts so a whitelisted page can embed
 *    YouTube/Google Maps/Disqus without making those hosts browseable.
 *
 * Note (documented limitation): this restricts *navigation* (what page/frame
 * is displayed). It does NOT filter subresource network requests (images,
 * scripts, fetch/XHR, fonts, CSS) -- a whitelisted page can still load
 * third-party subresources in the background. Full network-level filtering
 * would require session.webRequest.onBeforeRequest and is out of scope here.
 */
export function attachNavigationGuard(
  siteWebContents: WebContents,
  getWhitelist: () => WhitelistEntry[],
  onBlocked: (attemptedUrl: string) => void,
): void {
  const strictGuard = (details: NavigationDetails): void => {
    if (!isUrlAllowed(details.url, getWhitelist())) {
      details.preventDefault();
      onBlocked(details.url);
    }
  };

  const frameGuard = (details: NavigationDetails): void => {
    if (!isFrameUrlAllowed(details.url, getWhitelist())) {
      details.preventDefault();
      onBlocked(details.url);
    }
  };

  // Top-level (main frame) navigation -- strict only.
  siteWebContents.on('will-navigate', strictGuard);

  // Server redirects: apply the strict check to the main frame, but let
  // sub-frame redirects use the frame check too (a YouTube/Google embed often
  // bounces between subdomains before settling).
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

  // Never let a whitelisted site spawn a second OS window/popup. If the
  // popup target is itself whitelisted, redirect it into the same site view
  // instead; otherwise show the blocked screen. Either way, always deny the
  // new-window creation. Strict only -- embed-only hosts must never open as
  // a browsable page (e.g. YouTube's "Watch on YouTube" link).
  siteWebContents.setWindowOpenHandler(({ url }) => {
    if (isUrlAllowed(url, getWhitelist())) {
      siteWebContents.loadURL(url);
    } else {
      onBlocked(url);
    }
    return { action: 'deny' };
  });
}
