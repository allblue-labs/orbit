/// Contratos públicos aditivos do PMOC V2 (`/api/v1/pmoc`).
library;

typedef PmocJson = Map<String, dynamic>;

abstract final class PmocEquipmentExecutionStatus {
  static const inProgress = 'IN_PROGRESS';
  static const completed = 'COMPLETED';
  static const cancelled = 'CANCELLED';
  static const all = [inProgress, completed, cancelled];
}

class PmocExecutionEligibilityContract {
  const PmocExecutionEligibilityContract({
    required this.ready,
    required this.blockedReasons,
  });
  factory PmocExecutionEligibilityContract.fromJson(PmocJson json) =>
      PmocExecutionEligibilityContract(
        ready: json['ready'] as bool? ?? false,
        blockedReasons: (json['blockedReasons'] as List<dynamic>? ?? const [])
            .whereType<String>()
            .toList(growable: false),
      );
  final bool ready;
  final List<String> blockedReasons;
}

class PmocEquipmentExecutionContract {
  const PmocEquipmentExecutionContract({
    required this.id,
    required this.status,
    required this.asset,
    required this.evidence,
    required this.auxiliaryTechnicians,
    this.sequenceNumber,
    this.performedAt,
    this.startedAt,
    this.completedAt,
    this.notes,
    this.responsibleFieldTechnician,
    this.operation,
    this.artifactExecution,
  });
  factory PmocEquipmentExecutionContract.fromJson(PmocJson json) =>
      PmocEquipmentExecutionContract(
        id: json['id'] as String? ?? '',
        status: json['status'] as String? ?? '',
        sequenceNumber: json['sequenceNumber'] as int?,
        asset: json['asset'] as PmocJson? ?? const {},
        evidence: (json['evidence'] as List<dynamic>? ?? const [])
            .whereType<PmocJson>()
            .toList(growable: false),
        auxiliaryTechnicians:
            (json['auxiliaryTechnicians'] as List<dynamic>? ?? const [])
                .whereType<PmocJson>()
                .toList(growable: false),
        performedAt: DateTime.tryParse(json['performedAt'] as String? ?? ''),
        startedAt: DateTime.tryParse(json['startedAt'] as String? ?? ''),
        completedAt: DateTime.tryParse(json['completedAt'] as String? ?? ''),
        notes: json['notes'] as String?,
        responsibleFieldTechnician:
            json['responsibleFieldTechnician'] as PmocJson?,
        operation: json['operation'] as PmocJson?,
        artifactExecution: json['artifactExecution'] as PmocJson?,
      );
  final String id;
  final String status;

  /// Qual manutenção **deste equipamento** é esta — 1, 2, 3…
  ///
  /// Não é o número do ciclo, que é o mesmo para todos os aparelhos atendidos no
  /// período. Um equipamento que entra no contrato no meio da vigência está na
  /// sua primeira manutenção dentro de um ciclo que pode ser o sétimo, e é a dele
  /// que o relatório afirma.
  final int? sequenceNumber;
  final PmocJson asset;
  final List<PmocJson> evidence;

  /// Quem acompanhou. Auxiliar **não** é quem assina: a distinção existe no
  /// domínio e some se a tela juntar os dois numa lista de "equipe".
  final List<PmocJson> auxiliaryTechnicians;

  final DateTime? performedAt;
  final DateTime? startedAt;
  final DateTime? completedAt;

  /// O que o técnico escreveu. É o que o relatório imprime em "Observações e
  /// conclusão" — a substância do atendimento.
  final String? notes;

  /// Quem atendeu — e, por isso, quem pode concluir e emitir.
  final PmocJson? responsibleFieldTechnician;

  final PmocJson? operation;
  final PmocJson? artifactExecution;

  String? get responsibleFieldTechnicianId =>
      responsibleFieldTechnician?['id'] as String?;
  String? get responsibleFieldTechnicianName =>
      responsibleFieldTechnician?['displayName'] as String?;
}

