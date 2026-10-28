import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/design/orbit_wizard.dart';
import '../../../../core/contracts/mobile_evidence_contracts.dart';
import '../../../evidence/application/evidence_providers.dart';
import '../../../signature/application/signature_providers.dart';
import '../../../signature/presentation/customer_acknowledgement_screen.dart';
import 'attendance_work_record.dart';
import 'attendance_result.dart';
import 'execution_signing.dart';
import 'execution_checklist.dart';

/// O aceite do cliente conclui o atendimento; a última etapa apenas apresenta o resultado.
class AttendanceWizard extends ConsumerStatefulWidget {
  const AttendanceWizard({
    super.key,
    required this.steps,
    required this.confirmationStep,
    this.operationId,
    this.initialStep = 0,
    this.completed = false,
    this.onComplete,
    this.onBeforeStepChanged,
    this.evidenceTarget,
  });
  final List<OrbitWizardStep> steps;
  final int confirmationStep;
  final String? operationId;
  final int initialStep;
  final bool completed;
  final Future<bool> Function(int current, int destination)?
  onBeforeStepChanged;
  final FieldEvidenceTargetRef? evidenceTarget;

  /// false significa conclusão persistida no aparelho, ainda aguardando sincronização.
  final Future<bool> Function()? onComplete;
  @override
  ConsumerState<AttendanceWizard> createState() => _AttendanceWizardState();
}

class _AttendanceWizardState extends ConsumerState<AttendanceWizard> {
  var _workKey = GlobalKey<AttendanceWorkRecordState>();
  var _checklistKey = GlobalKey<ExecutionChecklistState>();
  var _wizardKey = GlobalKey<OrbitWizardState>();
  bool _confirmed = false;
  bool _finishing = false;
  Object? _finishError;
  @override
  void didUpdateWidget(AttendanceWizard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.operationId != widget.operationId) {
      _workKey = GlobalKey<AttendanceWorkRecordState>();
      _checklistKey = GlobalKey<ExecutionChecklistState>();
      _wizardKey = GlobalKey<OrbitWizardState>();
      _confirmed = false;
      _finishing = false;
      _finishError = null;
    }
  }

  Future<void> _finish() async {
    if (_finishing || widget.completed) return;
    final operationId = widget.operationId;
    setState(() {
      _confirmed = true;
      _finishing = true;
      _finishError = null;
    });
    await _wizardKey.currentState?.goToStep(widget.confirmationStep + 1);
    if (!mounted || operationId != widget.operationId) return;
    try {
      await widget.onComplete?.call();
    } on Object catch (error) {
      if (mounted && operationId == widget.operationId) {
        setState(() => _finishError = error);
      }
    } finally {
      if (mounted && operationId == widget.operationId) {
        setState(() => _finishing = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) => OrbitWizard(
    key: _wizardKey,
    steps: widget.steps.indexed.map((entry) {
      final (index, step) = entry;
      Widget child = step.child;
      if (child case final ExecutionChecklist checklist) {
        child = ExecutionChecklist(
          key: _checklistKey,
          checklists: checklist.checklists,
          enabled: checklist.enabled,
          onAnswer: checklist.onAnswer,
          onSave: checklist.onSave,
          onConfirm: checklist.onConfirm,
          pendingIds: checklist.pendingIds,
        );
      }
      if (child case final AttendanceWorkRecord work) {
        child = AttendanceWorkRecord(
          key: _workKey,
          operationId: work.operationId,
          onSaveNotes: work.onSaveNotes,
          initialNotes: work.initialNotes,
          enabled: work.enabled,
        );
      }
      if (widget.onComplete != null && index == widget.confirmationStep) {
        if (child case final ExecutionSigningSections signing) {
          child = ExecutionSigningSections(
            operationId: signing.operationId,
            preparation: signing.preparation,
            onConfirmed: _finish,
          );
        } else if (child case final CustomerAcknowledgementScreen signing) {
          child = CustomerAcknowledgementScreen(
            key: ValueKey(signing.operationId),
            operationId: signing.operationId,
            embedded: true,
            onConfirmed: _finish,
          );
        }
      }
      final isResult =
          widget.onComplete != null && index == widget.confirmationStep + 1;
      if (isResult) {
        child = AttendanceResult(
          completed: widget.completed,
          finishing: _finishing,
          error: _finishError,
          onRetry: _finish,
          child: child,
        );
      }
      return OrbitWizardStep(
        title: step.title,
        hint: step.hint,
        complete: step.complete,
        lockedReason: step.lockedReason,
        forward: step.forward,
        terminal: isResult || step.terminal,
        hideForward:
            (widget.onComplete != null && index == widget.confirmationStep) ||
            step.hideForward,
        child: child,
      );
    }).toList(),
    initialStep: widget.initialStep,
    preserveStepState: true,
    onBeforeStepChanged: (from, to) async {
      if (widget.onComplete != null &&
          to > widget.confirmationStep &&
          !widget.completed &&
          !_confirmed) {
        ScaffoldMessenger.maybeOf(context)?.showSnackBar(
          const SnackBar(
            content: Text(
              'Registre a confirmação do cliente para concluir o atendimento.',
            ),
          ),
        );
        return false;
      }
      if (to > from && !_confirmed && !widget.completed) {
        final checklistStep = widget.steps.indexWhere(
          (step) => step.child is ExecutionChecklist,
        );
        if (checklistStep >= from &&
            checklistStep < to &&
            !(await _checklistKey.currentState?.saveDraft() ?? true)) {
          return false;
        }
        if (!(await widget.onBeforeStepChanged?.call(from, to) ?? true)) {
          return false;
        }
        final workStep = widget.steps.indexWhere(
          (step) => step.child is AttendanceWorkRecord,
        );
        if (workStep >= from &&
            workStep < to &&
            !(await _workKey.currentState?.saveDraft() ?? true)) {
          return false;
        }
        if (!mounted) return false;
        // O resumo e o documento só podem considerar fotos já confirmadas pelo
        // servidor. A fila local ainda não participa do snapshot do relatório.
        if (to >= widget.confirmationStep && widget.evidenceTarget != null) {
          final uploads = ref.read(mediaUploadControllerProvider.notifier);
          await uploads.process(manual: true);
          if (!mounted) return false;
          final media = await ref
              .read(mediaQueueProvider)
              .forScope(uploads.scope);
          if (!mounted || !context.mounted) return false;
          final outstanding = media
              .where((item) => item.target == widget.evidenceTarget)
              .toList();
          if (outstanding.isNotEmpty) {
            final rejected = outstanding.any((item) => item.isBlocked);
            ScaffoldMessenger.maybeOf(context)?.showSnackBar(
              SnackBar(
                content: Text(
                  rejected
                      ? 'Há fotos não aceitas. Volte às evidências para conferir o motivo e registrar novamente ou remover o anexo.'
                      : 'As fotos ainda aguardam envio. Confira sua conexão e tente avançar novamente.',
                ),
              ),
            );
            return false;
          }
        }
      }
      return true;
    },
    onStepChanged: (index) {
      if (index == widget.confirmationStep && widget.operationId != null) {
        ref.invalidate(acknowledgementPreparationProvider(widget.operationId!));
      }
    },
  );
}
