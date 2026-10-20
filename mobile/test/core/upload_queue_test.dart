/// Fila de uploads.
///
/// É o componente mais crítico da PR: uma evidência perdida é trabalho de
/// campo perdido. Os testes cobrem o caminho feliz, as falhas recuperáveis, as
/// definitivas, o cancelamento e a sobrevivência ao fechamento do aplicativo.
library;

import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/errors/orbit_exception.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/core/uploads/upload_queue.dart';
import 'package:orbit_operator/core/uploads/upload_task.dart';

/// Armazenamento em memória, com contagem de gravações.
class _MemoryStore implements UploadQueueStore {
  List<UploadTask> tasks = const [];
  int saves = 0;

  @override
  Future<List<UploadTask>> load() async => tasks;

  @override
  Future<void> save(List<UploadTask> value) async {
    tasks = value;
    saves++;
  }
}

const _logger = OrbitLogger(isProduction: true);

late Directory _tempDir;

UploadTask buildTask({
  String id = 'task-1',
  String operationId = 'op-1',
  UploadStatus status = UploadStatus.pending,
  int attempts = 0,
  int size = 1024,
}) {
  // Arquivo real: a fila apaga o arquivo após enviar.
  final file = File('${_tempDir.path}/$id.jpg')..writeAsStringSync('conteudo');
  return UploadTask(
    id: id,
    operationId: operationId,
    filePath: file.path,
    fileName: 'evidencia.jpg',
    mimeType: 'image/jpeg',
    sizeInBytes: size,
    createdAt: DateTime.now(),
    status: status,
    attempts: attempts,
  );
}

