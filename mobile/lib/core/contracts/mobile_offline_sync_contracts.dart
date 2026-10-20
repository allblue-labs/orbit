/// Protocolo offline do MB-04.
///
/// O que trafega não é uma requisição HTTP guardada para depois: é uma
/// **intenção** com identidade, versão observada e instante de ocorrência. A
/// diferença aparece no replay — uma requisição serializada reexecuta o que o
/// app quis fazer; uma intenção é revalidada pelo servidor contra o estado, a
/// autorização e a designação **de agora**.
///
/// Endpoints reais:
///
/// ```text
/// POST /mobile/field/offline/sync/push     até 50 comandos, receipt por comando
/// POST /mobile/field/offline/sync/pull     delta por cursor opaco
/// GET  /mobile/field/offline/packages/:id  pacote de um item
/// POST /mobile/field/offline/packages      até 20 itens
/// ```
library;

import 'mobile_field_contracts.dart';

/// Os seis comandos que o backend aceita offline.
///
/// Não há mais: evidência e artefato não entram por aqui, e `aggregateType` é
/// `OPERATION` e nada além — PMOC e RVT têm pacote de leitura, não mutação.
enum OfflineCommandType {
  operationStart,
  operationChecklistUpdate,
  operationAddNote,
  operationAddMaterial,
  operationComplete,
  customerAcknowledgement,
}

String offlineCommandTypeWire(OfflineCommandType value) => switch (value) {
  OfflineCommandType.operationStart => 'OPERATION_START',
  OfflineCommandType.operationChecklistUpdate => 'OPERATION_CHECKLIST_UPDATE',
  OfflineCommandType.operationAddNote => 'OPERATION_ADD_NOTE',
  OfflineCommandType.operationAddMaterial => 'OPERATION_ADD_MATERIAL',
  OfflineCommandType.operationComplete => 'OPERATION_COMPLETE',
  OfflineCommandType.customerAcknowledgement => 'CUSTOMER_ACKNOWLEDGEMENT',
};

OfflineCommandType offlineCommandTypeFromWire(String value) => switch (value) {
  'OPERATION_START' => OfflineCommandType.operationStart,
  'OPERATION_CHECKLIST_UPDATE' => OfflineCommandType.operationChecklistUpdate,
  'OPERATION_ADD_NOTE' => OfflineCommandType.operationAddNote,
  'OPERATION_ADD_MATERIAL' => OfflineCommandType.operationAddMaterial,
  'OPERATION_COMPLETE' => OfflineCommandType.operationComplete,
  'CUSTOMER_ACKNOWLEDGEMENT' => OfflineCommandType.customerAcknowledgement,
  _ => throw FormatException('Unsupported offline command type: $value'),
};

/// O desfecho de um comando, segundo o servidor.
///
/// `blocked` não é falha do próprio comando: é o servidor recusando processar
/// um comando cujo antecessor **no mesmo atendimento** não foi aplicado. Sem
/// isso, marcar um item de checklist depois de um `start` recusado aplicaria a
/// segunda intenção sobre um estado que a primeira não alcançou.
enum OfflineCommandStatus {
  applied,
  alreadyApplied,
  conflict,
  rejected,
  retryableError,
  blocked,
}

OfflineCommandStatus offlineCommandStatusFromWire(String value) =>
    switch (value) {
      'APPLIED' => OfflineCommandStatus.applied,
      'ALREADY_APPLIED' => OfflineCommandStatus.alreadyApplied,
      'CONFLICT' => OfflineCommandStatus.conflict,
      'REJECTED' => OfflineCommandStatus.rejected,
      'RETRYABLE_ERROR' => OfflineCommandStatus.retryableError,
      'BLOCKED' => OfflineCommandStatus.blocked,
      _ => throw FormatException('Unsupported command status: $value'),
    };

