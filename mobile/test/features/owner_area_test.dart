import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/app/providers.dart';
import 'package:orbit_operator/core/theme/orbit_theme.dart';
import 'package:orbit_operator/features/owner/data/owner_repository.dart';
import 'package:orbit_operator/features/owner/presentation/owner_controls.dart';
import 'package:orbit_operator/features/owner/presentation/owner_screen.dart';

import '../support/fakes.dart';

void main() {
  testWidgets('exibe somente as funções delegadas pelo servidor', (
    tester,
  ) async {
    final container = ProviderContainer(
      overrides: [
        sessionProvider.overrideWithValue(
          sessionFrom(
            roles: const ['FIELD_TECHNICIAN'],
            permissions: const ['operations.read'],
          ),
        ),
        ownerAccessProvider.overrideWith(
          (_) async => const OwnerAccess({'customers'}, false),
        ),
      ],
    );
    addTearDown(container.dispose);

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          theme: OrbitTheme.light(),
          home: const OwnerScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Clientes'), findsOneWidget);
    expect(find.text('Equipe de campo'), findsNothing);
    expect(find.text('Operações e OS'), findsNothing);
    expect(find.text('Entradas e saídas'), findsNothing);
  });

  testWidgets('valida cada etapa e conserva os dados ao voltar', (
    tester,
  ) async {
    OwnerRow? saved;
    await tester.pumpWidget(
      MaterialApp(
        theme: OrbitTheme.light(),
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () => ownerForm(
                context,
                title: 'Novo atendimento',
                sections: const {'title': 'Serviço', 'notes': 'Observações'},
                fields: const [
                  OwnerFormField('title', 'Título', required: true),
                  OwnerFormField('notes', 'Observação'),
                ],
                save: (values, _) async => saved = values,
              ),
              child: const Text('Abrir formulário'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Abrir formulário'));
    await tester.pumpAndSettle();

    final advance = find.widgetWithText(FilledButton, 'Avançar · Observações');
    await tester.tap(advance);
    await tester.pumpAndSettle();
    expect(find.text('Preencha título.'), findsOneWidget);

    await tester.enterText(find.byType(TextFormField), 'Manutenção');
    await tester.tap(advance);
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField), 'Acesso pela recepção');
    await tester.tap(find.widgetWithText(OutlinedButton, 'Voltar'));
    await tester.pumpAndSettle();

    expect(find.text('Manutenção'), findsOneWidget);
    await tester.tap(advance);
    await tester.pumpAndSettle();
    expect(find.text('Acesso pela recepção'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Salvar'));
    await tester.pumpAndSettle();
    expect(saved, {'title': 'Manutenção', 'notes': 'Acesso pela recepção'});
  });
}
