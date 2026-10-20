/// O orquestrador de mídia.
///
/// Separado do sincronismo de comandos porque o problema é outro: comandos são
/// pequenos, ordenados e idempotentes por envelope; mídia são megabytes, com
/// três passos e um objeto no storage no meio do caminho. Coordenado com ele,
/// porém — os gatilhos de conectividade e o botão manual são os mesmos.
///
/// ## Os três passos
///
/// ```text
/// reserve  →  PUT nos bytes  →  finalize
/// ```
///
/// A evidência só existe no terceiro. Um `PUT` a 100% deixou bytes no storage;
/// é o `finalize` que relê o objeto, confere magic bytes, tamanho e SHA-256, e
/// materializa a Evidence. Tratar o segundo passo como sucesso seria prometer
/// em nome de uma validação que ainda não aconteceu.
library;

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/contracts/mobile_evidence_contracts.dart';
import '../../../core/errors/orbit_exception.dart';
import '../../sync/data/command_journal.dart' show CommandScope;
import '../data/evidence_repository.dart';
import '../data/local_media.dart';
import '../data/media_store.dart';

enum MediaSyncPhase { idle, uploading, offline, error }

class MediaSyncState {
  const MediaSyncState({
    this.phase = MediaSyncPhase.idle,
    this.pending = 0,
    this.blocked = 0,
    this.progress,
    this.error,
  });

  final MediaSyncPhase phase;

  /// Mídias esperando ou em envio.
  final int pending;

  /// Recusadas ou sem arquivo — precisam de uma pessoa.
  final int blocked;

  /// Progresso do envio em curso, 0..1. `null` quando nada está subindo.
  final double? progress;

  final Object? error;

  bool get isUploading => phase == MediaSyncPhase.uploading;
  bool get hasWork => pending > 0 || blocked > 0;

  MediaSyncState copyWith({
    MediaSyncPhase? phase,
    int? pending,
    int? blocked,
    double? progress,
    Object? error,
    bool clearProgress = false,
    bool clearError = false,
  }) => MediaSyncState(
    phase: phase ?? this.phase,
    pending: pending ?? this.pending,
    blocked: blocked ?? this.blocked,
    progress: clearProgress ? null : (progress ?? this.progress),
    error: clearError ? null : (error ?? this.error),
  );
}

/// Espera crescente entre tentativas, igual à do sincronismo de comandos.
Duration mediaBackoff(int attempts) => switch (attempts) {
  <= 1 => const Duration(seconds: 10),
  2 => const Duration(minutes: 1),
  3 => const Duration(minutes: 5),
  4 => const Duration(minutes: 15),
  _ => const Duration(minutes: 30),
};

class MediaUploadController extends StateNotifier<MediaSyncState> {
  MediaUploadController({
    required MediaQueue queue,
    required EvidenceRepository repository,
    required this.scope,
    required this.onEvidenceConfirmed,
  }) : _queue = queue,
       _repository = repository,
       super(const MediaSyncState());

  final MediaQueue _queue;
  final EvidenceRepository _repository;
  final CommandScope scope;

  /// Chamado quando uma evidência passou a existir no servidor — a hora de
  /// reler a lista autoritativa em vez de deduzir o que mudou.
  final void Function(FieldEvidenceTargetRef target) onEvidenceConfirmed;

  /// Um envio de cada vez.
  ///
  /// Sequencial de propósito: o limite de evidências é aplicado no `finalize`,
  /// e mandar várias em paralelo faria o app disputar consigo mesmo a última
  /// vaga. Também é o que evita saturar a rede de um aparelho em 3G no
  /// subsolo de um prédio.
  Future<void>? _inFlight;
  DateTime? _backoffUntil;

  /// Registra uma captura.
  ///
  /// Registrar e enviar são coisas diferentes, e a separação está aqui de
  /// propósito: depois desta linha o arquivo existe para o app e sobrevive a
  /// fechar o aplicativo, tenha havido rede ou não. Enviar é [process], que
  /// quem chama dispara sem esperar — uma foto de 10 MB não pode segurar a
  /// tela aberta.
  Future<LocalMedia> enqueue(LocalMedia media) async {
    await _queue.enqueue(media);
    await _refreshCounts();
    return media;
  }

  /// Processa a fila. Chamadas concorrentes recebem a mesma volta.
  Future<void> process({bool manual = false}) {
    final running = _inFlight;
    if (running != null) return running;

    if (!manual &&
        _backoffUntil != null &&
        DateTime.now().toUtc().isBefore(_backoffUntil!)) {
      return Future.value();
    }
    if (manual) _backoffUntil = null;

    final run = _run().whenComplete(() => _inFlight = null);
    _inFlight = run;
    return run;
  }

  Future<void> _run() async {
    state = state.copyWith(phase: MediaSyncPhase.uploading, clearError: true);
    try {
      /// Arquivo que sumiu do disco não é tentativa perdida — é um fato que a
      /// pessoa precisa saber.
      await _queue.detectOrphans();

      final attempted = <String>{};
      for (var round = 0; round < 50; round += 1) {
        final queue = await _queue.forScope(scope);
        final next = queue
            .where(
              (value) =>
                  value.isSendable && !attempted.contains(value.localMediaId),
            )
            .firstOrNull;
        if (next == null) break;
        attempted.add(next.localMediaId);
        await _send(next);
      }

      state = state.copyWith(
        phase: MediaSyncPhase.idle,
        clearProgress: true,
        clearError: true,
      );
    } on OrbitException catch (error) {
      state = state.copyWith(
        phase: error.isOffline ? MediaSyncPhase.offline : MediaSyncPhase.error,
        error: error.isOffline ? null : error,
        clearProgress: true,
      );
    } on Object catch (error) {
      state = state.copyWith(
        phase: MediaSyncPhase.error,
        error: error,
        clearProgress: true,
      );
    }
    await _refreshCounts();
  }