/// Por que o servidor recusou reconciliar.
///
/// Nenhum destes é motivo para repetir sozinho: são estados do mundo que
/// mudaram, e quem decide o que fazer é a pessoa.
enum OfflineConflictCode {
  versionConflict,
  stateConflict,
  authorizationChanged,
  assignmentChanged,
  resourceRemoved,
  checklistChanged,
  materialStockConflict,
  acknowledgementStale,
  idempotencyMismatch,
}

OfflineConflictCode? offlineConflictCodeFromWire(String value) =>
    switch (value) {
      'VERSION_CONFLICT' => OfflineConflictCode.versionConflict,
      'STATE_CONFLICT' => OfflineConflictCode.stateConflict,
      'AUTHORIZATION_CHANGED' => OfflineConflictCode.authorizationChanged,
      'ASSIGNMENT_CHANGED' => OfflineConflictCode.assignmentChanged,
      'RESOURCE_REMOVED' => OfflineConflictCode.resourceRemoved,
      'CHECKLIST_CHANGED' => OfflineConflictCode.checklistChanged,
      'MATERIAL_STOCK_CONFLICT' => OfflineConflictCode.materialStockConflict,
      'ACKNOWLEDGEMENT_STALE' => OfflineConflictCode.acknowledgementStale,
      'IDEMPOTENCY_MISMATCH' => OfflineConflictCode.idempotencyMismatch,

      /// Um código novo no servidor não pode derrubar a sincronização: o
      /// comando continua em conflito, só sem rótulo específico.
      _ => null,
    };

/// O envelope, exatamente como o `OfflineCommandEnvelopeDto` o exige.
///
/// Tudo aqui é **congelado** no instante da intenção. O servidor calcula um
/// hash sobre `commandType`, `aggregateType`, `aggregateId`, `expectedVersion`,
/// `occurredAt` e `payload`, e o compara com o hash guardado para a mesma
/// chave de idempotência: qualquer campo regenerado no replay vira
/// `IDEMPOTENCY_MISMATCH`. Não é rigor gratuito — mesma chave com outro
/// conteúdo é outra intenção se passando pela primeira.
final class OfflineCommandEnvelope {
  const OfflineCommandEnvelope({
    required this.commandId,
    required this.idempotencyKey,
    required this.commandType,
    required this.aggregateId,
    required this.expectedVersion,
    required this.occurredAt,
    required this.payload,
    this.aggregateType = 'OPERATION',
    this.deviceInstanceId,
    this.clientContextVersion,
  });

  final String commandId;
  final String idempotencyKey;
  final OfflineCommandType commandType;

  /// `OPERATION` é o único valor que o DTO aceita (`IsIn(['OPERATION'])`).
  final String aggregateType;
  final String aggregateId;

  /// A versão que o usuário tinha diante dos olhos ao decidir.
  final String expectedVersion;

  /// O instante da ação no aparelho. Serve de janela de replay — comandos
  /// além de `MOBILE_SYNC_MAX_OFFLINE_REPLAY_DAYS` são recusados — e não de
  /// autoridade de ordenação: quem ordena é o servidor.
  final DateTime occurredAt;

  final Map<String, Object?> payload;
  final String? deviceInstanceId;
  final String? clientContextVersion;

  Map<String, Object?> toJson() => {
    'commandId': commandId,
    'idempotencyKey': idempotencyKey,
    'commandType': offlineCommandTypeWire(commandType),
    'aggregateType': aggregateType,
    'aggregateId': aggregateId,
    'expectedVersion': expectedVersion,
    'occurredAt': occurredAt.toUtc().toIso8601String(),
    'payload': payload,
    if (deviceInstanceId != null) 'deviceInstanceId': deviceInstanceId,
    if (clientContextVersion != null)
      'clientContextVersion': clientContextVersion,
  };

