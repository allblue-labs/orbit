import 'dart:math';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:timezone/timezone.dart' as tz;

import '../../../core/design/orbit_primitives.dart';
import '../../../core/design/orbit_wizard.dart';
import '../../../core/errors/orbit_exception.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../../core/time/orbit_timezone.dart';
import '../data/owner_repository.dart';
import 'owner_style.dart';

const ownerPadding = EdgeInsets.all(OrbitSpacing.gutter);

String ownerText(
  OwnerRow row, [
  List<String> keys = const [
    'title',
    'tradeName',
    'name',
    'legalName',
    'displayName',
    'label',
    'description',
    'code',
  ],
]) {
  for (final key in keys) {
    final value = row[key];
    if (value is String && value.trim().isNotEmpty) return value.trim();
  }
  return '';
}

String ownerId(OwnerRow row) => (row['id'] ?? row['userId']) as String? ?? '';
String? ownerString(OwnerRow row, String key) => row[key]?.toString();
String? present(String? value) =>
    value == null || value.trim().isEmpty ? null : value.trim();

String ownerCode(String prefix) {
  final suffix = Random.secure().nextInt(1 << 24).toRadixString(36);
  return '$prefix-${DateTime.now().millisecondsSinceEpoch.toRadixString(36)}-$suffix'
      .toUpperCase();
}

String ownerDate(DateTime value) => DateFormat('yyyy-MM-dd').format(value);
String ownerTime(DateTime value) => DateFormat('HH:mm').format(value);

String ownerDateLabel(String? value) {
  final date = DateTime.tryParse(value ?? '');
  return date == null ? '' : DateFormat('dd/MM/yyyy').format(date);
}

String ownerInstant(OrbitTimezone zone, String? value) {
  final date = DateTime.tryParse(value ?? '');
  return date == null
      ? ''
      : DateFormat('dd/MM/yyyy • HH:mm').format(zone.at(date));
}

String ownerStatus(Object? status) => switch (status) {
  'OPEN' => 'Em aberto',
  'SCHEDULED' => 'Agendado',
  'IN_PROGRESS' => 'Em andamento',
  'PAUSED' => 'Pausado',
  'COMPLETED' => 'Concluído',
  'CANCELLED' => 'Cancelado',
  'ACTIVE' => 'Ativo',
  'INACTIVE' => 'Inativo',
  'DRAFT' => 'Rascunho',
  'SUSPENDED' => 'Suspenso',
  'PENDING' => 'Pendente',
  'CONFIRMED' => 'Confirmado',
  'NOT_STARTED' => 'A iniciar',
  'BLOCKED' => 'Bloqueado',
  'PROSPECT' => 'Prospecto',
  _ => '',
};

String ownerError(Object error) => switch (error) {
  OrbitException() => error.publicMessage,
  OwnerInputError() => error.message,
  _ => 'Não foi possível concluir a solicitação. Tente novamente.',
};

class OwnerInputError implements Exception {
  const OwnerInputError(this.message);
  final String message;
}

/// Pedir confirmação. Ação que apaga, cancela ou suspende vem em vermelho.
Future<bool> ownerConfirm(
  BuildContext context,
  String title,
  String message, {
  String label = 'Confirmar',
}) async =>
    await showDialog<bool>(
      context: context,
      builder: (context) {
        final palette = context.orbit;
        final danger = ownerDestructive(label);
        return AlertDialog(
          icon: Icon(
            danger ? Icons.warning_amber_rounded : Icons.help_outline_rounded,
            color: danger ? palette.danger : palette.accent,
          ),
          title: Text(title, textAlign: TextAlign.center),
          content: Text(message, textAlign: TextAlign.center),
          actions: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                FilledButton(
                  style: danger
                      ? FilledButton.styleFrom(
                          backgroundColor: palette.danger,
                          foregroundColor: Colors.white,
                        )
                      : null,
                  onPressed: () => Navigator.pop(context, true),
                  child: Text(label),
                ),
                const SizedBox(height: OrbitSpacing.xs),
                TextButton(
                  onPressed: () => Navigator.pop(context, false),
                  child: const Text('Voltar'),
                ),
              ],
            ),
          ],
        );
      },
    ) ??
    false;

