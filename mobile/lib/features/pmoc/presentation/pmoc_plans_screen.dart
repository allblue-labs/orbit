/// Os PMOCs configurados, para quem vai atender.
///
/// ## Por que esta tela existe
///
/// A fila de trabalho é filtrada por atribuição, e é assim que deve ser: ela
/// responde "o que é meu hoje". O dono precisava de outra pergunta — "quais
/// contratos existem, e qual deles eu atendo agora" — e ela não tinha resposta no
/// celular: sem esta lista, o dono só atendia PMOC pela web.
///
/// ## Só os ativos
///
/// Plano em rascunho, suspenso ou encerrado não se atende. Mostrá-los encheria a
/// lista de linhas que só levam a uma recusa.
///
/// ## A atribuição aparece, e não filtra
///
/// Quem não tem o plano atribuído vê o contrato e não vê o botão de atender —
/// com a frase que diz por quê. Esconder o plano faria o técnico achar que ele
/// não existe; oferecer o botão faria o servidor recusar depois do toque.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/providers.dart';
import '../../../core/contracts/pmoc_contracts.dart';
import '../../../core/design/orbit_primitives.dart';
import '../../../core/routing/orbit_router.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../../core/widgets/section_states.dart';
import '../application/pmoc_providers.dart';
import 'pmoc_labels.dart';

class PmocPlansScreen extends ConsumerWidget {
  const PmocPlansScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final plans = ref.watch(pmocPlansProvider);
    final session = ref.watch(sessionProvider);

    return Scaffold(
      backgroundColor: context.orbit.background,
      appBar: AppBar(title: const Text('PMOC')),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(pmocPlansProvider),
        child: plans.when(
          loading: () => const Padding(
            padding: EdgeInsets.all(OrbitSpacing.gutter),
            child: SectionLoading(lines: 5),
          ),
          error: (error, _) => ListView(
            padding: const EdgeInsets.all(OrbitSpacing.gutter),
            children: [
              SectionError(
                error: error,
                onRetry: () => ref.invalidate(pmocPlansProvider),
              ),
            ],
          ),
          data: (items) => items.isEmpty
              ? ListView(
                  children: const [
                    OrbitEmptyState(
                      icon: Icons.fact_check_outlined,
                      title: 'Nenhum PMOC ativo',
                      description:
                          'Planos são configurados na web. Os ativos aparecem aqui '
                          'para atendimento.',
                    ),
                  ],
                )
              : ListView.separated(
                  padding: const EdgeInsets.all(OrbitSpacing.gutter),
                  itemCount: items.length,
                  separatorBuilder: (_, __) =>
                      const SizedBox(height: OrbitSpacing.sm),
                  itemBuilder: (context, index) => _PlanCard(
                    plan: items[index],
                    isMine:
                        session?.isOwner == true ||
                        (session != null &&
                            items[index].technicianId == session.user.id),
                  ),
                ),
        ),
      ),
    );
  }
}

class _PlanCard extends StatelessWidget {
  const _PlanCard({required this.plan, required this.isMine});

  final PmocPlanSummaryContract plan;

  /// Este ator atende este plano — por atribuição ou por ser o dono.
  final bool isMine;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;

    return OrbitCard(
      onTap: () => context.push(OrbitRoutes.pmocPlan(plan.id)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            plan.code,
            style: OrbitType.eyebrow.copyWith(color: palette.inkSubtle),
          ),
          const SizedBox(height: 2),
          Text(
            plan.name,
            style: OrbitType.itemTitle.copyWith(color: palette.ink),
          ),
          const SizedBox(height: 2),
          Text(
            plan.customerName,
            style: OrbitType.body.copyWith(color: palette.inkMuted),
          ),
          const SizedBox(height: OrbitSpacing.sm),
          Wrap(
            spacing: OrbitSpacing.xs,
            runSpacing: 4,
            children: [
              if (isMine)
                const OrbitStatusBadge(
                  label: 'Você atende',
                  tone: OrbitTone.success,
                ),
              OrbitStatusBadge(
                label: 'Vence ${pmocDueLabel(plan.nextDueOn)}',
                tone: OrbitTone.info,
              ),
              if (plan.frequencyLabel case final String cada)
                OrbitStatusBadge(label: cada),
              OrbitStatusBadge(
                label:
                    '${plan.coveredEquipment} '
                    '${plan.coveredEquipment == 1 ? 'equipamento' : 'equipamentos'}',
              ),
            ],
          ),

          /// Quem atende, quando não é quem está olhando. É a informação que
          /// falta para resolver — a pessoa sabe a quem pedir.
          if (!isMine)
            Padding(
              padding: const EdgeInsets.only(top: OrbitSpacing.xs),
              child: Text(
                plan.technicianName == null
                    ? 'Sem técnico atribuído — só o dono pode atender.'
                    : 'Atribuído a ${plan.technicianName}.',
                style: OrbitType.caption.copyWith(color: palette.inkSubtle),
              ),
            ),
        ],
      ),
    );
  }
}
