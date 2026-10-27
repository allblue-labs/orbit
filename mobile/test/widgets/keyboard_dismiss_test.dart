import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/design/orbit_wizard.dart';
import 'package:orbit_operator/core/theme/orbit_theme.dart';
import 'package:orbit_operator/features/walk_in/presentation/widgets/walk_in_fields.dart';

void main() {
  testWidgets(
    'campo longo permite ocultar e reabrir teclado sem perder parágrafos',
    (tester) async {
      final controller = TextEditingController();
      addTearDown(controller.dispose);
      await tester.pumpWidget(
        MaterialApp(
          theme: OrbitTheme.light(),
          home: Scaffold(
            body: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                children: [
                  WalkInField(
                    label: 'O que o cliente pediu',
                    controller: controller,
                    maxLines: 4,
                  ),
                  const Text('Área fora do campo'),
                ],
              ),
            ),
          ),
        ),
      );
      final field = find.byType(TextField);
      await tester.showKeyboard(field);
      await tester.enterText(field, 'Primeiro relato\nSegundo relato');
      expect(tester.testTextInput.isVisible, isTrue);
      await tester.tap(find.byTooltip('Ocultar teclado'));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<EditableText>(find.byType(EditableText))
            .focusNode
            .hasFocus,
        isFalse,
      );
      expect(tester.testTextInput.isVisible, isFalse);
      expect(controller.text, 'Primeiro relato\nSegundo relato');
      await tester.showKeyboard(field);
      await tester.pump();
      await tester.tap(find.text('Área fora do campo'));
      await tester.pumpAndSettle();
      expect(tester.testTextInput.isVisible, isFalse);
      await tester.showKeyboard(field);
      expect(tester.testTextInput.isVisible, isTrue);
      expect(controller.text, 'Primeiro relato\nSegundo relato');
    },
  );

  testWidgets('avançar no wizard dispensa teclado e mantém o texto ao voltar', (
    tester,
  ) async {
    final controller = TextEditingController();
    addTearDown(controller.dispose);
    await tester.pumpWidget(
      MaterialApp(
        theme: OrbitTheme.light(),
        home: Scaffold(
          body: SingleChildScrollView(
            child: OrbitWizard(
              steps: [
                OrbitWizardStep(
                  title: 'Relato',
                  child: WalkInField(
                    label: 'Observações',
                    controller: controller,
                    maxLines: 4,
                  ),
                ),
                const OrbitWizardStep(
                  title: 'Revisão',
                  child: Text('Revisar atendimento'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    await tester.showKeyboard(find.byType(TextField));
    await tester.enterText(find.byType(TextField), 'Texto preservado');
    await tester.tap(find.text('Avançar · Revisão'));
    await tester.pumpAndSettle();
    expect(tester.testTextInput.isVisible, isFalse);
    expect(find.text('Revisar atendimento'), findsOneWidget);
    await tester.tap(find.text('Voltar'));
    await tester.pumpAndSettle();
    expect(controller.text, 'Texto preservado');
  });
}