/// A ação desfaz, apaga ou tira acesso? Vai para o grupo vermelho.
bool ownerDestructive(String label) => RegExp(
  r'^(Remover|Cancelar|Excluir|Desligar|Suspender|Retirar|Bloquear|Desativar)',
).hasMatch(label);

class OwnerFormField {
  const OwnerFormField(
    this.key,
    this.label, {
    this.initial,
    this.required = false,
    this.maxLength = 220,
    this.lines = 1,
    this.keyboard,
    this.numeric = false,
    this.choices,
    this.pick,
    this.select,
    this.many = false,
    this.date = false,
    this.time = false,
    this.toggle = false,
  });

  final String key;
  final String label;
  final Object? initial;
  final bool required;
  final int maxLength;
  final int lines;
  final TextInputType? keyboard;
  final bool numeric;
  final Map<String, String>? choices;
  final Future<List<OwnerRow>> Function(String search)? pick;
  final Future<({OwnerRow? value})?> Function(BuildContext)? select;
  final bool many;
  final bool date;
  final bool time;
  final bool toggle;
}

Future<bool> ownerForm(
  BuildContext context, {
  required String title,
  required List<OwnerFormField> fields,
  required Future<void> Function(OwnerRow values, BuildContext sheet) save,
  String action = 'Salvar',
  OrbitTimezone? zone,
  Map<String, String> sections = const {},
}) async =>
    await showModalBottomSheet<bool>(
      context: context,
      useSafeArea: true,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _OwnerFormSheet(
        title: title,
        fields: fields,
        sections: sections,
        save: save,
        action: action,
        zone: zone ?? OrbitTimezone.resolve(),
      ),
    ) ??
    false;

class _OwnerFormSheet extends StatefulWidget {
  const _OwnerFormSheet({
    required this.title,
    required this.fields,
    required this.sections,
    required this.save,
    required this.action,
    required this.zone,
  });

  final String title;
  final List<OwnerFormField> fields;
  final Map<String, String> sections;
  final Future<void> Function(OwnerRow, BuildContext) save;
  final String action;
  final OrbitTimezone zone;

  @override
  State<_OwnerFormSheet> createState() => _OwnerFormSheetState();
}

class _OwnerFormSheetState extends State<_OwnerFormSheet> {
  final _scroll = ScrollController();
  late final _steps = _groupFields();
  late final _forms = List.generate(
    _steps.length,
    (_) => GlobalKey<FormState>(),
  );

