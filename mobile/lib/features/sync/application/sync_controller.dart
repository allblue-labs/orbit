/// O orquestrador de sincronização.
///
/// Um só, global. Um motor de sync por feature produziria levas concorrentes
/// disputando a mesma fila, e o servidor veria a mesma intenção duas vezes —
/// a idempotência salvaria o resultado, mas não a bateria nem a ordem.
///
/// ## O ciclo
///
/// ```text
/// push (≤50)  →  recibo por comando  →  pull autoritativo  →  reconcilia
/// ```
///
/// O servidor devolve `nextRecommendedAction: PULL` justamente porque os
/// recibos dizem o desfecho de cada intenção, não o estado resultante. Deduzir
/// o estado a partir dos recibos seria reconstruir domínio no cliente.
library;

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/contracts/mobile_offline_sync_contracts.dart';
import '../../../core/errors/orbit_exception.dart';
import '../data/command_journal.dart';
import '../data/sync_projection.dart';
import '../data/sync_repository.dart';

/// Em que ponto a sincronização está.
enum SyncPhase { idle, syncing, offline, error }

class SyncState {
  const SyncState({
    this.phase = SyncPhase.idle,
    this.pending = 0,
    this.conflicts = 0,
    this.rejected = 0,
    this.expired = 0,
    this.lastSyncedAt,
    this.error,
  });

  final SyncPhase phase;

  /// Intenções esperando o servidor.
  final int pending;

  /// Intenções que o servidor recusou reconciliar — precisam de uma pessoa.
  final int conflicts;
  final int rejected;
  final int expired;

  final DateTime? lastSyncedAt;
  final Object? error;

  bool get isSyncing => phase == SyncPhase.syncing;

  /// Algo parado esperando decisão humana.
  bool get needsAttention => conflicts + rejected + expired > 0;

  bool get hasWork => pending > 0 || needsAttention;

  SyncState copyWith({
    SyncPhase? phase,
    int? pending,
    int? conflicts,
    int? rejected,
    int? expired,
    DateTime? lastSyncedAt,
    Object? error,
    bool clearError = false,
  }) => SyncState(
    phase: phase ?? this.phase,
    pending: pending ?? this.pending,
    conflicts: conflicts ?? this.conflicts,
    rejected: rejected ?? this.rejected,
    expired: expired ?? this.expired,
    lastSyncedAt: lastSyncedAt ?? this.lastSyncedAt,
    error: clearError ? null : (error ?? this.error),
  );
}

/// Espera crescente entre tentativas de falha temporária.
///
/// Sem isso, um servidor fora do ar e um app em primeiro plano viram um laço
/// apertado que gasta bateria e rede sem chegar a lugar nenhum.
Duration syncBackoff(int attempts) => switch (attempts) {
  <= 1 => const Duration(seconds: 5),
  2 => const Duration(seconds: 30),
  3 => const Duration(minutes: 2),
  4 => const Duration(minutes: 10),
  _ => const Duration(minutes: 30),
};

/// O que aconteceu com uma intenção, para quem a criou.
sealed class CommandOutcome {
  const CommandOutcome();
}

/// O servidor aplicou — ou já tinha aplicado, o que dá no mesmo.
final class CommandConfirmed extends CommandOutcome {
  const CommandConfirmed(this.result);
  final OfflineCommandResult result;
}

/// Ainda não chegou ao servidor. Não é falha: é trabalho guardado.
final class CommandPendingOutcome extends CommandOutcome {
  const CommandPendingOutcome();
}

/// O servidor recusou reconciliar, e isso precisa de uma pessoa.
final class CommandBlocked extends CommandOutcome {
  const CommandBlocked(this.command);
  final PendingCommand command;

  String get message =>
      command.receipt?.conflict?.message ??
      command.receipt?.error?.message ??
      'Não foi possível sincronizar esta ação.';
}

class SyncController extends StateNotifier<SyncState> {
  SyncController({
    required CommandJournal journal,
    required SyncProjectionStore projection,
    required SyncRepository repository,
    required this.scope,
    required this.scopeKey,
    required this.onReconciled,
  }) : _journal = journal,
       _projection = projection,
       _repository = repository,
       super(const SyncState());

  final CommandJournal _journal;
  final SyncProjectionStore _projection;
  final SyncRepository _repository;

  /// A quem pertencem os comandos que este orquestrador pode enviar.
  final CommandScope scope;
  final String scopeKey;

  /// Chamado quando o servidor confirmou algo — a hora de reler estado.
  final void Function() onReconciled;

  /// O sync em voo. Chamadas concorrentes recebem **este** future em vez de
  /// abrir uma segunda leva: é o que faz o toque manual e a volta da rede
  /// coalescerem em uma sincronização só.
  Future<void>? _inFlight;

  /// Antes deste instante, gatilhos automáticos não tentam de novo. O manual
  /// ignora — quem tocou o botão está olhando para a tela.
  DateTime? _backoffUntil;

