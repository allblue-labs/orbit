import 'dart:math';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:timezone/timezone.dart' as tz;

import '../../../core/design/orbit_wizard.dart';
import '../../../core/errors/orbit_exception.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../../core/time/orbit_timezone.dart';
import '../data/owner_repository.dart';

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

Future<bool> ownerConfirm(
  BuildContext context,
  String title,
  String message, {
  String label = 'Confirmar',
}) async =>
    await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Voltar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(label),
          ),
        ],
      ),
    ) ??
    false;

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
                style: Theme.of(context).textTheme.headlineSmall,
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
    child: Text(message, style: TextStyle(color: context.orbit.danger)),
  );

  Widget _input(OwnerFormField field) {
    final label = field.required ? '${field.label} *' : field.label;
    final value = _values[field.key];
    final decoration = InputDecoration(labelText: label);
    if (field.toggle) {
      return SwitchListTile.adaptive(
        contentPadding: EdgeInsets.zero,
        title: Text(label),
        value: value == true,
        onChanged: _saving
            ? null
            : (value) => setState(() => _values[field.key] = value),
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
    if (field.pick != null || field.date || field.time) {
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
                field.pick == null ? Icons.event_outlined : Icons.expand_more,
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
      decoration: decoration,
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
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
    child: SizedBox(
      height: MediaQuery.sizeOf(context).height * .57,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: ownerPadding,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(widget.title, style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: OrbitSpacing.sm),
              TextField(
                controller: _search,
                textInputAction: TextInputAction.search,
                onSubmitted: (_) => _find(),
                decoration: InputDecoration(
                  labelText: 'Buscar',
                  suffixIcon: IconButton(
                    onPressed: _find,
                    icon: const Icon(Icons.search),
                    tooltip: 'Buscar',
                  ),
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
                      return Center(
                        child: TextButton(
                          onPressed: _find,
                          child: Text(
                            '${ownerError(snapshot.error!)} Tentar novamente',
                          ),
                        ),
                      );
                    }
                    final rows = snapshot.data ?? const [];
                    if (rows.isEmpty) {
                      return const Center(child: Text('Nenhum resultado.'));
                    }
                    return ListView.builder(
                      keyboardDismissBehavior:
                          ScrollViewKeyboardDismissBehavior.onDrag,
                      itemCount: rows.length,
                      itemBuilder: (context, index) {
                        final row = rows[index];
                        final id = ownerId(row);
                        final name = Text(ownerText(row));
                        return widget.many
                            ? CheckboxListTile(
                                title: name,
                                value: _selected.containsKey(id),
                                onChanged: (value) => setState(() {
                                  if (value == true) {
                                    _selected[id] = row;
                                  } else {
                                    _selected.remove(id);
                                  }
                                }),
                              )
                            : ListTile(
                                title: name,
                                onTap: () => Navigator.pop(context, [row]),
                              );
                      },
                    );
                  },
                ),
              ),
              if (widget.many || widget.allowClear)
                Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    if (widget.allowClear)
                      TextButton(
                        onPressed: () => Navigator.pop(context, <OwnerRow>[]),
                        child: const Text('Limpar'),
                      ),
                    if (widget.many)
                      FilledButton(
                        onPressed: () =>
                            Navigator.pop(context, _selected.values.toList()),
                        child: Text('Selecionar (${_selected.length})'),
                      ),
                  ],
                ),
            ],
          ),
        ),
      ),
    ),
  );
}

class OwnerAction {
  const OwnerAction(this.label, this.icon, this.run);
  final String label;
  final IconData icon;
  final Future<bool> Function() run;
}

Future<bool> ownerActions(
  BuildContext context,
  String title,
  List<OwnerAction> actions, {
  String? details,
}) async {
  final selected = await showModalBottomSheet<OwnerAction>(
    context: context,
    useSafeArea: true,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (sheet) => SafeArea(
      top: false,
      child: SingleChildScrollView(
        padding: ownerPadding,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(title, style: Theme.of(sheet).textTheme.titleLarge),
            if (present(details) case final description?)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: OrbitSpacing.sm),
                child: Text(description),
              ),
            for (final action in actions)
              ListTile(
                title: Text(action.label),
                leading: Icon(action.icon),
                onTap: () => Navigator.pop(sheet, action),
              ),
          ],
        ),
      ),
    ),
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
