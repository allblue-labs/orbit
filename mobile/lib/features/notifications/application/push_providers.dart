/// A fiação do push.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../../../app/providers.dart';
import '../../../core/push/push_channel.dart';
import '../../../core/storage/device_identity.dart';
import '../data/mobile_device_repository.dart';
import 'push_registrar.dart';

/// A fonte do token.
///
/// Sobreposta nos testes por [SilentPushTokenSource]; em produção é o canal
/// nativo, que devolve vazio onde a parte nativa não existe.
final pushTokenSourceProvider = Provider<PushTokenSource>(
  (ref) => PushChannel(),
);

final mobileDeviceRepositoryProvider = Provider<MobileDeviceRepository>(
  (ref) => MobileDeviceRepository(client: ref.watch(apiClientProvider)),
);

final pushRegistrarProvider = Provider<PushRegistrar>(
  (ref) => PushRegistrar(
    source: ref.watch(pushTokenSourceProvider),
    repository: ref.watch(mobileDeviceRepositoryProvider),
    logger: ref.watch(loggerProvider),
    deviceInstanceId: () async =>
        deviceInstanceId(ref.read(sharedPreferencesProvider)),
    appVersion: () async {
      final info = await PackageInfo.fromPlatform();
      return '${info.version}+${info.buildNumber}';
    },
  ),
);
