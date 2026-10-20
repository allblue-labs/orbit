/// Contratos de execução de campo (MB-02).
///
/// Espelham `mobile-field-operation.read-models.ts`. O que o backend publica
/// aqui é **estado e permissão**, não sugestão: `allowedActions` diz quais
/// comandos existem agora, `version` é o token de concorrência que todo comando
/// precisa carregar, e `executionEligibility` explica o que impede começar.
///
/// O Flutter não implementa a máquina de estados do atendimento. Ele mostra o
/// que chegou e envia comandos semânticos.
library;

import 'mobile_field_contracts.dart';

enum FieldOperationAllowedAction {
  view,
  openRoute,
  start,
  resume,
  complete,
  updateChecklist,
  addNote,
  registerMaterial,

  /// Publicada pelo backend via `MobileFieldAction`. É ela — e só ela — que
  /// autoriza a captura de evidência na tela de execução.
  addEvidence,

  scanEquipment,
  viewDocument,
  downloadDocument,
}

/// Ação publicada pelo backend.
///
/// `null` para código que esta versão não conhece — some da lista em vez de
/// virar botão sem nome.
FieldOperationAllowedAction? fieldOperationActionFrom(String? value) =>
    switch (value) {
      'VIEW' => FieldOperationAllowedAction.view,
      'OPEN_ROUTE' => FieldOperationAllowedAction.openRoute,
      'START' => FieldOperationAllowedAction.start,
      'RESUME' => FieldOperationAllowedAction.resume,
      'COMPLETE' => FieldOperationAllowedAction.complete,
      'UPDATE_CHECKLIST' => FieldOperationAllowedAction.updateChecklist,
      'ADD_NOTE' => FieldOperationAllowedAction.addNote,
      'REGISTER_MATERIAL' => FieldOperationAllowedAction.registerMaterial,
      'ADD_EVIDENCE' => FieldOperationAllowedAction.addEvidence,
      'SCAN_EQUIPMENT' => FieldOperationAllowedAction.scanEquipment,
      'VIEW_DOCUMENT' => FieldOperationAllowedAction.viewDocument,
      'DOWNLOAD_DOCUMENT' => FieldOperationAllowedAction.downloadDocument,
      _ => null,
    };

class FieldOperationCommandContract {
  const FieldOperationCommandContract({
    required this.commandId,
    required this.idempotencyKey,
    required this.expectedVersion,
    required this.occurredAt,
  });

  /// O envelope que todo comando carrega.
  ///
  /// `commandId` identifica **esta intenção** e é o que torna o reenvio
  /// inofensivo; `expectedVersion` é o estado que o usuário viu ao decidir. Os
  /// dois juntos são o que impede efeito duplicado e sobrescrita silenciosa.
  Map<String, dynamic> toJson() => {
    'commandId': commandId,
    'idempotencyKey': idempotencyKey,
    'expectedVersion': expectedVersion,
    'occurredAt': occurredAt.toUtc().toIso8601String(),
  };

  final String commandId;
  final String idempotencyKey;
  final String expectedVersion;
  final DateTime occurredAt;
}

class FieldOperationChecklistItemContract {
  const FieldOperationChecklistItemContract({
    required this.id,
    required this.label,
    required this.type,
    required this.required,
    required this.options,
    this.answer,
  });
  factory FieldOperationChecklistItemContract.fromJson(
    Map<String, dynamic> json,
  ) => FieldOperationChecklistItemContract(
    id: json['id'] as String? ?? '',
    label: json['label'] as String? ?? '',
    type: json['type'] as String? ?? '',
    required: json['required'] as bool? ?? false,
    options: (json['options'] as List<dynamic>? ?? const [])
        .whereType<String>()
        .toList(growable: false),
    answer: json['answer'],
  );

  final String id;
  final String label;
  final String type;

  /// Obrigatoriedade é **apresentação**. Quem decide se o atendimento pode
  /// ser concluído é o servidor, em `allowedActions`.
  final bool required;
  final List<String> options;

  /// Resposta em JSON livre: o tipo depende do item. Fica contida aqui, no
  /// limite do contrato, em vez de espalhar `dynamic` pela árvore.
  final Object? answer;

  bool get isAnswered => switch (answer) {
    null => false,
    final String value => value.trim().isNotEmpty,
    final List<dynamic> value => value.isNotEmpty,
    _ => true,
  };
}

