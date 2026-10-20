/// Comandos de execução de campo (MB-02).
///
/// ```text
/// GET  /mobile/field/operations/:id/execution-preparation
/// POST /mobile/field/operations/:id/commands/start
/// POST /mobile/field/operations/:id/commands/complete
/// POST /mobile/field/operations/:id/notes
/// PUT  /mobile/field/operations/:id/checklists/:checklistId
/// POST /mobile/field/operations/:id/materials
/// GET  /mobile/field/operations/:id/timeline
/// ```
///
/// **Não existe atualização genérica de status.** Nenhum método aqui envia
/// `{status: IN_PROGRESS}`: iniciar e concluir são comandos semânticos, e é o
/// servidor que decide se a transição vale.
///
/// Todo comando carrega o envelope: `commandId`, `idempotencyKey`,
/// `expectedVersion` e `occurredAt`. Os dois primeiros tornam o reenvio
/// inofensivo; o terceiro impede sobrescrever o que outra pessoa mudou.
library;

import '../../../core/contracts/field_operation_contracts.dart';
import '../../../core/contracts/mobile_field_contracts.dart';
import '../../../core/network/orbit_api_client.dart';

class FieldOperationRepository {
  const FieldOperationRepository({required OrbitApiClient client})
    : _client = client;

  final OrbitApiClient _client;

  String _base(String operationId) =>
      '/mobile/field/operations/${Uri.encodeComponent(operationId)}';

  /// O contexto de execução.
  ///
  /// **Leitura pura.** Abrir a preparação não inicia, não reserva material e
  /// não escreve na linha do tempo — é um `GET`, e o gate de smoke prova que
  /// o estado do atendimento não muda ao abri-la.
  Future<FieldOperationExecutionPreparationContract> preparation(
    String operationId,
  ) async {
    final data = await _client.get<Map<String, dynamic>>(
      '${_base(operationId)}/execution-preparation',
    );
    return FieldOperationExecutionPreparationContract.fromJson(data);
  }

  Future<FieldOperationCommandResultContract> start(
    String operationId,
    FieldOperationCommandContract command,
  ) async {
    final data = await _client.post<Map<String, dynamic>>(
      '${_base(operationId)}/commands/start',
      body: command.toJson(),
    );
    return FieldOperationCommandResultContract.fromJson(data);
  }

  Future<FieldOperationCommandResultContract> complete(
    String operationId,
    FieldOperationCommandContract command,
  ) async {
    final data = await _client.post<Map<String, dynamic>>(
      '${_base(operationId)}/commands/complete',
      body: command.toJson(),
    );
    return FieldOperationCommandResultContract.fromJson(data);
  }

  /// Pede ao dono o cancelamento do atendimento.
  ///
  /// **Pedido, e não comando.** Por isso fica fora de `commands/` e não carrega
  /// `expectedVersion`: nada muda no atendimento, então não há versão a
  /// disputar. O que volta é o pedido registrado, para a tela mostrar que foi
  /// enviado.
  ///
  /// As fotos viajam pelo id **local** da captura: no instante do pedido elas
  /// quase nunca existem no servidor, porque o upload é offline-first. O
  /// servidor costura as duas coisas quando o arquivo enfim chega.
  ///
  /// Reenviar é inofensivo: havendo pedido em aberto, o servidor devolve o
  /// mesmo em vez de recusar — o que importa quando a rede cai depois de
  /// gravar.
  Future<MobilePendingCancellationContract?> requestCancellation(
    String operationId, {
    required String reason,
    List<String> evidenceLocalIds = const [],
  }) async {
    final data = await _client.post<Map<String, dynamic>>(
      '${_base(operationId)}/cancellation-request',
      body: {
        'reason': reason,
        if (evidenceLocalIds.isNotEmpty) 'evidenceLocalIds': evidenceLocalIds,
      },
    );
    return MobilePendingCancellationContract.fromJson(data);
  }

  /// Uma observação operacional.
  ///
  /// `visibility` é do contrato: interna por padrão, e o servidor decide o que
  /// fazer com cada uma. O app não inventa destinatário.
  Future<void> addNote(
    String operationId,
    FieldOperationCommandContract command, {
    required String note,
    String visibility = 'INTERNAL',
  }) => _client.post<Object?>(
    '${_base(operationId)}/notes',
    body: {...command.toJson(), 'note': note, 'visibility': visibility},
  );

  /// Atualiza um checklist.
  ///
  /// O contrato recebe o mapa de respostas inteiro (`answers`), então o app
  /// parte sempre do que o servidor devolveu e altera um item — nunca monta o
  /// mapa do zero.
  Future<void> updateChecklist(
    String operationId,
    String checklistId,
    FieldOperationCommandContract command, {
    required Map<String, dynamic> answers,
    String? notes,
    bool complete = false,
  }) => _client.put<Object?>(
    '${_base(operationId)}/checklists/${Uri.encodeComponent(checklistId)}',
    body: {
      ...command.toJson(),
      'answers': answers,
      if (notes != null) 'notes': notes,
      'complete': complete,
    },
  );

  /// Registra consumo de material.
  ///
  /// O estoque é do Inventory: o app envia a intenção e lê o saldo que voltou.
  /// Recusa por falta de estoque é decisão do servidor, apresentada como veio.
  Future<FieldOperationMaterialResultContract> registerMaterial(
    String operationId,
    FieldOperationCommandContract command, {
    required String catalogItemId,
    required num quantity,
    String? reason,
    String? notes,
  }) async {
    final data = await _client.post<Map<String, dynamic>>(
      '${_base(operationId)}/materials',
      body: {
        ...command.toJson(),
        'catalogItemId': catalogItemId,
        'quantity': quantity,
        if (reason != null) 'reason': reason,
        if (notes != null) 'notes': notes,
      },
    );
    return FieldOperationMaterialResultContract.fromJson(data);
  }

  Future<FieldOperationTimelinePageContract> timeline(
    String operationId, {
    int limit = 20,
    String? cursor,
  }) async {
    final data = await _client.get<Map<String, dynamic>>(
      '${_base(operationId)}/timeline',
      query: {'limit': limit, if (cursor != null) 'cursor': cursor},
    );
    return FieldOperationTimelinePageContract.fromJson(data);
  }
}
