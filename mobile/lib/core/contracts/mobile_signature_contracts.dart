enum MobileProfessionalRole { fieldTechnician, technicalResponsible }

MobileProfessionalRole mobileProfessionalRoleFromWire(String value) =>
    switch (value) {
      'FIELD_TECHNICIAN' => MobileProfessionalRole.fieldTechnician,
      'TECHNICAL_RESPONSIBLE' => MobileProfessionalRole.technicalResponsible,
      _ => throw FormatException('Unsupported professional role: $value'),
    };

final class MobileSignatureStatus {
  const MobileSignatureStatus({
    required this.signatureAvailable,
    required this.version,
    required this.updatedAt,
    required this.roles,
    required this.preview,
  });
  final bool signatureAvailable;
  final int? version;
  final DateTime? updatedAt;
  final List<MobileProfessionalRole> roles;
  final MobileSignaturePreview? preview;

  factory MobileSignatureStatus.fromJson(Map<String, Object?> json) =>
      MobileSignatureStatus(
        signatureAvailable: json['signatureAvailable']! as bool,
        version: json['version'] as int?,
        updatedAt: json['updatedAt'] == null
            ? null
            : DateTime.parse(json['updatedAt']! as String),
        roles: (json['roles']! as List<Object?>)
            .map((value) => mobileProfessionalRoleFromWire(value! as String))
            .toList(growable: false),
        preview: json['preview'] == null
            ? null
            : MobileSignaturePreview.fromJson(
                json['preview']! as Map<String, Object?>,
              ),
      );
}

/// Acesso efêmero à imagem da própria assinatura.
///
/// A URL assinada é uma capability de curta duração, não a identidade do
/// arquivo. O backend não publica bucket, chave, caminho ou StorageFile ID.
final class MobileSignaturePreview {
  const MobileSignaturePreview({
    required this.url,
    required this.expiresAt,
    required this.requiredHeaders,
    required this.mimeType,
    required this.sizeBytes,
    required this.sha256,
  });

  factory MobileSignaturePreview.fromJson(Map<String, Object?> json) {
    final rawHeaders =
        json['requiredHeaders'] as Map<String, Object?>? ?? const {};
    final rawSize = json['sizeBytes'];
    final sizeBytes = switch (rawSize) {
      final int value => value,
      final String value => int.parse(value),
      _ => throw const FormatException('Invalid signature preview size'),
    };
    return MobileSignaturePreview(
      url: Uri.parse(json['url']! as String),
      expiresAt: DateTime.parse(json['expiresAt']! as String),
      requiredHeaders: rawHeaders.map(
        (key, value) => MapEntry(key, value! as String),
      ),
      mimeType: json['mimeType']! as String,
      sizeBytes: sizeBytes,
      sha256: json['sha256']! as String,
    );
  }

  final Uri url;
  final DateTime expiresAt;
  final Map<String, String> requiredHeaders;
  final String mimeType;
  final int sizeBytes;
  final String sha256;

  bool get isExpired => !expiresAt.toUtc().isAfter(
    DateTime.now().toUtc().add(const Duration(seconds: 5)),
  );
}

final class MobileSignatureUploadInput {
  const MobileSignatureUploadInput(this.storageObjectId);
  final String storageObjectId;
  Map<String, Object?> toJson() => {'storageObjectId': storageObjectId};
}

final class MobileSignatureUploadReservationInput {
  const MobileSignatureUploadReservationInput({
    required this.fileName,
    required this.mimeType,
    required this.sizeBytes,
  });
  final String fileName;
  final String mimeType;
  final int sizeBytes;
  Map<String, Object?> toJson() => {
    'fileName': fileName,
    'mimeType': mimeType,
    'sizeBytes': sizeBytes,
  };
}

