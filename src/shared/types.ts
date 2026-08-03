export interface WhitelistEntry {
  name: string;
  url: string;
  icon?: string;
  allowedHosts?: string[];
}

export interface WhitelistFile {
  sites: WhitelistEntry[];
}

export interface NavigateResult {
  ok: boolean;
  reason?: string;
}

export const IPC = {
  GET_WHITELIST: 'lockdown:get-whitelist',
  NAVIGATE_TO: 'lockdown:navigate-to',
  GO_HOME: 'lockdown:go-home',
} as const;
