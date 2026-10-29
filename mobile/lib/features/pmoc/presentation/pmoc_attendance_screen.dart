/// O atendimento de um equipamento de PMOC, em campo.
///
/// ## Só a execução
///
/// Este roteiro **não** configura plano: não escolhe cliente, periodicidade,
/// cobertura nem Responsável Técnico. Isso é contrato, e contrato se configura na
/// web, com calma, por quem responde por ele. Aqui se executa o que já foi
/// configurado — e é por isso que o primeiro passo mostra o contexto em vez de
/// pedir dados.
///
/// ## Quem atende
///
/// Não há escolha de técnico: quem atende é quem está com o celular na mão. O
/// servidor escala o próprio ator e recusa quando o plano não lhe foi atribuído —
/// escalar outra pessoa é decisão de quem organiza o trabalho, e tem outra porta.
///
/// ## Os passos vêm do servidor
///
/// `allowedActions` decide onde a pessoa está: `START` → abrir, `COMPLETE` →
/// roteiro e registro, nada disso → relatório. A tela não deduz de `status`, e
/// avançar de passo não envia comando nenhum.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/contracts/mobile_evidence_contracts.dart';
import '../../../core/contracts/pmoc_contracts.dart';
import '../../../core/design/orbit_primitives.dart';
import '../../../core/design/orbit_wizard.dart';
import '../../../core/presentation/orbit_format.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../../core/widgets/section_states.dart';
import '../../artifact/data/document_name.dart';
import '../../evidence/presentation/widgets/evidence_section.dart';
import '../application/pmoc_attendance_controller.dart';
import '../../field/application/execution_controller.dart';
import '../../field/presentation/widgets/attendance_wizard.dart';
import '../../field/presentation/widgets/attendance_result.dart';
import '../../field/presentation/widgets/attendance_work_record.dart';
import '../../signature/presentation/customer_acknowledgement_screen.dart';
import 'pmoc_document_section.dart';
import 'pmoc_labels.dart';

class PmocAttendanceScreen extends ConsumerStatefulWidget {
  const PmocAttendanceScreen({
    super.key,
    required this.planId,
    required this.cycleId,
    required this.assetId,
  });

  final String planId;
  final String cycleId;
  final String assetId;

  @override
  ConsumerState<PmocAttendanceScreen> createState() =>
      _PmocAttendanceScreenState();
}

class _PmocAttendanceScreenState extends ConsumerState<PmocAttendanceScreen> {
  final Map<String, bool> _answers = {};
  String? _executionId;

  /// A pessoa percorreu o roteiro. **Não** é dado do servidor — é confirmação de
  /// quem estava lá, e existe para que registrar a manutenção seja um ato
  /// deliberado e não o terceiro toque seguido.
  bool _roteiroConferido = false;

  PmocAttendanceTarget get _target => PmocAttendanceTarget(
    planId: widget.planId,
    cycleId: widget.cycleId,
    assetId: widget.assetId,
  );

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(pmocAttendanceControllerProvider(_target));
    final controller = ref.read(
      pmocAttendanceControllerProvider(_target).notifier,
    );

    final execution = state.execution;
    if (execution != null && _executionId != execution.id) {
      _executionId = execution.id;
      _roteiroConferido = false;
      _answers.clear();
      final groups = state.preparation!.procedureGroups;
      for (var g = 0; g < groups.length; g++) {
        for (var i = 0; i < groups[g].items.length; i++) {
          final key = '$g:$i';
          _answers[key] = execution.procedureAnswers[key] ?? true;
        }
      }
    }
    return Scaffold(
      backgroundColor: context.orbit.background,
      appBar: AppBar(title: const Text('Atendimento de PMOC')),
      body: switch (state.phase) {
        PmocAttendancePhase.loading => const Padding(
          padding: EdgeInsets.all(OrbitSpacing.gutter),
          child: SectionLoading(lines: 6),
        ),
        PmocAttendancePhase.error when state.preparation == null => ListView(
          padding: const EdgeInsets.all(OrbitSpacing.gutter),
          children: [
            SectionError(error: state.error!, onRetry: controller.load),
          ],
        ),
        _ => _Body(
          state: state,
          controller: controller,
          answers: _answers,
          onAnswer: (key, value) => setState(() {
            _answers[key] = value;
            _roteiroConferido = false;
          }),
          reviewed: _roteiroConferido,
          onReviewed: (value) => setState(() => _roteiroConferido = value),
        ),
      },
    );
  }
}

