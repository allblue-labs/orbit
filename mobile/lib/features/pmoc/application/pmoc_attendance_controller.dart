/// Estado do atendimento de um equipamento de PMOC.
///
/// ## O que este arquivo não decide
///
/// Se pode abrir, se pode concluir, se o plano é do técnico. Nada disso é
/// calculado aqui: `eligibility` e `allowedActions` chegam prontos da preparação,
/// e a recusa de autoridade chega como erro do servidor. Uma regra escrita aqui
/// viraria a segunda máquina de estados — a que diverge da do backend na primeira
/// mudança.
///
/// ## O passo vem da resposta, não do toque
///
/// Depois de abrir, a preparação volta com `COMPLETE` liberado; depois de
/// concluir, com `VIEW`. Recarregá-la após cada comando mantém a tela e o domínio
/// no mesmo estado — inclusive quando alguém atende o mesmo equipamento pela web
/// ao mesmo tempo.
///
/// ## Rede direta, e a tela diz isso
///
/// O atendimento avulso passa pelo journal de comandos e funciona sem sinal. O
/// PMOC não: o protocolo offline só conhece comandos de operação, e o servidor
/// recusa o que não conhece. Então aqui o erro de rede é erro, e a tela o mostra
/// em vez de prometer que guardou — prometer o que não se cumpre é pior que
/// recusar.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/contracts/pmoc_contracts.dart';
import '../data/pmoc_repository.dart';
import 'pmoc_providers.dart';

/// Em que ponto a tela está.
///
/// Um estado nomeado em vez de booleanos: `carregando && !erro && enviando` é o
/// tipo de combinação que passa a existir sem ninguém decidir que deveria.
enum PmocAttendancePhase { loading, ready, sending, error }

/// Qual comando está em voo — para desabilitar exatamente o botão certo.
enum PmocAttendanceCommand { start, complete, issue }

/// O equipamento que está sendo atendido.
class PmocAttendanceTarget {
  const PmocAttendanceTarget({
    required this.planId,
    required this.cycleId,
    required this.assetId,
  });

  final String planId;
  final String cycleId;
  final String assetId;

  @override
  bool operator ==(Object other) =>
      other is PmocAttendanceTarget &&
      other.planId == planId &&
      other.cycleId == cycleId &&
      other.assetId == assetId;

  @override
  int get hashCode => Object.hash(planId, cycleId, assetId);
}

class PmocAttendanceState {
  const PmocAttendanceState({
    required this.phase,
    this.preparation,
    this.error,
    this.pending,
    this.cycleCompleted = false,
  });

  final PmocAttendancePhase phase;
  final PmocExecutionPreparationContract? preparation;
  final Object? error;
  final PmocAttendanceCommand? pending;

  /// O ciclo fechou com esta conclusão — informação do servidor, não contagem
  /// local: outra pessoa pode ter atendido o último equipamento em paralelo.
  final bool cycleCompleted;

  bool get isBusy => phase == PmocAttendancePhase.sending;

  PmocEquipmentExecutionContract? get execution =>
      preparation?.existingExecution;

  /// O que o servidor permite agora. Sem preparação, nada.
  List<String> get allowedActions => preparation?.allowedActions ?? const [];

  bool allows(String action) => allowedActions.contains(action);

  /// O atendimento terminou por completo: concluído **e** com documento.
  ///
  /// Sem o documento o trabalho existe e a prova de conformidade não — e é a
  /// prova que o cliente guarda para a fiscalização.
  bool get isFinished {
    final atual = execution;
    return atual != null &&
        atual.status == PmocEquipmentExecutionStatus.completed &&
        atual.artifactExecution != null;
  }

  PmocAttendanceState copyWith({
    PmocAttendancePhase? phase,
    PmocExecutionPreparationContract? preparation,
    Object? error,
    PmocAttendanceCommand? pending,
    bool? cycleCompleted,
    bool clearError = false,
    bool clearPending = false,
  }) => PmocAttendanceState(
    phase: phase ?? this.phase,
    preparation: preparation ?? this.preparation,
    error: clearError ? null : (error ?? this.error),
    pending: clearPending ? null : (pending ?? this.pending),
    cycleCompleted: cycleCompleted ?? this.cycleCompleted,
  );
}

class PmocAttendanceController extends StateNotifier<PmocAttendanceState> {
  PmocAttendanceController({
    required PmocRepository repository,
    required this.target,
  }) : _repository = repository,
       super(const PmocAttendanceState(phase: PmocAttendancePhase.loading)) {
    load();
  }

  final PmocRepository _repository;
  final PmocAttendanceTarget target;

  Future<void> load() async {
    state = state.copyWith(
      phase: PmocAttendancePhase.loading,
      clearError: true,
    );
    try {
      final preparation = await _repository.preparation(
        planId: target.planId,
        cycleId: target.cycleId,
        assetId: target.assetId,
      );
      state = state.copyWith(
        phase: PmocAttendancePhase.ready,
        preparation: preparation,
        clearError: true,
        clearPending: true,
      );
    } catch (error) {
      state = state.copyWith(phase: PmocAttendancePhase.error, error: error);
    }
  }

  /// Abre o atendimento deste técnico.
  ///
  /// A recusa por atribuição vem do servidor — 403 com a frase que nomeia a
  /// regra. A tela a mostra como veio; conferir aqui exigiria saber quem está
  /// atribuído, e isso é do plano, não da sessão.
  Future<void> start() => _run(
    PmocAttendanceCommand.start,
    () => _repository.startMine(
      planId: target.planId,
      cycleId: target.cycleId,
      assetId: target.assetId,
    ),
  );

  Future<void> complete({DateTime? performedAt, String? notes}) async {
    final atual = state.execution;
    if (atual == null) return;
    await _run(PmocAttendanceCommand.complete, () async {
      final resultado = await _repository.complete(
        planId: target.planId,
        cycleId: target.cycleId,
        executionId: atual.id,
        performedAt: performedAt,
        notes: notes,
      );
      /* O fechamento do ciclo é resposta do servidor, e vale mostrar: o técnico
         acabou de fechar o período inteiro daquele contrato. */
      state = state.copyWith(cycleCompleted: resultado.cycleCompleted);
      return resultado;
    });
  }

  Future<void> issueReport() async {
    final atual = state.execution;
    if (atual == null) return;
    await _run(
      PmocAttendanceCommand.issue,
      () => _repository.generateArtifact(atual.id),
    );
  }

  /// Envia, e **relê**.
  ///
  /// A releitura não é conveniência: é o que faz o passo seguinte vir do
  /// servidor. Avançar localmente depois de um comando deixaria a tela
  /// afirmando um estado que só a resposta pode confirmar — e é sobre isso que o
  /// documento legal é emitido.
  Future<void> _run(
    PmocAttendanceCommand command,
    Future<Object?> Function() action,
  ) async {
    if (state.isBusy) return;
    state = state.copyWith(
      phase: PmocAttendancePhase.sending,
      pending: command,
      clearError: true,
    );
    try {
      await action();
      await load();
    } catch (error) {
      state = state.copyWith(
        phase: PmocAttendancePhase.ready,
        error: error,
        clearPending: true,
      );
    }
  }
}

final pmocAttendanceControllerProvider = StateNotifierProvider.family<
  PmocAttendanceController,
  PmocAttendanceState,
  PmocAttendanceTarget
>(
  (ref, target) => PmocAttendanceController(
    repository: ref.watch(pmocRepositoryProvider),
    target: target,
  ),
);
