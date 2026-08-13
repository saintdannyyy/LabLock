import * as fs from 'fs';
import { whitelistConfigPath } from './paths';
import type { WhitelistEntry, WhitelistFile, SaveResult } from '../shared/types';

/**
 * Loads and validates config/whitelist.json. Fails loudly (throws) on any
 * malformed config rather than falling back to an empty/partial whitelist --
 * a kiosk app must never silently start in a broken state.
 */
export function loadWhitelist(): WhitelistFile {
  const configPath = whitelistConfigPath();

  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf-8');
  } catch (err) {
    throw new Error(`Failed to read whitelist config at ${configPath}: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Whitelist config at ${configPath} is not valid JSON: ${(err as Error).message}`);
  }

  return validateWhitelist(parsed, `config at ${configPath}`);
}

/**
 * Validates and writes a whitelist file from the admin console. The write is
 * atomic (temp file + rename) so the config the kiosk boots from can never be
 * left half-written by a crash mid-save. On success the caller still re-reads
 * the file with loadWhitelist() to refresh the live in-memory copy.
 */
export function saveWhitelist(payload: unknown): SaveResult {
  const configPath = whitelistConfigPath();

  let validated: WhitelistFile;
  try {
    validated = validateWhitelist(payload, 'save payload');
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  const json = JSON.stringify(validated, null, 2) + '\n';
  const tmpPath = configPath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, json, 'utf-8');
    fs.renameSync(tmpPath, configPath);
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // temp cleanup is best-effort
    }
    return { ok: false, error: `Failed to write whitelist config: ${(err as Error).message}` };
  }

  return { ok: true, path: configPath };
}

/**
 * Single source of truth for whitelist validation -- used both at load time
 * and on save, so the admin console can never write a file the kiosk would
 * refuse to load. `source` is a human label used in error messages.
 */
export function validateWhitelist(parsed: unknown, source: string): WhitelistFile {
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as Record<string, unknown>).sites)) {
    throw new Error(`Whitelist ${source} must be an object with a "sites" array.`);
  }

  const rawSites = (parsed as { sites: unknown[] }).sites;
  const sites: WhitelistEntry[] = rawSites.map((entry, index) => validateEntry(entry, index));

  return { sites };
}

function validateEntry(entry: unknown, index: number): WhitelistEntry {
  if (typeof entry !== 'object' || entry === null) {
    throw new Error(`Whitelist entry #${index} must be an object.`);
  }
  const e = entry as Record<string, unknown>;

  if (typeof e.name !== 'string' || e.name.trim() === '') {
    throw new Error(`Whitelist entry #${index} is missing a valid "name".`);
  }

  if (typeof e.url !== 'string') {
    throw new Error(`Whitelist entry #${index} ("${e.name}") is missing a valid "url".`);
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(e.url);
  } catch {
    throw new Error(`Whitelist entry #${index} ("${e.name}") has an unparsable "url": ${e.url}`);
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error(`Whitelist entry #${index} ("${e.name}") "url" must be http:// or https://.`);
  }

  let allowedHosts: string[] | undefined;
  if (e.allowedHosts !== undefined) {
    if (!Array.isArray(e.allowedHosts) || !e.allowedHosts.every((h) => typeof h === 'string')) {
      throw new Error(`Whitelist entry #${index} ("${e.name}") "allowedHosts" must be an array of strings.`);
    }
    const rules = e.allowedHosts as string[];
    for (const rule of rules) {
      if (!isValidHostRule(rule)) {
        throw new Error(`Whitelist entry #${index} ("${e.name}") has a malformed "allowedHosts" rule: "${rule}".`);
      }
    }
    allowedHosts = rules;
  }

  let allowSubdomains: boolean | undefined;
  if (e.allowSubdomains !== undefined) {
    if (typeof e.allowSubdomains !== 'boolean') {
      throw new Error(`Whitelist entry #${index} ("${e.name}") "allowSubdomains" must be a boolean.`);
    }
    allowSubdomains = e.allowSubdomains;
  }

  let embedHosts: string[] | undefined;
  if (e.embedHosts !== undefined) {
    if (!Array.isArray(e.embedHosts) || !e.embedHosts.every((h) => typeof h === 'string')) {
      throw new Error(`Whitelist entry #${index} ("${e.name}") "embedHosts" must be an array of strings.`);
    }
    const rules = e.embedHosts as string[];
    for (const rule of rules) {
      if (!isValidHostRule(rule)) {
        throw new Error(`Whitelist entry #${index} ("${e.name}") has a malformed "embedHosts" rule: "${rule}".`);
      }
    }
    embedHosts = rules;
  }

  return {
    name: e.name,
    url: e.url,
    icon: typeof e.icon === 'string' ? e.icon : undefined,
    allowedHosts,
    allowSubdomains,
    embedHosts,
  };
}

