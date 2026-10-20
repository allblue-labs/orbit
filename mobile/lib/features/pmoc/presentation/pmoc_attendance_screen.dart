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
  final _notes = TextEditingController();

  /// A pessoa percorreu o roteiro. **Não** é dado do servidor — é confirmação de
  /// quem estava lá, e existe para que registrar a manutenção seja um ato
  /// deliberado e não o terceiro toque seguido.
  bool _roteiroConferido = false;

  @override
  void dispose() {
    _notes.dispose();
    super.dispose();
  }

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
          notes: _notes,
          reviewed: _roteiroConferido,
          onReviewed: (value) => setState(() => _roteiroConferido = value),
        ),
      },
    );
  }
}

class _Body extends StatelessWidget {
  const _Body({
    required this.state,
    required this.controller,
    required this.notes,
    required this.reviewed,
    required this.onReviewed,
  });

  final PmocAttendanceState state;
  final PmocAttendanceController controller;
  final TextEditingController notes;
  final bool reviewed;
  final ValueChanged<bool> onReviewed;

  @override
  Widget build(BuildContext context) {
    final preparation = state.preparation!;
    final execution = state.execution;
    final podeAbrir = state.allows('START');
    final podeConcluir = state.allows('COMPLETE');

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
                  style: FilledButton.styleFrom(
                    minimumSize: const Size(0, 48),
                  ),
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
          reviewed: reviewed,
          onReviewed: onReviewed,
          canCapture: state.allows('ADD_EVIDENCE'),
        ),
      ),

      OrbitWizardStep(
        title: 'Registrar',
        hint: 'O que foi encontrado e feito. Isto sai impresso no relatório.',
        lockedReason: podeConcluir
            ? null
            : 'Percorra o roteiro e confirme a revisão antes de registrar.',
        complete: execution?.status == PmocEquipmentExecutionStatus.completed,
        child: _Register(
          state: state,
          controller: controller,
          notes: notes,
          reviewed: reviewed,
        ),
      ),

      OrbitWizardStep(
        title: 'Relatório',
        hint: 'Emitir é decisão separada de concluir.',
        lockedReason:
            execution?.status == PmocEquipmentExecutionStatus.completed
            ? null
            : 'O relatório é emitido depois de o atendimento ser concluído.',
        complete: state.isFinished,
        child: _Report(state: state, controller: controller),
      ),
    ];

    return RefreshIndicator(
      /// Não recarrega por cima de um comando em voo: a resposta dele é que
      /// define o passo seguinte.
      onRefresh: () async => state.isBusy ? null : controller.load(),
      child: ListView(
        padding: const EdgeInsets.only(bottom: OrbitSpacing.xl),
        children: [
          if (state.error != null)
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
          OrbitWizard(
            key: ValueKey(state.allowedActions.join('|')),
            steps: etapas,
            initialStep: podeAbrir
                ? 0
                : podeConcluir
                ? 1
                : 3,
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
            if (execution?.responsibleFieldTechnicianName case final String quem)
              _Line(
                label: 'Atendendo',
                value:
                    '$quem'
                    '${execution?.startedAt == null ? '' : ' · ${OrbitFormat.dateHourOf(execution!.startedAt)}'}',
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
    required this.reviewed,
    required this.onReviewed,
    required this.canCapture,
  });

  final PmocExecutionPreparationContract preparation;
  final PmocEquipmentExecutionContract? execution;
  final bool reviewed;
  final ValueChanged<bool> onReviewed;
  final bool canCapture;

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
                for (final grupo in grupos) ...[
                  Padding(
                    padding: const EdgeInsets.only(top: OrbitSpacing.xs),
                    child: Text(
                      grupo.group,
                      style: OrbitType.label.copyWith(color: palette.ink),
                    ),
                  ),
                  for (final item in grupo.items)
                    Padding(
                      padding: const EdgeInsets.only(left: 4, top: 2),
                      child: Text(
                        '• $item',
                        style: OrbitType.body.copyWith(color: palette.inkMuted),
                      ),
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

        Padding(
          padding: const EdgeInsets.symmetric(horizontal: OrbitSpacing.gutter),
          child: CheckboxListTile(
            value: reviewed,
            onChanged: (value) => onReviewed(value ?? false),
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            title: Text(
              'Percorri o roteiro neste equipamento',
              style: OrbitType.body.copyWith(color: palette.ink),
            ),
          ),
        ),
      ],
    );
  }
}

/// Observações e o registro da manutenção.
class _Register extends StatelessWidget {
  const _Register({
    required this.state,
    required this.controller,
    required this.notes,
    required this.reviewed,
  });

  final PmocAttendanceState state;
  final PmocAttendanceController controller;
  final TextEditingController notes;
  final bool reviewed;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final concluida =
        state.execution?.status == PmocEquipmentExecutionStatus.completed;

    if (concluida) {
      return SectionBlock(
        title: 'Manutenção registrada',
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Registrada em '
              '${OrbitFormat.dateHourOf(state.execution?.performedAt ?? state.execution?.completedAt)}.',
              style: OrbitType.body.copyWith(color: palette.ink),
            ),
            if (state.execution?.notes case final String observacao
                when observacao.trim().isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: OrbitSpacing.xs),
                child: Text(
                  observacao,
                  style: OrbitType.body.copyWith(color: palette.inkMuted),
                ),
              ),
            if (state.cycleCompleted)
              Padding(
                padding: const EdgeInsets.only(top: OrbitSpacing.sm),
                child: Text(
                  'Com este, todos os equipamentos do ciclo foram resolvidos — o '
                  'ciclo foi encerrado e o próximo já está previsto.',
                  style: OrbitType.caption.copyWith(color: palette.success),
                ),
              ),
          ],
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SectionBlock(
          title: 'Observações e conclusão',
          child: TextField(
            controller: notes,
            maxLines: 5,
            minLines: 3,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(
              hintText:
                  'O que foi encontrado e o que foi feito neste equipamento.',
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: OrbitSpacing.gutter,
            vertical: OrbitSpacing.xs,
          ),
          child: Text(
            /// A hora é a do servidor, e dizer isso evita a pergunta seguinte.
            /// O relógio do aparelho pode estar errado, e a hora da manutenção é
            /// registro legal.
            'A manutenção é registrada com a hora do servidor.',
            style: OrbitType.caption.copyWith(color: palette.inkSubtle),
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: OrbitSpacing.gutter),
          child: FilledButton(
            /// Exige a confirmação do roteiro: registrar é o ato que produz o
            /// documento legal, e ele não pode acontecer por inércia de toques.
            onPressed: state.isBusy || !reviewed
                ? null
                : () => controller.complete(notes: notes.text),
            style: FilledButton.styleFrom(minimumSize: const Size(0, 48)),
            child: Text(
              state.pending == PmocAttendanceCommand.complete
                  ? 'Registrando…'
                  : 'Registrar manutenção',
            ),
          ),
        ),
        if (!reviewed)
          Padding(
            padding: const EdgeInsets.fromLTRB(
              OrbitSpacing.gutter,
              OrbitSpacing.xs,
              OrbitSpacing.gutter,
              0,
            ),
            child: Text(
              'Confirme no passo anterior que percorreu o roteiro.',
              style: OrbitType.caption.copyWith(color: palette.inkSubtle),
            ),
          ),
      ],
    );
  }
}

