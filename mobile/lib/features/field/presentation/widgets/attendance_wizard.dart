import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/design/orbit_wizard.dart';
import '../../../signature/application/signature_providers.dart';
import 'attendance_work_record.dart';

/// Estrutura compartilhada, com rascunhos preservados e resumo atualizado antes do aceite.
class AttendanceWizard extends ConsumerStatefulWidget {
  const AttendanceWizard({
    super.key,
    required this.steps,
    required this.confirmationStep,
    this.operationId,
    this.initialStep = 0,
  });
  final List<OrbitWizardStep> steps;
  final int confirmationStep;
  final String? operationId;
  final int initialStep;
  @override
  ConsumerState<AttendanceWizard> createState() => _AttendanceWizardState();
}

class _AttendanceWizardState extends ConsumerState<AttendanceWizard> {
  var _workKey = GlobalKey<AttendanceWorkRecordState>();
  @override
  void didUpdateWidget(AttendanceWizard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.operationId != widget.operationId) {
      _workKey = GlobalKey<AttendanceWorkRecordState>();
    }
  }

  @override
  Widget build(BuildContext context) => OrbitWizard(
    key: ValueKey(widget.operationId),
    steps: widget.steps.map((step) {
      if (step.child case final AttendanceWorkRecord work) {
        return OrbitWizardStep(
          title: step.title,
          hint: step.hint,
          complete: step.complete,
          lockedReason: step.lockedReason,
          forward: step.forward,
          child: AttendanceWorkRecord(
            key: _workKey,
            operationId: work.operationId,
            onSaveNotes: work.onSaveNotes,
            initialNotes: work.initialNotes,
            enabled: work.enabled,
          ),
        );
      }
      return step;
    }).toList(),
    initialStep: widget.initialStep,
    preserveStepState: true,
    onBeforeStepChanged: (from, to) async {
      if (to >= widget.confirmationStep) {
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