/**
 * Rejects malformed wildcard rules outright (fails closed) instead of
 * letting them accidentally match everything, e.g. "*.*" or "**.com".
 */
function isValidHostRule(rule: string): boolean {
  if (rule.trim() === '') return false;
  // A rule must be a bare hostname, optionally "*."-wildcarded. Anything that
  // carries a scheme, port, path, query, or whitespace -- e.g.
  // "https://web.toddleapp.com" or "j100coders.org/coder" -- can never match a
  // hostname, so it would silently break every navigation to that site. Reject
  // it outright instead of storing a rule that always fails to match.
  if (/[/:?#\s]/.test(rule)) return false;
  if (rule.startsWith('*.')) {
    const base = rule.slice(2);
    return base !== '' && !base.includes('*') && !base.startsWith('.');
  }
  return !rule.includes('*');
}

function normalizeHost(host: string): string {
  const lower = host.toLowerCase();
  return lower.endsWith('.') ? lower.slice(0, -1) : lower;
}

/**
 * Wildcard rules ("*.domain.com") match subdomains only via a dot-anchored
 * suffix check -- NOT the bare apex domain (mirrors TLS wildcard-cert
 * semantics) and NOT via naive endsWith/includes, which would let
 * "notdomain.com" or "domain.com.evil.com" slip through.
 */
function hostMatchesRule(candidateHost: string, rule: string): boolean {
  const host = normalizeHost(candidateHost);
  const normalizedRule = normalizeHost(rule);

  if (normalizedRule.startsWith('*.')) {
    const base = normalizedRule.slice(2);
    if (base === '' || base.includes('*')) return false;
    return host.endsWith('.' + base);
  }

  return host === normalizedRule;
}

function hostAllowedByAnyEntry(host: string, whitelist: WhitelistEntry[], includeEmbed: boolean): boolean {
  for (const entry of whitelist) {
    const rules = entry.allowedHosts && entry.allowedHosts.length > 0
      ? entry.allowedHosts
      : [new URL(entry.url).hostname];

    if (rules.some((rule) => hostMatchesRule(host, rule))) {
      return true;
    }

    // allowSubdomains: the entry's own host plus every "*.host" subdomain is
    // allowed, so a single "google.com" entry covers docs/drive/meet.google.com
    // without the admin enumerating each. Dot-anchored suffix -- identical to
    // the "*." wildcard semantics, so "notgoogle.com" can never match.
    if (entry.allowSubdomains) {
      let base: string;
      try {
        base = normalizeHost(new URL(entry.url).hostname);
      } catch {
        base = '';
      }
      if (base !== '' && (host === base || host.endsWith('.' + base))) {
        return true;
      }
    }

    // embedHosts only ever license sub-frame (iframe) loads, never top-level
    // browsing -- include them only for the frame check.
    if (includeEmbed && entry.embedHosts?.some((rule) => hostMatchesRule(host, rule))) {
      return true;
    }
  }
  return false;
}

/**
 * Single source of truth for "is this URL allowed" -- used by every
 * interception point (will-navigate, will-redirect, setWindowOpenHandler)
 * and by the navigate-to IPC handler, so there is no risk of the rules
 * drifting between call sites. This is the STRICT check: embedHosts are NOT
 * honored here.
 */
export function isUrlAllowed(targetUrl: string, whitelist: WhitelistEntry[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return false;
  }

  // Scheme allowlist applies unconditionally, before any host comparison --
  // blocks javascript:, file:, data:, chrome:, about:, blob:, etc. even if
  // some whitelist rule string coincidentally appears inside them.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  return hostAllowedByAnyEntry(parsed.hostname, whitelist, false);
}

/**
 * Frame check for sub-frame (iframe) navigations: a frame URL may be allowed
 * either strictly (allowedHosts / the site's own host) OR via embedHosts.
 * Never call this for main-frame navigations, redirects, or window.open --
 * those must use isUrlAllowed().
 */
export function isFrameUrlAllowed(targetUrl: string, whitelist: WhitelistEntry[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  return hostAllowedByAnyEntry(parsed.hostname, whitelist, true);
}