/// O desfecho de concluir o atendimento de um equipamento.
///
/// `cycleCompleted` é do **servidor**: o ciclo fecha quando todos os
/// equipamentos dele estão resolvidos, e só ele sabe quantos faltavam. Contar no
/// aplicativo daria a resposta errada assim que outra pessoa atendesse um
/// equipamento do mesmo ciclo em paralelo.
class PmocCompletionContract {
  const PmocCompletionContract({
    required this.execution,
    required this.cycleCompleted,
  });

  factory PmocCompletionContract.fromJson(PmocJson json) =>
      PmocCompletionContract(
        execution: PmocEquipmentExecutionContract.fromJson(
          json['execution'] as PmocJson? ?? const {},
        ),
        cycleCompleted: json['cycleCompleted'] as bool? ?? false,
      );

  final PmocEquipmentExecutionContract execution;
  final bool cycleCompleted;
}

class PmocExecutionPreparationContract {
  const PmocExecutionPreparationContract({
    required this.plan,
    required this.cycle,
    required this.equipment,
    required this.customer,
    required this.procedure,
    required this.procedureGroups,
    required this.eligibility,
    required this.allowedActions,
    this.serviceLocation,
    this.technicalResponsible,
    this.existingExecution,
  });
  factory PmocExecutionPreparationContract.fromJson(PmocJson json) =>
      PmocExecutionPreparationContract(
        plan: json['plan'] as PmocJson? ?? const {},
        cycle: json['cycle'] as PmocJson? ?? const {},
        equipment: json['equipment'] as PmocJson? ?? const {},
        customer: json['customer'] as PmocJson? ?? const {},
        serviceLocation: json['serviceLocation'] as String?,
        technicalResponsible: json['technicalResponsible'] as PmocJson?,
        procedure: json['procedure'],
        procedureGroups: (json['procedureGroups'] as List<dynamic>? ?? const [])
            .whereType<PmocJson>()
            .map(PmocProcedureGroupContract.fromJson)
            .toList(growable: false),
        eligibility: PmocExecutionEligibilityContract.fromJson(
          json['eligibility'] as PmocJson? ?? const {},
        ),
        allowedActions: (json['allowedActions'] as List<dynamic>? ?? const [])
            .whereType<String>()
            .toList(growable: false),
        existingExecution: json['existingExecution'] is PmocJson
            ? PmocEquipmentExecutionContract.fromJson(
                json['existingExecution'] as PmocJson,
              )
            : null,
      );
  final PmocJson plan;
  final PmocJson cycle;
  final PmocJson equipment;
  final PmocJson customer;
  final String? serviceLocation;

  /// Quem assina o documento. Não é quem atende: a manutenção é do técnico de
  /// campo, a responsabilidade técnica é de quem responde pelo PMOC.
  final PmocJson? technicalResponsible;

  /// O roteiro cru, como o plano o guarda. Fica para diagnóstico — a tela lê
  /// [procedureGroups].
  final dynamic procedure;

  /// O roteiro **já lido**, em grupos, pelo servidor.
  ///
  /// `procedure` é JSON livre com mais de uma forma em produção. O leitor
  /// tolerante mora no backend, e é o mesmo que o PDF usa: assim o técnico
  /// confere em campo exatamente os itens que o relatório vai imprimir.
  final List<PmocProcedureGroupContract> procedureGroups;

  final PmocExecutionEligibilityContract eligibility;
  final List<String> allowedActions;
  final PmocEquipmentExecutionContract? existingExecution;

  String get planName => plan['name'] as String? ?? 'PMOC';
  String? get planCode => plan['code'] as String?;
  String get customerName => customer['name'] as String? ?? 'Cliente';
  String get equipmentName => equipment['name'] as String? ?? 'Equipamento';
  String? get cycleDueOn => cycle['dueOn'] as String?;
  int? get cycleSequenceNumber => cycle['sequenceNumber'] as int?;
  String? get technicalResponsibleName =>
      technicalResponsible?['displayName'] as String?;
}

/// Um grupo do roteiro — "Evaporadora", "Condensadora", "Dutos".
class PmocProcedureGroupContract {
  const PmocProcedureGroupContract({required this.group, required this.items});