final class MobileSignatureUploadReservation {
  const MobileSignatureUploadReservation({
    required this.fileId,
    required this.url,
    required this.expiresAt,
    required this.requiredHeaders,
  });
  final String fileId;
  final Uri url;
  final DateTime expiresAt;
  final Map<String, String> requiredHeaders;
  factory MobileSignatureUploadReservation.fromJson(Map<String, Object?> json) {
    final upload = json['upload']! as Map<String, Object?>;
    final headers = upload['requiredHeaders']! as Map<String, Object?>;
    return MobileSignatureUploadReservation(
      fileId: json['fileId']! as String,
      url: Uri.parse(upload['url']! as String),
      expiresAt: DateTime.parse(upload['expiresAt']! as String),
      requiredHeaders: headers.map(
        (key, value) => MapEntry(key, value! as String),
      ),
    );
  }
}

final class MobileSignatureUploadResult {
  const MobileSignatureUploadResult({
    required this.status,
    required this.replacedVersion,
  });
  final MobileSignatureStatus status;
  final int? replacedVersion;
  factory MobileSignatureUploadResult.fromJson(Map<String, Object?> json) =>
      MobileSignatureUploadResult(
        status: MobileSignatureStatus.fromJson(json),
        replacedVersion: json['replacedVersion'] as int?,
      );
}

final class ProfessionalSignatureRequirement {
  const ProfessionalSignatureRequirement({
    required this.required,
    required this.available,
    required this.role,
    required this.eligible,
    required this.blockedReason,
    required this.message,
  });
  final bool required;
  final bool available;
  final MobileProfessionalRole? role;
  final bool eligible;
  final String? blockedReason;
  final String? message;
  factory ProfessionalSignatureRequirement.fromJson(
    Map<String, Object?> json,
  ) => ProfessionalSignatureRequirement(
    required: json['required']! as bool,
    available: json['available']! as bool,
    role: json['role'] == null
        ? null
        : mobileProfessionalRoleFromWire(json['role']! as String),
    eligible: json['eligible']! as bool,
    blockedReason: json['blockedReason'] as String?,
    message: json['message'] as String?,
  );
}

final class CustomerAcknowledgementInput {
  const CustomerAcknowledgementInput({
    required this.signerName,
    required this.expectedVersion,
    required this.contentHash,
    required this.commandId,
    this.signatureStorageFileId,
    this.contactId,
    this.occurredAt,
  });
  final String signerName;
  final String expectedVersion;
  final String contentHash;
  final String commandId;
  final String? signatureStorageFileId;
  final String? contactId;
  final DateTime? occurredAt;
  Map<String, Object?> toJson() => {
    'signerName': signerName,
    'expectedVersion': expectedVersion,
    'contentHash': contentHash,
    'commandId': commandId,
    if (signatureStorageFileId != null)
      'signatureStorageFileId': signatureStorageFileId,
    if (contactId != null) 'contactId': contactId,
    if (occurredAt != null) 'occurredAt': occurredAt!.toUtc().toIso8601String(),
  };
}

/// Um equipamento no resumo apresentado ao cliente.
final class AcknowledgementEquipment {
  const AcknowledgementEquipment({
    required this.id,
    required this.code,
    required this.name,
  });

  factory AcknowledgementEquipment.fromJson(Map<String, Object?> json) =>
      AcknowledgementEquipment(
        id: json['id'] as String? ?? '',
        code: json['code'] as String? ?? '',
        name: json['name'] as String? ?? '',
      );

  final String id;
  final String code;
  final String name;
}

/// Um aceite já registrado neste atendimento.
///
/// É **fato histórico**: quem assinou e quando. O contrato não publica se ele
/// ainda corresponde ao estado atual do atendimento, e o app não deduz isso
/// comparando hashes — ver o comentário em [CustomerAcknowledgementPreparation].
final class ExistingAcknowledgement {
  const ExistingAcknowledgement({
    required this.signerName,
    required this.acknowledgedAt,
    required this.hasSignature,
  });

  factory ExistingAcknowledgement.fromJson(Map<String, Object?> json) =>
      ExistingAcknowledgement(
        signerName: json['signerName'] as String? ?? '',
        acknowledgedAt:
            DateTime.tryParse(json['acknowledgedAt'] as String? ?? '') ??
            DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
        hasSignature: json['hasSignature'] as bool? ?? false,
      );

  final String signerName;
  final DateTime acknowledgedAt;
  final bool hasSignature;
}

