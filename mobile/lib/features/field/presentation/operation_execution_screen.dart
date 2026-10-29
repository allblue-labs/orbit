/// Atendimento em campo: execução, confirmação e entrega automática do relatório.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/contracts/field_operation_contracts.dart';
import '../../../core/design/orbit_primitives.dart';
import '../../../core/design/orbit_wizard.dart';
import '../../../core/design/orbit_loading.dart';
import '../../../core/presentation/field_registry.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../../core/widgets/section_states.dart';
import '../../../core/contracts/mobile_evidence_contracts.dart';
import '../../../core/contracts/mobile_field_artifact_contracts.dart';
import '../../../core/contracts/mobile_offline_sync_contracts.dart';
import '../../../core/routing/orbit_router.dart';
import '../../artifact/application/artifact_providers.dart';
import '../../artifact/data/document_name.dart';
import '../../artifact/presentation/widgets/document_section.dart';
import '../../evidence/presentation/widgets/evidence_section.dart';
import '../../sync/data/command_journal.dart';
import '../../sync/presentation/widgets/pending_badge.dart';
import '../application/execution_controller.dart';
import 'widgets/attendance_result.dart';
import 'widgets/execution_checklist.dart';
import 'widgets/execution_signing.dart';
import 'widgets/attendance_work_record.dart';
import 'widgets/attendance_wizard.dart';

class OperationExecutionScreen extends ConsumerStatefulWidget {
  const OperationExecutionScreen({
    super.key,
    required this.operationId,
    this.rvtExecutionId,
  });

  final String operationId;
  final String? rvtExecutionId;

  @override
  ConsumerState<OperationExecutionScreen> createState() =>
      _OperationExecutionScreenState();
}

