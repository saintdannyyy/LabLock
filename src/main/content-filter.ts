// Cloudflare content filter (the "middle man" for the loose zone).
//
// The whitelist remains the zero-latency fast path: any request to a strictly
// whitelisted host is passed through untouched. Everything else is policed by
// this module: when enabled, any http(s) request whose host ISN'T strictly
// whitelisted -- iframes, third-party subresources pulled in by approved
// sites, and (with the loose policy on) non-whitelisted top-level loads -- is
// checked against a Cloudflare DNS-over-HTTPS resolver, and hosts blocked by
// its policy are cancelled before they load. That's what lets the admin
// approve one site without enumerating every CDN/embed/auth subdomain:
// anything Cloudflare's policy flags (adult, gambling/betting, malware, ...)
// is dropped.
//
// Config lives at <userData>/filter.json, lazy-loaded like settings.ts.
// 'families' uses the built-in 1.1.1.1 Families resolver (malware + adult,
// zero setup); 'gateway' uses the admin's Zero Trust Gateway DoH endpoint,
// which adds dashboard-managed categories.
import fs from 'fs';
import path from 'path';
import { app, session } from 'electron';
import type { ContentFilterConfig, ContentFilterMode, FilterTestResult, WhitelistEntry } from '../shared/types';
import { isUrlAllowed } from './whitelist';

const FILTER_FILE = 'filter.json';

// 1.1.1.3 (Families) blocks malware + adult content with no account. The
// admin's Gateway DoH URL replaces it for betting/gambling and custom
// categories when 'gateway' mode is configured.
const FAMILIES_DOH = 'https://family.cloudflare-dns.com/dns-query';

// How long a host verdict is trusted before it is re-checked. 10 minutes keeps
// policy changes snappy without paying a DoH round-trip on every request.
const CACHE_TTL_MS = 10 * 60 * 1000;

// DoH transport timeout. A timeout fails OPEN (allow) so a Cloudflare outage or
// a flaky lab connection never bricks every approved site.
const DOH_TIMEOUT_MS = 3000;

const BLOCKED = 'blocked';
const ALLOWED = 'allowed';
type Verdict = typeof BLOCKED | typeof ALLOWED;

let cachedConfig: ContentFilterConfig | null = null;

const verdictCache = new Map<string, { verdict: Verdict; expiresAt: number }>();
const inFlight = new Map<string, Promise<Verdict>>();

function filterPath(): string {
  return path.join(app.getPath('userData'), FILTER_FILE);
}

// Locked to Cloudflare: an https:// endpoint on a *.cloudflare-gateway.com host
// with a /dns-query path (the format the Zero Trust dashboard exposes). Any
// other URL is rejected so a stray paste can't point the kiosk at an arbitrary
// resolver.
function isValidGatewayDoH(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }
  const host = parsed.hostname.toLowerCase();
  const gatewayHost = host === 'cloudflare-gateway.com' || host.endsWith('.cloudflare-gateway.com');
  if (parsed.protocol !== 'https:' || !gatewayHost) return undefined;
  if (!parsed.pathname.endsWith('/dns-query')) return undefined;
  return parsed.toString();
}

function validateConfig(raw: Partial<ContentFilterConfig>): ContentFilterConfig {
  const enabled = raw.enabled === true;
  const mode: ContentFilterMode = raw.mode === 'gateway' ? 'gateway' : 'families';
  return { enabled, mode, gatewayDoH: isValidGatewayDoH(raw.gatewayDoH) };
}

export function loadFilterConfig(): ContentFilterConfig {
  if (cachedConfig) return cachedConfig;
  let config: ContentFilterConfig = { enabled: false, mode: 'families' };
  try {
    const raw = fs.readFileSync(filterPath(), 'utf8');
    config = validateConfig(JSON.parse(raw) as Partial<ContentFilterConfig>);
  } catch {
    // missing / corrupt filter.json -> filter disabled
  }
  cachedConfig = config;
  return config;
}