  List<({String title, List<OwnerFormField> fields})> _groupFields() {
    final steps = <({String title, List<OwnerFormField> fields})>[];
    for (final field in widget.fields) {
      final section = widget.sections[field.key];
      if (steps.isEmpty || section != null) {
        steps.add((title: section ?? widget.title, fields: []));
      }
      steps.last.fields.add(field);
    }
    return steps;
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  late final _values = <String, dynamic>{
    for (final field in widget.fields) field.key: field.initial,
  };
  bool _saving = false;
  String? _error;

  Future<void> _submit() async {
    if (_saving) return;
    for (final form in _forms) {
      final state = form.currentState;
      if (state == null || !state.validate()) return;
      state.save();
    }
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await widget.save(Map.unmodifiable(_values), context);
      if (mounted) {
        setState(() => _saving = false);
        Navigator.pop(context, true);
      }
    } on OwnerFormCancelled {
      if (mounted) setState(() => _saving = false);
    } catch (error) {
      if (mounted) {
        setState(() {
          _saving = false;
          _error = ownerError(error);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !_saving,
    child: SafeArea(
      top: false,
      child: AnimatedPadding(
        duration: const Duration(milliseconds: 180),
        padding: EdgeInsets.only(
          bottom: MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: SingleChildScrollView(
          controller: _scroll,
          padding: ownerPadding,
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                widget.title,
                style: OrbitType.sectionTitle.copyWith(
                  color: context.orbit.ink,
                ),
              ),
              if (_steps.length == 1)
                Padding(
                  padding: const EdgeInsets.only(top: OrbitSpacing.xs),
                  child: Text(
                    widget.fields.any((field) => field.required)
                        ? 'Campos com * são obrigatórios.'
                        : 'Preencha o que souber — nada aqui é obrigatório.',
                    style: OrbitType.caption.copyWith(
                      color: context.orbit.inkMuted,
                    ),
                  ),
                ),
              const SizedBox(height: OrbitSpacing.lg),
              if (_steps.length == 1) ...[
                _inputs(0),
                if (_error case final message?) _errorLabel(message),
                FilledButton(
                  onPressed: _saving ? null : _submit,
                  child: _saving
                      ? const SizedBox.square(
                          dimension: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Text(widget.action),
                ),
              ] else
                OrbitWizard(
                  preserveStepState: true,
                  onBeforeStepChanged: (current, next) async {
                    if (_saving || next > current + 1) return false;
                    final form = _forms[current].currentState;
                    if (next > current && form?.validate() != true) {
                      return false;
                    }
                    form?.save();
                    if (_error != null) setState(() => _error = null);
                    return true;
                  },
                  onStepChanged: (_) {
                    if (_scroll.hasClients) _scroll.jumpTo(0);
                  },
                  footer: _error == null ? null : _errorLabel(_error!),
                  steps: [
                    for (var index = 0; index < _steps.length; index++)
                      OrbitWizardStep(
                        title: _steps[index].title,
                        child: _inputs(index),
                        forward: index == _steps.length - 1
                            ? OrbitWizardForward(
                                label: widget.action,
                                onPressed: _submit,
                                pending: _saving,
                              )
                            : null,
                      ),
                  ],
                ),
            ],
          ),
        ),
      ),
    ),
  );

  Widget _inputs(int index) => Form(
    key: _forms[index],
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final field in _steps[index].fields)
          Padding(
            key: ValueKey(field.key),
            padding: const EdgeInsets.only(bottom: OrbitSpacing.md),
            child: _input(field),
          ),
      ],
    ),
  );

  Widget _errorLabel(String message) => Padding(
    padding: const EdgeInsets.only(bottom: OrbitSpacing.md),
    child: OwnerNote(
      icon: Icons.error_outline,
      tone: OrbitTone.danger,
      text: message,
    ),
  );

  Widget _input(OwnerFormField field) {
    final label = field.required ? '${field.label} *' : field.label;
    final value = _values[field.key];
    final decoration = InputDecoration(labelText: label);
    if (field.toggle) {
      final palette = context.orbit;
      return DecoratedBox(
        decoration: BoxDecoration(
          color: palette.surface,
          borderRadius: OrbitRadius.field,
          border: Border.all(color: palette.border),
        ),
        child: SwitchListTile.adaptive(
          contentPadding: const EdgeInsets.symmetric(
            horizontal: OrbitSpacing.ms,
          ),
          shape: const RoundedRectangleBorder(borderRadius: OrbitRadius.field),
          title: Text(
            label,
            style: OrbitType.body.copyWith(color: palette.ink),
          ),
          value: value == true,
          onChanged: _saving
              ? null
              : (value) => setState(() => _values[field.key] = value),
        ),
      );
    }
    if (field.choices case final choices?) {
      return DropdownButtonFormField<String>(
        initialValue: choices.containsKey(value) ? value as String : null,
        isExpanded: true,
        decoration: decoration,
        validator: (value) =>
            field.required && value == null ? 'Selecione uma opção.' : null,
        items: choices.entries
            .map(
              (item) =>
                  DropdownMenuItem(value: item.key, child: Text(item.value)),
            )
            .toList(),
        onChanged: _saving ? null : (value) => _values[field.key] = value,
      );
    }
    if (field.pick != null ||
        field.select != null ||
        field.date ||
        field.time) {
      final caption = value is DateTime
          ? field.time
                ? '${DateFormat('dd/MM/yyyy').format(value)} às ${ownerTime(value)}'
                : DateFormat('dd/MM/yyyy').format(value)
          : value is OwnerRow
          ? ownerText(value)
          : value is List<OwnerRow> && value.isNotEmpty
          ? '${value.length} selecionado(s)'
          : '';
      return FormField<Object>(
        validator: (_) =>
            field.required &&
                (value == null || (value is List && value.isEmpty))
            ? 'Selecione ${field.label.toLowerCase()}.'
            : null,
        builder: (state) => InkWell(
          onTap: _saving ? null : () => _choose(field),
          child: InputDecorator(
            decoration: decoration.copyWith(
              errorText: state.errorText,
              suffixIcon: Icon(
                field.date || field.time
                    ? Icons.event_outlined
                    : Icons.expand_more,
              ),
            ),
            child: Text(caption.isEmpty ? 'Selecionar' : caption),
          ),
        ),
      );
    }
    return TextFormField(
      initialValue: value?.toString(),
      enabled: !_saving,
      /* O contador só ajuda em texto longo; num nome, é ruído. */
      decoration: field.lines > 1
          ? decoration
          : decoration.copyWith(counterText: ''),
      minLines: 1,
      maxLines: field.lines,
      maxLength: field.maxLength,
      keyboardType: field.numeric
          ? const TextInputType.numberWithOptions(decimal: true)
          : field.keyboard,
      validator: (input) {
        final text = present(input);
        if (field.required && text == null) {
          return 'Preencha ${field.label.toLowerCase()}.';
        }
        if (field.numeric &&
            text != null &&
            !RegExp(r'^\d{1,13}([,.]\d{1,2})?$').hasMatch(text)) {
          return 'Informe um número com até duas casas decimais.';
        }
        return null;
      },
      onSaved: (input) => _values[field.key] = present(input),
    );
  }