  factory PmocProcedureGroupContract.fromJson(PmocJson json) =>
      PmocProcedureGroupContract(
        group: json['group'] as String? ?? '',
        items: (json['items'] as List<dynamic>? ?? const [])
            .whereType<String>()
            .toList(growable: false),
      );

  final String group;
  final List<String> items;
}

/// Um plano de PMOC como a lista o publica.
///
/// Espelha `PmocPlanSummaryReadModel`. Os blocos compostos — vigência,
/// periodicidade, conformidade, unidade — ficam como JSON: a tela de campo lê
/// deles só o rótulo pronto que o servidor já resolveu (`frequency.label`,
/// `compliance.nextDueOn`), e tipar cada um aqui criaria espelhos que ninguém
/// usa e que ainda assim precisariam ser mantidos.
class PmocPlanSummaryContract {
  const PmocPlanSummaryContract({
    required this.id,
    required this.code,
    required this.name,
    required this.status,
    required this.customer,
    required this.coveredEquipment,
    required this.validity,
    required this.frequency,
    required this.compliance,
    required this.businessUnit,
    this.technician,
    this.createdAt,
    this.updatedAt,
  });

  factory PmocPlanSummaryContract.fromJson(PmocJson json) =>
      PmocPlanSummaryContract(
        id: json['id'] as String? ?? '',
        code: json['code'] as String? ?? '',
        name: json['name'] as String? ?? '',
        status: json['status'] as String? ?? '',
        customer: json['customer'] as PmocJson? ?? const {},
        coveredEquipment: json['coveredEquipment'] as int? ?? 0,
        validity: json['validity'] as PmocJson? ?? const {},
        frequency: json['frequency'] as PmocJson? ?? const {},
        compliance: json['compliance'] as PmocJson? ?? const {},
        businessUnit: json['businessUnit'] as PmocJson? ?? const {},
        technician: json['technician'] as PmocJson?,
        createdAt: DateTime.tryParse(json['createdAt'] as String? ?? ''),
        updatedAt: DateTime.tryParse(json['updatedAt'] as String? ?? ''),
      );

  final String id;
  final String code;
  final String name;
  final String status;
  final PmocJson customer;
  final int coveredEquipment;
  final PmocJson validity;
  final PmocJson frequency;
  final PmocJson compliance;
  final PmocJson businessUnit;

  /// O técnico atribuído ao **plano** — quem pode atendê-lo do celular.
  ///
  /// `null` em plano sem atribuição: só o dono atende, e é ele que aparece
  /// resolvendo o que ficou sem responsável.
  final PmocJson? technician;

  final DateTime? createdAt;
  final DateTime? updatedAt;

  String get customerName => customer['name'] as String? ?? 'Cliente';
  String? get technicianId => technician?['id'] as String?;
  String? get technicianName => technician?['displayName'] as String?;
  String? get frequencyLabel => frequency['label'] as String?;
  String? get nextDueOn => compliance['nextDueOn'] as String?;
}

/// O plano inteiro, como o detalhe o publica.
///
/// Espelha `PmocPlanReadModel`, que estende o resumo. O campo que o campo usa é
/// `currentExecution`: é o ciclo aberto, e é nele que o atendimento acontece —
/// uma requisição a menos que pedir o plano e depois a lista de ciclos.
///
/// Os blocos de configuração vêm como JSON: o celular não configura plano, e
/// tipar aqui o que só a web edita criaria espelhos sem leitor.
class PmocPlanDetailContract {
  const PmocPlanDetailContract({
    required this.summary,
    required this.coverages,
    required this.units,
    required this.recentExecutions,
    required this.allowedTransitions,
    required this.configuration,
    this.notes,
    this.technicalResponsible,
    this.currentExecution,
    this.activatedAt,
    this.createdBy,
  });

