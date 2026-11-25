/// "Termos e privacidade" no perfil — exigência das lojas.
library;

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:orbit_operator/core/routing/orbit_router.dart';
import 'package:orbit_operator/core/theme/orbit_theme.dart';
import 'package:orbit_operator/features/legal/data/legal_repository.dart';
import 'package:orbit_operator/features/legal/presentation/legal_document_screen.dart';

void main() {
  testWidgets('mostra os dois documentos com os textos da web e abre cada um', (
    tester,
  ) async {
    final router = GoRouter(
      initialLocation: '/perfil',
      routes: [
        GoRoute(
          path: '/perfil',
          builder: (_, _) => const Scaffold(body: LegalDocumentsGroup()),
        ),
        GoRoute(
          path: OrbitRoutes.terms,
          builder: (_, _) => const Text('tela-termos'),
        ),
        GoRoute(
          path: OrbitRoutes.privacy,
          builder: (_, _) => const Text('tela-privacidade'),
        ),
      ],
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          legalDocumentProvider.overrideWith(
            (ref, kind) => LegalDocument(
              title: kind.title,
              version: '2026-11-01',
              effectiveAt: '2026-11-01',
              provider: const {},
              sections: const [],
            ),
          ),
        ],
        child: MaterialApp.router(
          theme: OrbitTheme.light(),
          routerConfig: router,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('TERMOS E PRIVACIDADE'), findsOneWidget);
    expect(
      find.text('Planos, pagamentos, cancelamento e responsabilidades.'),
      findsOneWidget,
    );
    expect(
      find.text('Tratamento de dados, conservação, exclusão e seus direitos.'),
      findsOneWidget,
    );
    expect(find.textContaining('Versão 2026-11-01'), findsOneWidget);

    await tester.tap(find.byKey(const Key('legal.terms')));
    await tester.pumpAndSettle();
    expect(find.text('tela-termos'), findsOneWidget);

    router.go('/perfil');
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('legal.privacy')));
    await tester.pumpAndSettle();
    expect(find.text('tela-privacidade'), findsOneWidget);
  });

  test('os textos são os mesmos do painel da web', () {
    final web = File(
      '../frontend/src/components/legal/legal-documents-panel.tsx',
    ).readAsStringSync();
    final app = File(
      'lib/features/legal/presentation/legal_document_screen.dart',
    ).readAsStringSync();
    for (final texto in [
      'Termos e privacidade',
      'Termos de Uso',
      'Política de Privacidade',
      'Planos, pagamentos, cancelamento e responsabilidades.',
      'Tratamento de dados, conservação, exclusão e seus direitos.',
      'Consulte os documentos do Orbit e guarde uma cópia.',
    ]) {
      expect(web, contains(texto), reason: 'a web não diz mais "$texto"');
      expect(app, contains(texto), reason: 'o app não diz "$texto"');
    }
  });
}
