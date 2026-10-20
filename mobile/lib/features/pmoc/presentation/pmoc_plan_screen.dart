/// Um PMOC e os equipamentos do ciclo aberto.
///
/// É aqui que se escolhe **o que** atender. A contagem que cada linha mostra é a
/// do equipamento, não a do ciclo: um aparelho que entrou no contrato no meio da
/// vigência está na sua primeira manutenção dentro de um ciclo que pode ser o
/// sétimo, e é a dele que o relatório afirma.
///
/// `eligibility` vem por equipamento, do servidor. A tela mostra o bloqueio com
/// a frase dele e não recalcula nada — nem para antecipar.
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

class PmocPlanScreen extends ConsumerWidget {
  const PmocPlanScreen({super.key, required this.planId});

  final String planId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final view = ref.watch(pmocPlanCycleProvider(planId));
    final session = ref.watch(sessionProvider);

    return Scaffold(
      backgroundColor: context.orbit.background,
      appBar: AppBar(title: const Text('PMOC')),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(pmocPlanCycleProvider(planId)),
        child: view.when(
          loading: () => const Padding(
            padding: EdgeInsets.all(OrbitSpacing.gutter),
            child: SectionLoading(lines: 6),
          ),
          error: (error, _) => ListView(
            padding: const EdgeInsets.all(OrbitSpacing.gutter),
            children: [
              SectionError(
                error: error,
                onRetry: () => ref.invalidate(pmocPlanCycleProvider(planId)),
              ),
            ],
          ),
          data: (data) => _Plan(
            view: data,
            canAttend: data.canAttend(
              actorId: session?.user.id,
              isOwner: session?.isOwner ?? false,
            ),
          ),
        ),
      ),
    );
  }
}

class _Plan extends StatelessWidget {
  const _Plan({required this.view, required this.canAttend});

  final PmocPlanCycleView view;
  final bool canAttend;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final plan = view.plan;
    final cycle = view.cycle;

    return ListView(
      padding: const EdgeInsets.all(OrbitSpacing.gutter),
      children: [
        OrbitCard(
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
                style: OrbitType.sectionTitle.copyWith(color: palette.ink),
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
                  if (cycle != null) ...[
                    OrbitStatusBadge(
                      label: 'Ciclo ${cycle.sequenceNumber}',
                      tone: pmocCycleStatus(cycle.status).tone,
                    ),
                    OrbitStatusBadge(
                      label: 'Vence ${pmocDueLabel(cycle.dueOn)}',
                      tone: OrbitTone.info,
                    ),
                  ],
                  if (plan.technicalResponsible?['displayName']
                      case final String rt)
                    OrbitStatusBadge(label: 'RT: $rt'),
                ],
              ),

              /// Por que o botão de atender não aparece. Sem esta linha, a
              /// ausência do botão parece defeito da tela.
              if (!canAttend)
                Padding(
                  padding: const EdgeInsets.only(top: OrbitSpacing.sm),
                  child: Text(
                    plan.technicianName == null
                        ? 'Este PMOC não tem técnico atribuído. Só o dono da '
                              'organização pode atendê-lo.'
                        : 'Este PMOC está atribuído a ${plan.technicianName}. '
                              'Só quem tem a atribuição — ou o dono — pode atendê-lo.',
                    style: OrbitType.caption.copyWith(color: palette.inkSubtle),
                  ),
                ),
            ],
          ),
        ),

        const SizedBox(height: OrbitSpacing.md),

        if (cycle == null)
          const OrbitEmptyState(
            icon: Icons.event_busy_outlined,
            title: 'Nenhum ciclo em aberto',
            description:
                'Este plano não tem manutenção prevista agora. O próximo ciclo '
                'abre quando o atual é encerrado.',
          )
        else if (view.equipment.isEmpty)
          const OrbitEmptyState(
            icon: Icons.hvac_outlined,
            title: 'Nenhum equipamento no ciclo',
            description: 'A cobertura do plano é definida na web.',
          )
        else
          Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.only(bottom: OrbitSpacing.xs),
                child: Text(
                  'Equipamentos do ciclo',
                  style: OrbitType.eyebrow.copyWith(color: palette.inkSubtle),
                ),
              ),
              for (final item in view.equipment)
                Padding(
                  padding: const EdgeInsets.only(bottom: OrbitSpacing.sm),
                  child: _EquipmentCard(
                    planId: plan.id,
                    cycleId: cycle.id,
                    item: item,
                    canAttend: canAttend,
                  ),
                ),
            ],
          ),
      ],
    );
  }
}

class _EquipmentCard extends StatelessWidget {
  const _EquipmentCard({
    required this.planId,
    required this.cycleId,
    required this.item,
    required this.canAttend,
  });

  final String planId;
  final String cycleId;
  final PmocCycleEquipmentContract item;
  final bool canAttend;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final situacao = pmocEquipmentStatus(item.status);

    /* Concluído continua abrindo: é onde se emite o relatório, que é decisão
       separada de concluir a manutenção. */
    final bloqueado = !item.eligibility.ready && item.execution == null;
    final habilitado = canAttend && !bloqueado;

    return OrbitCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  item.assetName,
                  style: OrbitType.itemTitle.copyWith(color: palette.ink),
                ),
              ),
              OrbitStatusBadge(label: situacao.label, tone: situacao.tone),
            ],
          ),
          if (item.assetIdentifier case final String etiqueta)
            Text(
              etiqueta,
              style: OrbitType.caption.copyWith(color: palette.inkSubtle),
            ),

          /// A contagem **do equipamento**, quando já há execução.
          if (item.execution?.sequenceNumber case final int numero)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                'Manutenção $numero',
                style: OrbitType.caption.copyWith(color: palette.inkMuted),
              ),
            ),

          if (bloqueado)
            Padding(
              padding: const EdgeInsets.only(top: OrbitSpacing.xs),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (final motivo in item.eligibility.blockedReasons)
                    Text(
                      pmocBlockedReasonLabel(motivo),
                      style: OrbitType.caption.copyWith(color: palette.warning),
                    ),
                ],
              ),
            ),

          const SizedBox(height: OrbitSpacing.sm),
          FilledButton(
            onPressed: habilitado
                ? () => context.push(
                    OrbitRoutes.pmocAttendance(
                      planId: planId,
                      cycleId: cycleId,
                      assetId: item.assetId,
                    ),
                  )
                : null,
            style: FilledButton.styleFrom(minimumSize: const Size(0, 48)),

            /// O verbo diz em que ponto está: abrir, continuar ou ver o que foi
            /// registrado. Um "Atender" genérico faria quem já concluiu achar que
            /// vai abrir de novo.
            child: Text(
              switch (item.status) {
                'IN_PROGRESS' => 'Continuar atendimento',
                'COMPLETED' => 'Ver atendimento e relatório',
                _ => 'Atender',
              },
            ),
          ),
        ],
      ),
    );
  }
}