  Future<void> _choose(OwnerFormField field) async {
    if (field.select case final select?) {
      final result = await select(context);
      if (mounted && result != null) {
        setState(() => _values[field.key] = result.value);
      }
      return;
    }
    if (field.pick case final load?) {
      final result = await ownerPick(
        context,
        title: field.label,
        load: load,
        many: field.many,
        selected: ownerRows(_values[field.key]),
        allowClear: !field.required,
      );
      if (mounted && result != null) {
        setState(
          () => _values[field.key] = field.many ? result : result.firstOrNull,
        );
      }
      return;
    }

    final current =
        _values[field.key] as DateTime? ?? widget.zone.at(DateTime.now());
    final day = await showDatePicker(
      context: context,
      initialDate: current,
      firstDate: DateTime(1900),
      lastDate: DateTime(2200),
    );
    if (!mounted || day == null) return;
    if (!field.time) {
      setState(() => _values[field.key] = day);
      return;
    }
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(current),
    );
    if (!mounted || time == null) return;
    setState(
      () => _values[field.key] = tz.TZDateTime(
        widget.zone.location,
        day.year,
        day.month,
        day.day,
        time.hour,
        time.minute,
      ),
    );
  }
}

class OwnerFormCancelled implements Exception {
  const OwnerFormCancelled();
}

Future<List<OwnerRow>?> ownerPick(
  BuildContext context, {
  required String title,
  required Future<List<OwnerRow>> Function(String search) load,
  bool many = false,
  bool allowClear = false,
  List<OwnerRow> selected = const [],
}) => showModalBottomSheet<List<OwnerRow>>(
  context: context,
  useSafeArea: true,
  isScrollControlled: true,
  showDragHandle: true,
  builder: (_) => _OwnerPicker(
    title: title,
    load: load,
    many: many,
    selected: selected,
    allowClear: allowClear,
  ),
);

class _OwnerPicker extends StatefulWidget {
  const _OwnerPicker({
    required this.title,
    required this.load,
    required this.many,
    required this.selected,
    required this.allowClear,
  });
  final String title;
  final Future<List<OwnerRow>> Function(String search) load;
  final bool many;
  final bool allowClear;
  final List<OwnerRow> selected;

  @override
  State<_OwnerPicker> createState() => _OwnerPickerState();
}

class _OwnerPickerState extends State<_OwnerPicker> {
  late final _selected = {for (final row in widget.selected) ownerId(row): row};
  final _search = TextEditingController();
  late Future<List<OwnerRow>> _options = widget.load('');

