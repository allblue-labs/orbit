/// As leituras do PMOC no campo.
///
/// ## Online, e a tela diz isso
///
/// Nada aqui passa pelo cache de leitura nem pelo journal. O PMOC ainda não tem
/// vocabulário no protocolo offline, e mostrar um plano guardado convidaria a
/// abrir um atendimento que não teria como subir — pior que dizer que falta
/// conexão.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/contracts/pmoc_contracts.dart';
import '../data/pmoc_repository.dart';

final pmocRepositoryProvider = Provider<PmocRepository>(
  (ref) => PmocRepository(client: ref.watch(apiClientProvider)),
);

/// Os planos ativos, para escolher o que atender.
final pmocPlansProvider = FutureProvider<List<PmocPlanSummaryContract>>(
  (ref) => ref.watch(pmocRepositoryProvider).plans(),
);

/// O ciclo aberto de um plano, e os equipamentos dele.
///
/// Uma coisa só porque a tela precisa das três juntas ou de nenhuma: sem ciclo
/// aberto não há equipamento a atender, e sem o plano não se sabe **quem** pode
/// atender.
class PmocPlanCycleView {
  const PmocPlanCycleView({
    required this.plan,
    required this.cycle,
    required this.equipment,
  });

  final PmocPlanDetailContract plan;

  /// `null` quando o plano não tem ciclo aberto — vigência encerrada, ou o ciclo
  /// atual já resolvido.
  final PmocCycleContract? cycle;

  final List<PmocCycleEquipmentContract> equipment;

  /// Este ator pode atender este plano?
  ///
  /// A atribuição é do **plano**, e é a mesma regra que o servidor aplica ao
  /// abrir: o técnico atribuído, ou o dono — que atende quando o escalado
  /// faltou. Aqui ela existe para não oferecer um botão que voltaria 403; a
  /// recusa de verdade continua sendo do backend.
  bool canAttend({required String? actorId, required bool isOwner}) =>
      isOwner || (actorId != null && plan.technicianId == actorId);
}

final pmocPlanProvider =
    FutureProvider.family<PmocPlanDetailContract, String>((ref, planId) =>
        ref.watch(pmocRepositoryProvider).plan(planId));

final pmocPlanCycleProvider = FutureProvider.family<PmocPlanCycleView, String>((
  ref,
  planId,
) async {
  final plan = await ref.watch(pmocPlanProvider(planId).future);
  final cycle = plan.currentExecution;
  if (cycle == null) {
    return PmocPlanCycleView(plan: plan, cycle: null, equipment: const []);
  }

  final equipment = await ref
      .watch(pmocRepositoryProvider)
      .cycleEquipment(planId: planId, cycleId: cycle.id);
  return PmocPlanCycleView(plan: plan, cycle: cycle, equipment: equipment);
});

/// As revisões emitidas do documento de uma execução.
///
/// `autoDispose` porque a pergunta é "já saiu?", e ela só existe enquanto a tela
/// do atendimento está aberta. Guardar a resposta faria a próxima abertura
/// mostrar o estado de antes da renderização terminar.
final pmocDocumentRevisionsProvider = FutureProvider.autoDispose
    .family<List<PmocDocumentRevisionContract>, String>(
      (ref, artifactExecutionId) => ref
          .watch(pmocRepositoryProvider)
          .documentRevisions(artifactExecutionId),
    );

/// A revisão que se distribui: a ativa e emitida.
///
/// `null` enquanto a renderização não terminou — o estado normal dos primeiros
/// segundos depois de emitir, e não uma falha.
PmocDocumentRevisionContract? distributableRevision(
  List<PmocDocumentRevisionContract> revisions,
) {
  for (final revision in revisions) {
    if (revision.isActive && revision.isDownloadable) return revision;
  }
  return null;
}
