/// Estado da execução de um atendimento.
///
/// ## O que este arquivo não faz
///
/// Não decide se pode iniciar, se pode concluir, nem se o checklist está
/// completo o bastante. Nada disso é calculado aqui — `allowedActions` chega
/// pronto e é a única fonte do que a tela oferece.
///
/// ## Um caminho só, com ou sem rede
///
/// Toda ação vira uma **intenção persistida** antes de qualquer requisição, e
/// só então se tenta sincronizar. Com rede, isso acontece no mesmo toque e o
/// usuário vê o estado confirmado; sem rede, a intenção fica guardada e a tela
/// diz que está aguardando. Não há um caminho online e outro offline — dois
/// caminhos divergem com o tempo, e a divergência aparece justamente no caso
/// raro, que é o caso em que alguém está sem conexão.
///
/// ## Concorrência e repetição
///
/// Dois problemas diferentes, duas defesas diferentes:
///
/// - **Sobrescrever o que outro mudou** → `expectedVersion`. Todo comando
///   carrega a versão que o usuário viu ao decidir; se o servidor mudou desde
///   então, ele recusa com 409 e a tela relê em vez de insistir.
/// - **Fazer duas vezes o que se pediu uma** → `commandId`. Uma intenção do
///   usuário tem uma chave, e reenviá-la é inofensivo: o servidor devolve
///   `idempotentReplay: true` em vez de um segundo efeito.
library;

import 'dart:math';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/contracts/field_operation_contracts.dart';
import '../../../core/errors/orbit_exception.dart';
import '../../../core/contracts/mobile_offline_sync_contracts.dart';
import '../../sync/application/sync_providers.dart';
import '../../sync/application/sync_controller.dart';
import '../../sync/data/command_journal.dart';
import '../data/field_operation_repository.dart';

final fieldOperationRepositoryProvider = Provider<FieldOperationRepository>(
  (ref) => FieldOperationRepository(client: ref.watch(apiClientProvider)),
);

/// Em que ponto a tela está.
///
/// Um estado nomeado em vez de meia dúzia de booleanos: `carregando &&
/// !erro && pendente` é o tipo de combinação que passa a existir sem ninguém
/// decidir que deveria.
enum ExecutionPhase { loading, ready, mutationPending, conflict, error }

class ExecutionState {
  const ExecutionState({
    required this.phase,
    this.preparation,
    this.error,
    this.pendingAction,
    this.lastReplay = false,
    this.pendingCommands = const [],
  });

  final ExecutionPhase phase;
  final FieldOperationExecutionPreparationContract? preparation;
  final Object? error;

  /// Qual comando está em voo — para desabilitar exatamente o botão certo.
  final FieldOperationAllowedAction? pendingAction;

  /// O último comando foi reexecução da mesma intenção, segundo o servidor.
  final bool lastReplay;

  /// Intenções deste atendimento ainda não confirmadas pelo servidor.
  ///
  /// A tela as mostra **sobre** o estado confirmado, sempre distinguíveis: um
  /// checklist marcado offline aparece como "aguardando sincronização", nunca
  /// como confirmado. Fundir as duas coisas faria o app afirmar algo que só o
  /// servidor pode afirmar.
  final List<PendingCommand> pendingCommands;

  /// Há intenção pendente deste tipo?
  bool isAwaitingSync(OfflineCommandType type) => pendingCommands.any(
    (value) => value.envelope.commandType == type && !value.isBlocking,
  );

  /// Intenções paradas esperando decisão da pessoa.
  List<PendingCommand> get blockedCommands =>
      pendingCommands.where((value) => value.isBlocking).toList();

  bool get isBusy => phase == ExecutionPhase.mutationPending;

  /// O que o servidor permite agora. Sem preparação carregada, nada.
  List<FieldOperationAllowedAction> get allowedActions =>
      preparation?.allowedActions ?? const [];

  bool allows(FieldOperationAllowedAction action) =>
      allowedActions.contains(action);

  ExecutionState copyWith({
    ExecutionPhase? phase,
    FieldOperationExecutionPreparationContract? preparation,
    Object? error,
    FieldOperationAllowedAction? pendingAction,
    bool? lastReplay,
    List<PendingCommand>? pendingCommands,
    bool clearError = false,
    bool clearPending = false,
  }) => ExecutionState(
    phase: phase ?? this.phase,
    preparation: preparation ?? this.preparation,
    error: clearError ? null : (error ?? this.error),
    pendingAction: clearPending ? null : (pendingAction ?? this.pendingAction),
    lastReplay: lastReplay ?? this.lastReplay,
    pendingCommands: pendingCommands ?? this.pendingCommands,
  );
}

