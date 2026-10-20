/// Captura de evidências.
///
/// Verifica o que a camada garante: copiar o arquivo para a área da aplicação
/// antes de enfileirar (o caminho da câmera é temporário) e não enfileirar
/// nada quando o usuário desiste.
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/core/uploads/evidence_capture.dart';
import 'package:orbit_operator/core/uploads/upload_queue.dart';
import 'package:orbit_operator/core/uploads/upload_task.dart';

class _MemoryStore implements UploadQueueStore {
  List<UploadTask> tasks = const [];

  @override
  Future<List<UploadTask>> load() async => tasks;

  @override
  Future<void> save(List<UploadTask> value) async => tasks = value;
}

/// Origem controlada pelo teste — sem câmera, sem galeria.
class _FakeSource implements EvidenceSource {
  _FakeSource(this.result);

  CapturedEvidence? result;
  int calls = 0;

  Future<CapturedEvidence?> _answer() async {
    calls++;
    return result;
  }

  @override
  Future<CapturedEvidence?> takePhoto() => _answer();
  @override
  Future<CapturedEvidence?> pickPhoto() => _answer();
  @override
  Future<CapturedEvidence?> recordVideo() => _answer();
  @override
  Future<CapturedEvidence?> pickDocument() => _answer();
}

void main() {
  late Directory tempDir;
  late Directory appDir;

  setUp(() {
    tempDir = Directory.systemTemp.createTempSync('orbit_evidence_origem');
    appDir = Directory.systemTemp.createTempSync('orbit_evidence_app');
  });

  tearDown(() {
    for (final directory in [tempDir, appDir]) {
      if (directory.existsSync()) directory.deleteSync(recursive: true);
    }
  });

  ({EvidenceRepository repository, UploadQueue queue, _FakeSource source})
  build(CapturedEvidence? captured) {
    final source = _FakeSource(captured);
    final queue = UploadQueue(
      store: _MemoryStore(),
      logger: const OrbitLogger(isProduction: true),
      // Não envia nada nestes testes: o foco é o que entra na fila.
      executor: (task, {required onProgress, required cancellation}) async =>
          throw StateError('não deve enviar'),
    );
    return (
      repository: EvidenceRepository(
        source: source,
        queue: queue,
        logger: const OrbitLogger(isProduction: true),
        directory: () async => appDir,
      ),
      queue: queue,
      source: source,
    );
  }

  CapturedEvidence writeOriginal({
    String name = 'foto.jpg',
    String mime = 'image/jpeg',
  }) {
    final file = File('${tempDir.path}/$name')..writeAsStringSync('binario');
    return CapturedEvidence(
      path: file.path,
      fileName: name,
      mimeType: mime,
      sizeInBytes: file.lengthSync(),
    );
  }

  test('copia o arquivo para a área do app antes de enfileirar', () async {
    final original = writeOriginal();
    final setup = build(original);

    final task = await setup.repository.capturePhoto('op-1');

    expect(task, isNotNull);
    expect(task!.filePath, startsWith(appDir.path));
    expect(task.filePath, isNot(original.path));
    expect(File(task.filePath).existsSync(), isTrue);

    // A cópia sobrevive ao sumiço do original — é o ponto do teste.
    File(original.path).deleteSync();
    expect(File(task.filePath).existsSync(), isTrue);
    await setup.queue.dispose();
  });

  test('preserva nome, tipo e tamanho declarados', () async {
    final setup = build(
      writeOriginal(name: 'laudo.pdf', mime: 'application/pdf'),
    );

    final task = await setup.repository.pickDocument('op-9');

    expect(task!.fileName, 'laudo.pdf');
    expect(task.mimeType, 'application/pdf');
    expect(task.kind, EvidenceKind.document);
    expect(task.operationId, 'op-9');
    await setup.queue.dispose();
  });

  test('vídeo entra na fila classificado como vídeo', () async {
    final setup = build(writeOriginal(name: 'visita.mp4', mime: 'video/mp4'));

    final task = await setup.repository.recordVideo('op-1');

    expect(task!.kind, EvidenceKind.video);
    await setup.queue.dispose();
  });

  test('usuário desistindo não enfileira nada', () async {
    final setup = build(null);

    final task = await setup.repository.capturePhoto('op-1');

    expect(task, isNull);
    expect(setup.queue.tasks, isEmpty);
    expect(setup.source.calls, 1);
    await setup.queue.dispose();
  });

  test('cada captura gera uma tarefa distinta', () async {
    final setup = build(writeOriginal());

    final first = await setup.repository.capturePhoto('op-1');
    final second = await setup.repository.capturePhoto('op-1');

    expect(first!.id, isNot(second!.id));
    expect(first.filePath, isNot(second.filePath));
    expect(setup.queue.tasks.length, 2);
    await setup.queue.dispose();
  });
}