  /// Registra uma intenção e tenta enviá-la já.
  ///
  /// Online e offline percorrem o **mesmo** caminho: a intenção é persistida
  /// primeiro, depois se tenta sincronizar. Um caminho online separado
  /// divergiria do offline com o tempo, e a divergência apareceria justamente
  /// no caso raro — que é o caso em que alguém está sem rede.
  Future<PendingCommand> enqueue(OfflineCommandEnvelope envelope) async {
    final command = PendingCommand(
      envelope: envelope,
      scope: scope,
      state: PendingCommandState.pending,
      enqueuedAt: DateTime.now().toUtc(),
    );
    await _journal.enqueue(command);
    await _refreshCounts();
    await sync();
    return command;
  }

  /// Sincroniza. Concorrentes esperam a mesma volta.
  Future<void> sync({bool manual = false}) {
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
    state = state.copyWith(phase: SyncPhase.syncing, clearError: true);
    try {
      await _journal.cleanup(DateTime.now().toUtc());
      final pushed = await _push();
      await _pull();
      state = state.copyWith(
        phase: SyncPhase.idle,
        lastSyncedAt: DateTime.now().toUtc(),
        clearError: true,
      );
      await _refreshCounts();
      if (pushed) onReconciled();
    } on OrbitException catch (error) {
      /// Sem rede não é erro de sincronização: é a condição normal do campo.
      state = state.copyWith(
        phase: error.isOffline ? SyncPhase.offline : SyncPhase.error,
        error: error.isOffline ? null : error,
      );
      await _refreshCounts();
    } on Object catch (error) {
      state = state.copyWith(phase: SyncPhase.error, error: error);
      await _refreshCounts();
    }
  }

  /// Envia o que está pendente, em levas do tamanho que o DTO aceita.
  ///
  /// Devolve se algum comando foi de fato aplicado — o que decide se vale
  /// avisar as telas para relerem.
  Future<bool> _push() async {
    var applied = false;

    /// Cada intenção é tentada no máximo uma vez por sincronização. Sem isto,
    /// um erro temporário devolve o comando à fila e a rodada seguinte o
    /// reenvia no mesmo instante — um laço apertado que ignora o backoff.
    final attempted = <String>{};

    for (var round = 0; round < 20; round += 1) {
      final snapshot = await _journal.read();
      final sendable = snapshot.commands
          .where(
            (value) =>
                value.isSendable &&
                value.scope.matches(scope) &&
                !attempted.contains(value.envelope.commandId),
          )
          .take(pushBatchLimit)
          .toList();
      if (sendable.isEmpty) return applied;
      attempted.addAll(sendable.map((value) => value.envelope.commandId));

      final now = DateTime.now().toUtc();
      for (final command in sendable) {
        await _journal.mark(
          command.envelope.commandId,
          (current) => current.copyWith(
            state: PendingCommandState.syncing,
            attempts: current.attempts + 1,
            lastAttemptAt: now,
          ),
        );
      }

      final MobileSyncPushResponse response;
      try {
        response = await _repository.push(
          sendable.map((value) => value.envelope).toList(),
        );
      } on Object {
        /// Desfecho incerto: pode ter chegado, pode não ter. Os comandos voltam
        /// para a fila **com o mesmo `commandId`**; se chegaram, o servidor
        /// devolve `ALREADY_APPLIED` no próximo envio.
        for (final command in sendable) {
          await _journal.mark(
            command.envelope.commandId,
            (current) => current.copyWith(state: PendingCommandState.pending),
          );
        }
        final attempts = sendable
            .map((value) => value.attempts + 1)
            .fold(0, (a, b) => a > b ? a : b);
        _backoffUntil = now.add(syncBackoff(attempts));
        rethrow;
      }

      final sent = {
        for (final command in sendable) command.envelope.commandId: command,
      };
      for (final result in response.results) {
        /// Um recibo que não corresponde a nada desta leva é ignorado.
        /// Atribuí-lo ao primeiro comando à mão resolveria a intenção errada —
        /// e a errada sairia da fila como se tivesse sido aplicada.
        final command = sent[result.commandId];
        if (command == null) continue;
        applied = await _apply(command, result) || applied;
      }
    }
    return applied;
  }

  /// O que fazer com um recibo.
  Future<bool> _apply(
    PendingCommand command,
    OfflineCommandResult result,
  ) async {
    final id = command.envelope.commandId;
    switch (result.status) {
      case OfflineCommandStatus.applied:
      case OfflineCommandStatus.alreadyApplied:

        /// O recibo é gravado **junto** com a saída da fila. Um crash entre as
        /// duas coisas reenviaria a intenção como nova.
        await _journal.resolve(
          commandId: id,
          scope: command.scope,
          result: result,
          at: DateTime.now().toUtc(),
        );
        return true;

      case OfflineCommandStatus.conflict:

        /// Conflito não se repete sozinho: o mundo mudou, e quem decide é a
        /// pessoa que estava fazendo o trabalho.
        await _journal.mark(
          id,
          (current) => current.copyWith(
            state: PendingCommandState.conflict,
            receipt: result,
          ),
        );
        return false;

      case OfflineCommandStatus.rejected:
        await _journal.mark(
          id,
          (current) => current.copyWith(
            state: result.error?.code == 'OFFLINE_REPLAY_WINDOW_EXPIRED'
                ? PendingCommandState.expired
                : PendingCommandState.rejected,
            receipt: result,
          ),
        );
        return false;

      case OfflineCommandStatus.blocked:

        /// Não é falha deste comando: o anterior do mesmo atendimento não foi
        /// aplicado. Volta para a fila sem contar como tentativa perdida — vai
        /// junto quando o bloqueio à frente for resolvido ou descartado.
        await _journal.mark(
          id,
          (current) => current.copyWith(state: PendingCommandState.pending),
        );
        return false;

      case OfflineCommandStatus.retryableError:
        await _journal.mark(
          id,
          (current) => current.copyWith(
            state: PendingCommandState.pending,
            receipt: result,
          ),
        );
        _backoffUntil = DateTime.now().toUtc().add(
          syncBackoff(command.attempts + 1),
        );
        return false;
    }
  }

