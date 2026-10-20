/// Registrar uma observação.
///
/// Limite de 2000 caracteres — o do contrato, não um menor inventado aqui.
library;

import 'package:flutter/material.dart';

import '../../../../core/theme/orbit_theme.dart';
import '../../application/execution_controller.dart';

Future<void> showNoteSheet(
  BuildContext context,
  ExecutionController controller,
) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  builder: (context) => _NoteSheet(controller: controller),
);

class _NoteSheet extends StatefulWidget {
  const _NoteSheet({required this.controller});

  final ExecutionController controller;

  @override
  State<_NoteSheet> createState() => _NoteSheetState();
}

class _NoteSheetState extends State<_NoteSheet> {
  final _field = TextEditingController();
  bool _sending = false;

  @override
  void dispose() {
    _field.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final note = _field.text.trim();
    if (note.isEmpty || _sending) return;
    setState(() => _sending = true);
    await widget.controller.addNote(note);
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      /// O teclado empurra o conteúdo em vez de cobrir o botão.
      padding: EdgeInsets.only(
        left: OrbitSpacing.md,
        right: OrbitSpacing.md,
        top: OrbitSpacing.md,
        bottom: MediaQuery.viewInsetsOf(context).bottom + OrbitSpacing.md,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Observação',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: OrbitSpacing.sm),
          TextField(
            controller: _field,
            maxLines: 4,
            maxLength: 2000,
            autofocus: true,
            decoration: const InputDecoration(
              hintText: 'O que aconteceu no atendimento',
            ),
          ),
          const SizedBox(height: OrbitSpacing.sm),
          FilledButton(
            onPressed: _sending ? null : _submit,
            style: FilledButton.styleFrom(minimumSize: const Size(0, 48)),
            child: Text(_sending ? 'Registrando…' : 'Registrar'),
          ),
        ],
      ),
    );
  }
}
