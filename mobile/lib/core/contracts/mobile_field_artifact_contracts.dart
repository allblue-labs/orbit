/// Documentos de campo (MB-06).
///
/// Seis conceitos que **não** se fundem:
///
/// ```text
/// ESTADO DA EXECUÇÃO   o atendimento em si
/// PRONTIDÃO            se dá para emitir, e o que falta
/// SNAPSHOT             os fatos congelados, com hash
/// RENDERIZAÇÃO         o estado do trabalho assíncrono
/// ARTEFATO             o documento como entidade do domínio
/// ACESSO ASSINADO      uma URL temporária para o arquivo
/// ```
///
/// Atendimento concluído **não** é documento pronto, e uma requisição de
/// geração aceita **não** é PDF disponível.
///
/// Endpoints reais:
///
/// ```text
/// GET  /mobile/field/artifacts/sources/:id/preparation?sourceType=
/// POST /mobile/field/artifacts/sources/:id/prepare        congela o snapshot
/// GET  /mobile/field/artifacts/:id
/// POST /mobile/field/artifacts/:id/render                 agenda a renderização
/// GET  /mobile/field/artifacts/:id/access?operation=
/// ```
library;

enum FieldArtifactSourceType { operation, rvtExecution, pmocEquipmentExecution }

String fieldArtifactSourceTypeWire(FieldArtifactSourceType value) =>
    switch (value) {
      FieldArtifactSourceType.operation => 'OPERATION',
      FieldArtifactSourceType.rvtExecution => 'RVT_EXECUTION',
      FieldArtifactSourceType.pmocEquipmentExecution =>
        'PMOC_EQUIPMENT_EXECUTION',
    };

FieldArtifactSourceType fieldArtifactSourceTypeFromWire(String value) =>
    switch (value) {
      'OPERATION' => FieldArtifactSourceType.operation,
      'RVT_EXECUTION' => FieldArtifactSourceType.rvtExecution,
      'PMOC_EQUIPMENT_EXECUTION' =>
        FieldArtifactSourceType.pmocEquipmentExecution,
      _ => throw FormatException('Unsupported artifact source: $value'),
    };

enum FieldArtifactDocumentType { serviceOrder, rvt, pmoc }

FieldArtifactDocumentType fieldArtifactDocumentTypeFromWire(String value) =>
    switch (value) {
      'SERVICE_ORDER' => FieldArtifactDocumentType.serviceOrder,
      'RVT' => FieldArtifactDocumentType.rvt,
      'PMOC' => FieldArtifactDocumentType.pmoc,
      _ => throw FormatException('Unsupported document type: $value'),
    };

/// O ciclo do documento, do lado do servidor.
///
/// `prepared` é o snapshot congelado sem renderização pedida; `pending` e
/// `rendering` são o trabalho assíncrono em curso; `ready` é o único em que
/// existe arquivo.
enum FieldArtifactStatus {
  notPrepared,
  prepared,
  pending,
  rendering,
  ready,
  failed,
  unknown,
}

/// Estado publicado que este app ainda não conhece vira [unknown].
///
/// Não lança: uma versão nova do servidor não pode deixar a tela do documento
/// em branco no meio de um atendimento.
FieldArtifactStatus fieldArtifactStatusFromWire(String value) =>
    switch (value) {
      'NOT_PREPARED' => FieldArtifactStatus.notPrepared,
      'PREPARED' => FieldArtifactStatus.prepared,
      'PENDING' => FieldArtifactStatus.pending,
      'RENDERING' => FieldArtifactStatus.rendering,
      'READY' => FieldArtifactStatus.ready,
      'FAILED' => FieldArtifactStatus.failed,
      _ => FieldArtifactStatus.unknown,
    };

/// Estados em que vale perguntar de novo.
///
/// Fora deles não há o que esperar, e continuar consultando seria gastar rede
/// e bateria para receber sempre a mesma resposta.
bool fieldArtifactIsTransient(FieldArtifactStatus status) =>
    status == FieldArtifactStatus.pending ||
    status == FieldArtifactStatus.rendering;

