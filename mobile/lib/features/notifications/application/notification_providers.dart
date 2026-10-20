/// Provedores das notificações.
///
/// A home lê isto em paralelo com o painel: são duas requisições curtas, e
/// encadeá-las atrasaria a abertura pelo tempo da mais lenta somado ao da
/// outra. O sino e os avisos podem chegar depois do resto da tela.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/contracts/notification_contracts.dart';
import '../../field/application/field_providers.dart' show fieldScopeKey;
import '../../operations/data/operations_repository.dart' show CachedResult;
import '../data/notification_repository.dart';

final notificationRepositoryProvider = Provider<NotificationRepository>(
  (ref) => NotificationRepository(
    client: ref.watch(apiClientProvider),
    cache: ref.watch(readCacheProvider),
  ),
);

/// As notificações recentes e o total de não lidas.
final notificationsProvider =
    FutureProvider.autoDispose<CachedResult<OrbitNotificationPage>>((ref) {
      final scope = fieldScopeKey(ref);
      return ref.watch(notificationRepositoryProvider).recent(scopeKey: scope);
    });
