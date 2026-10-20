/// Item da fila de uploads.
///
/// Uma tarefa descreve **o que enviar e para onde**, não como. É serializável
/// porque a fila sobrevive ao fechamento do aplicativo: o técnico fotografa
/// dentro de um subsolo sem sinal, fecha o app, e o envio acontece quando a
/// conexão volta.
library;

/// Situação de uma tarefa na fila.
enum UploadStatus {
  /// Aguardando vez ou aguardando conexão.
  pending,

  /// Em envio agora.
  uploading,

  /// Aceita pelo backend.
  completed,

  /// Falhou de forma recuperável; será tentada de novo.
  retrying,

  /// Falhou definitivamente — exige ação de quem enviou.
  failed,

  /// Cancelada pelo usuário.
  cancelled,
}

/// Natureza da evidência, para a interface saber como apresentá-la.
///
/// O backend não classifica anexos: guarda `mimeType` e nada mais. A
/// classificação abaixo é de apresentação e é derivada do próprio MIME.
enum EvidenceKind { photo, video, document }

EvidenceKind evidenceKindFromMime(String mimeType) {
  if (mimeType.startsWith('image/')) return EvidenceKind.photo;
  if (mimeType.startsWith('video/')) return EvidenceKind.video;
  return EvidenceKind.document;
}

class UploadTask {
  const UploadTask({
    required this.id,
    required this.operationId,
    required this.filePath,
    required this.fileName,
    required this.mimeType,
    required this.sizeInBytes,
    required this.createdAt,
    this.status = UploadStatus.pending,
    this.attempts = 0,
    this.progress = 0,
    this.lastError,
    this.nextAttemptAt,
  });

  factory UploadTask.fromJson(Map<String, dynamic> json) => UploadTask(
    id: json['id'] as String,
    operationId: json['operationId'] as String,
    filePath: json['filePath'] as String,
    fileName: json['fileName'] as String,
    mimeType: json['mimeType'] as String? ?? 'application/octet-stream',
    sizeInBytes: (json['sizeInBytes'] as num?)?.toInt() ?? 0,
    createdAt:
        DateTime.tryParse(json['createdAt'] as String? ?? '') ?? DateTime.now(),
    status: UploadStatus.values.firstWhere(
      (value) => value.name == json['status'],
      orElse: () => UploadStatus.pending,
    ),
    attempts: (json['attempts'] as num?)?.toInt() ?? 0,
    progress: (json['progress'] as num?)?.toDouble() ?? 0,
    lastError: json['lastError'] as String?,
    nextAttemptAt: DateTime.tryParse(json['nextAttemptAt'] as String? ?? ''),
  );

  final String id;
  final String operationId;

  /// Caminho no armazenamento do aplicativo. A cópia é nossa: o arquivo
  /// original da galeria pode desaparecer antes do envio.
  final String filePath;
  final String fileName;
  final String mimeType;
  final int sizeInBytes;
  final DateTime createdAt;
  final UploadStatus status;
  final int attempts;

  /// 0..1
  final double progress;
  final String? lastError;

  /// Quando a próxima tentativa é permitida (backoff exponencial).
  final DateTime? nextAttemptAt;

  EvidenceKind get kind => evidenceKindFromMime(mimeType);

  bool get isTerminal =>
      status == UploadStatus.completed ||
      status == UploadStatus.cancelled ||
      status == UploadStatus.failed;

  bool get isActive =>
      status == UploadStatus.pending ||
      status == UploadStatus.uploading ||
      status == UploadStatus.retrying;

  /// Pronta para ser enviada agora.
  bool isReady(DateTime now) {
    if (status != UploadStatus.pending && status != UploadStatus.retrying) {
      return false;
    }
    final next = nextAttemptAt;
    return next == null || !next.isAfter(now);
  }

  UploadTask copyWith({
    UploadStatus? status,
    int? attempts,
    double? progress,
    String? lastError,
    DateTime? nextAttemptAt,
    bool clearError = false,
    bool clearNextAttempt = false,
  }) => UploadTask(
    id: id,
    operationId: operationId,
    filePath: filePath,
    fileName: fileName,
    mimeType: mimeType,
    sizeInBytes: sizeInBytes,
    createdAt: createdAt,
    status: status ?? this.status,
    attempts: attempts ?? this.attempts,
    progress: progress ?? this.progress,
    lastError: clearError ? null : (lastError ?? this.lastError),
    nextAttemptAt: clearNextAttempt
        ? null
        : (nextAttemptAt ?? this.nextAttemptAt),
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'operationId': operationId,
    'filePath': filePath,
    'fileName': fileName,
    'mimeType': mimeType,
    'sizeInBytes': sizeInBytes,
    'createdAt': createdAt.toIso8601String(),
    'status': status.name,
    'attempts': attempts,
    'progress': progress,
    'lastError': lastError,
    'nextAttemptAt': nextAttemptAt?.toIso8601String(),
  };
}
