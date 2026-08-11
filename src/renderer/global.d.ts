import type {
  WhitelistFile,
  NavigateResult,
  UiState,
  SaveResult,
  ActivityPage,
  SystemStatus,
  VolumeStatus,
  VolumeRequest,
  PlatformEntry,
  ProfilesFile,
  ScreenTimeStatus,
  UsageSnapshot,
  PlannerFile,
  PlannerTodo,
  WifiScanResult,
  WifiActionResult,
  InstalledApp,
} from '../shared/types';

export {};

declare global {
  // Lightweight profile summary used by the picker (never carries full apps).
  interface ProfileSummary {
    id: string;
    name: string;
    avatarColor: string;
  }

  interface Window {
    // Shape exposed by content-preload.ts (home/picker/blocked) or
    // toolbar-preload.ts (toolbar) via contextBridge.
    lockdown: {
      getWhitelist?(): Promise<WhitelistFile>;
      navigateTo?(url: string): Promise<NavigateResult>;
      goHome(): void;
      // Content-view profile/platform API (home grid + picker).
      getProfiles?(): Promise<ProfileSummary[]>;
      selectProfile?(id: string): Promise<boolean>;
      getPlatforms?(): Promise<PlatformEntry[]>;
      launchApp?(id: string): Promise<{ ok: boolean; error?: string }>;
      // Toolbar-only additions (optional here because the home/blocked
      // preload doesn't expose them).
      goBack?(): void;
      shutdown?(): void;
      restart?(): void;
      getSystemStatus?(includeVolume: boolean): Promise<SystemStatus>;
      setVolume?(req: VolumeRequest): Promise<VolumeStatus>;
      setPanelOpen?(open: boolean): void;
      setBannerOpen?(open: boolean): void;
      switchProfile?(): void;
      getPlanner?(): Promise<PlannerFile>;
      saveTodos?(todos: PlannerTodo[]): Promise<SaveResult>;
      onPlannerChanged?(callback: () => void): void;
      scanWifi?(): Promise<WifiScanResult>;
      connectWifi?(ssid: string, password?: string | null): Promise<WifiActionResult>;
      forgetWifi?(ssid: string): Promise<WifiActionResult>;
      getScreenTimeStatus?(): Promise<ScreenTimeStatus>;
      extendScreenTime?(): void;
      getTheme?(): Promise<'light' | 'dark'>;
      setTheme?(theme: 'light' | 'dark'): Promise<'light' | 'dark'>;
      onThemeChanged?(callback: (theme: 'light' | 'dark') => void): void;
      onUiState?(callback: (state: UiState) => void): void;
      onWhitelistRefreshed?(callback: () => void): void;
      onSystemStatus?(callback: (status: SystemStatus) => void): void;
      onScreenTime?(callback: (status: ScreenTimeStatus) => void): void;
    };
    // Exposed by escape-preload.ts (admin escape dialog + admin console)
    // via contextBridge.
    escapeAPI: {
      sendPasswordResult(password: string): void;
      sendExtendResult(password: string): void;
      getTheme?(): Promise<'light' | 'dark'>;
      onThemeChanged?(callback: (theme: 'light' | 'dark') => void): void;
    };
    adminAPI: {
      getProfiles(): Promise<ProfilesFile>;
      saveProfiles(file: ProfilesFile): Promise<SaveResult>;
      getInstalledApps(): Promise<InstalledApp[]>;
      getInstalledAppIcons(): Promise<Record<string, string>>;
      getActivity(offset: number, limit: number, date?: string): Promise<ActivityPage>;
      clearActivity(): Promise<{ ok: boolean }>;
      getUsage(): Promise<UsageSnapshot>;
      getPlanner(profileId: string): Promise<PlannerFile>;
      savePlanner(profileId: string, file: PlannerFile): Promise<SaveResult>;
      close(): void;
    };
  }
}