export function saveFilterConfig(payload: unknown): { ok: true } | { ok: false; error: string } {
  if (typeof payload !== 'object' || payload === null) {
    return { ok: false, error: 'Filter config must be an object.' };
  }
  const validated = validateConfig(payload as Partial<ContentFilterConfig>);
  const file = filterPath();
  const tmp = `${file}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(validated, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // best-effort temp cleanup
    }
    return { ok: false, error: `Failed to write filter config: ${(err as Error).message}` };
  }
  cachedConfig = validated;
  verdictCache.clear();
  return { ok: true };
}

function resolverUrl(config: ContentFilterConfig): string {
  if (config.mode === 'gateway' && config.gatewayDoH) return config.gatewayDoH;
  return FAMILIES_DOH;
}

interface DohAnswer {
  rcode: number;
  aRecords: string[];
  aaaaRecords: string[];
}

// Encode a single-question DNS message (RFC 8484 body). QTYPE 1 = A, 28 = AAAA.
function buildDnsQuery(host: string, type: number): Buffer {
  const id = Math.floor(Math.random() * 0xffff);
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(0x0100, 2); // RD
  header.writeUInt16BE(1, 4); // QDCOUNT
  const qnameParts: Buffer[] = [];
  for (const label of host.split('.')) {
    const bytes = Buffer.from(label, 'latin1');
    qnameParts.push(Buffer.from([bytes.length]), bytes);
  }
  qnameParts.push(Buffer.from([0]));
  const qname = Buffer.concat(qnameParts);
  const question = Buffer.alloc(4);
  question.writeUInt16BE(type, 0);
  question.writeUInt16BE(1, 2); // CLASS IN
  return Buffer.concat([header, qname, question]);
}

// Walk a DNS name (compression pointer aware) and return the new offset.
function skipDnsName(buf: Buffer, off: number): number {
  for (;;) {
    const len = buf[off];
    if ((len & 0xc0) === 0xc0) return off + 2;
    off += 1 + len;
    if (len === 0) return off;
  }
}

// Parse a DoH wire-format response into its rcode and A/AAAA records.
function parseDohResponse(buf: Buffer): DohAnswer {
  const rcode = buf.readUInt16BE(2) & 0x0f;
  const ancount = buf.readUInt16BE(6);
  const aRecords: string[] = [];
  const aaaaRecords: string[] = [];
  let off = skipDnsName(buf, 12) + 4; // skip question name + qtype/qclass
  for (let i = 0; i < ancount; i++) {
    off = skipDnsName(buf, off);
    const type = buf.readUInt16BE(off);
    const rdlen = buf.readUInt16BE(off + 8);
    const dataStart = off + 10;
    if (type === 1 && rdlen === 4) {
      aRecords.push(`${buf[dataStart]}.${buf[dataStart + 1]}.${buf[dataStart + 2]}.${buf[dataStart + 3]}`);
    } else if (type === 28 && rdlen === 16) {
      const groups: string[] = [];
      for (let g = 0; g < 8; g++) {
        groups.push(buf.readUInt16BE(dataStart + g * 2).toString(16));
      }
      // Normalize the all-zeros marker to "::" whatever its spelling
      // (Cloudflare Families answers a block as 0:0:0:0:0:0:0:0).
      aaaaRecords.push(groups.every((g) => g === '0') ? '::' : groups.join(':'));
    }
    off = dataStart + rdlen;
  }
  return { rcode, aRecords, aaaaRecords };
}

// RFC 8484 wire-format DoH POST. IMPORTANT: only the wire-format
// (application/dns-message) endpoint on Cloudflare's filtered resolvers applies
// their policy -- the JSON API (application/dns-json) serves unfiltered answers
// and must not be used. Returns null only on a transport/parse failure; the
// caller treats that as "unable to judge", which fails OPEN.
async function queryDoh(host: string, type: number, url: string): Promise<DohAnswer | null> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { accept: 'application/dns-message', 'content-type': 'application/dns-message' },
      body: new Uint8Array(buildDnsQuery(host, type)),
      signal: AbortSignal.timeout(DOH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return parseDohResponse(Buffer.from(await res.arrayBuffer()));
  } catch {
    return null;
  }
}

// A single lookup (A or AAAA) is "blocked" when the resolver refuses to answer
// OR pins every record to Cloudflare's block marker. Families blocks with
// RCODE 0 + 0.0.0.0/:: (not NXDOMAIN), while Gateway returns NXDOMAIN -- both
// must count as blocked.
function lookupBlocked(answer: DohAnswer, type: 'A' | 'AAAA'): boolean {
  if (answer.rcode !== 0) return true;
  const records = type === 'A' ? answer.aRecords : answer.aaaaRecords;
  if (records.length === 0) return true;
  const marker = type === 'A' ? '0.0.0.0' : '::';
  return records.every((ip) => ip === marker);
}

// Blocked ONLY when BOTH the A and AAAA lookups are blocked -- a host that
// resolves on AAAA alone must not be false-blocked. Any transport error fails
// OPEN.
async function checkHost(host: string): Promise<Verdict> {
  const config = loadFilterConfig();
  const url = resolverUrl(config);
  const [a, aaaa] = await Promise.all([queryDoh(host, 1, url), queryDoh(host, 28, url)]);
  if (a === null || aaaa === null) return ALLOWED;
  return lookupBlocked(a, 'A') && lookupBlocked(aaaa, 'AAAA') ? BLOCKED : ALLOWED;
}

// Per-host verdict with cache + in-flight coalescing so concurrent requests to
// the same host share one lookup.
export function hostVerdict(host: string): Promise<Verdict> {
  const now = Date.now();
  const hit = verdictCache.get(host);
  if (hit && hit.expiresAt > now) return Promise.resolve(hit.verdict);
  const pending = inFlight.get(host);
  if (pending) return pending;
  const run = checkHost(host)
    .then((verdict) => {
      verdictCache.set(host, { verdict, expiresAt: Date.now() + CACHE_TTL_MS });
      return verdict;
    })
    .finally(() => inFlight.delete(host));
  inFlight.set(host, run);
  return run;
}

// Skip hosts the DoH resolver can't meaningfully judge (loopback, link-local,
// bare IPs) so local dev and intranet resources are never cancelled.
function shouldCheck(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.local')) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  if (host.includes(':') && !host.includes('.')) return false; // IPv6-ish literal
  return host.includes('.');
}

// Admin console's "Test a domain" against the live filter.
export async function testDomain(rawUrl: string): Promise<FilterTestResult> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, allowed: false, host: '', detail: 'That is not a valid URL.' };
  }
  const host = parsed.hostname;
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, allowed: false, host, detail: 'Only http(s) URLs can be tested.' };
  }
  if (!shouldCheck(host)) {
    return { ok: true, allowed: true, host, detail: 'Local/private hosts are never filtered.' };
  }
  const verdict = await hostVerdict(host);
  return {
    ok: true,
    allowed: verdict === ALLOWED,
    host,
    detail: verdict === ALLOWED ? 'Allowed by the content filter.' : 'Blocked by the content filter (Cloudflare policy).',
  };
}

// Attach the request filter to the app's default session. Strictly-whitelisted
// hosts bypass the lookup entirely; everything else -- iframes, subresources
// and (when the loose policy is on) non-whitelisted top-level loads -- is
// checked against Cloudflare and cancelled when the policy blocks the host.
// The navigation guard (navigation-guard.ts) decides what even reaches the
// network layer: it only releases a non-whitelisted http(s) top-level load
// when the loose policy is on. Blocked hosts are reported via onFilterBlock at
// most once per host per session to keep the activity log readable.
export function installContentFilter(getWhitelist: () => WhitelistEntry[], onFilterBlock: (url: string) => void): void {
  const loggedBlocks = new Set<string>();

  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => {
      if (!loadFilterConfig().enabled) {
        callback({ cancel: false });
        return;
      }
      let host: string;
      try {
        host = new URL(details.url).hostname;
      } catch {
        callback({ cancel: false });
        return;
      }
      // Admin-approved hosts bypass the filter entirely (no DoH latency, no
      // false positives on a site the school explicitly chose).
      if (isUrlAllowed(details.url, getWhitelist())) {
        callback({ cancel: false });
        return;
      }
      if (!shouldCheck(host)) {
        callback({ cancel: false });
        return;
      }

      hostVerdict(host).then((verdict) => {
        if (verdict === BLOCKED) {
          if (!loggedBlocks.has(host)) {
            loggedBlocks.add(host);
            onFilterBlock(details.url);
          }
          callback({ cancel: true });
        } else {
          callback({ cancel: false });
        }
      });
    },
  );
}