class _OperationExecutionScreenState
    extends ConsumerState<OperationExecutionScreen> {
  bool _preparing = true;
  int _entrySequence = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _prepare();
    });
  }

  @override
  void didUpdateWidget(OperationExecutionScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.operationId != widget.operationId) _prepare();
  }

  Future<void> _prepare() async {
    final sequence = ++_entrySequence;
    setState(() => _preparing = true);
    await ref
        .read(executionControllerProvider(widget.operationId).notifier)
        .prepareForAttendance();
    if (mounted && sequence == _entrySequence) {
      setState(() => _preparing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final operationId = widget.operationId;
    final rvtExecutionId = widget.rvtExecutionId;
    final state = ref.watch(executionControllerProvider(operationId));
    final controller = ref.read(
      executionControllerProvider(operationId).notifier,
    );

    return Scaffold(
      appBar: AppBar(
        title: Text(rvtExecutionId == null ? 'Atendimento' : 'Visita técnica'),
        actions: [
          /// A saída, nomeada.
          ///
          /// A seta do sistema já voltava, mas quem está de luva no meio de um
          /// roteiro de seis etapas não lê seta como "posso sair daqui". Sair
          /// não desfaz nada: cada registro já foi enviado quando foi feito, e
          /// o atendimento continua onde está.
          TextButton(
            onPressed: () => Navigator.of(context).maybePop(),
            child: const Text('Sair'),
          ),
        ],
      ),
      body: _preparing
          ? const OrbitLoadingState(
              title: 'Preparando atendimento',
              message: 'Confirmando o início no servidor. Aguarde um instante.',
            )
          : switch (state.phase) {
              ExecutionPhase.loading => const OrbitLoadingState(
                title: 'Carregando atendimento',
                message: 'Buscando os dados para continuar.',
              ),
              ExecutionPhase.error when state.preparation == null => ListView(
                padding: const EdgeInsets.all(OrbitSpacing.gutter),
                children: [
                  SectionError(error: state.error!, onRetry: _prepare),
                ],
              ),
              _ when state.allows(FieldOperationAllowedAction.start) => ListView(
                padding: const EdgeInsets.all(OrbitSpacing.gutter),
                children: [
                  if (state.error != null)
                    SectionError(error: state.error!, onRetry: _prepare)
                  else
                    SectionBlock(
                      title: 'Início do atendimento pendente',
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'O início precisa ser confirmado pelo servidor antes de preencher e concluir o atendimento. Confira sua conexão.',
                          ),
                          const SizedBox(height: OrbitSpacing.md),
                          FilledButton(
                            onPressed: _prepare,
                            child: const Text('Tentar novamente'),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
              _ => _Body(
                state: state,
                controller: controller,
                operationId: operationId,
                rvtExecutionId: rvtExecutionId,
              ),
            },
    );
  }
}

/// As ações de cada etapa continuam autorizadas pelo servidor.
class _Body extends StatelessWidget {
  const _Body({
    required this.state,
    required this.controller,
    required this.operationId,
    this.rvtExecutionId,
  });

  final ExecutionState state;
  final ExecutionController controller;
  final String operationId;
  final String? rvtExecutionId;

  @override
  Widget build(BuildContext context) {
    final preparation = state.preparation!;
    final checklists = preparation.checklist;

    /// Marcar os itens prepara as respostas; a etapa termina quando o checklist é confirmado.
    final checklistCumprido = checklists.every(
      (lista) => lista.status != 'IN_PROGRESS',
    );

    final etapas = <OrbitWizardStep>[
      OrbitWizardStep(
        title: rvtExecutionId == null ? 'Checklist' : 'Checklist da visita',
        hint: 'Responda o checklist previsto para este atendimento.',

        /// Sem checklist a etapa **abre** e diz que não há itens.
        ///
        /// Era `enabled: checklists.isNotEmpty`, e o roteiro pulava o que estava
        /// desabilitado: um atendimento sem checklist — o caso mais comum — saltava de
        /// Preparação direto para Evidências. O `OrbitEmptyState` abaixo já explicava
        /// a situação e nunca era visto.
        ///
        /// Aqui não há travamento: não ter itens a responder não é "ainda não é a
        /// hora", é a etapa cumprida por não ter conteúdo. Quem precisa saber disso
        /// lê o estado vazio.
        complete: checklistCumprido,
        child: checklists.isEmpty
            ? const OrbitEmptyState(
                icon: Icons.checklist_outlined,
                title: 'Sem checklist previsto',
                description: 'Este atendimento não tem itens a responder.',
              )
            : ExecutionChecklist(
                checklists: checklists,
                enabled:
                    state.allows(FieldOperationAllowedAction.updateChecklist) &&
                    !state.isBusy,
                onSave: controller.saveChecklist,
                pendingIds: {
                  for (final command in state.pendingCommands)
                    if (command.envelope.commandType ==
                            OfflineCommandType.operationChecklistUpdate &&
                        !command.isBlocking)
                      command.envelope.payload['checklistId'] as String,
                },
                onAnswer: (checklistId, itemId, answer) =>
                    controller.answerChecklistItem(
                      checklistId: checklistId,
                      itemId: itemId,
                      answer: answer,
                    ),
              ),
      ),

      OrbitWizardStep(
        title: 'Evidências',
        hint: 'Registre o que comprova o serviço feito.',

        /// A seção só oferece captura quando o servidor publica
        /// `ADD_EVIDENCE`. Quem pode anexar é decisão dele — o app mostra o
        /// que foi autorizado.
        child: EvidenceSection(
          target: FieldEvidenceTargetRef(
            type: rvtExecutionId == null
                ? FieldEvidenceTarget.operation
                : FieldEvidenceTarget.rvtExecution,
            id: rvtExecutionId ?? operationId,
          ),
          canCapture: state.allows(FieldOperationAllowedAction.addEvidence),
        ),
      ),

      OrbitWizardStep(
        title: 'Serviço realizado',
        hint:
            'Registre o que foi feito e os materiais utilizados, se necessário.',
        child: AttendanceWorkRecord(operationId: operationId),
      ),

      OrbitWizardStep(
        title: 'Confirmação',
        lockedReason: checklists.any((item) => item.status == 'IN_PROGRESS')
            ? 'Confirme os checklists antes de apresentar o resumo ao cliente.'
            : null,
        hint: 'Assinatura profissional, aceite do cliente e documento.',
        child: ExecutionSigningSections(
          operationId: operationId,
          preparation: preparation,
        ),
      ),

      OrbitWizardStep(
        title: 'Conclusão',
        hint: 'Resumo técnico e relatório do atendimento.',
        complete: preparation.operation.completedAt != null,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            AttendanceTechnicalSummary(
              operationId: operationId,
              code:
                  preparation.operation.serviceOrderCode ??
                  preparation.operation.code,
              technician: preparation.responsibleFieldTechnician?.name,
              completedAt: preparation.operation.completedAt,
            ),
            if (preparation.operation.completedAt != null)
              DocumentSection(
                automatic: true,
                source: ArtifactSourceRef(
                  type: rvtExecutionId == null
                      ? FieldArtifactSourceType.operation
                      : FieldArtifactSourceType.rvtExecution,
                  id: rvtExecutionId ?? operationId,
                ),
                fileName: documentFileNameOf([
                  preparation.operation.serviceOrderCode ??
                      preparation.operation.code,
                  preparation.customer?.name ?? '',
                ]),
                subject: [
                  rvtExecutionId == null
                      ? 'Ordem de Serviço'
                      : 'Visita técnica',
                  preparation.operation.serviceOrderCode ??
                      preparation.operation.code,
                  preparation.customer?.name,
                ].whereType<String>().join(' · '),
              ),
          ],
        ),
      ),
    ];

    return RefreshIndicator(
      /// Não recarrega por cima de um comando em voo: o resultado dele é que
      /// define o estado seguinte.
      onRefresh: () async => state.isBusy ? null : controller.load(),
      child: ListView(
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        padding: const EdgeInsets.only(bottom: OrbitSpacing.xl),
        children: [
          if (state.phase == ExecutionPhase.conflict)
            Padding(
              padding: const EdgeInsets.fromLTRB(
                OrbitSpacing.md,
                OrbitSpacing.md,
                OrbitSpacing.md,
                0,
              ),
              child: _ConflictBanner(
                onRefresh: controller.refreshAfterConflict,
              ),
            ),

          if (state.phase == ExecutionPhase.error && state.error != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(
                OrbitSpacing.md,
                OrbitSpacing.md,
                OrbitSpacing.md,
                0,
              ),
              child: SectionError(
                error: state.error!,
                onRetry: controller.load,
              ),
            ),

          /// O que a etapa Preparação carregava e ainda importa.
          ///
          /// A etapa saiu: a tela de detalhe **é** a preparação, e organizada.
          /// Repeti-la aqui era mostrar duas vezes o mesmo resumo e, pior, um
          /// segundo "Iniciar atendimento" depois de a pessoa já ter iniciado.
          ///
          /// O que não podia sumir junto são os impedimentos e o que ainda não
          /// chegou ao servidor: os dois mudam o que a pessoa pode fazer agora,
          /// e valem para o roteiro inteiro, não para uma etapa.
          if (state.pendingCommands.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(
                OrbitSpacing.md,
                OrbitSpacing.md,
                OrbitSpacing.md,
                0,
              ),
              child: _PendingIntentions(
                commands: state.pendingCommands,
                onOpenSyncCenter: () => context.push(OrbitRoutes.syncCenter),
              ),
            ),

          if (!preparation.eligible && preparation.blockers.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(
                OrbitSpacing.md,
                OrbitSpacing.md,
                OrbitSpacing.md,
                0,
              ),
              child: _Blockers(blockers: preparation.blockers),
            ),

          AttendanceWizard(
            steps: etapas,
            evidenceTarget: FieldEvidenceTargetRef(
              type: rvtExecutionId == null
                  ? FieldEvidenceTarget.operation
                  : FieldEvidenceTarget.rvtExecution,
              id: rvtExecutionId ?? operationId,
            ),
            confirmationStep: 3,
            operationId: operationId,
            completed: preparation.operation.completedAt != null,
            initialStep: preparation.operation.completedAt != null ? 4 : 0,
            onComplete: () => controller.finishAfterConfirmation(
              rvtExecutionId: rvtExecutionId,
            ),
          ),
        ],
      ),
    );
  }
}

/// Contexto do atendimento: quem, onde, o quê, e quem executou.
/// O que impede executar, na frase do servidor.
class _Blockers extends StatelessWidget {
  const _Blockers({required this.blockers});

  final List<String> blockers;

  @override
  Widget build(BuildContext context) => SectionBlock(
    title: 'Ainda não é possível iniciar',
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final blocker in blockers)
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Text(
              executionBlockerLabel(blocker),
              style: const TextStyle(fontSize: 13, color: OrbitColors.warning),
            ),
          ),
      ],
    ),
  );
}

