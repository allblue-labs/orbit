/// As ações de execução — exatamente as que o servidor publicou.
///
/// `primaryAction` decide o botão de baixo; `allowedActions` decide o resto.
/// Nada é habilitado por status, e nada é acrescentado "para facilitar".
library;

import 'package:flutter/material.dart';

import '../../../../core/contracts/field_operation_contracts.dart';
import '../../../../core/presentation/field_registry.dart';
import '../../../../core/theme/orbit_theme.dart';
import '../../../../core/widgets/section_states.dart';
import '../../application/execution_controller.dart';

const _codes = <FieldOperationAllowedAction, String>{
  FieldOperationAllowedAction.start: 'START',
  FieldOperationAllowedAction.resume: 'RESUME',
  FieldOperationAllowedAction.complete: 'COMPLETE',
  FieldOperationAllowedAction.updateChecklist: 'UPDATE_CHECKLIST',
  FieldOperationAllowedAction.addNote: 'ADD_NOTE',
  FieldOperationAllowedAction.registerMaterial: 'REGISTER_MATERIAL',
};

/// Concluir pede confirmação — proporcional, sem alarme.
///
/// Pública porque quem a dispara agora é o controle de avanço da última etapa
/// do roteiro, e não mais uma barra fixa. A barra saiu: ela competia com o
/// "Avançar", e duas ações grandes lado a lado não dizem qual vem primeiro.
Future<void> confirmExecutionCompletion(
  BuildContext context,
  ExecutionController controller, {
  Future<void> Function()? onComplete,
}) async {
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('Concluir atendimento?'),
      content: const Text(
        'O atendimento será encerrado. O documento é emitido em separado.',
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('Cancelar'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(true),
          child: const Text('Concluir'),
        ),
      ],
    ),
  );
  if (confirmed ?? false) await (onComplete ?? controller.complete)();
}

/// Observação e material, quando publicados.
class ExecutionSecondaryActions extends StatelessWidget {
  const ExecutionSecondaryActions({
    super.key,
    required this.state,
    required this.onNote,
    required this.onMaterial,
  });

  final ExecutionState state;
  final VoidCallback onNote;
  final VoidCallback onMaterial;

  @override
  Widget build(BuildContext context) {
    final entries = <(FieldOperationAllowedAction, VoidCallback)>[
      (FieldOperationAllowedAction.addNote, onNote),
      (FieldOperationAllowedAction.registerMaterial, onMaterial),
    ].where((entry) => state.allows(entry.$1)).toList();

    if (entries.isEmpty) return const SizedBox.shrink();

    return SectionBlock(
      title: 'Registrar',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final (action, onPressed) in entries)
            if (executionActionLabel(_codes[action] ?? '') case final label?)
              Padding(
                padding: const EdgeInsets.only(bottom: OrbitSpacing.sm),
                child: OutlinedButton(
                  onPressed: state.isBusy ? null : onPressed,
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(0, 48),
                  ),
                  child: Text(label.label),
                ),
              ),
        ],
      ),
    );
  }
}
