/// Pipeline de evidências do MB-05.
///
/// Seis conceitos que **não** se fundem:
///
/// ```text
/// ARQUIVO LOCAL        os bytes no aparelho
/// REGISTRO LOCAL       o que o app sabe sobre esses bytes
/// INTENÇÃO             o pedido de upload, com chave de idempotência
/// RESERVA              a URL assinada que o servidor devolveu
/// OBJETO ENVIADO       os bytes já no storage
/// EVIDENCE CANÔNICA    o que o servidor aceitou, validou e materializou
/// ```
///
/// Um `PUT` a 100% produz o quinto, não o sexto. Entre eles ainda há o
/// `finalize`, onde o servidor relê o objeto, confere magic bytes, tamanho e
/// SHA-256, e só então cria a evidência.
///
/// Endpoints reais:
///
/// ```text
/// POST /mobile/field/evidence/uploads                 intenção + URL assinada
/// POST /mobile/field/evidence/uploads/:id/finalize    valida e materializa
/// GET  /mobile/field/evidence?targetType=&targetId=   confirmadas
/// GET  /mobile/field/evidence/:id/access?operation=   preview ou download
/// ```
library;

/// A que a evidência se prende.
enum FieldEvidenceTarget { operation, pmocEquipmentExecution, rvtExecution }

String fieldEvidenceTargetWire(FieldEvidenceTarget value) => switch (value) {
  FieldEvidenceTarget.operation => 'OPERATION',
  FieldEvidenceTarget.pmocEquipmentExecution => 'PMOC_EQUIPMENT_EXECUTION',
  FieldEvidenceTarget.rvtExecution => 'RVT_EXECUTION',
};

FieldEvidenceTarget fieldEvidenceTargetFromWire(String value) =>
    switch (value) {
      'OPERATION' => FieldEvidenceTarget.operation,
      'PMOC_EQUIPMENT_EXECUTION' => FieldEvidenceTarget.pmocEquipmentExecution,
      'RVT_EXECUTION' => FieldEvidenceTarget.rvtExecution,
      _ => throw FormatException('Unsupported evidence target: $value'),
    };

enum EvidenceCategory { before, after, general, equipment, defect, measurement }

String evidenceCategoryWire(EvidenceCategory value) => switch (value) {
  EvidenceCategory.before => 'BEFORE',
  EvidenceCategory.after => 'AFTER',
  EvidenceCategory.general => 'GENERAL',
  EvidenceCategory.equipment => 'EQUIPMENT',
  EvidenceCategory.defect => 'DEFECT',
  EvidenceCategory.measurement => 'MEASUREMENT',
};

EvidenceCategory evidenceCategoryFromWire(String value) => switch (value) {
  'BEFORE' => EvidenceCategory.before,
  'AFTER' => EvidenceCategory.after,
  'GENERAL' => EvidenceCategory.general,
  'EQUIPMENT' => EvidenceCategory.equipment,
  'DEFECT' => EvidenceCategory.defect,
  'MEASUREMENT' => EvidenceCategory.measurement,
  _ => throw FormatException('Unsupported evidence category: $value'),
};

/// De onde o arquivo veio. É registro de proveniência, não de permissão.
enum EvidenceSource { camera, gallery, file }

String evidenceSourceWire(EvidenceSource value) => switch (value) {
  EvidenceSource.camera => 'CAMERA',
  EvidenceSource.gallery => 'GALLERY',
  EvidenceSource.file => 'FILE',
};

EvidenceSource evidenceSourceFromWire(String value) => switch (value) {
  'CAMERA' => EvidenceSource.camera,
  'GALLERY' => EvidenceSource.gallery,
  'FILE' => EvidenceSource.file,
  _ => throw FormatException('Unsupported evidence source: $value'),
};

/// Em que ponto a intenção está, **do lado do servidor**.
enum EvidenceUploadStatus {
  pendingUpload,
  uploaded,
  finalized,
  failed,
  expired,
}

EvidenceUploadStatus evidenceUploadStatusFromWire(String value) =>
    switch (value) {
      'PENDING_UPLOAD' => EvidenceUploadStatus.pendingUpload,
      'UPLOADED' => EvidenceUploadStatus.uploaded,
      'FINALIZED' => EvidenceUploadStatus.finalized,
      'FAILED' => EvidenceUploadStatus.failed,
      'EXPIRED' => EvidenceUploadStatus.expired,
      _ => throw FormatException('Unsupported upload status: $value'),
    };