/// A emissão do relatório de execução.
class _Report extends StatelessWidget {
  const _Report({required this.state, required this.controller});

  final PmocAttendanceState state;
  final PmocAttendanceController controller;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final execution = state.execution;
    final emitido = execution?.artifactExecution != null;
    final preparation = state.preparation;

    /* O nome é o que o cliente vê chegar no WhatsApp: o contrato, o equipamento
       e qual manutenção é. `documento.pdf` não diz nada a quem recebe — e as
       regras de limpeza são as mesmas da lista de Documentos, de propósito. */
    final fileName = documentFileNameOf([
      'PMOC',
      preparation?.planCode ?? '',
      preparation?.equipmentName ?? '',
      if (execution?.sequenceNumber case final int numero)
        'manutencao-$numero',
    ]);

    final subject = [
      'Relatório de PMOC',
      preparation?.equipmentName,
      preparation?.customerName,
    ].whereType<String>().join(' · ');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (!emitido)
          Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: OrbitSpacing.gutter,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'A manutenção está registrada. O relatório de execução é o que '
                  'o cliente guarda como prova de conformidade.',
                  style: OrbitType.body.copyWith(color: palette.inkMuted),
                ),
                const SizedBox(height: OrbitSpacing.sm),
                FilledButton(
                  onPressed: state.isBusy || execution == null
                      ? null
                      : controller.issueReport,
                  style: FilledButton.styleFrom(
                    minimumSize: const Size(0, 48),
                  ),
                  child: Text(
                    state.pending == PmocAttendanceCommand.issue
                        ? 'Emitindo…'
                        : 'Emitir relatório',
                  ),
                ),
              ],
            ),
          ),

        /// Depois de emitido, o arquivo — da execução de artefato, que é onde o
        /// documento de PMOC mora.
        if (execution?.artifactExecution?['id'] case final String documento)
          PmocDocumentSection(
            artifactExecutionId: documento,
            fileName: fileName,
            subject: subject,
          ),
      ],
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