enum FieldArtifactAllowedAction {
  prepareDocument,
  generateDocument,
  viewDocument,
  downloadDocument,
}

FieldArtifactAllowedAction? fieldArtifactActionFromWire(String value) =>
    switch (value) {
      'PREPARE_DOCUMENT' => FieldArtifactAllowedAction.prepareDocument,
      'GENERATE_DOCUMENT' => FieldArtifactAllowedAction.generateDocument,
      'VIEW_DOCUMENT' => FieldArtifactAllowedAction.viewDocument,
      'DOWNLOAD_DOCUMENT' => FieldArtifactAllowedAction.downloadDocument,

      /// Ação desconhecida some da lista em vez de virar botão sem nome.
      _ => null,
    };

/// Por que o documento ainda não pode ser emitido.
///
/// Todos vêm do servidor. Nenhum é recalculado aqui — inclusive
/// `EVIDENCE_PENDING`, que conta intenções de upload pendentes **no servidor**,
/// não a fila local do aparelho.
enum FieldArtifactBlockedReason {
  sourceNotCompleted,
  fieldTechnicianSignatureMissing,
  technicalResponsibleMissing,
  rtSignatureMissing,
  acknowledgementRequired,
  acknowledgementStale,
  evidencePending,
  templateNotAvailable,
  notAuthorized,
  unknown,
}

FieldArtifactBlockedReason fieldArtifactBlockedReasonFromWire(
  String value,
) => switch (value) {
  'SOURCE_NOT_COMPLETED' => FieldArtifactBlockedReason.sourceNotCompleted,
  'FIELD_TECHNICIAN_SIGNATURE_MISSING' =>
    FieldArtifactBlockedReason.fieldTechnicianSignatureMissing,
  'TECHNICAL_RESPONSIBLE_MISSING' =>
    FieldArtifactBlockedReason.technicalResponsibleMissing,
  'RT_SIGNATURE_MISSING' => FieldArtifactBlockedReason.rtSignatureMissing,
  'ACKNOWLEDGEMENT_REQUIRED' =>
    FieldArtifactBlockedReason.acknowledgementRequired,
  'ACKNOWLEDGEMENT_STALE' => FieldArtifactBlockedReason.acknowledgementStale,
  'EVIDENCE_PENDING' => FieldArtifactBlockedReason.evidencePending,
  'TEMPLATE_NOT_AVAILABLE' => FieldArtifactBlockedReason.templateNotAvailable,
  'NOT_AUTHORIZED' => FieldArtifactBlockedReason.notAuthorized,
  _ => FieldArtifactBlockedReason.unknown,
};

final class FieldArtifactEligibility {
  const FieldArtifactEligibility({
    required this.eligible,
    required this.blockedReasons,
  });

  final bool eligible;
  final List<FieldArtifactBlockedReason> blockedReasons;

  factory FieldArtifactEligibility.fromJson(Map<String, Object?> json) =>
      FieldArtifactEligibility(
        eligible: json['eligible']! as bool,
        blockedReasons: (json['blockedReasons'] as List<Object?>? ?? const [])
            .map(
              (value) => fieldArtifactBlockedReasonFromWire(value! as String),
            )
            .toList(growable: false),
      );
}

/// O documento como entidade — não o arquivo.
final class FieldArtifact {
  const FieldArtifact({
    required this.id,
    required this.artifactExecutionId,
    required this.sourceType,
    required this.sourceId,
    required this.documentType,
    required this.status,
    required this.snapshotVersion,
    required this.snapshotHash,
    required this.templateVersion,
    required this.generatedAt,
    required this.previewAvailable,
    required this.downloadAvailable,
    required this.allowedActions,
  });

  final String id;
  final String artifactExecutionId;
  final FieldArtifactSourceType sourceType;
  final String sourceId;
  final FieldArtifactDocumentType documentType;
  final FieldArtifactStatus status;

  /// A versão dos fatos congelados. Mudanças posteriores na fonte criam outra
  /// versão; **não** reescrevem esta.
  final int snapshotVersion;

  /// SHA-256 dos fatos congelados. Referência técnica, não informação de
  /// campo — quem está no telhado não precisa dela.
  final String snapshotHash;

