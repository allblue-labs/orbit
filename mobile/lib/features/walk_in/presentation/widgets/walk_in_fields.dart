/// Os campos do atendimento avulso.
///
/// ## Por que nenhum deles é obrigatório, fora o nome
///
/// Porque quem preenche está de pé na porta do cliente, às vezes de luva,
/// quase sempre com pressa. Um formulário que exige CNPJ, CEP e número de série
/// para abrir a ordem é um formulário que ninguém preenche — e o atendimento
/// acontece sem registro nenhum, que é o estado que este fluxo existe para
/// acabar.
///
/// O que falta se completa no escritório, de onde é confortável completar.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../../core/theme/orbit_theme.dart';
import '../../../../core/design/orbit_keyboard.dart';

/// Um campo de texto do roteiro, com rótulo acima.
class WalkInField extends StatelessWidget {
  const WalkInField({
    super.key,
    required this.label,
    required this.controller,
    this.hint,
    this.keyboardType,
    this.textCapitalization = TextCapitalization.sentences,
    this.maxLines = 1,
    this.inputFormatters,
    this.suffix,
    this.onChanged,
    this.helper,
    this.maxLength,
    this.readOnly = false,
    this.onTap,
  });

  final String label;
  final TextEditingController controller;
  final String? hint;
  final TextInputType? keyboardType;
  final TextCapitalization textCapitalization;
  final int maxLines;
  final List<TextInputFormatter>? inputFormatters;
  final Widget? suffix;
  final ValueChanged<String>? onChanged;
  final int? maxLength;
  final bool readOnly;
  final VoidCallback? onTap;

  /// Uma linha abaixo do campo, quando há algo a explicar.
  final String? helper;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return Padding(
      padding: const EdgeInsets.only(bottom: OrbitSpacing.ms),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: OrbitType.caption.copyWith(color: palette.inkSubtle),
          ),
          const SizedBox(height: 4),
          TextField(
            key: ValueKey('walk-in.$label'),
            controller: controller,
            keyboardType: keyboardType,
            textCapitalization: textCapitalization,
            maxLines: maxLines,
            inputFormatters: [
              ...?inputFormatters,
              if (maxLength != null)
                LengthLimitingTextInputFormatter(maxLength),
            ],
            readOnly: readOnly,
            onTap: onTap,
            onTapOutside: (_) => FocusManager.instance.primaryFocus?.unfocus(),
            onChanged: onChanged,
            decoration: InputDecoration(
              hintText: hint,
              isDense: true,
              suffixIcon:
                  suffix ??
                  (maxLines > 1 ? const OrbitKeyboardDismissButton() : null),
              helperText: helper,
              helperMaxLines: 2,
            ),
          ),
        ],
      ),
    );
  }
}

/// Alternar entre empresa e pessoa física.
///
/// Muda o que se pede — CNPJ e razão social de um lado, CPF e nome do outro —
/// e é por isso que é escolha explícita e não dedução pelo comprimento do
/// número digitado: deduzir erraria no meio da digitação, trocando os rótulos
/// debaixo da mão de quem escreve.
class WalkInTypeToggle extends StatelessWidget {
  const WalkInTypeToggle({
    super.key,
    required this.value,
    required this.onChanged,
  });