  factory OfflineCommandEnvelope.fromJson(Map<String, Object?> json) =>
      OfflineCommandEnvelope(
        commandId: json['commandId']! as String,
        idempotencyKey: json['idempotencyKey']! as String,
        commandType: offlineCommandTypeFromWire(json['commandType']! as String),
        aggregateType: json['aggregateType'] as String? ?? 'OPERATION',
        aggregateId: json['aggregateId']! as String,
        expectedVersion: json['expectedVersion']! as String,
        occurredAt: DateTime.parse(json['occurredAt']! as String),
        payload: Map<String, Object?>.from(
          json['payload']! as Map<Object?, Object?>,
        ),
        deviceInstanceId: json['deviceInstanceId'] as String?,
        clientContextVersion: json['clientContextVersion'] as String?,
      );
}

final class OfflineCommandConflict {
  const OfflineCommandConflict({
    required this.code,
    required this.message,
    required this.refreshRequired,
  });

  /// `null` quando o servidor publicou um código que este app ainda não
  /// conhece — o conflito continua sendo conflito.
  final OfflineConflictCode? code;
  final String message;
  final bool refreshRequired;

  factory OfflineCommandConflict.fromJson(Map<String, Object?> json) =>
      OfflineCommandConflict(
        code: offlineConflictCodeFromWire(json['code']! as String),
        message: json['message']! as String,
        refreshRequired: json['refreshRequired']! as bool,
      );
}

final class OfflineCommandError {
  const OfflineCommandError({
    required this.code,
    required this.message,
    required this.retryable,
  });

  final String code;
  final String message;

  /// Quem decide se vale repetir é o servidor, não uma heurística local.
  final bool retryable;

  factory OfflineCommandError.fromJson(Map<String, Object?> json) =>
      OfflineCommandError(
        code: json['code']! as String,
        message: json['message']! as String,
        retryable: json['retryable']! as bool,
      );
}

/// O recibo de um comando.
final class OfflineCommandResult {
  const OfflineCommandResult({
    required this.commandId,
    required this.commandType,
    required this.status,
    required this.serverVersion,
    required this.authoritativeResourceRef,
    required this.conflict,
    required this.error,
  });

  final String commandId;
  final String commandType;
  final OfflineCommandStatus status;
  final String? serverVersion;
  final String? authoritativeResourceRef;
  final OfflineCommandConflict? conflict;
  final OfflineCommandError? error;

  factory OfflineCommandResult.fromJson(Map<String, Object?> json) =>
      OfflineCommandResult(
        commandId: json['commandId']! as String,
        commandType: json['commandType']! as String,
        status: offlineCommandStatusFromWire(json['status']! as String),
        serverVersion: json['serverVersion'] as String?,
        authoritativeResourceRef: json['authoritativeResourceRef'] as String?,
        conflict: json['conflict'] == null
            ? null
            : OfflineCommandConflict.fromJson(
                Map<String, Object?>.from(
                  json['conflict']! as Map<Object?, Object?>,
                ),
              ),
        error: json['error'] == null
            ? null
            : OfflineCommandError.fromJson(
                Map<String, Object?>.from(
                  json['error']! as Map<Object?, Object?>,
                ),
              ),
      );

  Map<String, Object?> toJson() => {
    'commandId': commandId,
    'commandType': commandType,
    'status': _statusToWire(status),
    'serverVersion': serverVersion,
    'authoritativeResourceRef': authoritativeResourceRef,
    'conflict': conflict == null
        ? null
        : {
            'code': conflict!.code == null
                ? 'UNKNOWN'
                : offlineConflictCodeWire(conflict!.code!),
            'message': conflict!.message,
            'refreshRequired': conflict!.refreshRequired,
          },
    'error': error == null
        ? null
        : {
            'code': error!.code,
            'message': error!.message,
            'retryable': error!.retryable,
          },
  };
}

String _statusToWire(OfflineCommandStatus value) => switch (value) {
  OfflineCommandStatus.applied => 'APPLIED',
  OfflineCommandStatus.alreadyApplied => 'ALREADY_APPLIED',
  OfflineCommandStatus.conflict => 'CONFLICT',
  OfflineCommandStatus.rejected => 'REJECTED',
  OfflineCommandStatus.retryableError => 'RETRYABLE_ERROR',
  OfflineCommandStatus.blocked => 'BLOCKED',
};