class _ConflictBanner extends StatelessWidget {
  const _ConflictBanner({required this.onRefresh});

  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(bottom: OrbitSpacing.sm),
    padding: const EdgeInsets.all(OrbitSpacing.gutter),
    decoration: BoxDecoration(
      color: OrbitColors.warning.withValues(alpha: 0.12),
      borderRadius: OrbitRadius.field,
    ),
    child: Row(
      children: [
        const Expanded(
          child: Text(
            'Os dados foram alterados. Atualize e tente novamente.',
            style: TextStyle(fontSize: 13, color: OrbitColors.textPrimary),
          ),
        ),
        TextButton(onPressed: onRefresh, child: const Text('Atualizar')),
      ],
    ),
  );
}

/// As intenções deste atendimento que o servidor ainda não confirmou.
///
/// Cada uma aparece pelo que é, em português, e nunca como conclusão. O ponto
/// da faixa é justamente impedir que "registrei" seja lido como "está feito".
class _PendingIntentions extends StatelessWidget {
  const _PendingIntentions({
    required this.commands,
    required this.onOpenSyncCenter,
  });

  final List<PendingCommand> commands;
  final VoidCallback onOpenSyncCenter;

  @override
  Widget build(BuildContext context) {
    final blocked = commands.where((value) => value.isBlocking).toList();
    final waiting = commands.where((value) => !value.isBlocking).toList();

    return SectionBlock(
      title: 'Registrado neste aparelho',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final command in waiting)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),

