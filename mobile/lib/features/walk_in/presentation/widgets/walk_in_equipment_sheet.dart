/// Acrescentar um equipamento identificado na hora.
///
/// ## Por que uma folha, e não campos empilhados na etapa
///
/// Porque o número de aparelhos é desconhecido: um endereço pode ter um split
/// ou catorze. Formulários empilhados na etapa fariam a rolagem crescer até o
/// técnico perder de vista onde estava — e os controladores de texto de catorze
/// formulários viveriam na tela inteira, não no que está sendo preenchido.
///
/// Cada aparelho entra, aparece como linha na etapa, e a folha fecha.
library;

import 'package:flutter/material.dart';

import '../../../../core/theme/orbit_theme.dart';
import '../../data/walk_in_draft.dart';
import 'walk_in_fields.dart';

/// Devolve o equipamento preenchido, ou `null` se a pessoa desistiu.
Future<WalkInEquipmentDraft?> showWalkInEquipmentSheet(BuildContext context) =>
    showModalBottomSheet<WalkInEquipmentDraft>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: context.orbit.background,
      builder: (context) => Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: const _Folha(),
      ),
    );

class _Folha extends StatefulWidget {
  const _Folha();

  @override
  State<_Folha> createState() => _FolhaState();
}

class _TechnicalField {
  final name = TextEditingController();
  final value = TextEditingController();
  void dispose() {
    name.dispose();
    value.dispose();
  }
}

class _FolhaState extends State<_Folha> {
  final _nome = TextEditingController();
  final _marca = TextEditingController();
  final _modelo = TextEditingController();
  final _serie = TextEditingController();
  final _local = TextEditingController();
  final _identificador = TextEditingController();
  final _instalacao = TextEditingController();
  final _garantia = TextEditingController();
  final _specifications = <_TechnicalField>[];
  String _categoria = 'EQUIPMENT';
  String _tipoIdentificador = 'INTERNAL_CODE';
  DateTime? _dataInstalacao;
  DateTime? _dataGarantia;

  static const _categorias = {
    'EQUIPMENT': 'Equipamento',
    'TOOL': 'Ferramenta',
    'VEHICLE': 'Veículo',
    'FACILITY': 'Instalação',
    'OTHER': 'Outro',
  };
  static const _identificadores = {
    'INTERNAL_CODE': 'Código interno',
    'SERIAL_NUMBER': 'Número de série',
    'QR_CODE': 'QR Code',
    'BARCODE': 'Código de barras',
    'NFC': 'NFC',
    'RFID': 'RFID',
    'CUSTOM': 'Outro',
  };

  @override
  void dispose() {
    for (final controller in [
      _nome,
      _marca,
      _modelo,
      _serie,
      _local,
      _identificador,
      _instalacao,
      _garantia,
    ]) {
      controller.dispose();
    }
    for (final row in _specifications) {
      row.dispose();
    }
    super.dispose();
  }

  bool get _specsValid {
    final names = <String>{};
    for (final row in _specifications) {
      final name = row.name.text.trim(), value = row.value.text.trim();
      if (name.isEmpty && value.isEmpty) continue;
      if (name.isEmpty || value.isEmpty || !names.add(name.toLowerCase())) {
        return false;
      }
    }
    return true;
  }

  bool get _valido => _nome.text.trim().isNotEmpty && _specsValid;

  Future<void> _date(bool installation) async {
    final date = await showDatePicker(
      context: context,
      initialDate:
          (installation ? _dataInstalacao : _dataGarantia) ?? DateTime.now(),
      firstDate: DateTime(1970),
      lastDate: DateTime(2100),
      helpText: installation ? 'Data da instalação' : 'Garantia até',
      cancelText: 'Cancelar',
      confirmText: 'Confirmar',
      fieldLabelText: 'Data',
      fieldHintText: 'Selecione uma data',
      errorFormatText: 'Informe uma data válida.',
      errorInvalidText: 'Escolha uma data entre 1970 e 2100.',
    );
    if (date == null || !mounted) return;
    setState(() {
      final text =
          '${date.day.toString().padLeft(2, '0')}/${date.month.toString().padLeft(2, '0')}/${date.year}';
      if (installation) {
        _dataInstalacao = date;
        _instalacao.text = text;
      } else {
        _dataGarantia = date;
        _garantia.text = text;
      }
    });
  }