  /// `COMPANY` ou `INDIVIDUAL`.
  final String value;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return Padding(
      padding: const EdgeInsets.only(bottom: OrbitSpacing.ms),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Tipo de cliente',
            style: OrbitType.caption.copyWith(color: palette.inkSubtle),
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              Expanded(
                child: WalkInChoiceTile(
                  title: 'Pessoa jurídica',
                  description: 'CNPJ',
                  selected: value == 'COMPANY',
                  onTap: () => onChanged('COMPANY'),
                ),
              ),
              const SizedBox(width: OrbitSpacing.sm),
              Expanded(
                child: WalkInChoiceTile(
                  title: 'Pessoa física',
                  description: 'CPF',
                  selected: value == 'INDIVIDUAL',
                  onTap: () => onChanged('INDIVIDUAL'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Uma escolha de toque, grande o suficiente para luva.
class WalkInChoiceTile extends StatelessWidget {
  const WalkInChoiceTile({
    super.key,
    required this.title,
    required this.selected,
    required this.onTap,
    this.description,
    this.icon,
  });

  final String title;
  final String? description;
  final bool selected;
  final VoidCallback onTap;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return Semantics(
      selected: selected,
      button: true,
      child: InkWell(
        onTap: onTap,
        borderRadius: OrbitRadius.field,
        child: Container(
          /// Altura mínima generosa: o alvo precisa aceitar um toque de luva.
          constraints: const BoxConstraints(minHeight: 56),
          padding: const EdgeInsets.symmetric(
            horizontal: OrbitSpacing.ms,
            vertical: OrbitSpacing.sm,
          ),
          decoration: BoxDecoration(
            color: selected ? palette.accentSoft : palette.surface,
            borderRadius: OrbitRadius.field,
            border: Border.all(
              color: selected ? palette.accentStrong : palette.border,
              width: selected ? 1.5 : 1,
            ),
          ),
          child: Row(
            children: [
              Icon(
                icon ??
                    (selected
                        ? Icons.radio_button_checked
                        : Icons.radio_button_unchecked),
                size: 20,
                color: selected ? palette.accentStrong : palette.inkSubtle,
              ),
              const SizedBox(width: OrbitSpacing.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      title,
                      style: OrbitType.body.copyWith(
                        color: palette.ink,
                        fontWeight: selected
                            ? FontWeight.w600
                            : FontWeight.w400,
                      ),
                    ),
                    if (description case final String texto)
                      Text(
                        texto,
                        style: OrbitType.caption.copyWith(
                          color: palette.inkSubtle,
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Máscara de CPF/CNPJ conforme o tipo escolhido.
///
/// Formata enquanto digita porque o número é longo, e conferir dígito por
/// dígito sem pontuação não é como ninguém lê um documento.
class DocumentInputFormatter extends TextInputFormatter {
  const DocumentInputFormatter({required this.individual});

  final bool individual;

  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    final maximo = individual ? 11 : 14;
    final todos = newValue.text.replaceAll(RegExp(r'\D'), '');
    final digits = todos.length > maximo ? todos.substring(0, maximo) : todos;
    final formatado = individual ? _cpf(digits) : _cnpj(digits);
    return TextEditingValue(
      text: formatado,
      selection: TextSelection.collapsed(offset: formatado.length),
    );
  }

  String _cpf(String d) {
    if (d.length <= 3) return d;
    if (d.length <= 6) return '${d.substring(0, 3)}.${d.substring(3)}';
    if (d.length <= 9) {
      return '${d.substring(0, 3)}.${d.substring(3, 6)}.${d.substring(6)}';
    }
    return '${d.substring(0, 3)}.${d.substring(3, 6)}.${d.substring(6, 9)}'
        '-${d.substring(9)}';
  }

  String _cnpj(String d) {
    if (d.length <= 2) return d;
    if (d.length <= 5) return '${d.substring(0, 2)}.${d.substring(2)}';
    if (d.length <= 8) {
      return '${d.substring(0, 2)}.${d.substring(2, 5)}.${d.substring(5)}';
    }
    if (d.length <= 12) {
      return '${d.substring(0, 2)}.${d.substring(2, 5)}.${d.substring(5, 8)}'
          '/${d.substring(8)}';
    }
    return '${d.substring(0, 2)}.${d.substring(2, 5)}.${d.substring(5, 8)}'
        '/${d.substring(8, 12)}-${d.substring(12)}';
  }
}

/// Máscara de CEP: `50030230` → `50030-230`.
class PostalCodeInputFormatter extends TextInputFormatter {
  const PostalCodeInputFormatter();

  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    final todos = newValue.text.replaceAll(RegExp(r'\D'), '');
    final digits = todos.length > 8 ? todos.substring(0, 8) : todos;
    final formatado = digits.length <= 5
        ? digits
        : '${digits.substring(0, 5)}-${digits.substring(5)}';
    return TextEditingValue(
      text: formatado,
      selection: TextSelection.collapsed(offset: formatado.length),
    );
  }
}