class _Body extends ConsumerWidget {
  const _Body({
    required this.state,
    required this.controller,
    required this.answers,
    required this.onAnswer,
    required this.reviewed,
    required this.onReviewed,
  });

  final PmocAttendanceState state;
  final PmocAttendanceController controller;
  final Map<String, bool> answers;
  final void Function(String, bool) onAnswer;
  final bool reviewed;
  final ValueChanged<bool> onReviewed;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final preparation = state.preparation!;
    final execution = state.execution;
    final podeAbrir = state.allows('START');
    final podeConcluir = state.allows('COMPLETE');
    final operationId = execution?.operation?['id'] as String?;
    Future<bool> save({String? notes}) async {
      final saved = await controller.saveWork(answers: answers, notes: notes);
      if (saved && operationId != null) {
        await ref
            .read(executionControllerProvider(operationId).notifier)
            .load();
      }
      return saved;
    }

    final etapas = <OrbitWizardStep>[
      OrbitWizardStep(
        title: 'Contexto',
        hint: 'Confira o contrato, o equipamento e o prazo antes de abrir.',

        /// Cumprida quando o atendimento já foi aberto — e "aberto" é o que o
        /// servidor diz, não o que a tela lembra de ter pedido.
        complete: execution != null,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _Summary(preparation: preparation, execution: execution),
            if (!preparation.eligibility.ready &&
                preparation.eligibility.blockedReasons.isNotEmpty)
              _Blockers(reasons: preparation.eligibility.blockedReasons),
            if (podeAbrir)
              Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: OrbitSpacing.gutter,
                  vertical: OrbitSpacing.md,
                ),
                child: FilledButton(
                  onPressed: state.isBusy ? null : controller.start,
                  style: FilledButton.styleFrom(minimumSize: const Size(0, 48)),
                  child: Text(
                    state.pending == PmocAttendanceCommand.start
                        ? 'Abrindo…'
                        : 'Abrir atendimento',
                  ),
                ),
              ),
          ],
        ),
      ),

      OrbitWizardStep(
        title: 'Roteiro',
        hint: 'Percorra os itens previstos no plano e registre as evidências.',

        /// Travada antes de abrir: sem execução não há a que anexar evidência.
        ///
        /// Era `enabled: execution != null`, e o roteiro pulava a etapa — então todo
        /// atendimento de PMOC ainda não aberto, que é todo atendimento ao chegar
        /// nesta tela, saltava a etapa 2. A pessoa via "Etapa 1 de 4" virar
        /// "Etapa 3 de 4" e nenhuma pista do que havia no meio.
        lockedReason: execution != null
            ? null
            : 'Abra o atendimento na etapa anterior para percorrer o roteiro.',
        complete: reviewed,
        child: _Procedure(
          preparation: preparation,
          execution: execution,
          answers: answers,
          onAnswer: onAnswer,
          enabled: podeConcluir && !state.isBusy,
          canCapture: state.allows('ADD_EVIDENCE'),
        ),
      ),

      OrbitWizardStep(
        title: 'Serviço realizado',
        hint: 'Observações e materiais são opcionais.',
        lockedReason: operationId == null
            ? 'Abra o atendimento para registrar o serviço.'
            : null,
        child: operationId == null
            ? const SizedBox.shrink()
            : AttendanceWorkRecord(
                key: ValueKey(operationId),
                operationId: operationId,
                enabled: podeConcluir,
                initialNotes: execution?.notes,
                onSaveNotes: (notes) => save(notes: notes),
              ),
      ),
      OrbitWizardStep(
        title: 'Confirmação',
        hint: 'Apresente ao cliente o resumo e registre o aceite neste espaço.',
        lockedReason: operationId == null || (!reviewed && podeConcluir)
            ? 'Avance pela etapa de roteiro antes de coletar a confirmação do cliente.'
            : null,
        child: operationId == null
            ? const SizedBox.shrink()
            : CustomerAcknowledgementScreen(
                key: ValueKey(operationId),
                operationId: operationId,
                embedded: true,
              ),
      ),
      OrbitWizardStep(
        title: 'Conclusão',
        hint: 'Resumo técnico e relatório da manutenção.',
        complete: execution?.status == PmocEquipmentExecutionStatus.completed,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (operationId != null)
              AttendanceTechnicalSummary(
                operationId: operationId,
                code: preparation.planCode,
                technician: execution?.responsibleFieldTechnicianName,
                completedAt: execution?.completedAt,
              ),
            if (execution?.status == PmocEquipmentExecutionStatus.completed)
              _Report(state: state, controller: controller),
          ],
        ),
      ),
    ];

    return RefreshIndicator(
      /// Não recarrega por cima de um comando em voo: a resposta dele é que
      /// define o passo seguinte.
      onRefresh: () async => state.isBusy ? null : controller.load(),
      child: ListView(
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        padding: const EdgeInsets.only(bottom: OrbitSpacing.xl),
        children: [
          if (state.error != null &&
              execution?.status != PmocEquipmentExecutionStatus.completed)
            Padding(
              padding: const EdgeInsets.fromLTRB(
                OrbitSpacing.md,
                OrbitSpacing.md,
                OrbitSpacing.md,
                0,
              ),

              /// O erro fica **na tela**, e não num aviso que passa: a recusa de
              /// atribuição é uma frase que a pessoa precisa ler até o fim para
              /// saber o que fazer — pedir a atribuição, não tentar de novo.
              child: SectionError(
                error: state.error!,
                onRetry: controller.load,
              ),
            ),

          /// O passo inicial é o do servidor: quem reabre a tela com o
          /// atendimento em andamento cai no roteiro, não no contexto.
          AttendanceWizard(
            operationId: operationId,
            evidenceTarget: execution == null
                ? null
                : FieldEvidenceTargetRef(
                    type: FieldEvidenceTarget.pmocEquipmentExecution,
                    id: execution.id,
                  ),
            onBeforeStepChanged: (from, to) async {
              if (from <= 1 && to > 1 && podeConcluir) {
                final saved = await save();
                if (saved) onReviewed(true);
                return saved;
              }
              return true;
            },
            confirmationStep: 3,
            completed:
                execution?.status == PmocEquipmentExecutionStatus.completed,
            onComplete: controller.finishAfterConfirmation,
            steps: etapas,
            initialStep: podeAbrir
                ? 0
                : podeConcluir
                ? 1
                : execution == null
                ? 0
                : 4,
          ),
        ],
      ),
    );
  }
}

