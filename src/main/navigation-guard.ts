import type { WebContents } from 'electron';
import { isUrlAllowed } from './whitelist';
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
  const guard = (details: NavigationDetails): void => {
    if (!isUrlAllowed(details.url, getWhitelist())) {
      details.preventDefault();
      onBlocked(details.url);
    }
  };

  // Top-level (main frame) navigation and redirects.
  siteWebContents.on('will-navigate', guard);
  siteWebContents.on('will-redirect', guard);

  // Sub-frame (iframe) navigation -- will-frame-navigate also fires for the
  // main frame, so it's filtered to sub-frames only here to avoid double
  // handling the same main-frame navigation twice.
  siteWebContents.on('will-frame-navigate', (details: NavigationDetails) => {
    if (details.isMainFrame) return;
    guard(details);
  });

  // Never let a whitelisted site spawn a second OS window/popup. If the
  // popup target is itself whitelisted, redirect it into the same site view
  // instead; otherwise show the blocked screen. Either way, always deny the
  // new-window creation.
  siteWebContents.setWindowOpenHandler(({ url }) => {
    if (isUrlAllowed(url, getWhitelist())) {
      siteWebContents.loadURL(url);
    } else {
      onBlocked(url);
    }
    return { action: 'deny' };
  });
}