  Widget _dateField(
    String label,
    TextEditingController controller,
    bool installation,
  ) => WalkInField(
    label: label,
    controller: controller,
    readOnly: true,
    hint: 'Opcional',
    onTap: () => _date(installation),
    suffix: controller.text.isEmpty
        ? const Icon(Icons.calendar_today_outlined, size: 18)
        : IconButton(
            tooltip: 'Limpar $label',
            icon: const Icon(Icons.close, size: 18),
            onPressed: () => setState(() {
              controller.clear();
              if (installation) {
                _dataInstalacao = null;
              } else {
                _dataGarantia = null;
              }
            }),
          ),
  );

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return SingleChildScrollView(
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      padding: const EdgeInsets.fromLTRB(
        OrbitSpacing.gutter,
        0,
        OrbitSpacing.gutter,
        OrbitSpacing.md,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Equipamento',
            style: OrbitType.sectionTitle.copyWith(color: palette.ink),
          ),
          const SizedBox(height: OrbitSpacing.xs),
          Text(
            'Somente o nome é obrigatório. As outras informações podem ser preenchidas depois.',
            style: OrbitType.caption.copyWith(color: palette.inkSubtle),
          ),
          const SizedBox(height: OrbitSpacing.ms),
          WalkInField(
            label: 'Nome do equipamento',
            controller: _nome,
            maxLength: 180,
            hint: 'Split do quarto, central da recepção',
            onChanged: (_) => setState(() {}),
          ),
          DropdownButtonFormField<String>(
            initialValue: _categoria,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Categoria'),
            items: [
              for (final entry in _categorias.entries)
                DropdownMenuItem(value: entry.key, child: Text(entry.value)),
            ],
            onChanged: (value) =>
                setState(() => _categoria = value ?? 'EQUIPMENT'),
          ),
          const SizedBox(height: OrbitSpacing.ms),
          WalkInField(
            label: 'Onde fica',
            controller: _local,
            maxLength: 255,
            hint: 'Sala 2, cobertura, recepção',
          ),
          WalkInField(label: 'Marca', controller: _marca, maxLength: 120),
          WalkInField(label: 'Modelo', controller: _modelo, maxLength: 120),
          WalkInField(
            label: 'Número de série',
            controller: _serie,
            maxLength: 120,
            textCapitalization: TextCapitalization.characters,
          ),
          ExpansionTile(
            tilePadding: EdgeInsets.zero,
            title: const Text('Identificação e detalhes técnicos'),
            subtitle: const Text('Informações opcionais'),
            children: [
              DropdownButtonFormField<String>(
                initialValue: _tipoIdentificador,
                isExpanded: true,
                decoration: const InputDecoration(
                  labelText: 'Tipo de identificação',
                ),
                items: [
                  for (final entry in _identificadores.entries)
                    DropdownMenuItem(
                      value: entry.key,
                      child: Text(entry.value),
                    ),
                ],
                onChanged: (value) => setState(
                  () => _tipoIdentificador = value ?? 'INTERNAL_CODE',
                ),
              ),
              const SizedBox(height: OrbitSpacing.ms),
              WalkInField(
                label: 'Identificador / etiqueta',
                controller: _identificador,
                maxLength: 180,
              ),
              Row(
                children: [
                  Expanded(child: _dateField('Instalação', _instalacao, true)),
                  const SizedBox(width: OrbitSpacing.sm),
                  Expanded(child: _dateField('Garantia até', _garantia, false)),
                ],
              ),
              for (final row in _specifications)
                Padding(
                  key: ObjectKey(row),
                  padding: const EdgeInsets.only(bottom: OrbitSpacing.sm),
                  child: Column(
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: TextField(
                              controller: row.name,
                              maxLength: 80,
                              decoration: const InputDecoration(
                                labelText: 'Informação técnica',
                                hintText: 'Capacidade, tensão, fluido…',
                              ),
                              onChanged: (_) => setState(() {}),
                            ),
                          ),
                          IconButton(
                            tooltip: 'Remover informação técnica',
                            icon: const Icon(Icons.delete_outline),
                            onPressed: () {
                              setState(() => _specifications.remove(row));
                              row.dispose();
                            },
                          ),
                        ],
                      ),
                      TextField(
                        controller: row.value,
                        maxLength: 255,
                        decoration: const InputDecoration(
                          labelText: 'Valor',
                          hintText: '12.000 BTU/h, 220 V…',
                        ),
                        onChanged: (_) => setState(() {}),
                      ),
                    ],
                  ),
                ),
              if (!_specsValid)
                Text(
                  'Preencha o nome e o valor de cada informação, sem repetir os nomes.',
                  style: OrbitType.caption.copyWith(color: palette.warning),
                ),
              TextButton.icon(
                onPressed: () =>
                    setState(() => _specifications.add(_TechnicalField())),
                icon: const Icon(Icons.add),
                label: const Text('Adicionar informação técnica'),
              ),
            ],
          ),
          const SizedBox(height: OrbitSpacing.sm),
          FilledButton(
            onPressed: _valido
                ? () => Navigator.of(context).pop(
                    WalkInEquipmentDraft(
                      name: _nome.text,
                      category: _categoria,
                      manufacturer: _marca.text,
                      model: _modelo.text,
                      serialNumber: _serie.text,
                      location: _local.text,
                      identifier: _identificador.text,
                      identifierType: _tipoIdentificador,
                      installationAt: _dataInstalacao,
                      warrantyUntil: _dataGarantia,
                      specifications: {
                        for (final row in _specifications)
                          if (row.name.text.trim().isNotEmpty &&
                              row.value.text.trim().isNotEmpty)
                            row.name.text.trim(): row.value.text.trim(),
                      },
                    ),
                  )
                : null,
            style: FilledButton.styleFrom(minimumSize: const Size(0, 48)),
            child: const Text('Acrescentar'),
          ),
        ],
      ),
    );
  }
}