/// O resumo **congelado** que o cliente revisa antes de dar ciência.
///
/// `serviceSummary` vem redigido do servidor e é o que o `contentHash` cobre.
/// Montar um resumo alternativo no app quebraria a correspondência: o cliente
/// concordaria com um texto e o backend registraria outro.
///
/// ## Sobre validade do aceite anterior
///
/// O desalinhamento é detectado **no momento de coletar**: se o atendimento
/// mudou, `expectedVersion` ou `contentHash` não batem e o servidor recusa com
/// 409. A preparação não publica se um aceite já registrado continua
/// correspondendo ao estado atual — por isso o app o apresenta como fato
/// ("fulano deu ciência em tal data") e não afirma que segue válido.
final class CustomerAcknowledgementPreparation {
  const CustomerAcknowledgementPreparation({
    required this.executionType,
    required this.executionId,
    required this.serviceSummary,
    required this.equipment,
    required this.contentVersion,
    required this.contentHash,
    required this.signatureRequired,
    required this.signatureOptional,
    this.customerName,
    this.performedAt,
    this.existingAcknowledgement,
  });

  factory CustomerAcknowledgementPreparation.fromJson(
    Map<String, Object?> json,
  ) {
    final policy = json['signerPolicy'] as Map<String, Object?>? ?? const {};
    final customer = json['customer'] as Map<String, Object?>?;
    final existing = json['existingAcknowledgement'] as Map<String, Object?>?;

    return CustomerAcknowledgementPreparation(
      executionType: json['executionType'] as String? ?? 'OPERATION',
      executionId: json['executionId'] as String? ?? '',
      serviceSummary: json['serviceSummary'] as String? ?? '',
      customerName: customer?['name'] as String?,
      equipment: (json['equipment'] as List<Object?>? ?? const [])
          .whereType<Map<String, Object?>>()
          .map(AcknowledgementEquipment.fromJson)
          .toList(growable: false),
      performedAt: DateTime.tryParse(json['performedAt'] as String? ?? ''),
      existingAcknowledgement: existing == null
          ? null
          : ExistingAcknowledgement.fromJson(existing),
      contentVersion: json['contentVersion'] as String? ?? '',
      contentHash: json['contentHash'] as String? ?? '',
      signatureRequired: policy['signatureRequired'] as bool? ?? false,
      signatureOptional: policy['signatureOptional'] as bool? ?? true,
    );
  }

  final String executionType;
  final String executionId;

  /// O texto que o cliente lê. Vem pronto do servidor.
  final String serviceSummary;
  final String? customerName;
  final List<AcknowledgementEquipment> equipment;
  final DateTime? performedAt;
  final ExistingAcknowledgement? existingAcknowledgement;

  /// Precondições que voltam no comando, verbatim.
  final String contentVersion;
  final String contentHash;

  /// Assinatura gráfica é **opcional** por política do servidor. Sem ela, o
  /// nome de quem deu ciência basta — e chamar isso de "assinatura do cliente"
  /// prometeria algo que o contrato não faz.
  final bool signatureRequired;
  final bool signatureOptional;
}

final class CustomerAcknowledgementResult {
  const CustomerAcknowledgementResult({
    required this.id,
    required this.executionId,
    required this.signerName,
    required this.hasSignature,
    required this.acknowledgedAt,
    required this.contentVersion,
    required this.contentHash,
    required this.idempotentReplay,
  });
  final String id;
  final String executionId;
  final String signerName;
  final bool hasSignature;
  final DateTime acknowledgedAt;
  final String contentVersion;
  final String contentHash;
  final bool idempotentReplay;
  factory CustomerAcknowledgementResult.fromJson(Map<String, Object?> json) =>
      CustomerAcknowledgementResult(
        id: json['id']! as String,
        executionId: json['executionId']! as String,
        signerName: json['signerName']! as String,
        hasSignature: json['hasSignature']! as bool,
        acknowledgedAt: DateTime.parse(json['acknowledgedAt']! as String),
        contentVersion: json['contentVersion']! as String,
        contentHash: json['contentHash']! as String,
        idempotentReplay: json['idempotentReplay']! as bool,
      );
}
