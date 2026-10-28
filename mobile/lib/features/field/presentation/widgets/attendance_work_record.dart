import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/contracts/field_operation_contracts.dart';
import '../../../../core/design/orbit_keyboard.dart';
import '../../../../core/theme/orbit_theme.dart';
import '../../../../core/widgets/section_states.dart';
import '../../../sync/application/sync_controller.dart';
import '../../application/execution_controller.dart';
import 'material_sheet.dart';

/// Registro opcional compartilhado pelos três atendimentos.
class AttendanceWorkRecord extends ConsumerStatefulWidget {
  const AttendanceWorkRecord({
    super.key,
    required this.operationId,
    this.onSaveNotes,
    this.initialNotes,
    this.enabled = true,
  });
  final String operationId;
  final Future<bool> Function(String)? onSaveNotes;
  final String? initialNotes;
  final bool enabled;
  @override
  ConsumerState<AttendanceWorkRecord> createState() =>
      AttendanceWorkRecordState();
}

class AttendanceWorkRecordState extends ConsumerState<AttendanceWorkRecord> {
  late final _notes = TextEditingController(text: widget.initialNotes);
  late String _savedText = widget.initialNotes?.trim() ?? '';
  bool _saving = false;
  String? _message;
  @override
  void dispose() {
    _notes.dispose();
    super.dispose();
  }

  Future<bool> saveDraft() async {
    final text = _notes.text.trim();
    if (_saving) return false;
    if (text == _savedText || !widget.enabled) return true;
    if (text.isEmpty && widget.onSaveNotes == null) return true;
    var successful = false;
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() {
      _saving = true;
      _message = null;
    });
    try {
      if (widget.onSaveNotes case final save?) {
        final saved = await save(text);
        successful = saved;
        if (mounted) {
          setState(
            () => _message = saved
                ? 'Observação registrada.'
                : 'Não foi possível salvar. Confira o aviso do atendimento.',
          );
        }
      } else {
        final outcome = await ref
            .read(executionControllerProvider(widget.operationId).notifier)
            .addNote(text);
        successful =
            outcome is CommandConfirmed || outcome is CommandPendingOutcome;
        if (mounted) {
          setState(
            () => _message = switch (outcome) {
              CommandConfirmed() => 'Observação registrada.',
              CommandPendingOutcome() =>
                'Observação salva no aparelho, aguardando sincronização.',
              CommandBlocked() => outcome.message,
              _ => 'Não foi possível registrar a observação. Tente novamente.',
            },
          );
        }
      }
      if (successful) _savedText = text;
      return successful;
    } on Object {
      if (mounted) {
        setState(
          () => _message =
              'Não foi possível salvar a observação. Tente novamente.',
        );
      }
      return false;
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(executionControllerProvider(widget.operationId));
    final controller = ref.read(
      executionControllerProvider(widget.operationId).notifier,
    );
    final canNote =
        widget.enabled &&
        (widget.onSaveNotes != null ||
            state.allows(FieldOperationAllowedAction.addNote));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SectionBlock(
          title: 'O que foi feito',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'Opcional. Descreva o serviço realizado para aparecer no resumo que o cliente irá confirmar.',
              ),
              const SizedBox(height: OrbitSpacing.sm),
              TextField(
                controller: _notes,
                enabled: canNote && !_saving,
                minLines: 3,
                maxLines: 6,
                maxLength: widget.onSaveNotes == null ? 2000 : 1000,
                onTapOutside: (_) =>
                    FocusManager.instance.primaryFocus?.unfocus(),
                decoration: const InputDecoration(
                  labelText: 'Observações do serviço (opcional)',
                  suffixIcon: OrbitKeyboardDismissButton(),
                ),
              ),
              if (canNote)
                Text(
                  _saving ? 'Salvando…' : 'A observação será salva ao avançar.',
                ),
              if (_message != null) Text(_message!),
            ],
          ),
        ),
        SectionBlock(
          title: 'O que foi usado',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'Opcional. Adicione os materiais utilizados neste atendimento.',
              ),
              for (final item
                  in state.preparation?.materials ?? <Map<String, dynamic>>[])
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.inventory_2_outlined),
                  title: Text(item['description'] as String? ?? 'Material'),
                  subtitle: Text('${item['quantity']} ${item['unit'] ?? 'UN'}'),
                ),
              if (widget.enabled &&
                  state.allows(FieldOperationAllowedAction.registerMaterial))
                OutlinedButton.icon(
                  onPressed: state.isBusy
                      ? null
                      : () => showMaterialSheet(context, controller),
                  icon: const Icon(Icons.add),
                  label: const Text('Adicionar material'),
                ),
            ],
          ),
        ),
      ],
    );
  }
}
