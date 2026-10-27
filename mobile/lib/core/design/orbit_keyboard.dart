import 'package:flutter/material.dart';

/// Fecha o teclado sem alterar o texto.
class OrbitKeyboardDismissButton extends StatelessWidget {
  const OrbitKeyboardDismissButton({super.key});

  @override
  Widget build(BuildContext context) => IconButton(
    tooltip: 'Ocultar teclado',
    icon: const Icon(Icons.keyboard_hide_outlined),
    onPressed: () => FocusManager.instance.primaryFocus?.unfocus(),
  );
}