/// Gera o identificador de uma intenção.
///
/// UUIDv7 como o backend exige (`IsUUIDv7`) — tempo nos 48 bits altos,
/// aleatoriedade no resto. Carimbo de tempo sozinho não serviria: dois toques
/// no mesmo milissegundo colidiriam, e é exatamente o caso que a chave existe
/// para separar.
String newCommandId([Random? random]) {
  final rng = random ?? Random.secure();
  final bytes = List<int>.generate(16, (_) => rng.nextInt(256));
  final now = DateTime.now().millisecondsSinceEpoch;
  for (var i = 0; i < 6; i += 1) {
    bytes[i] = (now >> (8 * (5 - i))) & 0xff;
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  String hex(int start, int end) => bytes
      .sublist(start, end)
      .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
      .join();

  return '${hex(0, 4)}-${hex(4, 6)}-${hex(6, 8)}-${hex(8, 10)}-${hex(10, 16)}';
}

class ExecutionController extends StateNotifier<ExecutionState> {
  ExecutionController({
    required FieldOperationRepository repository,
    required SyncController sync,
    required this.operationId,
    this.deviceInstanceId,
  }) : _repository = repository,
       _sync = sync,
       super(const ExecutionState(phase: ExecutionPhase.loading)) {
    load();
  }

  final FieldOperationRepository _repository;

  /// Quem leva as intenções ao servidor. A execução não fala com a rede
  /// diretamente: ela registra o que a pessoa quis e deixa o sincronismo com
  /// o único componente que sabe fazer isso.
  final SyncController _sync;

  final String operationId;
  final String? deviceInstanceId;

  /// A intenção em curso, guardada **inteira**.
  ///
  /// Repetir depois de um timeout precisa reenviar o mesmo envelope — chave
  /// **e** versão. O backend compara o payload associado à chave e recusa com
  /// "Idempotency key reused with a different payload" se só a chave coincidir.
  /// Faz sentido: é a mesma intenção, tomada no mesmo momento, sobre o mesmo
  /// estado.
  ({FieldOperationAllowedAction action, OfflineCommandEnvelope envelope})?
  _intent;

  /// Relê o estado autoritativo. É o que fecha todo comando.
  Future<void> load() async {
    try {
      final preparation = await _repository.preparation(operationId);
      state = ExecutionState(
        phase: ExecutionPhase.ready,
        preparation: preparation,
        lastReplay: state.lastReplay,
        pendingCommands: await _sync.commandsFor(operationId),
      );
    } on Object catch (error) {
      state = state.copyWith(phase: ExecutionPhase.error, error: error);
    }
  }

  /// O envelope de um comando, com a versão que o usuário viu.
  ///
  /// Mesma intenção repetida reaproveita o envelope **inteiro**; intenção nova
  /// ganha outro. O servidor calcula um hash sobre tipo, agregado, versão,
  /// instante e payload, e o compara com o da chave de idempotência — regenerar
  /// qualquer campo no replay vira `IDEMPOTENCY_MISMATCH`.
  OfflineCommandEnvelope _envelope(
    FieldOperationAllowedAction action,
    OfflineCommandType type,
    Map<String, Object?> payload,
  ) {
    final current = _intent;
    if (current != null && current.action == action) return current.envelope;

    final commandId = newCommandId();
    final envelope = OfflineCommandEnvelope(
      commandId: commandId,
      idempotencyKey: commandId,
      commandType: type,
      aggregateId: operationId,
      expectedVersion: state.preparation?.version ?? '',
      occurredAt: DateTime.now().toUtc(),
      payload: payload,
      deviceInstanceId: deviceInstanceId,
    );
    _intent = (action: action, envelope: envelope);
    return envelope;
  }

  /// Registra uma intenção e tenta sincronizá-la.
  ///
  /// A intenção é persistida **antes** de qualquer requisição. O que vem
  /// depois — aplicada, pendente ou parada — é lido do journal, não deduzido
  /// da resposta HTTP: com rede ruim, "não sei se chegou" é um desfecho
  /// legítimo, e a idempotência é quem o resolve no próximo envio.
  Future<CommandOutcome?> _run(
    FieldOperationAllowedAction action,
    OfflineCommandType type,
    Map<String, Object?> payload,
  ) async {
    if (state.isBusy) return null;
    if (!state.allows(action)) return null;

    state = state.copyWith(
      phase: ExecutionPhase.mutationPending,
      pendingAction: action,
      clearError: true,
    );

    final envelope = _envelope(action, type, payload);
    try {
      await _sync.enqueue(envelope);
      final outcome = await _sync.outcomeOf(envelope.commandId);

      switch (outcome) {
        case CommandConfirmed():

          /// Intenção cumprida: a próxima ganha chave nova.
          _intent = null;
          await load();
          state = state.copyWith(
            clearPending: true,
            lastReplay:
                outcome.result.status == OfflineCommandStatus.alreadyApplied,
          );

        case CommandPendingOutcome():

          /// Guardada, não confirmada. A tela mostra "aguardando
          /// sincronização" — nunca "concluído".
          _intent = null;
          await _refreshPending();
          state = state.copyWith(
            phase: ExecutionPhase.ready,
            clearPending: true,
          );

        case CommandBlocked():
          _intent = null;
          await _refreshPending();
          state = state.copyWith(
            phase: outcome.command.state == PendingCommandState.conflict
                ? ExecutionPhase.conflict
                : ExecutionPhase.error,

            /// A recusa vem do servidor e é mostrada como veio — o app não
            /// reescreve o motivo nem tenta de novo sozinho.
            error: OrbitException(
              kind: OrbitErrorKind.http,
              status: outcome.command.state == PendingCommandState.conflict
                  ? 409
                  : 422,
              publicMessage: outcome.message,
              code: outcome.command.receipt?.error?.code ?? 'SYNC_BLOCKED',
            ),
            clearPending: true,
          );
      }
      return outcome;
    } on Object catch (error) {
      state = state.copyWith(
        phase: ExecutionPhase.error,
        error: error,
        clearPending: true,
      );
      return null;
    }
  }

  /// Relê as intenções pendentes deste atendimento.
  Future<void> _refreshPending() async {
    state = state.copyWith(
      pendingCommands: await _sync.commandsFor(operationId),
    );
  }

  Future<void> start() => _run(
    FieldOperationAllowedAction.start,
    OfflineCommandType.operationStart,
    const {},
  );

  Future<void> complete() => _run(
    FieldOperationAllowedAction.complete,
    OfflineCommandType.operationComplete,
    const {},
  );

  Future<void> addNote(String note) => _run(
    FieldOperationAllowedAction.addNote,
    OfflineCommandType.operationAddNote,
    {'note': note},
  );

  /// Responde um item do checklist.
  ///
  /// O contrato substitui o mapa inteiro, então parte-se do que o servidor
  /// devolveu e altera-se **um** item. Montar o mapa do zero apagaria
  /// respostas que a tela não está mostrando.
  Future<void> answerChecklistItem({
    required String checklistId,
    required String itemId,
    required Object? answer,
  }) async {
    final checklist = state.preparation?.checklist
        .where((entry) => entry.id == checklistId)
        .firstOrNull;
    if (checklist == null) return;

    await _run(
      FieldOperationAllowedAction.updateChecklist,
      OfflineCommandType.operationChecklistUpdate,
      {
        'checklistId': checklistId,
        'answers': {...checklist.answers, itemId: answer},
      },
    );
  }

  /// Registra material e devolve o desfecho a quem chamou.
  ///
  /// A folha de material precisa mostrar a recusa do servidor no próprio
  /// formulário — saldo insuficiente volta como conflito, com a mensagem que o
  /// Inventory produziu.
  Future<CommandOutcome?> registerMaterial({
    required String catalogItemId,
    required num quantity,
    String? reason,
  }) => _run(
    FieldOperationAllowedAction.registerMaterial,
    OfflineCommandType.operationAddMaterial,
    {
      'catalogItemId': catalogItemId,
      'quantity': quantity,
      if (reason != null) 'reason': reason,
    },
  );

  /// Depois de um conflito, o usuário pede para atualizar.
  Future<void> refreshAfterConflict() async {
    _intent = null;
    state = state.copyWith(phase: ExecutionPhase.loading, clearError: true);
    await load();
  }
}

final executionControllerProvider = StateNotifierProvider.autoDispose
    .family<ExecutionController, ExecutionState, String>(
      (ref, operationId) => ExecutionController(
        repository: ref.watch(fieldOperationRepositoryProvider),
        sync: ref.watch(syncControllerProvider.notifier),
        deviceInstanceId: ref.watch(deviceInstanceIdProvider).valueOrNull,
        operationId: operationId,
      ),
    );

/// A linha do tempo do atendimento — fatos persistidos, na ordem publicada.
final executionTimelineProvider = FutureProvider.autoDispose
    .family<FieldOperationTimelinePageContract, String>(
      (ref, operationId) =>
          ref.watch(fieldOperationRepositoryProvider).timeline(operationId),
    );
