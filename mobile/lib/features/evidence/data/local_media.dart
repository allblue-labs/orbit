/// O registro local de uma mídia.
///
/// Não é a Evidence. É o que o app sabe sobre um arquivo que **ainda** pode
/// virar uma: onde ele está, o que ele é, e a que ponto do pipeline chegou.
/// A Evidence canônica só existe depois que o servidor releu o objeto,
/// conferiu magic bytes, tamanho e hash, e a materializou.
library;

import '../../../core/contracts/mobile_evidence_contracts.dart';
import '../../sync/data/command_journal.dart' show CommandScope;

/// Em que ponto a mídia está, **do lado de cá**.
///
/// `uploading` e `finalizing` não são persistidos como estado final: ao
/// reabrir, o que estava em voo volta a `pending`. Se os bytes chegaram, o
/// servidor devolve a mesma intenção pela chave de idempotência; se não
/// chegaram, sobem agora.
enum LocalMediaState {
  /// Registrada, esperando rede.
  pending,

  /// Enviando os bytes.
  uploading,

  /// Bytes no storage, aguardando o `finalize`. **Não** é evidência ainda.
  finalizing,

  /// O servidor recusou de forma definitiva.
  rejected,

  /// O arquivo sumiu do disco.
  missing,
}

/// Uma mídia capturada, antes de ser evidência.
final class LocalMedia {
  const LocalMedia({
    required this.localMediaId,
    required this.scope,
    required this.target,
    required this.path,
    required this.filename,
    required this.mimeType,
    required this.sizeBytes,
    required this.sha256,
    required this.capturedAt,
    required this.category,
    required this.source,
    required this.state,
    required this.idempotencyKey,
    this.uploadId,
    this.attempts = 0,
    this.lastAttemptAt,
    this.failureCode,
    this.failureMessage,
  });

  /// A identidade do arquivo no aparelho.
  ///
  /// Estável do momento da captura até a evidência existir: sobrevive a
  /// reinício, retry e timeout. **Não é o `evidenceId`** — esse só o servidor
  /// gera, e só depois de aceitar o arquivo.
  final String localMediaId;

  final CommandScope scope;
  final FieldEvidenceTargetRef target;

  /// Caminho num diretório do próprio app, não no cache do seletor.
  final String path;

  final String filename;
  final String mimeType;
  final int sizeBytes;

  /// Calculado sobre os bytes **exatos** que serão enviados. Se o arquivo
  /// fosse alterado depois disto, o servidor recusaria por divergência — e
  /// estaria certo.
  final String sha256;

  final DateTime capturedAt;
  final EvidenceCategory category;
  final EvidenceSource source;
  final LocalMediaState state;

  /// A chave que o servidor associa ao conteúdo da intenção. Congelada na
  /// criação: regenerá-la faria a mesma captura virar duas evidências.
  final String idempotencyKey;

  /// Devolvido pela reserva. Guardado para retomar o `finalize` depois de um
  /// reinício sem refazer a intenção.
  final String? uploadId;

  final int attempts;
  final DateTime? lastAttemptAt;
  final String? failureCode;
  final String? failureMessage;

  bool get isSendable =>
      state == LocalMediaState.pending ||
      state == LocalMediaState.uploading ||
      state == LocalMediaState.finalizing;

  bool get isBlocked =>
      state == LocalMediaState.rejected || state == LocalMediaState.missing;

  LocalMedia copyWith({
    LocalMediaState? state,
    String? uploadId,
    int? attempts,
    DateTime? lastAttemptAt,
    String? failureCode,
    String? failureMessage,
    bool clearFailure = false,
  }) => LocalMedia(
    localMediaId: localMediaId,
    scope: scope,
    target: target,
    path: path,
    filename: filename,
    mimeType: mimeType,
    sizeBytes: sizeBytes,
    sha256: sha256,
    capturedAt: capturedAt,
    category: category,
    source: source,
    state: state ?? this.state,
    idempotencyKey: idempotencyKey,
    uploadId: uploadId ?? this.uploadId,
    attempts: attempts ?? this.attempts,
    lastAttemptAt: lastAttemptAt ?? this.lastAttemptAt,
    failureCode: clearFailure ? null : (failureCode ?? this.failureCode),
    failureMessage: clearFailure
        ? null
        : (failureMessage ?? this.failureMessage),
  );

  Map<String, Object?> toJson() => {
    'localMediaId': localMediaId,
    'scope': scope.toJson(),
    'target': target.toJson(),
    'path': path,
    'filename': filename,
    'mimeType': mimeType,
    'sizeBytes': sizeBytes,
    'sha256': sha256,
    'capturedAt': capturedAt.toUtc().toIso8601String(),
    'category': evidenceCategoryWire(category),
    'source': evidenceSourceWire(source),
    'state': state.name,
    'idempotencyKey': idempotencyKey,
    'uploadId': uploadId,
    'attempts': attempts,
    'lastAttemptAt': lastAttemptAt?.toUtc().toIso8601String(),
    'failureCode': failureCode,
    'failureMessage': failureMessage,
  };

  factory LocalMedia.fromJson(Map<String, Object?> json) => LocalMedia(
    localMediaId: json['localMediaId']! as String,
    scope: CommandScope.fromJson(
      Map<String, Object?>.from(json['scope']! as Map<Object?, Object?>),
    ),
    target: FieldEvidenceTargetRef.fromJson(
      Map<String, Object?>.from(json['target']! as Map<Object?, Object?>),
    ),
    path: json['path']! as String,
    filename: json['filename']! as String,
    mimeType: json['mimeType']! as String,
    sizeBytes: (json['sizeBytes']! as num).toInt(),
    sha256: json['sha256']! as String,
    capturedAt: DateTime.parse(json['capturedAt']! as String),
    category: evidenceCategoryFromWire(json['category']! as String),
    source: evidenceSourceFromWire(json['source']! as String),

    /// O que estava em voo volta para a fila — a idempotência cobre o resto.
    state: switch (json['state']) {
      'rejected' => LocalMediaState.rejected,
      'missing' => LocalMediaState.missing,
      _ => LocalMediaState.pending,
    },
    idempotencyKey: json['idempotencyKey']! as String,
    uploadId: json['uploadId'] as String?,
    attempts: (json['attempts'] as num?)?.toInt() ?? 0,
    lastAttemptAt: json['lastAttemptAt'] == null
        ? null
        : DateTime.parse(json['lastAttemptAt']! as String),
    failureCode: json['failureCode'] as String?,
    failureMessage: json['failureMessage'] as String?,
  );
}