  /// Puxa o delta e reconcilia a projeção.
  Future<void> _pull() async {
    var projection = await _projection.read();
    var cursor = projection.cursors[scopeKey];

    for (var page = 0; page < 50; page += 1) {
      final known = projection.workItems[scopeKey]?.keys.toList() ?? const [];
      final response = await _repository.pull(
        cursor: cursor,
        knownWorkItemIds: known,
      );

      if (response.fullResyncRequired || response.purgeRequired) {
        /// Recomeça a projeção — e só ela. A fila de comandos está noutro
        /// arquivo, que este caminho não abre.
        projection = await _projection.resetScope(scopeKey);
        cursor = null;
        if (response.fullResyncRequired) continue;
      }

      final upserted = <String, Map<String, dynamic>>{};
      final removed = <String>{};
      for (final change in response.changes) {
        if (change.isRemoval || change.snapshot == null) {
          removed.add(change.resourceId);
        } else {
          upserted[change.resourceId] = change.rawSnapshot!;
        }
      }
      for (final tombstone in response.tombstones) {
        removed.add(tombstone.resourceId);
        upserted.remove(tombstone.resourceId);
      }

      /// Página aplicada e cursor avançado na mesma gravação: avançar antes
      /// perderia a página para sempre se o app morresse no meio.
      projection = await _projection.applyPage(
        scopeKey: scopeKey,
        upserted: upserted,
        removed: removed,
        cursor: response.nextCursor,
        syncedAt: DateTime.now().toUtc(),
      );
      cursor = response.nextCursor;

      if (!response.hasMore || response.nextCursor == null) return;
    }
  }

  /// O desfecho de uma intenção específica.
  ///
  /// Quem tocou o botão precisa saber se aquilo valeu. Não sai do estado
  /// interno do orquestrador: sai do journal, que é onde a verdade local mora.
  Future<CommandOutcome> outcomeOf(String commandId) async {
    final snapshot = await _journal.read();
    final pending = snapshot.commands
        .where((value) => value.envelope.commandId == commandId)
        .firstOrNull;
    if (pending != null) {
      return pending.isBlocking
          ? CommandBlocked(pending)
          : const CommandPendingOutcome();
    }
    final receipt = snapshot.receipts
        .where((value) => value.commandId == commandId)
        .firstOrNull;
    return receipt == null
        ? const CommandPendingOutcome()
        : CommandConfirmed(receipt.result);
  }

  /// As intenções pendentes de um atendimento, para a tela sobrepor o que
  /// ainda não é estado confirmado.
  Future<List<PendingCommand>> commandsFor(String aggregateId) async {
    final snapshot = await _journal.read();
    return snapshot.commands
        .where(
          (value) =>
              value.envelope.aggregateId == aggregateId &&
              value.scope.matches(scope),
        )
        .toList(growable: false);
  }

  /// Descarta uma intenção que o servidor não aplicou.
  ///
  /// Só o que está parado pode ser descartado. Um comando ainda pendente pode
  /// estar em voo neste instante, e jogá-lo fora deixaria o app achando que
  /// nada aconteceu enquanto o servidor aplicava.
  Future<void> discard(String commandId) async {
    final snapshot = await _journal.read();
    final command = snapshot.commands
        .where((value) => value.envelope.commandId == commandId)
        .firstOrNull;
    if (command == null || !command.isBlocking) return;
    await _journal.discard(commandId);
    await _refreshCounts();
    onReconciled();
  }

  Future<void> _refreshCounts() async {
    final snapshot = await _journal.read();
    final mine = snapshot.commands.where((value) => value.scope.matches(scope));
    state = state.copyWith(
      pending: mine.where((value) => value.isSendable).length,
      conflicts: mine
          .where((value) => value.state == PendingCommandState.conflict)
          .length,
      rejected: mine
          .where((value) => value.state == PendingCommandState.rejected)
          .length,
      expired: mine
          .where((value) => value.state == PendingCommandState.expired)
          .length,
    );
  }

  /// Carrega a contagem inicial ao abrir o app.
  Future<void> restore() async {
    await _refreshCounts();
    final projection = await _projection.read();
    final last = projection.lastSyncedAt[scopeKey];
    if (last != null) {
      state = state.copyWith(lastSyncedAt: DateTime.tryParse(last));
    }
  }
}
