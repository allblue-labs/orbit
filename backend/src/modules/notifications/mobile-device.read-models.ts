export const MOBILE_PLATFORMS = ['IOS', 'ANDROID'] as const;
export type MobilePlatform = (typeof MOBILE_PLATFORMS)[number];

export const MOBILE_PUSH_PROVIDERS = ['FCM', 'APNS'] as const;
export type MobilePushProvider = (typeof MOBILE_PUSH_PROVIDERS)[number];

export interface MobileDeviceInstallationReadModel {
  id: string;
  deviceInstanceId: string;
  platform: MobilePlatform;
  pushProvider: MobilePushProvider;
  appVersion: string;
  osVersion: string | null;
  locale: string | null;
  timezone: string | null;
  enabled: boolean;
  lastSeenAt: string;
  tokenUpdatedAt: string;
  createdAt: string;
  revokedAt: string | null;
}

export type MobileNotificationType =
  'WORK_ASSIGNED' | 'ARTIFACT_AVAILABLE' | 'SYNC_ATTENTION_REQUIRED';

export interface MobilePushPayloadReadModel {
  version: 1;
  notificationId: string;
  type: MobileNotificationType;
  deepLink: string;
  title: string;
  body: string;
}