final class FieldEvidenceTargetRef {
  const FieldEvidenceTargetRef({required this.type, required this.id});

  final FieldEvidenceTarget type;
  final String id;

  Map<String, Object?> toJson() => {
    'type': fieldEvidenceTargetWire(type),
    'id': id,
  };

  factory FieldEvidenceTargetRef.fromJson(Map<String, Object?> json) =>
      FieldEvidenceTargetRef(
        type: fieldEvidenceTargetFromWire(json['type']! as String),
        id: json['id']! as String,
      );

  @override
  bool operator ==(Object other) =>
      other is FieldEvidenceTargetRef && other.type == type && other.id == id;

  @override
  int get hashCode => Object.hash(type, id);
}

/// O pedido de reserva, exatamente como o `CreateFieldEvidenceUploadDto`.
final class EvidenceUploadIntentRequest {
  const EvidenceUploadIntentRequest({
    required this.target,
    required this.filename,
    required this.declaredMimeType,
    required this.declaredSize,
    required this.idempotencyKey,
    this.category,
    this.source,
    this.capturedAt,
    this.localMediaId,
    this.expectedSha256,
  });

  final FieldEvidenceTargetRef target;
  final String filename;
  final String declaredMimeType;
  final int declaredSize;

  /// 8–160 caracteres de `[A-Za-z0-9._:-]`. Repetir a mesma chave com outro
  /// conteúdo devolve `IDEMPOTENCY_MISMATCH` — o servidor guarda o hash do
  /// payload junto da chave.
  final String idempotencyKey;

  final EvidenceCategory? category;
  final EvidenceSource? source;
  final DateTime? capturedAt;

  /// A identidade do arquivo **no aparelho**. Não é o id da Evidence: sobrevive
  /// a reinício e retry, e é o que impede o mesmo arquivo de virar duas
  /// evidências.
  final String? localMediaId;

  /// O SHA-256 dos bytes que serão enviados. O servidor recalcula sobre o
  /// objeto real no `finalize` e recusa se divergir.
  final String? expectedSha256;

  Map<String, Object?> toJson() => {
    'target': target.toJson(),
    'filename': filename,
    'declaredMimeType': declaredMimeType,
    'declaredSize': declaredSize,
    'idempotencyKey': idempotencyKey,
    if (category != null) 'category': evidenceCategoryWire(category!),
    if (source != null) 'source': evidenceSourceWire(source!),
    if (capturedAt != null) 'capturedAt': capturedAt!.toUtc().toIso8601String(),
    if (localMediaId != null) 'localMediaId': localMediaId,
    if (expectedSha256 != null) 'expectedSha256': expectedSha256,
  };
}

/// A reserva devolvida pelo servidor.
///
/// `uploadUrl` vem `null` quando a intenção já está finalizada — repetir a
/// reserva de algo pronto devolve o estado, não uma nova URL.
final class EvidenceUploadIntent {
  const EvidenceUploadIntent({
    required this.uploadId,
    required this.uploadUrl,
    required this.method,
    required this.requiredHeaders,
    required this.expiresAt,
    required this.maxSize,
    required this.localMediaId,
    required this.status,
  });

  final String uploadId;
  final Uri? uploadUrl;
  final String? method;
  final Map<String, String> requiredHeaders;

  /// A URL é temporária. Guardá-la como estado de domínio faria o app tentar
  /// usar, horas depois, uma credencial que já venceu.
  final DateTime expiresAt;

  /// O limite publicado para este tipo — a autoridade sobre tamanho.
  final int maxSize;
  final String? localMediaId;
  final EvidenceUploadStatus status;

  bool get isFinalized => status == EvidenceUploadStatus.finalized;

  bool get isExpired =>
      status == EvidenceUploadStatus.expired ||
      DateTime.now().toUtc().isAfter(expiresAt);