/// O contexto do atendimento: contrato, cliente, equipamento, prazo.
class _Summary extends StatelessWidget {
  const _Summary({required this.preparation, required this.execution});

  final PmocExecutionPreparationContract preparation;
  final PmocEquipmentExecutionContract? execution;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: OrbitSpacing.gutter),
      child: OrbitCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (preparation.planCode case final String codigo)
              Text(
                codigo,
                style: OrbitType.eyebrow.copyWith(color: palette.inkSubtle),
              ),
            const SizedBox(height: 2),
            Text(
              preparation.equipmentName,
              style: OrbitType.sectionTitle.copyWith(color: palette.ink),
            ),
            const SizedBox(height: OrbitSpacing.sm),
            Wrap(
              spacing: OrbitSpacing.xs,
              runSpacing: 4,
              children: [
                /// A contagem **deste equipamento**, quando a execução existe.
                /// Antes de abrir não há número: inventá-lo seria afirmar uma
                /// posição que o servidor ainda não reservou.
                if (execution?.sequenceNumber case final int numero)
                  OrbitStatusBadge(
                    label: 'Manutenção $numero',
                    tone: OrbitTone.info,
                  ),
                OrbitStatusBadge(
                  label: 'Vence ${pmocDueLabel(preparation.cycleDueOn)}',
                ),
                if (preparation.cycleSequenceNumber case final int ciclo)
                  OrbitStatusBadge(label: 'Ciclo $ciclo'),
              ],
            ),
            const SizedBox(height: OrbitSpacing.sm),
            _Line(label: 'Contrato', value: preparation.planName),
            _Line(label: 'Cliente', value: preparation.customerName),
            if (preparation.serviceLocation case final String local)
              _Line(label: 'Local', value: local),
            if (preparation.technicalResponsibleName case final String rt)
              _Line(label: 'Responsável Técnico', value: rt),

            /// Quem abriu, quando já foi aberto. É histórico, e é o que explica
            /// para o técnico certo por que ele pode concluir — ou não.
            if (execution?.responsibleFieldTechnicianName
                case final String quem)
              _Line(
                label: 'Atendendo',
                value:
                    '$quem'
                    '${execution?.startedAt == null ? '' : ' · ${OrbitFormat.of(context).dateHourOf(execution!.startedAt)}'}',
              ),
          ],
        ),
      ),
    );
  }
}