class FieldOperationChecklistContract {
  const FieldOperationChecklistContract({
    required this.id,
    required this.name,
    required this.status,
    required this.progress,
    required this.version,
    required this.items,
    this.notes,
  });
  factory FieldOperationChecklistContract.fromJson(Map<String, dynamic> json) =>
      FieldOperationChecklistContract(
        id: json['id'] as String? ?? '',
        name: json['name'] as String? ?? '',
        status: json['status'] as String? ?? '',
        progress: (json['progress'] as num?)?.toInt() ?? 0,
        version: json['version'] as String? ?? '',
        items: (json['items'] as List<dynamic>? ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(FieldOperationChecklistItemContract.fromJson)
            .toList(growable: false),
        notes: json['notes'] as String?,
      );

  final String id;
  final String name;
  final String status;

  /// Progresso calculado pelo servidor.
  final int progress;
  final String version;
  final List<FieldOperationChecklistItemContract> items;
  final String? notes;

  /// Respostas prontas para reenviar: o comando de checklist substitui o mapa
  /// inteiro, então parte-se sempre do que o servidor devolveu.
  Map<String, dynamic> get answers => {
    for (final item in items)
      if (item.answer != null) item.id: item.answer,
  };
}

class FieldOperationMaterialPolicyContract {
  const FieldOperationMaterialPolicyContract({
    required this.enabled,
    required this.requiresAvailableStock,
    required this.idempotencyRequired,
  });
  factory FieldOperationMaterialPolicyContract.fromJson(
    Map<String, dynamic> json,
  ) => FieldOperationMaterialPolicyContract(
    enabled: json['enabled'] as bool? ?? false,
    requiresAvailableStock: json['requiresAvailableStock'] as bool? ?? true,
    idempotencyRequired: json['idempotencyRequired'] as bool? ?? true,
  );

  final bool enabled;

  /// O estoque é do Inventory. O app não calcula disponibilidade.
  final bool requiresAvailableStock;
  final bool idempotencyRequired;
}

class FieldOperationStateContract {
  const FieldOperationStateContract({
    required this.id,
    required this.code,
    required this.title,
    this.serviceOrderCode,
    required this.status,
    required this.priority,
    this.description,
    this.scheduledFor,
    this.startedAt,
    this.completedAt,
    this.startedBy,
    this.completedBy,
  });
  factory FieldOperationStateContract.fromJson(Map<String, dynamic> json) =>
      FieldOperationStateContract(
        id: json['id'] as String? ?? '',
        code: json['code'] as String? ?? '',
        serviceOrderCode: json['serviceOrderCode'] as String?,
        title: json['title'] as String? ?? '',
        status: json['status'] as String? ?? '',
        priority: json['priority'] as String? ?? '',
        description: json['description'] as String?,
        scheduledFor: DateTime.tryParse(json['scheduledFor'] as String? ?? ''),
        startedAt: DateTime.tryParse(json['startedAt'] as String? ?? ''),
        completedAt: DateTime.tryParse(json['completedAt'] as String? ?? ''),
        startedBy: _party(json['startedBy']),
        completedBy: _party(json['completedBy']),
      );

  final String id;
  final String code;

  /// `OS-000087` — o número da ordem de serviço, o mesmo que o documento imprime.
  ///
  /// É o que o técnico lê para o cliente. `code` é a convenção interna de quem
  /// criou a operação; nulo aqui é o normal de uma operação que não é ordem de
  /// serviço — PMOC e RVT têm as contagens delas.
  final String? serviceOrderCode;

  final String title;
  final String? description;
  final String status;
  final String priority;
  final DateTime? scheduledFor;
  final DateTime? startedAt;
  final DateTime? completedAt;

