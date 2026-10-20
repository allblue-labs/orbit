/// Captura de evidências.
///
/// Separa **de onde vem o arquivo** (câmera, galeria, gerenciador de arquivos)
/// de **o que se faz com ele** (copiar para a área da aplicação e enfileirar).
/// A fila e o envio não sabem qual foi a origem.
///
/// O backend não distingue tipos de anexo — guarda `mimeType` e nada mais. A
/// classificação em foto, vídeo e documento é de apresentação.
library;

import 'dart:io';
import 'dart:math';

import 'package:file_picker/file_picker.dart';
import 'package:image_picker/image_picker.dart';

import '../observability/orbit_logger.dart';
import 'upload_queue.dart';
import 'upload_queue_store.dart';
import 'upload_task.dart';

/// Arquivo escolhido pelo usuário, antes de entrar na fila.
class CapturedEvidence {
  const CapturedEvidence({
    required this.path,
    required this.fileName,
    required this.mimeType,
    required this.sizeInBytes,
  });

  final String path;
  final String fileName;
  final String mimeType;
  final int sizeInBytes;
}

/// Origem de evidências. Trocável — é o que permite testar a fila sem plugin.
abstract interface class EvidenceSource {
  Future<CapturedEvidence?> takePhoto();
  Future<CapturedEvidence?> pickPhoto();
  Future<CapturedEvidence?> recordVideo();
  Future<CapturedEvidence?> pickDocument();
}

/// Implementação sobre `image_picker` e `file_picker`.
class PlatformEvidenceSource implements EvidenceSource {
  PlatformEvidenceSource({ImagePicker? picker})
    : _picker = picker ?? ImagePicker();

  final ImagePicker _picker;

  /// Reduz a foto antes de enviar: 20 MB é o teto do backend e a rede de campo
  /// costuma ser ruim. A qualidade continua suficiente para laudo.
  static const _imageMaxWidth = 2000.0;
  static const _imageQuality = 85;

  @override
  Future<CapturedEvidence?> takePhoto() => _fromXFile(
    () => _picker.pickImage(
      source: ImageSource.camera,
      maxWidth: _imageMaxWidth,
      imageQuality: _imageQuality,
    ),
    fallbackMime: 'image/jpeg',
  );

  @override
  Future<CapturedEvidence?> pickPhoto() => _fromXFile(
    () => _picker.pickImage(
      source: ImageSource.gallery,
      maxWidth: _imageMaxWidth,
      imageQuality: _imageQuality,
    ),
    fallbackMime: 'image/jpeg',
  );

  @override
  Future<CapturedEvidence?> recordVideo() => _fromXFile(
    () => _picker.pickVideo(
      source: ImageSource.camera,
      maxDuration: const Duration(minutes: 2),
    ),
    fallbackMime: 'video/mp4',
  );

  @override
  Future<CapturedEvidence?> pickDocument() async {
    final result = await FilePicker.platform.pickFiles(withData: false);
    final file = result?.files.singleOrNull;
    final path = file?.path;
    if (file == null || path == null) return null;
    return CapturedEvidence(
      path: path,
      fileName: file.name,
      mimeType: _mimeFromExtension(file.extension),
      sizeInBytes: file.size,
    );
  }

  Future<CapturedEvidence?> _fromXFile(
    Future<XFile?> Function() pick, {
    required String fallbackMime,
  }) async {
    final file = await pick();
    if (file == null) return null;
    return CapturedEvidence(
      path: file.path,
      fileName: file.name,
      mimeType: file.mimeType ?? fallbackMime,
      sizeInBytes: await file.length(),
    );
  }

  static String _mimeFromExtension(String? extension) => switch (extension
      ?.toLowerCase()) {
    'pdf' => 'application/pdf',
    'jpg' || 'jpeg' => 'image/jpeg',
    'png' => 'image/png',
    'heic' => 'image/heic',
    'mp4' => 'video/mp4',
    'mov' => 'video/quicktime',
    'doc' => 'application/msword',
    'docx' =>
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls' => 'application/vnd.ms-excel',
    'xlsx' =>
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'csv' => 'text/csv',
    'txt' => 'text/plain',
    _ => 'application/octet-stream',
  };
}

/// Liga a captura à fila.
///
/// Copia o arquivo para o diretório da aplicação antes de enfileirar — o
/// caminho da galeria ou da câmera pode ser temporário e desaparecer antes do
/// envio.
class EvidenceRepository {
  const EvidenceRepository({
    required EvidenceSource source,
    required UploadQueue queue,
    required OrbitLogger logger,
    Future<Directory> Function()? directory,
  }) : _source = source,
       _queue = queue,
       _logger = logger,
       _directory = directory ?? evidenceDirectory;

  final EvidenceSource _source;
  final UploadQueue _queue;
  final OrbitLogger _logger;
  final Future<Directory> Function() _directory;

  Future<UploadTask?> capturePhoto(String operationId) =>
      _capture(operationId, _source.takePhoto);

  Future<UploadTask?> pickPhoto(String operationId) =>
      _capture(operationId, _source.pickPhoto);

  Future<UploadTask?> recordVideo(String operationId) =>
      _capture(operationId, _source.recordVideo);

  Future<UploadTask?> pickDocument(String operationId) =>
      _capture(operationId, _source.pickDocument);

  Future<UploadTask?> _capture(
    String operationId,
    Future<CapturedEvidence?> Function() pick,
  ) async {
    final captured = await pick();
    if (captured == null) return null; // usuário desistiu

    final stored = await _copyToAppStorage(captured);
    final task = UploadTask(
      id: _newId(),
      operationId: operationId,
      filePath: stored.path,
      fileName: captured.fileName,
      mimeType: captured.mimeType,
      sizeInBytes: captured.sizeInBytes,
      createdAt: DateTime.now(),
    );

    _logger.info(
      'evidência capturada',
      data: {
        'operationId': operationId,
        'tipo': task.kind.name,
        'bytes': task.sizeInBytes,
      },
    );
    return _queue.enqueue(task);
  }

  Future<File> _copyToAppStorage(CapturedEvidence captured) async {
    final directory = await _directory();
    final extension = captured.fileName.contains('.')
        ? captured.fileName.substring(captured.fileName.lastIndexOf('.'))
        : '';
    final destination = File('${directory.path}/${_newId()}$extension');
    return File(captured.path).copy(destination.path);
  }

  static final _random = Random.secure();

  static String _newId() {
    final bytes = List<int>.generate(16, (_) => _random.nextInt(256));
    return bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  }
}

extension _SingleOrNull<T> on List<T> {
  T? get singleOrNull => length == 1 ? first : null;
}
