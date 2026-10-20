/// Public contracts for `/api/v1/artifact-manifests`.
///
/// The manifest is the platform's single official representation of an issued
/// document. The mobile client reads it and asks for a signed URL when the
/// operator wants to open the file — it never learns bucket or object key, and
/// there is no code path here that talks to a storage provider.
///
/// Additive fields are ignored to keep the mobile v1 parser forward-compatible.
library;

typedef JsonObject = Map<String, dynamic>;

/// Lifecycle of one revision.
///
/// `draft` has no content yet; the renderer delivers it later. Only `issued`
/// can be the active revision, and `revoked` is never distributable.
enum ArtifactManifestStatus {
  draft,
  issued,
  superseded,
  revoked,
  unknown;

  static ArtifactManifestStatus parse(String? value) => switch (value) {
    'DRAFT' => ArtifactManifestStatus.draft,
    'ISSUED' => ArtifactManifestStatus.issued,
    'SUPERSEDED' => ArtifactManifestStatus.superseded,
    'REVOKED' => ArtifactManifestStatus.revoked,
    _ => ArtifactManifestStatus.unknown,
  };
}

/// Stored file, without any provider address.
class StorageFileContract {
  const StorageFileContract({
    required this.id,
    required this.fileName,
    required this.mimeType,
    required this.sizeBytes,
    required this.sha256,
    required this.status,
  });

  factory StorageFileContract.fromJson(JsonObject json) => StorageFileContract(
    id: json['id'] as String? ?? '',
    fileName: json['fileName'] as String? ?? '',
    mimeType: json['mimeType'] as String? ?? 'application/octet-stream',
    // Serialized as text: the byte count does not fit a JSON number safely.
    sizeBytes: int.tryParse(json['sizeBytes']?.toString() ?? '') ?? 0,
    sha256: json['sha256'] as String?,
    status: json['status'] as String? ?? 'PENDING',
  );

  final String id;
  final String fileName;
  final String mimeType;
  final int sizeBytes;

  /// SHA-256 of the stored content; null while the upload is unconfirmed.
  final String? sha256;
  final String status;

  bool get isAvailable => status == 'AVAILABLE';
}

/// Short-lived URL for download, preview or upload.
class SignedUrlContract {
  const SignedUrlContract({
    required this.url,
    required this.method,
    required this.expiresAt,
    required this.requiredHeaders,
  });

  factory SignedUrlContract.fromJson(JsonObject json) => SignedUrlContract(
    url: json['url'] as String? ?? '',
    method: json['method'] as String? ?? 'GET',
    expiresAt: DateTime.tryParse(json['expiresAt'] as String? ?? ''),
    requiredHeaders: (json['requiredHeaders'] as JsonObject? ?? const {}).map(
      (key, value) => MapEntry(key, value?.toString() ?? ''),
    ),
  );

  final String url;
  final String method;
  final DateTime? expiresAt;

  /// Headers the client must repeat, or the signature does not match.
  final Map<String, String> requiredHeaders;

  bool get isExpired =>
      expiresAt != null && expiresAt!.isBefore(DateTime.now().toUtc());
}

class ArtifactManifestActorContract {
  const ArtifactManifestActorContract({
    required this.id,
    required this.displayName,
  });

  factory ArtifactManifestActorContract.fromJson(JsonObject json) =>
      ArtifactManifestActorContract(
        id: json['id'] as String? ?? '',
        displayName: json['displayName'] as String? ?? '',
      );

  final String id;
  final String displayName;
}

class ArtifactManifestContract {
  const ArtifactManifestContract({
    required this.id,
    required this.executionId,
    required this.revision,
    required this.status,
    required this.renderer,
    required this.format,
    required this.contentHash,
    required this.sourceHash,
    required this.isActive,
    required this.issuedAt,
    required this.issuedBy,
    required this.revokedAt,
    required this.revokedReason,
    required this.file,
  });

  factory ArtifactManifestContract.fromJson(JsonObject json) =>
      ArtifactManifestContract(
        id: json['id'] as String? ?? '',
        executionId: json['executionId'] as String? ?? '',
        revision: (json['revision'] as num?)?.toInt() ?? 0,
        status: ArtifactManifestStatus.parse(json['status'] as String?),
        renderer: json['renderer'] as String? ?? '',
        format: json['format'] as String? ?? 'PDF',
        contentHash: json['contentHash'] as String?,
        sourceHash: json['sourceHash'] as String? ?? '',
        isActive: json['isActive'] as bool? ?? false,
        issuedAt: DateTime.tryParse(json['issuedAt'] as String? ?? ''),
        issuedBy: json['issuedBy'] is JsonObject
            ? ArtifactManifestActorContract.fromJson(
                json['issuedBy'] as JsonObject,
              )
            : null,
        revokedAt: DateTime.tryParse(json['revokedAt'] as String? ?? ''),
        revokedReason: json['revokedReason'] as String?,
        file: json['file'] is JsonObject
            ? StorageFileContract.fromJson(json['file'] as JsonObject)
            : null,
      );

  final String id;
  final String executionId;
  final int revision;
  final ArtifactManifestStatus status;
  final String renderer;
  final String format;

  /// SHA-256 of the issued file; null while the revision is a draft.
  final String? contentHash;

  /// SHA-256 of the execution content when the revision was opened.
  final String sourceHash;
  final bool isActive;
  final DateTime? issuedAt;
  final ArtifactManifestActorContract? issuedBy;
  final DateTime? revokedAt;
  final String? revokedReason;
  final StorageFileContract? file;

  bool get isDownloadable =>
      file != null && status != ArtifactManifestStatus.revoked;
}

/// Every revision of one execution, plus which one is active.
class ArtifactManifestListContract {
  const ArtifactManifestListContract({
    required this.revisions,
    required this.total,
    required this.activeRevision,
  });

  factory ArtifactManifestListContract.fromJson(JsonObject json) {
    final meta = json['meta'] as JsonObject? ?? const {};
    return ArtifactManifestListContract(
      revisions: (json['data'] as List<dynamic>? ?? const [])
          .whereType<JsonObject>()
          .map(ArtifactManifestContract.fromJson)
          .toList(growable: false),
      total: (meta['total'] as num?)?.toInt() ?? 0,
      activeRevision: (meta['activeRevision'] as num?)?.toInt(),
    );
  }

  final List<ArtifactManifestContract> revisions;
  final int total;

  /// Null when no revision is active — revoked or still a draft.
  final int? activeRevision;

  ArtifactManifestContract? get active {
    for (final revision in revisions) {
      if (revision.isActive) return revision;
    }
    return null;
  }
}