  /// Quem **executou** — histórico, não escala. Pode ser outra pessoa que a
  /// atualmente responsável, e substituir um pelo outro apagaria o fato.
  final MobilePartySummaryContract? startedBy;
  final MobilePartySummaryContract? completedBy;
}

MobilePartySummaryContract? _party(Object? value) => value == null
    ? null
    : MobilePartySummaryContract.fromJson(value as Map<String, dynamic>);

List<FieldOperationAllowedAction> _actions(Object? value) =>
    (value as List<dynamic>? ?? const [])
        .whereType<String>()
        .map(fieldOperationActionFrom)
        .whereType<FieldOperationAllowedAction>()
        .toList(growable: false);

class FieldOperationExecutionPreparationContract {
  const FieldOperationExecutionPreparationContract({
    required this.operation,
    required this.equipment,
    required this.auxiliaryTechnicians,
    required this.checklist,
    required this.materialPolicy,
    required this.allowedTransitions,
    required this.allowedActions,
    required this.version,
    required this.eligible,
    required this.blockers,
    required this.evidenceUploadEnabled,
    required this.artifactEligibleAfterCompletion,
    required this.artifacts,
    required this.professionalSignatureAvailable,
    this.customer,
    this.serviceLocation,
    this.responsibleFieldTechnician,
    this.primaryAction,
  });
  factory FieldOperationExecutionPreparationContract.fromJson(
    Map<String, dynamic> json,
  ) {
    final eligibility =
        json['executionEligibility'] as Map<String, dynamic>? ?? const {};
    return FieldOperationExecutionPreparationContract(
      operation: FieldOperationStateContract.fromJson(
        json['operation'] as Map<String, dynamic>? ?? const {},
      ),
      customer: json['customer'] == null
          ? null
          : MobileCustomerSummaryContract.fromJson(
              json['customer'] as Map<String, dynamic>,
            ),
      serviceLocation: json['serviceLocation'] as Map<String, dynamic>?,
      equipment: (json['equipment'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(MobileEquipmentSummaryContract.fromJson)
          .toList(growable: false),
      responsibleFieldTechnician: _party(json['responsibleFieldTechnician']),
      auxiliaryTechnicians:
          (json['auxiliaryTechnicians'] as List<dynamic>? ?? const [])
              .whereType<Map<String, dynamic>>()
              .map(MobilePartySummaryContract.fromJson)
              .toList(growable: false),
      checklist: (json['checklist'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(FieldOperationChecklistContract.fromJson)
          .toList(growable: false),
      materialPolicy: FieldOperationMaterialPolicyContract.fromJson(
        json['materialPolicy'] as Map<String, dynamic>? ?? const {},
      ),
      evidenceUploadEnabled:
          (json['evidencePolicy'] as Map<String, dynamic>?)?['uploadEnabled']
              as bool? ??
          false,
      artifactEligibleAfterCompletion:
          (json['artifactPolicy']
                  as Map<String, dynamic>?)?['eligibleAfterCompletion']
              as bool? ??
          false,
      artifacts:
          ((json['artifactPolicy'] as Map<String, dynamic>?)?['artifacts']
                      as List<dynamic>? ??
                  const [])
              .whereType<Map<String, dynamic>>()
              .map(MobileArtifactSummaryContract.fromJson)
              .toList(growable: false),
      professionalSignatureAvailable:
          (json['professionalSignature'] as Map<String, dynamic>?)?['available']
              as bool? ??
          false,
      allowedTransitions:
          (json['allowedTransitions'] as List<dynamic>? ?? const [])
              .whereType<String>()
              .toList(growable: false),
      allowedActions: _actions(json['allowedActions']),
      primaryAction: fieldOperationActionFrom(json['primaryAction'] as String?),
      version: json['version'] as String? ?? '',
      eligible: eligibility['eligible'] as bool? ?? false,
      blockers: (eligibility['blockers'] as List<dynamic>? ?? const [])
          .whereType<String>()
          .toList(growable: false),
    );
  }

  final FieldOperationStateContract operation;
  final MobileCustomerSummaryContract? customer;
  final Map<String, Object?>? serviceLocation;
  final List<MobileEquipmentSummaryContract> equipment;
  final MobilePartySummaryContract? responsibleFieldTechnician;
  final List<MobilePartySummaryContract> auxiliaryTechnicians;
  final List<FieldOperationChecklistContract> checklist;
  final FieldOperationMaterialPolicyContract materialPolicy;

  /// Políticas que pertencem a PRs seguintes — lidas para que a tela saiba o
  /// que **não** oferecer, sem adivinhar.
  final bool evidenceUploadEnabled;
  final bool artifactEligibleAfterCompletion;
  final List<MobileArtifactSummaryContract> artifacts;
  final bool professionalSignatureAvailable;
  final List<String> allowedTransitions;

  /// **A autoridade da interação.** O que não está aqui não vira botão.
  final List<FieldOperationAllowedAction> allowedActions;
  final FieldOperationAllowedAction? primaryAction;

  /// Token de concorrência — o `updatedAt` do atendimento, como texto. Todo
  /// comando o carrega, e o servidor recusa com 409 quando não bate.
  final String version;
  final bool eligible;

  /// Por que ainda não dá para executar. Códigos do servidor, traduzidos na
  /// apresentação — o app não decide elegibilidade.
  final List<String> blockers;
}

class FieldOperationCommandResultContract {
  const FieldOperationCommandResultContract({
    required this.operationId,
    required this.status,
    required this.version,
    required this.allowedActions,
    required this.idempotentReplay,
    this.startedBy,
    this.startedAt,
    this.completedBy,
    this.completedAt,
  });
  factory FieldOperationCommandResultContract.fromJson(
    Map<String, dynamic> json,
  ) => FieldOperationCommandResultContract(
    operationId: json['operationId'] as String? ?? '',
    status: json['status'] as String? ?? '',
    version: json['version'] as String? ?? '',
    allowedActions: _actions(json['allowedActions']),
    idempotentReplay: json['idempotentReplay'] as bool? ?? false,
    startedBy: _party(json['startedBy']),
    startedAt: DateTime.tryParse(json['startedAt'] as String? ?? ''),
    completedBy: _party(json['completedBy']),
    completedAt: DateTime.tryParse(json['completedAt'] as String? ?? ''),
  );

  final String operationId;
  final String status;

  /// A nova versão, para o próximo comando.
  final String version;
  final MobilePartySummaryContract? startedBy;
  final DateTime? startedAt;
  final MobilePartySummaryContract? completedBy;
  final DateTime? completedAt;
  final List<FieldOperationAllowedAction> allowedActions;

  /// O servidor avisa quando o comando foi **reexecução** da mesma intenção.
  /// É por isso que o app não precisa adivinhar se o toque duplicado pegou.
  final bool idempotentReplay;
}

class FieldOperationTimelineEntryContract {
  const FieldOperationTimelineEntryContract({
    required this.id,
    required this.type,
    required this.message,
    required this.occurredAt,
    this.actor,
  });
  factory FieldOperationTimelineEntryContract.fromJson(
    Map<String, dynamic> json,
  ) => FieldOperationTimelineEntryContract(
    id: json['id'] as String? ?? '',
    type: json['type'] as String? ?? '',
    message: json['message'] as String? ?? '',
    occurredAt:
        DateTime.tryParse(json['occurredAt'] as String? ?? '') ??
        DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
    actor: _party(json['actor']),
  );

  final String id;
  final String type;

  /// A frase vem redigida do servidor. O app não fabrica fato.
  final String message;
  final MobilePartySummaryContract? actor;
  final DateTime occurredAt;
}

/// Uma página da linha do tempo.
class FieldOperationTimelinePageContract {
  const FieldOperationTimelinePageContract({
    required this.data,
    required this.hasNextPage,
    this.nextCursor,
  });

  factory FieldOperationTimelinePageContract.fromJson(
    Map<String, dynamic> json,
  ) {
    final meta = json['meta'] as Map<String, dynamic>? ?? const {};
    return FieldOperationTimelinePageContract(
      data: (json['data'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(FieldOperationTimelineEntryContract.fromJson)
          .toList(growable: false),
      hasNextPage: meta['hasNextPage'] as bool? ?? false,
      nextCursor: meta['nextCursor'] as String?,
    );
  }

  /// Na ordem publicada.
  final List<FieldOperationTimelineEntryContract> data;
  final bool hasNextPage;
  final String? nextCursor;
}

/// O que `POST /materials` devolve.
class FieldOperationMaterialResultContract {
  const FieldOperationMaterialResultContract({
    required this.movementId,
    required this.catalogItemId,
    required this.quantity,
    required this.balanceAfter,
    required this.idempotentReplay,
  });

  factory FieldOperationMaterialResultContract.fromJson(
    Map<String, dynamic> json,
  ) => FieldOperationMaterialResultContract(
    movementId: json['movementId'] as String? ?? '',
    catalogItemId: json['catalogItemId'] as String? ?? '',
    quantity: json['quantity'] as String? ?? '0',
    balanceAfter: json['balanceAfter'] as String? ?? '0',
    idempotentReplay: json['idempotentReplay'] as bool? ?? false,
  );

  final String movementId;
  final String catalogItemId;

  /// Quantidades chegam como texto: decimal exato, sem passar por `double`.
  final String quantity;

  /// Saldo **do Inventory** depois do movimento. O app não o calcula.
  final String balanceAfter;
  final bool idempotentReplay;
}
