/// O transporte do protocolo offline.
///
/// Três chamadas, e nada de lógica: empurrar intenções, puxar o delta, buscar
/// o pacote de um item. Quem decide o que fazer com os recibos é o
/// orquestrador.
library;

import '../../../core/contracts/mobile_offline_sync_contracts.dart';
import '../../../core/network/orbit_api_client.dart';

/// O teto do `MobileSyncPushRequestDto` (`@ArrayMaxSize(50)`).
///
/// Enviar mais faria o servidor recusar a leva inteira por validação — o pior
/// desfecho possível, porque nenhum comando avançaria e nada explicaria o
/// porquê.
const pushBatchLimit = 50;

/// O teto do `FieldPackageBatchDto`.
const packageBatchLimit = 20;

class SyncRepository {
  const SyncRepository({required OrbitApiClient client}) : _client = client;

  final OrbitApiClient _client;

  /// Reapresenta intenções ao servidor.
  ///
  /// A ordem importa: o backend processa em sequência e, ao recusar um comando,
  /// **bloqueia** os seguintes do mesmo atendimento. Reordenar aqui mudaria o
  /// que é bloqueado.
  Future<MobileSyncPushResponse> push(
    List<OfflineCommandEnvelope> commands, {
    String? checkpoint,
  }) async {
    assert(commands.length <= pushBatchLimit, 'lote acima do limite do DTO');
    final data = await _client.post<Map<String, dynamic>>(
      '/mobile/field/offline/sync/push',
      body: {
        'commands': commands.map((value) => value.toJson()).toList(),
        if (checkpoint != null) 'checkpoint': checkpoint,
      },
    );
    return MobileSyncPushResponse.fromJson(data);
  }

  /// Busca o delta desde o cursor.
  ///
  /// `knownWorkItemIds` é o que permite ao servidor emitir tombstone: sem
  /// dizer o que se tem em mãos, não há como ele apontar o que deixou de valer.
  Future<MobileSyncPullResponse> pull({
    String? cursor,
    List<String> knownWorkItemIds = const [],
  }) async {
    final data = await _client.post<Map<String, dynamic>>(
      '/mobile/field/offline/sync/pull',
      body: {
        if (cursor != null) 'cursor': cursor,
        if (knownWorkItemIds.isNotEmpty)
          'knownWorkItemIds': knownWorkItemIds.take(500).toList(),
      },
    );
    return MobileSyncPullResponse.fromJson(data);
  }

  /// O pacote de um item, para executá-lo sem rede.
  Future<FieldPackageContract> package(String workItemId) async {
    final data = await _client.get<Map<String, dynamic>>(
      '/mobile/field/offline/packages/$workItemId',
    );
    return FieldPackageContract.fromJson(data);
  }

  Future<List<FieldPackageContract>> packages(List<String> workItemIds) async {
    final data = await _client.post<Map<String, dynamic>>(
      '/mobile/field/offline/packages',
      body: {'workItemIds': workItemIds.take(packageBatchLimit).toList()},
    );
    return (data['packages'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(FieldPackageContract.fromJson)
        .toList(growable: false);
  }
}