/// O código do conflito de volta ao formato do servidor.
///
/// Existe porque `enum.name.toUpperCase()` daria `VERSIONCONFLICT` — parecido
/// o bastante para passar despercebido e diferente o bastante para não casar
/// com rótulo nenhum.
String offlineConflictCodeWire(OfflineConflictCode value) => switch (value) {
  OfflineConflictCode.versionConflict => 'VERSION_CONFLICT',
  OfflineConflictCode.stateConflict => 'STATE_CONFLICT',
  OfflineConflictCode.authorizationChanged => 'AUTHORIZATION_CHANGED',
  OfflineConflictCode.assignmentChanged => 'ASSIGNMENT_CHANGED',
  OfflineConflictCode.resourceRemoved => 'RESOURCE_REMOVED',
  OfflineConflictCode.checklistChanged => 'CHECKLIST_CHANGED',
  OfflineConflictCode.materialStockConflict => 'MATERIAL_STOCK_CONFLICT',
  OfflineConflictCode.acknowledgementStale => 'ACKNOWLEDGEMENT_STALE',
  OfflineConflictCode.idempotencyMismatch => 'IDEMPOTENCY_MISMATCH',
};

/// A resposta do push: um recibo por comando, na ordem enviada.
final class MobileSyncPushResponse {
  const MobileSyncPushResponse({
    required this.results,
    required this.serverTime,
    required this.nextRecommendedAction,
  });

  final List<OfflineCommandResult> results;
  final DateTime serverTime;

  /// O servidor sempre recomenda `PULL` depois do push — é assim que o estado
  /// autoritativo volta, em vez de ser deduzido dos recibos.
  final String nextRecommendedAction;

  factory MobileSyncPushResponse.fromJson(Map<String, Object?> json) =>
      MobileSyncPushResponse(
        results: (json['results']! as List<Object?>)
            .map(
              (value) => OfflineCommandResult.fromJson(
                Map<String, Object?>.from(value! as Map<Object?, Object?>),
              ),
            )
            .toList(growable: false),
        serverTime: DateTime.parse(json['serverTime']! as String),
        nextRecommendedAction: json['nextRecommendedAction']! as String,
      );
}

/// O que mudou desde o cursor.
enum SyncChangeType { upserted, removed, revoked, outOfScope }

SyncChangeType syncChangeTypeFromWire(String value) => switch (value) {
  'UPSERTED' => SyncChangeType.upserted,
  'REMOVED' => SyncChangeType.removed,
  'REVOKED' => SyncChangeType.revoked,
  'OUT_OF_SCOPE' => SyncChangeType.outOfScope,
  _ => throw FormatException('Unsupported change type: $value'),
};

final class MobileSyncChange {
  const MobileSyncChange({
    required this.sequence,
    required this.resourceType,
    required this.resourceId,
    required this.changeType,
    required this.version,
    required this.snapshot,
    required this.rawSnapshot,
  });

  final String sequence;
  final String resourceType;
  final String resourceId;
  final SyncChangeType changeType;
  final String? version;

  /// Presente só quando o recurso continua visível para este ator.
  final MobileWorkItemContract? snapshot;

  /// O mesmo item como o servidor o mandou.
  ///
  /// A projeção local guarda **isto**, não o objeto já interpretado: assim um
  /// campo que esta versão do app ainda não lê continua no disco, e uma versão
  /// futura o encontra em vez de precisar de outro pull.
  final Map<String, dynamic>? rawSnapshot;

  /// Deixou de valer: removido, revogado ou fora de escopo. Os três apagam a
  /// projeção local — a diferença entre eles é o motivo, não o efeito.
  bool get isRemoval => changeType != SyncChangeType.upserted;