  final int templateVersion;

  /// Quando o arquivo foi emitido. Distinto do momento em que o snapshot foi
  /// congelado: entre os dois há uma fila.
  final DateTime? generatedAt;

  final bool previewAvailable;
  final bool downloadAvailable;
  final List<FieldArtifactAllowedAction> allowedActions;

  bool allows(FieldArtifactAllowedAction action) =>
      allowedActions.contains(action);

  bool get isTransient => fieldArtifactIsTransient(status);

  factory FieldArtifact.fromJson(Map<String, Object?> json) => FieldArtifact(
    id: json['id']! as String,
    artifactExecutionId: json['artifactExecutionId']! as String,
    sourceType: fieldArtifactSourceTypeFromWire(json['sourceType']! as String),
    sourceId: json['sourceId']! as String,
    documentType: fieldArtifactDocumentTypeFromWire(
      json['documentType']! as String,
    ),
    status: fieldArtifactStatusFromWire(json['status']! as String),
    snapshotVersion: (json['snapshotVersion']! as num).toInt(),
    snapshotHash: json['snapshotHash']! as String,
    templateVersion: (json['templateVersion']! as num).toInt(),
    generatedAt: json['generatedAt'] == null
        ? null
        : DateTime.parse(json['generatedAt']! as String),
    previewAvailable: json['previewAvailable']! as bool,
    downloadAvailable: json['downloadAvailable']! as bool,
    allowedActions: (json['allowedActions'] as List<Object?>? ?? const [])
        .map((value) => fieldArtifactActionFromWire(value! as String))
        .whereType<FieldArtifactAllowedAction>()
        .toList(growable: false),
  );
}

/// Quais assinaturas profissionais o snapshot já tem.
///
/// Fatos do servidor. O app não resolve executor real, não escolhe signatário
/// e não deduz papel — a cadeia `completedBy → startedBy → responsável` é
/// resolvida lá.
final class FieldArtifactSignatures {
  const FieldArtifactSignatures({
    required this.fieldTechnician,
    required this.technicalResponsibleRequired,
    required this.technicalResponsible,
  });

  final bool fieldTechnician;
  final bool technicalResponsibleRequired;
  final bool technicalResponsible;

  factory FieldArtifactSignatures.fromJson(Map<String, Object?> json) =>
      FieldArtifactSignatures(
        fieldTechnician: json['fieldTechnician']! as bool,
        technicalResponsibleRequired:
            json['technicalResponsibleRequired']! as bool,
        technicalResponsible: json['technicalResponsible']! as bool,
      );
}

/// A ciência do cliente, do ponto de vista do documento.
///
/// `valid` é do servidor: se o atendimento mudou depois do aceite, é ele quem
/// decide que o aceite não vale mais. O app não compara hash nem recalcula
/// validade.
final class FieldArtifactAcknowledgement {
  const FieldArtifactAcknowledgement({
    required this.required,
    required this.available,
    required this.valid,
  });

  final bool required;
  final bool available;
  final bool valid;

  factory FieldArtifactAcknowledgement.fromJson(Map<String, Object?> json) =>
      FieldArtifactAcknowledgement(
        required: json['required']! as bool,
        available: json['available']! as bool,
        valid: json['valid']! as bool,
      );
}

/// Quantas evidências o servidor considera prontas e quantas ainda não.
///
/// `pending` conta intenções de upload **no servidor**, não a fila local: uma
/// foto que nunca saiu do aparelho não aparece aqui, e não deveria.
final class FieldArtifactEvidenceSummary {
  const FieldArtifactEvidenceSummary({
    required this.finalized,
    required this.pending,
  });

  final int finalized;
  final int pending;

  factory FieldArtifactEvidenceSummary.fromJson(Map<String, Object?> json) =>
      FieldArtifactEvidenceSummary(
        finalized: (json['finalized']! as num).toInt(),
        pending: (json['pending']! as num).toInt(),
      );
}