  factory PmocPlanDetailContract.fromJson(PmocJson json) =>
      PmocPlanDetailContract(
        summary: PmocPlanSummaryContract.fromJson(json),
        notes: json['notes'] as String?,
        technicalResponsible: json['technicalResponsible'] as PmocJson?,
        configuration: json['configuration'] as PmocJson? ?? const {},
        activatedAt: DateTime.tryParse(json['activatedAt'] as String? ?? ''),
        createdBy: json['createdBy'] as PmocJson?,
        coverages: (json['coverages'] as List<dynamic>? ?? const [])
            .whereType<PmocJson>()
            .toList(growable: false),
        units: (json['units'] as List<dynamic>? ?? const [])
            .whereType<PmocJson>()
            .toList(growable: false),
        currentExecution: json['currentExecution'] is PmocJson
            ? PmocCycleContract.fromJson(json['currentExecution'] as PmocJson)
            : null,
        recentExecutions:
            (json['recentExecutions'] as List<dynamic>? ?? const [])
                .whereType<PmocJson>()
                .map(PmocCycleContract.fromJson)
                .toList(growable: false),
        allowedTransitions:
            (json['allowedTransitions'] as List<dynamic>? ?? const [])
                .whereType<String>()
                .toList(growable: false),
      );

  final PmocPlanSummaryContract summary;
  final String? notes;

  /// Quem assina o documento do plano.
  final PmocJson? technicalResponsible;

  final PmocJson configuration;
  final DateTime? activatedAt;
  final PmocJson? createdBy;
  final List<PmocJson> coverages;
  final List<PmocJson> units;

  /// O ciclo **aberto** — a manutenção prevista agora. `null` quando não há.
  final PmocCycleContract? currentExecution;

  final List<PmocCycleContract> recentExecutions;
  final List<String> allowedTransitions;

  String get id => summary.id;
  String get name => summary.name;
  String get code => summary.code;
  String get customerName => summary.customerName;

  /// O técnico atribuído ao plano — quem pode atendê-lo do celular.
  String? get technicianId => summary.technicianId;
  String? get technicianName => summary.technicianName;
}

/// Um ciclo do plano — o período de manutenção que se atende.
class PmocCycleContract {
  const PmocCycleContract({
    required this.id,
    required this.sequenceNumber,
    required this.status,
    required this.dueOn,
    this.performedAt,
    this.notes,
    this.completedBy,
    this.schedulingEventId,
  });

  factory PmocCycleContract.fromJson(PmocJson json) => PmocCycleContract(
    id: json['id'] as String? ?? '',
    sequenceNumber: json['sequenceNumber'] as int? ?? 0,
    status: json['status'] as String? ?? '',
    dueOn: json['dueOn'] as String? ?? '',
    performedAt: DateTime.tryParse(json['performedAt'] as String? ?? ''),
    notes: json['notes'] as String?,
    completedBy: json['completedBy'] as PmocJson?,
    schedulingEventId: json['schedulingEventId'] as String?,
  );

  final String id;
  final int sequenceNumber;
  final String status;

  /// Data pura (`YYYY-MM-DD`): vencimento é dia, não instante — e converter
  /// para `DateTime` local mudaria o dia perto da meia-noite.
  final String dueOn;

  final DateTime? performedAt;
  final String? notes;

  /// Quem fechou o ciclo. Histórico, e nunca a escala: pode ser outra pessoa.
  final PmocJson? completedBy;

  /// O compromisso na Agenda, quando o ciclo gerou um.
  final String? schedulingEventId;

  bool get isOpen => status == 'PENDING' || status == 'IN_PROGRESS';
}

/// Um equipamento do ciclo, com o que ele permite agora.
///
/// `eligibility` é do servidor e por equipamento — a **mesma** função que a
/// preparação usa. É o que permite montar a lista com uma requisição em vez de
/// uma preparação por aparelho.
class PmocCycleEquipmentContract {
  const PmocCycleEquipmentContract({
    required this.coverageId,
    required this.equipment,
    required this.status,
    required this.eligibility,
    this.execution,
  });

  factory PmocCycleEquipmentContract.fromJson(PmocJson json) =>
      PmocCycleEquipmentContract(
        coverageId: json['coverageId'] as String? ?? '',
        equipment: json['equipment'] as PmocJson? ?? const {},
        status: json['status'] as String? ?? 'NOT_STARTED',
        eligibility: PmocExecutionEligibilityContract.fromJson(
          json['eligibility'] as PmocJson? ?? const {},
        ),
        execution: json['execution'] is PmocJson
            ? PmocEquipmentExecutionContract.fromJson(
                json['execution'] as PmocJson,
              )
            : null,
      );