  factory MobileSyncChange.fromJson(Map<String, dynamic> json) =>
      MobileSyncChange(
        sequence: json['sequence']! as String,
        resourceType: json['resourceType']! as String,
        resourceId: json['resourceId']! as String,
        changeType: syncChangeTypeFromWire(json['changeType']! as String),
        version: json['version'] as String?,
        snapshot: json['snapshot'] == null
            ? null
            : MobileWorkItemContract.fromJson(
                Map<String, dynamic>.from(json['snapshot']! as Map),
              ),
        rawSnapshot: json['snapshot'] == null
            ? null
            : Map<String, dynamic>.from(json['snapshot']! as Map),
      );
}

final class MobileSyncTombstone {
  const MobileSyncTombstone({required this.resourceId, required this.reason});

  final String resourceId;
  final String reason;

  factory MobileSyncTombstone.fromJson(Map<String, Object?> json) =>
      MobileSyncTombstone(
        resourceId: json['resourceId']! as String,
        reason: json['reason']! as String,
      );
}

/// A resposta do pull.
///
/// `FULL_RESYNC_REQUIRED` não é erro: é o servidor dizendo que o cursor ficou
/// velho demais para reconstruir o delta. A resposta certa é recomeçar a
/// projeção — nunca apagar comandos pendentes.
final class MobileSyncPullResponse {
  const MobileSyncPullResponse({
    required this.status,
    required this.changes,
    required this.tombstones,
    required this.nextCursor,
    required this.hasMore,
    required this.purgeRequired,
  });

  final String status;
  final List<MobileSyncChange> changes;
  final List<MobileSyncTombstone> tombstones;
  final String? nextCursor;
  final bool hasMore;

  /// O servidor pedindo que a projeção local seja descartada.
  final bool purgeRequired;

  bool get fullResyncRequired => status == 'FULL_RESYNC_REQUIRED';

  factory MobileSyncPullResponse.fromJson(Map<String, dynamic> json) =>
      MobileSyncPullResponse(
        status: json['status']! as String,
        changes: (json['changes']! as List<Object?>)
            .map(
              (value) => MobileSyncChange.fromJson(
                Map<String, dynamic>.from(value! as Map),
              ),
            )
            .toList(growable: false),
        tombstones: (json['tombstones']! as List<Object?>)
            .map(
              (value) => MobileSyncTombstone.fromJson(
                Map<String, Object?>.from(value! as Map<Object?, Object?>),
              ),
            )
            .toList(growable: false),
        nextCursor: json['nextCursor'] as String?,
        hasMore: json['hasMore']! as bool,
        purgeRequired: json['purgeRequired']! as bool,
      );
}

/// A política de cache que o próprio pacote carrega.
///
/// O servidor diz que o conteúdo é sensível, que deve ser apagado no logout e
/// que **não é autoritativo** — ou seja, serve para executar offline, não para
/// discordar do servidor depois.
final class FieldPackageCachePolicy {
  const FieldPackageCachePolicy({
    required this.sensitive,
    required this.purgeOnLogout,
    required this.authoritative,
  });

  final bool sensitive;
  final bool purgeOnLogout;
  final bool authoritative;

  factory FieldPackageCachePolicy.fromJson(Map<String, Object?> json) =>
      FieldPackageCachePolicy(
        sensitive: json['sensitive']! as bool,
        purgeOnLogout: json['purgeOnLogout']! as bool,
        authoritative: json['authoritative']! as bool,
      );
}

/// Mídia não vem no pacote, e referência local de mídia não é aceita — o que
/// delimita FL-06 sem que este app precise adivinhar.
final class FieldPackageMediaPolicy {
  const FieldPackageMediaPolicy({
    required this.blobsIncluded,
    required this.localMediaReferencesAccepted,
  });

  final bool blobsIncluded;
  final bool localMediaReferencesAccepted;

  factory FieldPackageMediaPolicy.fromJson(Map<String, Object?> json) =>
      FieldPackageMediaPolicy(
        blobsIncluded: json['blobsIncluded']! as bool,
        localMediaReferencesAccepted:
            json['localMediaReferencesAccepted']! as bool,
      );
}

