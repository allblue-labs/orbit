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

class ExecutionChecklist extends StatelessWidget {
  const ExecutionChecklist({
    super.key,
    required this.checklists,
    required this.enabled,
    required this.onAnswer,
  });

  final List<FieldOperationChecklistContract> checklists;

  /// `false` quando o servidor não publica `UPDATE_CHECKLIST` ou há comando
  /// em voo.
  final bool enabled;
  final ChecklistAnswer onAnswer;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        for (final checklist in checklists)
          SectionBlock(
            title: checklist.name,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                /// Contagem é leitura, não autorização.
                Text(
                  '${checklist.items.where((item) => item.isAnswered).length}'
                  ' de ${checklist.items.length} itens',
                  style: const TextStyle(
                    fontSize: 12,
                    color: OrbitColors.textSecondary,
                  ),
                ),
                const SizedBox(height: OrbitSpacing.sm),
                for (final item in checklist.items)
                  _ChecklistTile(
                    item: item,
                    enabled: enabled,
                    onChanged: (answer) =>
                        onAnswer(checklist.id, item.id, answer),
                  ),
              ],
            ),
          ),
      ],
    );
  }
}

class _ChecklistTile extends StatelessWidget {
  const _ChecklistTile({
    required this.item,
    required this.enabled,
    required this.onChanged,
  });

  final FieldOperationChecklistItemContract item;
  final bool enabled;
  final ValueChanged<Object?> onChanged;

  @override
  Widget build(BuildContext context) {
    final checked = item.answer == true;

    /// O leitor de tela anuncia o item e o estado como **um** nó:
    /// "Filtro limpo, obrigatório, marcado". Sem `container` e sem excluir a
    /// semântica interna, o rótulo e o estado do `Checkbox` viram nós
    /// separados e a leitura sai partida.
    return Semantics(
      container: true,
      checked: checked,
      enabled: enabled,
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