  /// Uma mídia, do começo ao fim.
  Future<void> _send(LocalMedia media) async {
    final now = DateTime.now().toUtc();
    await _queue.mark(
      media.localMediaId,
      (current) => current.copyWith(
        state: LocalMediaState.uploading,
        attempts: current.attempts + 1,
        lastAttemptAt: now,
        clearFailure: true,
      ),
    );

    try {
      final intent = await _repository.reserve(
        EvidenceUploadIntentRequest(
          target: media.target,
          filename: media.filename,
          declaredMimeType: media.mimeType,
          declaredSize: media.sizeBytes,
          idempotencyKey: media.idempotencyKey,
          category: media.category,
          source: media.source,
          capturedAt: media.capturedAt,
          localMediaId: media.localMediaId,
          expectedSha256: media.sha256,
        ),
      );

      /// Já finalizada numa tentativa anterior: a evidência existe, e o que
      /// falta é só o app parar de guardar o arquivo.
      if (intent.isFinalized) {
        await _confirm(media);
        return;
      }

      /// A janela de envio venceu. O servidor casa a intenção pelo
      /// `localMediaId`, então não há como renová-la para este arquivo — e
      /// dizer isso é melhor do que tentar para sempre.
      if (intent.isExpired || intent.uploadUrl == null) {
        await _reject(
          media,
          'UPLOAD_EXPIRED',
          'A janela de envio desta evidência expirou. Registre novamente.',
        );
        return;
      }

      final bytes = await _queue.files.read(media.path);
      if (bytes == null) {
        await _queue.mark(
          media.localMediaId,
          (current) => current.copyWith(
            state: LocalMediaState.missing,
            failureCode: 'LOCAL_FILE_MISSING',
            failureMessage: 'O arquivo não está mais neste aparelho.',
          ),
        );
        return;
      }

      await _queue.mark(
        media.localMediaId,
        (current) => current.copyWith(uploadId: intent.uploadId),
      );

      await _repository.putBytes(
        url: intent.uploadUrl!,
        headers: intent.requiredHeaders,
        bytes: bytes,
        onProgress: (value) => state = state.copyWith(progress: value),
      );

      /// Bytes no storage. **Ainda não é evidência.**
      await _queue.mark(
        media.localMediaId,
        (current) => current.copyWith(state: LocalMediaState.finalizing),
      );

      final evidence = await _repository.finalize(
        intent.uploadId,
        expectedSha256: media.sha256,
      );
      await _confirm(media, target: evidence.target);
    } on OrbitException catch (error) {
      await _handleFailure(media, error);
    }
  }

  /// A evidência existe: o registro local sai e o arquivo vai junto.
  Future<void> _confirm(
    LocalMedia media, {
    FieldEvidenceTargetRef? target,
  }) async {
    await _queue.remove(media.localMediaId);
    onEvidenceConfirmed(target ?? media.target);
  }

  /// O que fazer com uma recusa.
  ///
  /// A separação importa: 5xx e falha de rede voltam para a fila com espera;
  /// tipo, tamanho, limite, escopo e autorização são decisões que repetir não
  /// muda. O arquivo **fica** nos dois casos — descartar o trabalho de alguém
  /// porque o servidor disse não é a pessoa quem decide.
  Future<void> _handleFailure(LocalMedia media, OrbitException error) async {
    final retryable = error.isOffline || error.isServer || error.status == 429;

    if (retryable) {
      await _queue.mark(
        media.localMediaId,
        (current) => current.copyWith(
          state: LocalMediaState.pending,
          failureCode: error.code,
          failureMessage: error.publicMessage,
        ),
      );
      _backoffUntil = DateTime.now().toUtc().add(
        mediaBackoff(media.attempts + 1),
      );

      /// Sem rede, para a fila inteira: as próximas falhariam igual, e cada
      /// tentativa a mais é bateria gasta para chegar à mesma resposta.
      if (error.isOffline) throw error;
      return;
    }

    await _reject(media, error.code, error.publicMessage);
  }

  Future<void> _reject(LocalMedia media, String code, String message) =>
      _queue.mark(
        media.localMediaId,
        (current) => current.copyWith(
          state: LocalMediaState.rejected,
          failureCode: code,
          failureMessage: message,
        ),
      );

  /// Descarta uma captura que o servidor não aceitou.
  ///
  /// Só o que está parado. Uma mídia ainda pendente pode estar em voo neste
  /// instante, e apagá-la deixaria bytes no storage sem ninguém para
  /// finalizá-los.
  Future<void> discard(String localMediaId) async {
    final queue = await _queue.forScope(scope);
    final media = queue
        .where((value) => value.localMediaId == localMediaId)
        .firstOrNull;
    if (media == null || !media.isBlocked) return;
    await _queue.remove(localMediaId);
    await _refreshCounts();
  }

  Future<void> _refreshCounts() async {
    final queue = await _queue.forScope(scope);
    state = state.copyWith(
      pending: queue.where((value) => value.isSendable).length,
      blocked: queue.where((value) => value.isBlocked).length,
    );
  }

  Future<void> restore() => _refreshCounts();
}
