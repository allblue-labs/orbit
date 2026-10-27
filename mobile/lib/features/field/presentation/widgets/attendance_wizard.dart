import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/design/orbit_wizard.dart';
import '../../../signature/application/signature_providers.dart';
import '../../../signature/presentation/customer_acknowledgement_screen.dart';
import 'attendance_work_record.dart';
import 'attendance_result.dart';
import 'execution_signing.dart';

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
  });
  final List<OrbitWizardStep> steps;
  final int confirmationStep;
  final String? operationId;
  final int initialStep;
  final bool completed;

  /// false significa conclusão persistida no aparelho, ainda aguardando sincronização.
  final Future<bool> Function()? onComplete;
  @override
  ConsumerState<AttendanceWizard> createState() => _AttendanceWizardState();
}

class _AttendanceWizardState extends ConsumerState<AttendanceWizard> {
  var _workKey = GlobalKey<AttendanceWorkRecordState>();
  var _wizardKey = GlobalKey<OrbitWizardState>();
  bool _confirmed = false;
  bool _finishing = false;
  Object? _finishError;
  @override
  void didUpdateWidget(AttendanceWizard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.operationId != widget.operationId) {
      _workKey = GlobalKey<AttendanceWorkRecordState>();
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
      if (to >= widget.confirmationStep && !_confirmed && !widget.completed) {
        return await _workKey.currentState?.saveDraft() ?? true;
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
