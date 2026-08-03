import * as fs from 'fs';
import { whitelistConfigPath } from './paths';
import type { WhitelistEntry, WhitelistFile } from '../shared/types';

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

  return validateWhitelist(parsed, configPath);
}

function validateWhitelist(parsed: unknown, configPath: string): WhitelistFile {
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as Record<string, unknown>).sites)) {
    throw new Error(`Whitelist config at ${configPath} must be an object with a "sites" array.`);
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

  return {
    name: e.name,
    url: e.url,
    icon: typeof e.icon === 'string' ? e.icon : undefined,
    allowedHosts,
  };
}

/**
 * Rejects malformed wildcard rules outright (fails closed) instead of
 * letting them accidentally match everything, e.g. "*.*" or "**.com".
 */
function isValidHostRule(rule: string): boolean {
  if (rule.trim() === '') return false;
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

/**
 * Single source of truth for "is this URL allowed" -- used by every
 * interception point (will-navigate, will-redirect, will-frame-navigate,
 * setWindowOpenHandler) and by the navigate-to IPC handler, so there is no
 * risk of the rules drifting between call sites.
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

  const host = parsed.hostname;

  for (const entry of whitelist) {
    const rules = entry.allowedHosts && entry.allowedHosts.length > 0
      ? entry.allowedHosts
      : [new URL(entry.url).hostname];

    if (rules.some((rule) => hostMatchesRule(host, rule))) {
      return true;
    }
  }

  return false;
}
