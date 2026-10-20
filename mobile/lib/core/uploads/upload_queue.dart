/// Fila resiliente de uploads.
///
/// O aplicativo é usado em campo: sinal cai no meio do envio, o técnico fecha
/// o app, entra num subsolo. A fila existe para que nada disso perca uma
/// evidência já capturada.
///
/// Garantias:
///
/// - **Persistente** — sobrevive ao fechamento do app; o arquivo é copiado
///   para o diretório da aplicação antes de entrar na fila, porque o original
///   da galeria pode sumir.
/// - **Serial** — um envio por vez. Em rede móvel, paralelismo piora a taxa de
///   sucesso e o consumo de bateria.
/// - **Com backoff** — falha recuperável volta para a fila com espera
///   exponencial; falha definitiva (4xx que não seja 408/429) para de tentar e
///   pede ação de quem enviou.
/// - **Retomada por conexão** — ao voltar a rede, a fila acorda sozinha.
///
/// O que a fila **não** faz nesta PR: alterar operação offline. Ela só envia
/// evidências, que são acréscimo. Nenhuma mutação de estado é enfileirada.
library;

import 'dart:async';
import 'dart:io';

import '../errors/orbit_exception.dart';
import '../errors/orbit_public_copy.dart';
import '../observability/orbit_logger.dart';
import 'upload_task.dart';

/// Executa o envio de uma tarefa. Injetado para manter a fila independente do
/// transporte e testável sem rede.
typedef UploadExecutor =
    Future<void> Function(
      UploadTask task, {
      required void Function(double progress) onProgress,
      required CancellationSignal cancellation,
    });

/// Sinal cooperativo de cancelamento.
class CancellationSignal {
  bool _cancelled = false;
  void Function()? _onCancel;

  bool get isCancelled => _cancelled;

  void cancel() {
    _cancelled = true;
    _onCancel?.call();
  }

  /// Registra o que fazer quando o cancelamento chegar (abortar o request).
  void onCancel(void Function() callback) => _onCancel = callback;
}

/// Onde a fila guarda seu estado entre execuções.
abstract interface class UploadQueueStore {
  Future<List<UploadTask>> load();
  Future<void> save(List<UploadTask> tasks);
}

class UploadQueue {
  UploadQueue({
    required UploadQueueStore store,
    required UploadExecutor executor,
    required OrbitLogger logger,
    Stream<bool>? connectivity,
    this.maxAttempts = 5,
    Duration baseBackoff = const Duration(seconds: 5),
  }) : _store = store,
       _executor = executor,
       _logger = logger,
       _baseBackoff = baseBackoff {
    // Voltou a rede: acorda a fila.
    _connectivitySubscription = connectivity?.listen((online) {
      if (online) unawaited(process());
    });
  }

  final UploadQueueStore _store;
  final UploadExecutor _executor;
  final OrbitLogger _logger;
  final Duration _baseBackoff;

  /// Depois disso, a tarefa é dada como falha e espera ação do usuário.
  final int maxAttempts;

  final _controller = StreamController<List<UploadTask>>.broadcast();
  StreamSubscription<bool>? _connectivitySubscription;

  List<UploadTask> _tasks = const [];
  CancellationSignal? _currentSignal;
  String? _currentTaskId;
  Future<void>? _processing;
  bool _loaded = false;

  /// Estado da fila, para a interface observar.
  ///
  /// Emite o estado atual ao se inscrever e depois cada mudança. Sem isso, uma
  /// tela aberta depois de a evidência entrar na fila não mostraria nada até a
  /// próxima alteração.
  Stream<List<UploadTask>> get changes async* {
    yield List.unmodifiable(_tasks);
    yield* _controller.stream;
  }

  List<UploadTask> get tasks => List.unmodifiable(_tasks);

  List<UploadTask> tasksFor(String operationId) => _tasks
      .where((task) => task.operationId == operationId)
      .toList(growable: false);

  int get pendingCount => _tasks.where((task) => task.isActive).length;

  /// Carrega a fila persistida. Tarefas que estavam "enviando" quando o app
  /// morreu voltam para pendente — o envio não foi confirmado.
  Future<void> restore() async {
    if (_loaded) return;
    final stored = await _store.load();
    _tasks = stored
        .map(
          (task) => task.status == UploadStatus.uploading
              ? task.copyWith(status: UploadStatus.pending, progress: 0)
              : task,
        )
        .toList();
    _loaded = true;
    _emit();
    if (_tasks.any((task) => task.isActive)) unawaited(process());
  }

  /// Enfileira um arquivo já copiado para o diretório da aplicação.
  Future<UploadTask> enqueue(UploadTask task) async {
    _tasks = [..._tasks, task];
    await _persist();
    unawaited(process());
    return task;
  }

  /// Cancela uma tarefa; se for a que está em envio, aborta a requisição.
  Future<void> cancel(String taskId) async {
    if (_currentTaskId == taskId) _currentSignal?.cancel();
    _tasks = _tasks
        .map(
          (task) => task.id == taskId
              ? task.copyWith(
                  status: UploadStatus.cancelled,
                  clearNextAttempt: true,
                )
              : task,
        )
        .toList();
    await _persist();
  }

