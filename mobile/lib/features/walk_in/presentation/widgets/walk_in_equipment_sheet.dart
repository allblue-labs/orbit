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

class _FolhaState extends State<_Folha> {
  final _nome = TextEditingController();
  final _marca = TextEditingController();
  final _modelo = TextEditingController();
  final _serie = TextEditingController();
  final _local = TextEditingController();

  @override
  void dispose() {
    for (final controller in [_nome, _marca, _modelo, _serie, _local]) {
      controller.dispose();
    }
    super.dispose();
  }

  bool get _valido => _nome.text.trim().isNotEmpty;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return SingleChildScrollView(
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
            'Só o nome é obrigatório. A placa com marca e número de série '
            'costuma estar atrás da condensadora — e não vale subir no telhado '
            'para abrir a ordem.',
            style: OrbitType.caption.copyWith(color: palette.inkSubtle),
          ),
          const SizedBox(height: OrbitSpacing.ms),

          WalkInField(
            label: 'Como chamar este aparelho',
            controller: _nome,
            hint: 'Split do quarto, central da recepção',
            onChanged: (_) => setState(() {}),
          ),
          WalkInField(
            label: 'Onde fica',
            controller: _local,
            hint: 'Sala 2, cobertura, recepção',
          ),
          WalkInField(label: 'Marca', controller: _marca),
          WalkInField(label: 'Modelo', controller: _modelo),
          WalkInField(
            label: 'Número de série',
            controller: _serie,
            textCapitalization: TextCapitalization.characters,
          ),

          const SizedBox(height: OrbitSpacing.sm),
          FilledButton(
            onPressed: _valido
                ? () => Navigator.of(context).pop(
                    WalkInEquipmentDraft(
                      name: _nome.text,
                      manufacturer: _marca.text,
                      model: _modelo.text,
                      serialNumber: _serie.text,
                      location: _local.text,
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
