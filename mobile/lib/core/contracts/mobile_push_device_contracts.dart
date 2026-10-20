enum MobilePlatform { ios, android }

enum MobilePushProvider { fcm, apns }

class RegisterMobileDeviceRequest {
  const RegisterMobileDeviceRequest({
    required this.deviceInstanceId,
    required this.platform,
    required this.pushProvider,
    required this.pushToken,
    required this.appVersion,
    this.osVersion,
    this.locale,
    this.timezone,
  });

  final String deviceInstanceId;
  final MobilePlatform platform;
  final MobilePushProvider pushProvider;
  final String pushToken;
  final String appVersion;
  final String? osVersion;
  final String? locale;
  final String? timezone;

  Map<String, Object> toJson() => {
    'deviceInstanceId': deviceInstanceId,
    'platform': platform.name.toUpperCase(),
    'pushProvider': pushProvider.name.toUpperCase(),
    'pushToken': pushToken,
    'appVersion': appVersion,
    if (osVersion != null) 'osVersion': osVersion!,
    if (locale != null) 'locale': locale!,
    if (timezone != null) 'timezone': timezone!,
  };
}

class MobileDeviceInstallationContract {
  const MobileDeviceInstallationContract({
    required this.id,
    required this.deviceInstanceId,
    required this.platform,
    required this.pushProvider,
    required this.appVersion,
    required this.enabled,
    required this.lastSeenAt,
    required this.tokenUpdatedAt,
    required this.createdAt,
    this.osVersion,
    this.locale,
    this.timezone,
    this.revokedAt,
  });

  final String id;
  final String deviceInstanceId;
  final String platform;
  final String pushProvider;
  final String appVersion;
  final String? osVersion;
  final String? locale;
  final String? timezone;
  final bool enabled;
  final DateTime lastSeenAt;
  final DateTime tokenUpdatedAt;
  final DateTime createdAt;
  final DateTime? revokedAt;

  factory MobileDeviceInstallationContract.fromJson(
    Map<String, Object?> json,
  ) => MobileDeviceInstallationContract(
    id: json['id']! as String,
    deviceInstanceId: json['deviceInstanceId']! as String,
    platform: json['platform']! as String,
    pushProvider: json['pushProvider']! as String,
    appVersion: json['appVersion']! as String,
    osVersion: json['osVersion'] as String?,
    locale: json['locale'] as String?,
    timezone: json['timezone'] as String?,
    enabled: json['enabled']! as bool,
    lastSeenAt: DateTime.parse(json['lastSeenAt']! as String),
    tokenUpdatedAt: DateTime.parse(json['tokenUpdatedAt']! as String),
    createdAt: DateTime.parse(json['createdAt']! as String),
    revokedAt: json['revokedAt'] == null
        ? null
        : DateTime.parse(json['revokedAt']! as String),
  );
}