  /// Reenvia manualmente uma tarefa que falhou.
  Future<void> retry(String taskId) async {
    _tasks = _tasks
        .map(
          (task) => task.id == taskId
              ? task.copyWith(
                  status: UploadStatus.pending,
                  attempts: 0,
                  progress: 0,
                  clearError: true,
                  clearNextAttempt: true,
                )
              : task,
        )
        .toList();
    await _persist();
    unawaited(process());
  }

  /// Remove tarefas encerradas e apaga os arquivos copiados.
  Future<void> clearFinished() async {
    final finished = _tasks.where((task) => task.isTerminal).toList();
    for (final task in finished) {
      await _deleteFile(task);
    }
    _tasks = _tasks.where((task) => !task.isTerminal).toList();
    await _persist();
  }

  /// Processa a fila até não haver mais nada pronto.
  ///
  /// Reentrante: chamadas concorrentes **compartilham a mesma execução** em vez
  /// de duplicar envios. Quem chama recebe o `Future` da execução em curso e
  /// pode esperá-la — importante para testes e para quem precisa saber que a
  /// fila drenou.
  Future<void> process() {
    final running = _processing;
    if (running != null) return running;

    final future = _drain();
    _processing = future;
    return future.whenComplete(() => _processing = null);
  }

  Future<void> _drain() async {
    while (true) {
      final now = DateTime.now();
      final next = _tasks.where((task) => task.isReady(now)).firstOrNull;
      if (next == null) break;
      await _send(next);
    }
  }

  Future<void> _send(UploadTask task) async {
    final signal = CancellationSignal();
    _currentSignal = signal;
    _currentTaskId = task.id;

    _update(
      task.id,
      (current) => current.copyWith(
        status: UploadStatus.uploading,
        progress: 0,
        clearError: true,
      ),
    );
    await _persist();

    try {
      await _executor(
        task,
        cancellation: signal,
        onProgress: (progress) {
          // Progresso não vai para o disco: seria escrita a cada pacote.
          _updateInMemory(
            task.id,
            (current) => current.copyWith(progress: progress),
          );
        },
      );

      _update(
        task.id,
        (current) =>
            current.copyWith(status: UploadStatus.completed, progress: 1),
      );
      await _deleteFile(task);
      _logger.info(
        'evidência enviada',
        data: {'operationId': task.operationId},
      );
    } on Object catch (error) {
      if (signal.isCancelled) {
        _update(
          task.id,
          (current) => current.copyWith(status: UploadStatus.cancelled),
        );
      } else {
        _handleFailure(task, error);
      }
    } finally {
      _currentSignal = null;
      _currentTaskId = null;
      await _persist();
    }
  }

  /// Decide entre tentar de novo e desistir.
  ///
  /// Erro do cliente (4xx) não melhora com repetição — exceto 408 e 429, que
  /// são sobre tempo. Rede, timeout e 5xx são recuperáveis.
  void _handleFailure(UploadTask task, Object error) {
    final orbitError = error is OrbitException ? error : null;
    final permanent =
        orbitError != null &&
        orbitError.status >= 400 &&
        orbitError.status < 500 &&
        orbitError.status != 408 &&
        orbitError.status != 429;

    final attempts = task.attempts + 1;
    final exhausted = attempts >= maxAttempts;

    if (permanent || exhausted) {
      _update(
        task.id,
        (current) => current.copyWith(
          status: UploadStatus.failed,
          attempts: attempts,
          lastError:
              orbitError?.publicMessage ??
              'Não foi possível enviar esta evidência agora.',
          clearNextAttempt: true,
        ),
      );
      _logger.warning(
        'envio de evidência falhou',
        data: {
          'operationId': task.operationId,
          'tentativas': attempts,
          'definitivo': permanent,
        },
      );
      return;
    }

    // Backoff exponencial: 5s, 10s, 20s, 40s…
    final delay = _baseBackoff * (1 << (attempts - 1));
    _update(
      task.id,
      (current) => current.copyWith(
        status: UploadStatus.retrying,
        attempts: attempts,
        progress: 0,
        lastError: orbitError?.publicMessage ?? OrbitPublicCopy.offline,
        nextAttemptAt: DateTime.now().add(delay),
      ),
    );
  }

  void _update(String id, UploadTask Function(UploadTask) transform) {
    _updateInMemory(id, transform);
  }

  void _updateInMemory(String id, UploadTask Function(UploadTask) transform) {
    _tasks = _tasks
        .map((task) => task.id == id ? transform(task) : task)
        .toList();
    _emit();
  }

  Future<void> _deleteFile(UploadTask task) async {
    try {
      final file = File(task.filePath);
      if (file.existsSync()) await file.delete();
    } on FileSystemException {
      // Arquivo já removido: não é motivo para falhar nada.
    }
  }

  Future<void> _persist() async {
    _emit();
    await _store.save(_tasks);
  }

  void _emit() {
    if (!_controller.isClosed) _controller.add(List.unmodifiable(_tasks));
  }

  Future<void> dispose() async {
    await _connectivitySubscription?.cancel();
    await _controller.close();
  }
}

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