  void _find() => setState(() => _options = widget.load(_search.text.trim()));

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final chosen = {for (final row in widget.selected) ownerId(row)};
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * .62,
        child: SafeArea(
          top: false,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  OrbitSpacing.gutter,
                  0,
                  OrbitSpacing.gutter,
                  OrbitSpacing.sm,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      widget.title,
                      style: OrbitType.sectionTitle.copyWith(
                        color: palette.ink,
                      ),
                    ),
                    if (widget.many)
                      Text(
                        'Marque um ou mais.',
                        style: OrbitType.caption.copyWith(
                          color: palette.inkMuted,
                        ),
                      ),
                    const SizedBox(height: OrbitSpacing.ms),
                    TextField(
                      controller: _search,
                      textInputAction: TextInputAction.search,
                      onSubmitted: (_) => _find(),
                      decoration: InputDecoration(
                        hintText: 'Buscar',
                        prefixIcon: const Icon(Icons.search_rounded),
                        suffixIcon: IconButton(
                          onPressed: _find,
                          icon: const Icon(Icons.arrow_forward_rounded),
                          tooltip: 'Buscar',
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: FutureBuilder(
                  future: _options,
                  builder: (context, snapshot) {
                    if (snapshot.connectionState != ConnectionState.done) {
                      return const Center(child: CircularProgressIndicator());
                    }
                    if (snapshot.hasError) {
                      return SingleChildScrollView(
                        child: OrbitEmptyState(
                          icon: Icons.cloud_off_outlined,
                          title: ownerError(snapshot.error!),
                          action: OutlinedButton(
                            onPressed: _find,
                            child: const Text('Tentar novamente'),
                          ),
                        ),
                      );
                    }
                    final rows = snapshot.data ?? const [];
                    if (rows.isEmpty) {
                      return const SingleChildScrollView(
                        child: OrbitEmptyState(
                          icon: Icons.search_off_rounded,
                          title: 'Nenhum resultado',
                          description: 'Tente outra busca.',
                        ),
                      );
                    }
                    return ListView.separated(
                      keyboardDismissBehavior:
                          ScrollViewKeyboardDismissBehavior.onDrag,
                      padding: const EdgeInsets.symmetric(
                        horizontal: OrbitSpacing.sm,
                      ),
                      itemCount: rows.length,
                      separatorBuilder: (_, _) => Divider(
                        height: 1,
                        indent: OrbitSpacing.ml + 40,
                        color: palette.border,
                      ),
                      itemBuilder: (context, index) {
                        final row = rows[index];
                        final id = ownerId(row);
                        final name = ownerText(row);
                        final avatar = _Initials(name);
                        if (widget.many) {
                          return CheckboxListTile(
                            secondary: avatar,
                            title: Text(name),
                            value: _selected.containsKey(id),
                            onChanged: (value) => setState(() {
                              if (value == true) {
                                _selected[id] = row;
                              } else {
                                _selected.remove(id);
                              }
                            }),
                          );
                        }
                        final current = chosen.contains(id);
                        return ListTile(
                          leading: avatar,
                          title: Text(name),
                          trailing: current
                              ? Icon(
                                  Icons.check_circle_rounded,
                                  color: palette.accent,
                                )
                              : null,
                          onTap: () => Navigator.pop(context, [row]),
                        );
                      },
                    );
                  },
                ),
              ),
              if (widget.many || widget.allowClear)
                DecoratedBox(
                  decoration: BoxDecoration(
                    border: Border(top: BorderSide(color: palette.border)),
                  ),
                  child: Padding(
                    padding: ownerPadding,
                    child: Row(
                      children: [
                        if (widget.allowClear)
                          Expanded(
                            child: OutlinedButton(
                              onPressed: () =>
                                  Navigator.pop(context, <OwnerRow>[]),
                              child: const Text('Limpar'),
                            ),
                          ),
                        if (widget.allowClear && widget.many)
                          const SizedBox(width: OrbitSpacing.sm),
                        if (widget.many)
                          Expanded(
                            child: FilledButton(
                              onPressed: () => Navigator.pop(
                                context,
                                _selected.values.toList(),
                              ),
                              child: Text('Selecionar (${_selected.length})'),
                            ),
                          ),
                      ],
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

/// As iniciais num círculo — reconhecer a pessoa ou o cliente de relance.
class _Initials extends StatelessWidget {
  const _Initials(this.name);

  final String name;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final partes = name
        .split(RegExp(r'\s+'))
        .where((parte) => parte.isNotEmpty)
        .toList();
    final iniciais = partes.isEmpty
        ? '?'
        : (partes.first[0] + (partes.length > 1 ? partes.last[0] : ''))
              .toUpperCase();
    return CircleAvatar(
      radius: 20,
      backgroundColor: palette.accentSoft,
      child: Text(
        iniciais,
        style: OrbitType.label.copyWith(color: palette.accentStrong),
      ),
    );
  }
}

class OwnerAction {
  const OwnerAction(
    this.label,
    this.icon,
    this.run, {
    this.description,
    bool? destructive,
  }) : _destructive = destructive;
  final String label;
  final IconData icon;
  final Future<bool> Function() run;

  /// Uma linha a mais embaixo do rótulo, quando ele não basta.
  final String? description;
  final bool? _destructive;

  /// Ações que apagam, cancelam ou tiram acesso ficam num grupo à parte.
  bool get destructive => _destructive ?? ownerDestructive(label);
}

/// A ficha de um registro: cabeçalho, os dados e o que dá para fazer.
///
/// [facts] traz os dados rotulados ("Telefone", "Técnico"); [details] é o
/// texto livre de antes e continua valendo onde não há rótulo. As ações do dia
/// a dia vêm primeiro; as que apagam ou cancelam, separadas e em vermelho.
Future<bool> ownerActions(
  BuildContext context,
  String title,
  List<OwnerAction> actions, {
  String? details,
  List<(String, String?)> facts = const [],
  IconData icon = Icons.article_outlined,
  OrbitTone tone = OrbitTone.info,
  String? eyebrow,
  String? subtitle,
  OwnerBadgeData? badge,
}) async {
  final common = actions.where((action) => !action.destructive).toList();
  final danger = actions.where((action) => action.destructive).toList();
  final selected = await showModalBottomSheet<OwnerAction>(
    context: context,
    useSafeArea: true,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (sheet) {
      final palette = sheet.orbit;
      final dados = OwnerFactsCard.visible(facts);
      final texto = present(details);
      return SafeArea(
        top: false,
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(
            OrbitSpacing.gutter,
            0,
            OrbitSpacing.gutter,
            OrbitSpacing.lg,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              OwnerSheetHeader(
                icon: icon,
                tone: tone,
                eyebrow: eyebrow,
                title: title,
                subtitle: subtitle,
                badge: badge,
              ),
              if (dados.isNotEmpty) ...[
                const SizedBox(height: OrbitSpacing.lg),
                OwnerFactsCard(facts: facts),
              ],
              if (texto != null) ...[
                const SizedBox(height: OrbitSpacing.md),
                Container(
                  padding: const EdgeInsets.all(OrbitSpacing.md),
                  decoration: BoxDecoration(
                    color: palette.surfaceMuted,
                    borderRadius: OrbitRadius.card,
                  ),
                  child: Text(
                    texto,
                    style: OrbitType.body.copyWith(color: palette.inkMuted),
                  ),
                ),
              ],
              if (common.isNotEmpty) ...[
                const SizedBox(height: OrbitSpacing.lg),
                if (dados.isNotEmpty || texto != null)
                  const OwnerGroupLabel('Ações'),
                OwnerTileGroup(
                  children: [
                    for (final action in common)
                      OwnerTile(
                        icon: action.icon,
                        label: action.label,
                        description: action.description,
                        onTap: () => Navigator.pop(sheet, action),
                      ),
                  ],
                ),
              ],
              if (danger.isNotEmpty) ...[
                const SizedBox(height: OrbitSpacing.md),
                OwnerTileGroup(
                  children: [
                    for (final action in danger)
                      OwnerTile(
                        icon: action.icon,
                        label: action.label,
                        description: action.description,
                        danger: true,
                        onTap: () => Navigator.pop(sheet, action),
                      ),
                  ],
                ),
              ],
              if (actions.isEmpty) ...[
                const SizedBox(height: OrbitSpacing.lg),
                const OwnerNote(
                  icon: Icons.lock_outline,
                  text: 'Nenhuma ação disponível para o seu perfil aqui.',
                ),
              ],
            ],
          ),
        ),
      );
    },
  );
  if (!context.mounted || selected == null) return false;
  try {
    return await selected.run();
  } catch (error) {
    if (context.mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(ownerError(error))));
    }
    return false;
  }
}