  final String coverageId;
  final PmocJson equipment;

  /// `NOT_STARTED` quando nada foi aberto; o status da execução quando foi.
  final String status;

  final PmocExecutionEligibilityContract eligibility;
  final PmocEquipmentExecutionContract? execution;

  String get assetId => equipment['id'] as String? ?? '';
  String get assetName => equipment['name'] as String? ?? 'Equipamento';
  String? get assetIdentifier => equipment['identifier'] as String?;

  bool get isCompleted => status == PmocEquipmentExecutionStatus.completed;
  bool get isInProgress => status == PmocEquipmentExecutionStatus.inProgress;
}

/// Uma revisão emitida do documento — o arquivo que existe de verdade.
///
/// Espelha `ArtifactManifestListItemReadModel` no que o campo usa. O PDF não
/// pertence à execução de artefato: pertence a uma **revisão** dela, e é por isso
/// que reemitir não reescreve o que o cliente já recebeu.
class PmocDocumentRevisionContract {
  const PmocDocumentRevisionContract({
    required this.id,
    required this.revision,
    required this.status,
    required this.format,
    required this.isActive,
    this.issuedAt,
  });

  factory PmocDocumentRevisionContract.fromJson(PmocJson json) =>
      PmocDocumentRevisionContract(
        id: json['id'] as String? ?? '',
        revision: json['revision'] as int? ?? 0,
        status: json['status'] as String? ?? '',
        format: json['format'] as String? ?? 'PDF',
        isActive: json['isActive'] as bool? ?? false,
        issuedAt: DateTime.tryParse(json['issuedAt'] as String? ?? ''),
      );

  final String id;
  final int revision;
  final String status;
  final String format;

  /// Só uma revisão da execução é a ativa — é ela que se distribui.
  final bool isActive;

  /// `null` enquanto a revisão é rascunho: aberta, sem arquivo emitido.
  final DateTime? issuedAt;

  /// Há arquivo para baixar?
  ///
  /// Emitida e não revogada. Revogado não se baixa — o registro fica para
  /// auditoria, e distribuir o arquivo de um documento invalidado é o oposto do
  /// propósito da revogação.
  bool get isDownloadable => issuedAt != null && status != 'REVOKED';
}

class PmocCursorPageContract<T> {
  const PmocCursorPageContract({
    required this.data,
    required this.hasNextPage,
    this.nextCursor,
  });
  final List<T> data;
  final String? nextCursor;
  final bool hasNextPage;
}

class PmocTimelineItemContract {
  const PmocTimelineItemContract({
    required this.id,
    required this.type,
    required this.message,
    required this.occurredAt,
    required this.data,
    this.actor,
    this.equipment,
  });
  factory PmocTimelineItemContract.fromJson(PmocJson json) =>
      PmocTimelineItemContract(
        id: json['id'] as String? ?? '',
        type: json['type'] as String? ?? '',
        message: json['message'] as String? ?? '',
        occurredAt: DateTime.parse(json['occurredAt'] as String),
        actor: json['actor'] as PmocJson?,
        equipment: json['equipment'] as PmocJson?,
        data: json['data'] as PmocJson? ?? const {},
      );
  final String id;
  final String type;
  final String message;
  final DateTime occurredAt;
  final PmocJson? actor;
  final PmocJson? equipment;
  final PmocJson data;
}

class PmocGeneratedArtifactContract {
  const PmocGeneratedArtifactContract({
    required this.artifactExecutionId,
    required this.created,
    required this.sourceType,
    required this.sourceEntityId,
  });
  factory PmocGeneratedArtifactContract.fromJson(PmocJson json) =>
      PmocGeneratedArtifactContract(
        artifactExecutionId: json['artifactExecutionId'] as String? ?? '',
        created: json['created'] as bool? ?? false,
        sourceType: json['sourceType'] as String? ?? '',
        sourceEntityId: json['sourceEntityId'] as String? ?? '',
      );
  final String artifactExecutionId;
  final bool created;
  final String sourceType;
  final String sourceEntityId;
}