/// O roteiro previsto e as evidências.
class _Procedure extends StatelessWidget {
  const _Procedure({
    required this.preparation,
    required this.execution,
    required this.canCapture,
    required this.answers,
    required this.onAnswer,
    required this.enabled,
  });

  final PmocExecutionPreparationContract preparation;
  final PmocEquipmentExecutionContract? execution;
  final bool canCapture;
  final Map<String, bool> answers;
  final void Function(String, bool) onAnswer;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final grupos = preparation.procedureGroups;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (grupos.isEmpty)
          const OrbitEmptyState(
            icon: Icons.checklist_outlined,
            title: 'Sem roteiro previsto',
            description:
                'Este plano não declarou procedimentos. O relatório sai com o '
                'que você registrar abaixo.',
          )
        else
          SectionBlock(
            title: 'Roteiro do plano',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Os itens vêm marcados. Desmarque o que não foi realizado. O roteiro será salvo ao avançar.',
                ),
                for (var g = 0; g < grupos.length; g++) ...[
                  Text(
                    grupos[g].group,
                    style: OrbitType.label.copyWith(color: palette.ink),
                  ),
                  for (var i = 0; i < grupos[g].items.length; i++)
                    CheckboxListTile(
                      contentPadding: EdgeInsets.zero,
                      controlAffinity: ListTileControlAffinity.leading,
                      value: answers['$g:$i'] ?? true,
                      onChanged: enabled
                          ? (value) => onAnswer('$g:$i', value ?? false)
                          : null,
                      title: Text(grupos[g].items[i]),
                    ),
                ],
              ],
            ),
          ),

        /// As evidências pertencem à **execução do equipamento**, não à ordem de
        /// serviço: é o alvo que o servidor reconhece, e é por ele que a foto
        /// chega ao relatório daquele aparelho.
        if (execution != null)
          EvidenceSection(
            target: FieldEvidenceTargetRef(
              type: FieldEvidenceTarget.pmocEquipmentExecution,
              id: execution!.id,
            ),
            canCapture: canCapture,
          ),
      ],
    );
  }
}

/// A emissão é disparada ao entrar no resultado da manutenção concluída.
class _Report extends StatefulWidget {
  const _Report({required this.state, required this.controller});
  final PmocAttendanceState state;
  final PmocAttendanceController controller;
  @override
  State<_Report> createState() => _ReportState();
}

class _ReportState extends State<_Report> {
  bool _requested = false;
  void _issue() {
    if (_requested) return;
    _requested = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) widget.controller.issueReport();
    });
  }

  @override
  Widget build(BuildContext context) {
    final state = widget.state;
    final execution = state.execution;
    final preparation = state.preparation;
    if (execution?.artifactExecution?['id'] case final String documentId) {
      return PmocDocumentSection(
        artifactExecutionId: documentId,
        fileName: documentFileNameOf([
          'PMOC',
          preparation?.planCode ?? '',
          preparation?.equipmentName ?? '',
          if (execution?.sequenceNumber case final int number)
            'manutencao-$number',
        ]),
        subject: [
          'Relatório de PMOC',
          preparation?.equipmentName,
          preparation?.customerName,
        ].whereType<String>().join(' · '),
      );
    }
    if (state.error != null) {
      return SectionBlock(
        title: 'Relatório de execução',
        child: SectionError(
          error: state.error!,
          onRetry: () {
            _requested = false;
            _issue();
          },
        ),
      );
    }
    _issue();
    return const SectionBlock(
      title: 'Relatório de execução',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Preparando o relatório automaticamente…'),
          SizedBox(height: OrbitSpacing.sm),
          LinearProgressIndicator(),
        ],
      ),
    );
  }
}

class _Blockers extends StatelessWidget {
  const _Blockers({required this.reasons});

  final List<String> reasons;

  @override
  Widget build(BuildContext context) => SectionBlock(
    title: 'Ainda não é possível abrir',
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final reason in reasons)
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Text(
              pmocBlockedReasonLabel(reason),
              style: OrbitType.body.copyWith(color: context.orbit.warning),
            ),
          ),
      ],
    ),
  );
}

class _Line extends StatelessWidget {
  const _Line({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 4),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: OrbitType.caption.copyWith(color: context.orbit.inkSubtle),
        ),
        Text(value, style: OrbitType.body.copyWith(color: context.orbit.ink)),
      ],
    ),
  );
}