  factory EvidenceUploadIntent.fromJson(Map<String, Object?> json) =>
      EvidenceUploadIntent(
        uploadId: json['uploadId']! as String,
        uploadUrl: json['uploadUrl'] == null
            ? null
            : Uri.parse(json['uploadUrl']! as String),
        method: json['method'] as String?,
        requiredHeaders:
            (json['requiredHeaders'] as Map<Object?, Object?>? ?? const {}).map(
              (key, value) => MapEntry(key! as String, '$value'),
            ),
        expiresAt: DateTime.parse(json['expiresAt']! as String),
        maxSize: (json['maxSize']! as num).toInt(),
        localMediaId: json['localMediaId'] as String?,
        status: evidenceUploadStatusFromWire(json['status']! as String),
      );
}

final class FieldEvidenceAuthor {
  const FieldEvidenceAuthor({required this.id, required this.name});

  final String id;
  final String name;

  factory FieldEvidenceAuthor.fromJson(Map<String, Object?> json) =>
      FieldEvidenceAuthor(
        id: json['id']! as String,
        name: json['name']! as String,
      );
}

/// A evidência canônica — o que o servidor aceitou e materializou.
final class FieldEvidence {
  const FieldEvidence({
    required this.id,
    required this.target,
    required this.category,
    required this.filename,
    required this.mimeType,
    required this.sizeBytes,
    required this.sha256,
    required this.capturedAt,
    required this.uploadedAt,
    required this.capturedBy,
    required this.source,
    required this.localMediaId,
    required this.previewAvailable,
    required this.downloadAvailable,
  });

  final String id;
  final FieldEvidenceTargetRef target;
  final EvidenceCategory category;
  final String filename;
  final String mimeType;

  /// Chega como texto: o backend serializa `BigInt`. Converter para `int` na
  /// borda evita que a apresentação lide com isso.
  final int sizeBytes;
  final String sha256;
  final DateTime? capturedAt;
  final DateTime uploadedAt;
  final FieldEvidenceAuthor capturedBy;
  final EvidenceSource source;

  /// O elo com o registro local — é assim que o app reconhece a própria
  /// captura depois de ela virar evidência.
  final String? localMediaId;
  final bool previewAvailable;
  final bool downloadAvailable;

  factory FieldEvidence.fromJson(Map<String, Object?> json) => FieldEvidence(
    id: json['id']! as String,
    target: FieldEvidenceTargetRef.fromJson(
      Map<String, Object?>.from(json['target']! as Map<Object?, Object?>),
    ),
    category: evidenceCategoryFromWire(json['category']! as String),
    filename: json['filename']! as String,
    mimeType: json['mimeType']! as String,
    sizeBytes: int.tryParse('${json['sizeBytes']}') ?? 0,
    sha256: json['sha256']! as String,
    capturedAt: json['capturedAt'] == null
        ? null
        : DateTime.parse(json['capturedAt']! as String),
    uploadedAt: DateTime.parse(json['uploadedAt']! as String),
    capturedBy: FieldEvidenceAuthor.fromJson(
      Map<String, Object?>.from(json['capturedBy']! as Map<Object?, Object?>),
    ),
    source: evidenceSourceFromWire(json['source']! as String),
    localMediaId: json['localMediaId'] as String?,
    previewAvailable: json['previewAvailable']! as bool,
    downloadAvailable: json['downloadAvailable']! as bool,
  );
}

/// Acesso temporário a uma evidência.
///
/// Vale por minutos. É pedido no momento de mostrar e descartado depois —
/// nunca guardado como se fosse propriedade da evidência.
final class EvidenceAccess {
  const EvidenceAccess({
    required this.evidenceId,
    required this.operation,
    required this.url,
    required this.expiresAt,
    required this.requiredHeaders,
  });

  final String evidenceId;
  final String operation;
  final Uri url;
  final DateTime expiresAt;
  final Map<String, String> requiredHeaders;

  bool get isExpired => DateTime.now().toUtc().isAfter(expiresAt);

  factory EvidenceAccess.fromJson(Map<String, Object?> json) => EvidenceAccess(
    evidenceId: json['evidenceId']! as String,
    operation: json['operation']! as String,
    url: Uri.parse(json['url']! as String),
    expiresAt: DateTime.parse(json['expiresAt']! as String),
    requiredHeaders:
        (json['requiredHeaders'] as Map<Object?, Object?>? ?? const {}).map(
          (key, value) => MapEntry(key! as String, '$value'),
        ),
  );
}