/// A situação documental de uma fonte, **sem congelar nada**.
///
/// Abrir a seção do documento consulta isto e só isto: preparar é uma ação
/// explícita, porque congelar snapshot é irreversível.
final class FieldArtifactPreparation {
  const FieldArtifactPreparation({
    required this.sourceType,
    required this.sourceId,
    required this.documentType,
    required this.eligibility,
    required this.templateVersion,
    required this.professionalSignatures,
    required this.customerAcknowledgement,
    required this.evidenceSummary,
    required this.snapshotVersion,
    required this.existingArtifact,
    required this.allowedActions,
  });

  final FieldArtifactSourceType sourceType;
  final String sourceId;
  final FieldArtifactDocumentType documentType;
  final FieldArtifactEligibility eligibility;
  final int? templateVersion;
  final FieldArtifactSignatures professionalSignatures;
  final FieldArtifactAcknowledgement customerAcknowledgement;
  final FieldArtifactEvidenceSummary evidenceSummary;
  final int snapshotVersion;

  /// O artefato que já existe para esta fonte, quando existe.
  final FieldArtifact? existingArtifact;

  final List<FieldArtifactAllowedAction> allowedActions;

  bool allows(FieldArtifactAllowedAction action) =>
      allowedActions.contains(action);

  factory FieldArtifactPreparation.fromJson(
    Map<String, Object?> json,
  ) => FieldArtifactPreparation(
    sourceType: fieldArtifactSourceTypeFromWire(json['sourceType']! as String),
    sourceId: json['sourceId']! as String,
    documentType: fieldArtifactDocumentTypeFromWire(
      json['documentType']! as String,
    ),
    eligibility: FieldArtifactEligibility.fromJson(
      Map<String, Object?>.from(json['eligibility']! as Map<Object?, Object?>),
    ),
    templateVersion: (json['templateVersion'] as num?)?.toInt(),
    professionalSignatures: FieldArtifactSignatures.fromJson(
      Map<String, Object?>.from(
        json['professionalSignatures']! as Map<Object?, Object?>,
      ),
    ),
    customerAcknowledgement: FieldArtifactAcknowledgement.fromJson(
      Map<String, Object?>.from(
        json['customerAcknowledgement']! as Map<Object?, Object?>,
      ),
    ),
    evidenceSummary: FieldArtifactEvidenceSummary.fromJson(
      Map<String, Object?>.from(
        json['evidenceSummary']! as Map<Object?, Object?>,
      ),
    ),
    snapshotVersion: (json['snapshotVersion']! as num).toInt(),
    existingArtifact: json['existingArtifact'] == null
        ? null
        : FieldArtifact.fromJson(
            Map<String, Object?>.from(
              json['existingArtifact']! as Map<Object?, Object?>,
            ),
          ),
    allowedActions: (json['allowedActions'] as List<Object?>? ?? const [])
        .map((value) => fieldArtifactActionFromWire(value! as String))
        .whereType<FieldArtifactAllowedAction>()
        .toList(growable: false),
  );
}

/// Acesso temporário ao arquivo.
///
/// Vale minutos e é pedido no momento de usar. Guardá-lo como atributo do
/// documento renderia um link morto na próxima abertura — e uma URL assinada
/// não é estado de domínio.
final class FieldArtifactAccess {
  const FieldArtifactAccess({
    required this.artifactId,
    required this.operation,
    required this.url,
    required this.expiresAt,
    required this.requiredHeaders,
  });

  final String artifactId;
  final String operation;
  final Uri url;
  final DateTime expiresAt;
  final Map<String, String> requiredHeaders;

  bool get isExpired => DateTime.now().toUtc().isAfter(expiresAt);

  factory FieldArtifactAccess.fromJson(Map<String, Object?> json) =>
      FieldArtifactAccess(
        artifactId: json['artifactId']! as String,
        operation: json['operation']! as String,
        url: Uri.parse(json['url']! as String),
        expiresAt: DateTime.parse(json['expiresAt']! as String),
        requiredHeaders:
            (json['requiredHeaders'] as Map<Object?, Object?>? ?? const {}).map(
              (key, value) => MapEntry(key! as String, '$value'),
            ),
      );
}
