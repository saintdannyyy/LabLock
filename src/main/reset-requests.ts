import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { ResetRequest } from '../shared/types';

// Pending "I forgot my password" requests from the picker, stored in the
// writable per-user data dir as <userData>/reset-requests.json. The child can
// only enqueue a request (profileId + profileName, no password material); the
// admin console lists them and either opens the profile's password form
// (PROFILE_SET_PASSWORD clears the request) or dismisses one explicitly.
const RESET_REQUESTS_FILE = 'reset-requests.json';

function resetRequestsPath(): string {
  return path.join(app.getPath('userData'), RESET_REQUESTS_FILE);
}

function readAllRequests(): ResetRequest[] {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(resetRequestsPath(), 'utf-8'));
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (r): r is ResetRequest =>
          typeof r === 'object' &&
          r !== null &&
          typeof (r as ResetRequest).profileId === 'string' &&
          typeof (r as ResetRequest).profileName === 'string' &&
          typeof (r as ResetRequest).requestedAt === 'string',
      );
    }
  } catch {
    // missing/corrupt file -> no pending requests
  }
  return [];
}

function writeAllRequests(requests: ResetRequest[]): void {
  const file = resetRequestsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(requests, null, 2) + '\n', 'utf-8');
}

// Enqueue a password-reset request from the picker. Re-requesting replaces the
// existing entry's timestamp instead of duplicating it. Best-effort: a disk
// failure must never break the picker flow (the request just won't land).
export function requestReset(profileId: string, profileName: string): void {
  try {
    const requests = readAllRequests().filter((r) => r.profileId !== profileId);
    requests.push({ profileId, profileName, requestedAt: new Date().toISOString() });
    writeAllRequests(requests);
  } catch (err) {
    console.error('Failed to store password-reset request:', err);
  }
}

export function getPendingRequests(): ResetRequest[] {
  return readAllRequests();
}

// Drop one request (after the admin sets a new password for the profile).
export function clearRequestForProfile(profileId: string): void {
  try {
    const remaining = readAllRequests().filter((r) => r.profileId !== profileId);
    writeAllRequests(remaining);
  } catch (err) {
    console.error('Failed to clear password-reset request:', err);
  }
}

// Drop every pending request (admin "Dismiss all").
export function clearAllRequests(): void {
  try {
    writeAllRequests([]);
  } catch (err) {
    console.error('Failed to clear password-reset requests:', err);
  }
}
