/// O checklist do atendimento.
///
/// Os itens, o progresso e a obrigatoriedade vêm do servidor. `required` é
/// **apresentação**: marcar um item obrigatório não libera a conclusão, e
/// deixá-lo em branco não a impede — quem decide é `allowedActions`.
///
/// A identidade de cada item é o ID do backend, nunca o rótulo ou a posição:
/// dois itens podem se chamar igual, e a ordem pode mudar.
library;

import 'package:flutter/material.dart';

import '../../../../core/contracts/field_operation_contracts.dart';
import '../../../../core/theme/orbit_theme.dart';
import '../../../../core/widgets/section_states.dart';

typedef ChecklistAnswer =
    void Function(String checklistId, String itemId, Object? answer);

class ExecutionChecklist extends StatefulWidget {
  const ExecutionChecklist({
    super.key,
    required this.checklists,
    required this.enabled,
    required this.onAnswer,
    this.onConfirm,
    this.onSave,
    this.pendingIds = const {},
  });

  final List<FieldOperationChecklistContract> checklists;

  /// `false` quando o servidor não publica `UPDATE_CHECKLIST` ou há comando
  /// em voo.
  final bool enabled;
  final ChecklistAnswer onAnswer;
  final ValueChanged<String>? onConfirm;
  final Future<bool> Function(String, Map<String, dynamic>)? onSave;
  final Set<String> pendingIds;
  @override
  State<ExecutionChecklist> createState() => ExecutionChecklistState();
}

class ExecutionChecklistState extends State<ExecutionChecklist> {
  final Map<String, Map<String, dynamic>> _drafts = {};
  bool _saving = false;
  String? _error;
  Map<String, dynamic> _answers(FieldOperationChecklistContract checklist) =>
      _drafts.putIfAbsent(checklist.id, () => checklist.defaultAnswers);

  Future<bool> saveDraft() async {
    if (_saving) return false;
    final pending = widget.checklists
        .where(
          (item) =>
              item.status == 'IN_PROGRESS' &&
              !widget.pendingIds.contains(item.id),
        )
        .toList();
    if (pending.isEmpty) return true;
    if (!widget.enabled) return false;
    final drafts = {
      for (final item in pending)
        item.id: Map<String, dynamic>.of(_answers(item)),
    };
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      for (final item in pending) {
        final saved = widget.onSave != null
            ? await widget.onSave!(item.id, drafts[item.id]!)
            : widget.onConfirm != null;
        if (widget.onSave == null && saved) {
          widget.onConfirm!(item.id);
        }
        if (!saved) {
          if (mounted) {
            setState(
              () => _error =
                  'Não foi possível salvar o checklist. Confira o aviso e tente avançar novamente.',
            );
          }
          return false;
        }
      }
      return true;
    } on Object {
      if (mounted) {
        setState(
          () => _error =
              'Não foi possível salvar o checklist. Tente avançar novamente.',
        );
      }
      return false;
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  void didUpdateWidget(ExecutionChecklist oldWidget) {
    super.didUpdateWidget(oldWidget);
    for (final checklist in widget.checklists) {
      final previous = oldWidget.checklists
          .where((item) => item.id == checklist.id)
          .firstOrNull;
      if (checklist.status != 'IN_PROGRESS' ||
          previous?.version != checklist.version) {
        _drafts.remove(checklist.id);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        if (_error != null)
          Padding(
            padding: const EdgeInsets.all(OrbitSpacing.gutter),
            child: Text(_error!, style: TextStyle(color: context.orbit.danger)),
          ),
        if (_saving) const LinearProgressIndicator(),
        for (final checklist in widget.checklists)
          SectionBlock(
            title: checklist.name,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                /// Contagem é leitura, não autorização.
                Text(
                  '${widget.onSave == null ? checklist.items.where((item) => item.isAnswered).length : _answers(checklist).values.where((answer) => answer != null).length}'
                  ' de ${checklist.items.length} itens',
                  style: const TextStyle(
                    fontSize: 12,
                    color: OrbitColors.textSecondary,
                  ),
                ),
                const SizedBox(height: OrbitSpacing.sm),
                for (final item in checklist.items)
                  _ChecklistTile(
                    key: ValueKey(
                      '${checklist.id}:${checklist.version}:${item.id}',
                    ),
                    item: item,
                    enabled:
                        widget.enabled &&
                        !_saving &&
                        checklist.status == 'IN_PROGRESS' &&
                        !widget.pendingIds.contains(checklist.id),
                    currentAnswer: widget.onSave == null
                        ? item.answer
                        : _answers(checklist)[item.id],
                    onChanged: (answer) {
                      if (widget.onSave != null) {
                        setState(() => _answers(checklist)[item.id] = answer);
                      } else {
                        widget.onAnswer(checklist.id, item.id, answer);
                      }
                    },
                  ),
                if ((widget.onSave != null || widget.onConfirm != null) &&
                    checklist.status == 'IN_PROGRESS') ...[
                  const SizedBox(height: OrbitSpacing.sm),
                  const Text(
                    'Os itens vêm marcados. Desmarque o que não foi realizado. Suas respostas serão salvas ao avançar.',
                  ),
                ],
              ],
            ),
          ),
      ],
    );
  }
}

class _ChecklistTile extends StatelessWidget {
  const _ChecklistTile({
    super.key,
    required this.item,
    required this.enabled,
    required this.onChanged,
    required this.currentAnswer,
  });

  final FieldOperationChecklistItemContract item;
  final Object? currentAnswer;
  final bool enabled;
  final ValueChanged<Object?> onChanged;

  @override
  Widget build(BuildContext context) {
    if (!item.isCheck) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: TextFormField(
          key: ValueKey(item.id),
          initialValue: currentAnswer?.toString(),
          keyboardType: item.type == 'NUMBER'
              ? const TextInputType.numberWithOptions(
                  decimal: true,
                  signed: true,
                )
              : TextInputType.text,
          enabled: enabled,
          decoration: InputDecoration(
            labelText: item.required ? '${item.label} *' : item.label,
          ),
          onChanged: (value) => onChanged(
            item.type == 'NUMBER'
                ? num.tryParse(value.replaceAll(',', '.'))
                : value,
          ),
        ),
      );
    }
    final checked = currentAnswer == true || currentAnswer == null;

    /// O leitor de tela anuncia o item e o estado como **um** nó:
    /// "Filtro limpo, obrigatório, marcado". Sem `container` e sem excluir a
    /// semântica interna, o rótulo e o estado do `Checkbox` viram nós
    /// separados e a leitura sai partida.
    return Semantics(
      container: true,
      checked: checked,
      enabled: enabled,
      onTap: enabled ? () => onChanged(!checked) : null,
      label: '${item.label}${item.required ? ', obrigatório' : ''}',
      excludeSemantics: true,
      child: InkWell(
        onTap: enabled ? () => onChanged(!checked) : null,
        borderRadius: OrbitRadius.field,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              /// Alvo grande: em campo o toque é com luva.
              SizedBox(
                width: 48,
                height: 48,
                child: Checkbox(
                  value: checked,
                  onChanged: enabled
                      ? (value) => onChanged(value ?? false)
                      : null,
                ),
              ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(top: 14),
                  child: Text(
                    item.required ? '${item.label} *' : item.label,
                    style: const TextStyle(
                      fontSize: 14,
                      color: OrbitColors.textPrimary,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
