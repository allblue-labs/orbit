import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/app/providers.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/core/theme/orbit_theme.dart';
import 'package:orbit_operator/features/owner/data/owner_repository.dart';
import 'package:orbit_operator/features/owner/presentation/owner_controls.dart';
import 'package:orbit_operator/features/owner/presentation/owner_screen.dart';

import '../support/fakes.dart';
import '../support/scripted_adapter.dart';

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

  testWidgets('emite recibo com cliente selecionado ou pagador novo', (
    tester,
  ) async {
    final receipts = <OwnerRow>[];
    final adapter = ScriptedAdapter((request) async {
      final Object payload;
      if (request.uri.path.endsWith('/mobile/owner/customers')) {
        final secondPage = request.uri.queryParameters['page'] == '2';
        payload = {
          'data': [
            if (secondPage)
              {
                'id': 'cliente-2',
                'legalName': 'Oficina dos Ipês',
                'documentNumber': '12345678000195',
              }
            else
              {'id': 'cliente-1', 'legalName': 'Clínica das Acácias'},
          ],
          'hasNextPage': !secondPage,
        };
      } else if (request.method == 'POST') {
        receipts.add(Map<String, dynamic>.from(request.data as Map));
        payload = {};
      } else {
        payload = {'data': []};
      }
      return jsonResponse({'success': true, 'data': payload});
    });
    final client = OrbitApiClient.create(
      environment: OrbitEnvironment.fromDefines(),
      storage: InMemoryTokenStorage(),
      logger: const OrbitLogger(isProduction: true),
      dio: Dio()..httpClientAdapter = adapter,
      retryDio: Dio()..httpClientAdapter = adapter,
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(client),
          sessionProvider.overrideWithValue(
            sessionFrom(isOrganizationOwner: true),
          ),
          ownerAccessProvider.overrideWith(
            (_) async => const OwnerAccess({'receipts'}, false),
          ),
        ],
        child: MaterialApp(
          theme: OrbitTheme.light(),
          home: const OwnerScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Recibos'));
    await tester.pumpAndSettle();

    Future<void> tap(String label) async {
      final target = find.text(label);
      await tester.ensureVisible(target);
      await tester.pumpAndSettle();
      await tester.tap(target);
      await tester.pumpAndSettle();
    }

    Finder field(String label) => find.byWidgetPredicate(
      (widget) => widget is TextField && widget.decoration?.labelText == label,
    );

    Future<void> issueReceipt() async {
      final amount = field(r'Valor (R$) *');
      final reference = field('Referente a *');
      await tester.ensureVisible(amount);
      await tester.enterText(amount, '100,50');
      await tester.ensureVisible(reference);
      await tester.enterText(reference, 'Manutenção');
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pumpAndSettle();
      await tap('Criar recibo');
    }

    await tap('Novo recibo');
    expect(find.text('Clínica das Acácias'), findsOneWidget);
    await tap('Carregar mais');
    await tap('Oficina dos Ipês');
    expect(find.text('Oficina dos Ipês'), findsOneWidget);
    expect(find.text('12345678000195'), findsOneWidget);
    await issueReceipt();
    expect(receipts.single, containsPair('customerId', 'cliente-2'));
    expect(receipts.single, containsPair('payer', 'Oficina dos Ipês'));
    expect(receipts.single, containsPair('payerDocument', '12345678000195'));

    await tap('Novo recibo');
    await tap('Preencher dados de novo cliente');
    await tester.enterText(field('Nome de quem pagou *'), 'Cliente avulso');
    await issueReceipt();
    expect(receipts, hasLength(2));
    expect(receipts.last, containsPair('payer', 'Cliente avulso'));
    expect(receipts.last, isNot(contains('customerId')));
    expect(receipts.last, isNot(contains('payerDocument')));
  });
}
