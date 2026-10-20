/// Ações de execução: iniciar, pausar, retomar e concluir.
///
/// **Sem máquina de estados local.** A validade de cada transição é do backend
/// (`OperationService.transitions`); o app envia a intenção e apresenta a
/// recusa quando ela vem. Só é escondida a ação cujo destino é o estado atual,
/// porque enviá-la não teria efeito algum — isso é evitar ruído, não replicar
/// regra.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/providers.dart';
import '../../../../core/contracts/operation_contracts.dart';
import '../../../../core/errors/orbit_exception.dart';
import '../../../../core/routing/guards.dart';
import '../../../../core/theme/orbit_theme.dart';
import '../../../../core/widgets/section_states.dart';
import '../../application/operations_providers.dart';

/// Permissão exigida por `PATCH /operations/:id/status`.
const String _statusPermission = 'operations.status.update';

/// Ação de campo: um rótulo e o status que ela pede ao backend.
class _FieldAction {
  const _FieldAction({
    required this.label,
    required this.icon,
    required this.targetStatus,
    required this.color,
  });

  final String label;
  final IconData icon;
  final String targetStatus;
  final Color color;
}

const _actions = <_FieldAction>[
  _FieldAction(
    label: 'Iniciar',
    icon: Icons.play_arrow_rounded,
    targetStatus: OperationStatus.inProgress,
    color: OrbitColors.success,
  ),
  _FieldAction(
    label: 'Pausar',
    icon: Icons.pause_rounded,
    targetStatus: OperationStatus.paused,
    color: OrbitColors.warning,
  ),
  _FieldAction(
    label: 'Retomar',
    icon: Icons.play_arrow_rounded,
    targetStatus: OperationStatus.inProgress,
    color: OrbitColors.success,
  ),
  _FieldAction(
    label: 'Concluir',
    icon: Icons.check_rounded,
    targetStatus: OperationStatus.completed,
    color: OrbitColors.brand,
  ),
];

class FieldActionsSection extends ConsumerStatefulWidget {
  const FieldActionsSection({super.key, required this.operation});

  final Operation operation;

  @override
  ConsumerState<FieldActionsSection> createState() =>
      _FieldActionsSectionState();
}

class _FieldActionsSectionState extends ConsumerState<FieldActionsSection> {
  String? _submitting;

  Future<void> _run(_FieldAction action) async {
    setState(() => _submitting = action.label);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref
          .read(operationsRepositoryProvider)
          .changeStatus(id: widget.operation.id, status: action.targetStatus);
      if (!mounted) return;
      invalidateOperation(ref, widget.operation.id);
      messenger.showSnackBar(
        SnackBar(content: Text('${action.label}: status atualizado.')),
      );
    } on OrbitException catch (error) {
      if (!mounted) return;

      /// A recusa do servidor é mostrada como ele a deu. O que muda é o caso
      /// ambíguo: se a requisição pode ter sido processada, a frase pede para
      /// conferir antes de repetir — mudar de status duas vezes é pior do que
      /// esperar um instante.
      messenger.showSnackBar(
        SnackBar(content: Text(error.publicMessageForCommand)),
      );
      if (error.mayHaveBeenApplied) {
        invalidateOperation(ref, widget.operation.id);
      }
    } finally {
      if (mounted) setState(() => _submitting = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    // "Retomar" e "Iniciar" pedem o mesmo status: mostramos o rótulo que faz
    // sentido para quem está olhando a tela.
    final isPaused = widget.operation.status == OperationStatus.paused;
    final visible = _actions.where((action) {
      if (action.targetStatus == widget.operation.status) return false;
      if (action.label == 'Retomar') return isPaused;
      if (action.label == 'Iniciar') return !isPaused;
      return true;
    }).toList();

    return SectionBlock(
      title: 'Execução',
      subtitle: 'Cada transição é validada pelo servidor',
      child: PermissionGate(
        permission: _statusPermission,
        fallback: const SectionEmpty(
          icon: Icons.lock_outline,
          message: 'Sua conta não pode alterar o andamento desta operação.',
        ),
        child: Wrap(
          spacing: OrbitSpacing.sm,
          runSpacing: OrbitSpacing.sm,
          children: [
            for (final action in visible)
              _ActionButton(
                action: action,
                busy: _submitting == action.label,
                enabled: _submitting == null,
                onPressed: () => _run(action),
              ),
          ],
        ),
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  const _ActionButton({
    required this.action,
    required this.busy,
    required this.enabled,
    required this.onPressed,
  });

  final _FieldAction action;
  final bool busy;
  final bool enabled;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return FilledButton.tonalIcon(
      onPressed: enabled ? onPressed : null,
      icon: busy
          ? const SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : Icon(action.icon, size: 20),
      label: Text(action.label),
      style: FilledButton.styleFrom(
        minimumSize: const Size(0, 48),
        foregroundColor: action.color,
        backgroundColor: action.color.withValues(alpha: 0.14),
      ),
    );
  }
}