/// O pacote de campo: o mínimo para executar um item sem rede.
///
/// `pmoc` e `rvt` chegam preenchidos quando o item é desses tipos, mas esta PR
/// não abre mutação offline para eles — o backend só aceita `aggregateType`
/// `OPERATION`, e antecipar execução de PMOC/RVT aqui seria inventar fluxo.
final class FieldPackageContract {
  const FieldPackageContract({
    required this.packageId,
    required this.generatedAt,
    required this.expiresAt,
    required this.serverCheckpoint,
    required this.kind,
    required this.workItem,
    required this.context,
    required this.operation,
    required this.pmoc,
    required this.rvt,
    required this.allowedActionsAtGeneration,
    required this.versionTokens,
    required this.cachePolicy,
    required this.mediaPolicy,
  });

  final String packageId;
  final DateTime generatedAt;
  final DateTime? expiresAt;

  /// O ponto do journal em que o pacote foi tirado — o cursor de partida.
  final String serverCheckpoint;
  final String kind;
  final MobileWorkItemContract workItem;
  final MobileFieldContextContract context;

  /// A preparação de execução, crua: quem a interpreta é o contrato do MB-02.
  final Map<String, dynamic>? operation;
  final Map<String, dynamic>? pmoc;
  final Map<String, dynamic>? rvt;

  /// O que era permitido **quando o pacote foi gerado**. Não é autorização:
  /// no replay o servidor revalida, e pode recusar o que aqui aparecia.
  final List<String> allowedActionsAtGeneration;
  final Map<String, String> versionTokens;
  final FieldPackageCachePolicy cachePolicy;
  final FieldPackageMediaPolicy mediaPolicy;

  factory FieldPackageContract.fromJson(Map<String, dynamic> json) {
    /// Item e contexto **são** o pacote. Sem um deles não há o que executar
    /// offline, e meio pacote é pior que nenhum: a tela abriria sem os dados
    /// que a própria ação exige.
    final workItem = MobileWorkItemContract.fromJson(
      Map<String, dynamic>.from(json['workItem'] as Map? ?? const {}),
    );
    final context = MobileFieldContextContract.fromJson(
      Map<String, dynamic>.from(json['context'] as Map? ?? const {}),
    );
    if (workItem == null || context == null) {
      throw const FormatException(
        'FieldPackage sem item de trabalho ou contexto',
      );
    }

    return FieldPackageContract(
      packageId: json['packageId']! as String,
      generatedAt: DateTime.parse(json['generatedAt']! as String),
      expiresAt: json['expiresAt'] == null
          ? null
          : DateTime.parse(json['expiresAt']! as String),
      serverCheckpoint: json['serverCheckpoint']! as String,
      kind: json['kind']! as String,
      workItem: workItem,
      context: context,
      operation: json['operation'] == null
          ? null
          : Map<String, dynamic>.from(json['operation']! as Map),
      pmoc: json['pmoc'] == null
          ? null
          : Map<String, dynamic>.from(json['pmoc']! as Map),
      rvt: json['rvt'] == null
          ? null
          : Map<String, dynamic>.from(json['rvt']! as Map),
      allowedActionsAtGeneration:
          (json['allowedActionsAtGeneration']! as List<Object?>)
              .map((value) => value! as String)
              .toList(growable: false),
      versionTokens: (json['versionTokens']! as Map<Object?, Object?>).map(
        (key, value) => MapEntry(key! as String, value! as String),
      ),
      cachePolicy: FieldPackageCachePolicy.fromJson(
        Map<String, Object?>.from(
          json['cachePolicy']! as Map<Object?, Object?>,
        ),
      ),
      mediaPolicy: FieldPackageMediaPolicy.fromJson(
        Map<String, Object?>.from(
          json['mediaPolicy']! as Map<Object?, Object?>,
        ),
      ),
    );
  }
}