void main() {
  setUp(() {
    _tempDir = Directory.systemTemp.createTempSync('orbit_uploads_test');
  });

  tearDown(() {
    if (_tempDir.existsSync()) _tempDir.deleteSync(recursive: true);
  });

  test('envia e marca como concluída, apagando o arquivo local', () async {
    final store = _MemoryStore();
    final sent = <String>[];
    final queue = UploadQueue(
      store: store,
      logger: _logger,
      executor: (task, {required onProgress, required cancellation}) async {
        onProgress(0.5);
        sent.add(task.id);
      },
    );

    final task = buildTask();
    await queue.enqueue(task);
    await queue.process();

    expect(sent, ['task-1']);
    expect(queue.tasks.single.status, UploadStatus.completed);
    expect(queue.tasks.single.progress, 1);
    expect(File(task.filePath).existsSync(), isFalse, reason: 'cópia removida');
    await queue.dispose();
  });

  test('reporta progresso durante o envio', () async {
    final store = _MemoryStore();
    final observed = <double>[];
    final queue = UploadQueue(
      store: store,
      logger: _logger,
      executor: (task, {required onProgress, required cancellation}) async {
        onProgress(0.25);
        onProgress(0.75);
      },
    );

    queue.changes.listen((tasks) {
      if (tasks.isNotEmpty) observed.add(tasks.single.progress);
    });

    await queue.enqueue(buildTask());
    await queue.process();
    await Future<void>.delayed(Duration.zero);

    expect(observed, contains(0.25));
    expect(observed, contains(0.75));
    await queue.dispose();
  });

  test('falha de rede reagenda com espera crescente', () async {
    final store = _MemoryStore();
    var calls = 0;
    final queue = UploadQueue(
      store: store,
      logger: _logger,
      baseBackoff: const Duration(seconds: 5),
      executor: (task, {required onProgress, required cancellation}) async {
        calls++;
        throw const OrbitException(
          kind: OrbitErrorKind.network,
          publicMessage: 'Sem conexão com o servidor.',
          code: 'NETWORK',
        );
      },
    );

    await queue.enqueue(buildTask());
    await queue.process();

    final task = queue.tasks.single;
    expect(calls, 1, reason: 'não insiste em laço: espera o backoff');
    expect(task.status, UploadStatus.retrying);
    expect(task.attempts, 1);
    expect(task.nextAttemptAt, isNotNull);
    expect(task.nextAttemptAt!.isAfter(DateTime.now()), isTrue);
    await queue.dispose();
  });

  test('erro do cliente não é reenviado', () async {
    final store = _MemoryStore();
    var calls = 0;
    final queue = UploadQueue(
      store: store,
      logger: _logger,
      executor: (task, {required onProgress, required cancellation}) async {
        calls++;
        throw const OrbitException(
          kind: OrbitErrorKind.http,
          status: 413,
          code: 'PAYLOAD_TOO_LARGE',
          publicMessage:
              'Arquivo acima do limite de 20 MB aceito pelo servidor.',
        );
      },
    );

    await queue.enqueue(buildTask());
    await queue.process();
    await queue.process(); // não deve tentar de novo

    expect(calls, 1);
    final task = queue.tasks.single;
    expect(task.status, UploadStatus.failed);
    expect(task.lastError, contains('20 MB'));
    await queue.dispose();
  });

  test('403 é definitivo — permissão não melhora com repetição', () async {
    final store = _MemoryStore();
    final queue = UploadQueue(
      store: store,
      logger: _logger,
      executor: (task, {required onProgress, required cancellation}) async {
        throw const OrbitException(
          kind: OrbitErrorKind.http,
          status: 403,
          code: 'FORBIDDEN',
          publicMessage: 'Missing required permission',
        );
      },
    );

    await queue.enqueue(buildTask());
    await queue.process();

    expect(queue.tasks.single.status, UploadStatus.failed);
    await queue.dispose();
  });

  test('429 é recuperável — é sobre tempo, não sobre o pedido', () async {
    final store = _MemoryStore();
    final queue = UploadQueue(
      store: store,
      logger: _logger,
      executor: (task, {required onProgress, required cancellation}) async {
        throw const OrbitException(
          kind: OrbitErrorKind.http,
          status: 429,
          code: 'TOO_MANY_REQUESTS',
          publicMessage: 'Too many requests',
        );
      },
    );

    await queue.enqueue(buildTask());
    await queue.process();

    expect(queue.tasks.single.status, UploadStatus.retrying);
    await queue.dispose();
  });

  test('desiste após esgotar as tentativas', () async {
    final store = _MemoryStore();
    final queue = UploadQueue(
      store: store,
      logger: _logger,
      maxAttempts: 2,
      baseBackoff: Duration.zero,
      executor: (task, {required onProgress, required cancellation}) async {
        throw const OrbitException(
          kind: OrbitErrorKind.network,
          publicMessage: 'Sem conexão.',
          code: 'NETWORK',
        );
      },
    );

    await queue.enqueue(buildTask());
    await queue.process(); // consome as duas tentativas

    expect(queue.tasks.single.status, UploadStatus.failed);
    expect(queue.tasks.single.attempts, 2);
    await queue.dispose();
  });

  test('cancelamento interrompe o envio em andamento', () async {
    final store = _MemoryStore();
    final started = Completer<void>();
    final release = Completer<void>();

    final queue = UploadQueue(
      store: store,
      logger: _logger,
      executor: (task, {required onProgress, required cancellation}) async {
        started.complete();
        await release.future;
        if (cancellation.isCancelled) throw StateError('cancelado');
      },
    );

    await queue.enqueue(buildTask());
    final processing = queue.process();

    await started.future;
    await queue.cancel('task-1');
    release.complete();
    await processing;

    expect(queue.tasks.single.status, UploadStatus.cancelled);
    await queue.dispose();
  });

  test('reenvio manual zera as tentativas', () async {
    final store = _MemoryStore();
    var shouldFail = true;
    final queue = UploadQueue(
      store: store,
      logger: _logger,
      executor: (task, {required onProgress, required cancellation}) async {
        if (shouldFail) {
          throw const OrbitException(
            kind: OrbitErrorKind.http,
            status: 400,
            code: 'BAD_REQUEST',
            publicMessage: 'inválido',
          );
        }
      },
    );

    await queue.enqueue(buildTask());
    await queue.process();
    expect(queue.tasks.single.status, UploadStatus.failed);

    shouldFail = false;
    await queue.retry('task-1');
    await queue.process();

    expect(queue.tasks.single.status, UploadStatus.completed);
    expect(queue.tasks.single.attempts, 0);
    await queue.dispose();
  });

  test('envia uma tarefa por vez', () async {
    final store = _MemoryStore();
    var concurrent = 0;
    var maxConcurrent = 0;

    final queue = UploadQueue(
      store: store,
      logger: _logger,
      executor: (task, {required onProgress, required cancellation}) async {
        concurrent++;
        maxConcurrent = concurrent > maxConcurrent ? concurrent : maxConcurrent;
        await Future<void>.delayed(const Duration(milliseconds: 5));
        concurrent--;
      },
    );

    await queue.enqueue(buildTask(id: 'a'));
    await queue.enqueue(buildTask(id: 'b'));
    await queue.enqueue(buildTask(id: 'c'));
    await queue.process();

    expect(maxConcurrent, 1, reason: 'serial poupa rede e bateria em campo');
    expect(
      queue.tasks.every((task) => task.status == UploadStatus.completed),
      isTrue,
    );
    await queue.dispose();
  });

  test('sobrevive ao fechamento: "enviando" volta para pendente', () async {
    final store = _MemoryStore();
    final interrupted = buildTask(status: UploadStatus.uploading);
    store.tasks = [interrupted];

    final sent = <String>[];
    final queue = UploadQueue(
      store: store,
      logger: _logger,
      executor: (task, {required onProgress, required cancellation}) async =>
          sent.add(task.id),
    );

    await queue.restore();
    await queue.process();

    expect(sent, ['task-1'], reason: 'envio não confirmado é refeito');
    await queue.dispose();
  });

  test('a volta da conexão acorda a fila', () async {
    final store = _MemoryStore();
    final connectivity = StreamController<bool>();
    final sent = <String>[];

    final queue = UploadQueue(
      store: store,
      logger: _logger,
      connectivity: connectivity.stream,
      executor: (task, {required onProgress, required cancellation}) async =>
          sent.add(task.id),
    );

    // Tarefa aguardando nova tentativa, sem espera pendente.
    store.tasks = [buildTask(status: UploadStatus.retrying)];
    await queue.restore();
    sent.clear();

    connectivity.add(true);
    await Future<void>.delayed(const Duration(milliseconds: 20));

    expect(sent, contains('task-1'));
    await connectivity.close();
    await queue.dispose();
  });

  test('limpeza remove apenas as encerradas', () async {
    final store = _MemoryStore();
    final queue = UploadQueue(
      store: store,
      logger: _logger,
      executor: (task, {required onProgress, required cancellation}) async {},
    );

    await queue.enqueue(buildTask(id: 'concluida'));
    await queue.process();
    await queue.enqueue(buildTask(id: 'pendente'));

    await queue.clearFinished();

    expect(queue.tasks.map((task) => task.id), ['pendente']);
    await queue.dispose();
  });

  test('tarefas são filtradas por operação', () async {
    final store = _MemoryStore();
    final queue = UploadQueue(
      store: store,
      logger: _logger,
      executor: (task, {required onProgress, required cancellation}) async {
        await Future<void>.delayed(const Duration(milliseconds: 50));
      },
    );

    await queue.enqueue(buildTask(id: 'a', operationId: 'op-1'));
    await queue.enqueue(buildTask(id: 'b', operationId: 'op-2'));

    expect(queue.tasksFor('op-1').map((task) => task.id), ['a']);
    expect(queue.tasksFor('op-2').map((task) => task.id), ['b']);
    await queue.dispose();
  });

  test('serialização preserva o estado da tarefa', () {
    final task = buildTask(status: UploadStatus.retrying, attempts: 2);
    final restored = UploadTask.fromJson(task.toJson());

    expect(restored.id, task.id);
    expect(restored.operationId, task.operationId);
    expect(restored.status, UploadStatus.retrying);
    expect(restored.attempts, 2);
    expect(restored.mimeType, 'image/jpeg');
    expect(restored.kind, EvidenceKind.photo);
  });

  test('classifica a evidência pelo MIME devolvido', () {
    expect(evidenceKindFromMime('image/jpeg'), EvidenceKind.photo);
    expect(evidenceKindFromMime('video/mp4'), EvidenceKind.video);
    expect(evidenceKindFromMime('application/pdf'), EvidenceKind.document);
  });
}