              /// `Wrap` e não `Row`: com escala de texto grande, rótulo e selo
              /// não cabem lado a lado e precisam quebrar em vez de estourar.
              child: Wrap(
                spacing: OrbitSpacing.sm,
                runSpacing: 4,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text(
                    pendingCommandLabel(
                      offlineCommandTypeWire(command.envelope.commandType),
                    ),
                    style: const TextStyle(fontSize: 13),
                  ),
                  const PendingBadge(),
                ],
              ),
            ),

          for (final command in blocked)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Wrap(
                    spacing: OrbitSpacing.sm,
                    runSpacing: 4,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Text(
                        pendingCommandLabel(
                          offlineCommandTypeWire(command.envelope.commandType),
                        ),
                        style: const TextStyle(fontSize: 13),
                      ),
                      const BlockedBadge(label: 'Não sincronizou'),
                    ],
                  ),
                  Text(
                    syncBlockedLabel(
                      conflictCode: switch (command.receipt?.conflict?.code) {
                        final code? => offlineConflictCodeWire(code),
                        null => null,
                      },
                      errorCode: command.receipt?.error?.code,
                    ),
                    style: const TextStyle(
                      fontSize: 12,
                      color: OrbitColors.textSecondary,
                    ),
                  ),
                ],
              ),
            ),

          const SizedBox(height: OrbitSpacing.sm),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              onPressed: onOpenSyncCenter,
              child: const Text('Ver sincronização'),
            ),
          ),
        ],
      ),
    );
  }
}
