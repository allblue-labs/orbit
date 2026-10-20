/// Acesso às notificações — `/notifications`.
///
/// Leitura curta e cacheável: a home mostra os avisos e o sino, e nenhum dos
/// dois justifica bloquear a abertura do aplicativo. Offline, vale o que veio
/// da última vez; um aviso de ontem é melhor que um sino vazio que mente.
library;

import '../../../core/contracts/notification_contracts.dart';
import '../../../core/errors/orbit_exception.dart';
import '../../../core/network/orbit_api_client.dart';
import '../../../core/storage/read_cache.dart';
import '../../operations/data/operations_repository.dart' show CachedResult;

class NotificationRepository {
  const NotificationRepository({
    required OrbitApiClient client,
    required ReadCache cache,
  }) : _client = client,
       _cache = cache;

  final OrbitApiClient _client;
  final ReadCache _cache;

  /// As notificações mais recentes, com o total de não lidas.
  Future<CachedResult<OrbitNotificationPage>> recent({
    required String scopeKey,
    int limit = 10,
  }) async {
    final key = 'notifications.$scopeKey';
    try {
      final data = await _client.get<Map<String, dynamic>>(
        '/notifications',
        query: {'limit': limit},
      );
      await _cache.write(key, data);
      return CachedResult(
        value: OrbitNotificationPage.fromJson(data),
        cachedAt: null,
      );
    } on OrbitException catch (error) {
      if (!error.isOffline && !error.isServer) rethrow;
      final cached = await _cache.read(key);
      if (cached == null) rethrow;
      return CachedResult(
        value: OrbitNotificationPage.fromJson(cached.value),
        cachedAt: cached.cachedAt,
      );
    }
  }

  /// Marca uma notificação como lida.
  Future<void> markRead(String id) =>
      _client.patch<Map<String, dynamic>>('/notifications/$id/read', body: {});

  /// Marca todas como lidas.
  ///
  /// Existe porque a alternativa é tocar em quinze avisos um a um — e tocar
  /// num aviso **navega** para o que ele é sobre, então limpar a caixa a
  /// toques significa entrar e voltar quinze vezes.
  Future<void> markAllRead() =>
      _client.patch<Map<String, dynamic>>('/notifications/read-all', body: {});
}
