import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:orbit_operator/app/providers.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/contracts/mobile_field_contracts.dart';
import 'package:orbit_operator/core/design/orbit_signature_pad.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/core/theme/orbit_theme.dart';
import 'package:orbit_operator/features/customers/presentation/customer_sheet.dart';
import 'package:orbit_operator/features/customers/presentation/new_customer_sheet.dart';

import '../support/fakes.dart';
import '../support/scripted_adapter.dart';

class Backend {
  final requests = <RequestOptions>[];
  Future<ResponseBody> Function(RequestOptions)? lookup;
  bool loseFirstCreate = false;
  bool emptyEquipment = false;
  bool failEquipment = false;
  Future<ResponseBody> handle(RequestOptions request) async {
    requests.add(request);
    if (request.path.startsWith('/lookups/')) {
      if (lookup != null) return lookup!(request);
      return jsonResponse(
        envelope({
          'postalCode': '50050000',
          'street': 'Rua da Aurora',
          'district': 'Boa Vista',
          'city': 'Recife',
          'stateCode': 'PE',
        }),
      );
    }
    if (request.path.endsWith('/options')) {
      return jsonResponse(
        envelope({
          'businessUnitId': 'unit-1',
          'addresses': [
            {
              'id': 'address-1',
              'label': 'Principal',
              'street': 'Rua da Aurora',
              'number': '100',
              'city': 'Recife',
            },
          ],
          'equipment': [
            if (!emptyEquipment) {'id': 'asset-1', 'name': 'Split do cliente'},
          ],
          'responsibles': [
            {
              'id': 'user-1',
              'name': 'Técnico responsável',
              'hasSignature': true,
            },
          ],
        }),
      );
    }
    if (request.path.endsWith('/equipment')) {
      if (failEquipment) {
        return jsonResponse({
          'success': false,
          'error': {
            'code': 'VALIDATION_ERROR',
            'message': 'Não foi possível cadastrar agora.',
          },
        }, status: 400);
      }
      return jsonResponse(
        envelope({
          'id': 'new-equipment',
          'name': (request.data as Map)['name'],
          'customerId': 'customer-1',
          'businessUnitId': 'unit-1',
        }),
      );
    }
    if (request.path == '/mobile/field/quotes' && loseFirstCreate) {
      loseFirstCreate = false;
      return jsonResponse({
        'code': 'INTERNAL_SERVER_ERROR',
        'message': 'Não foi possível concluir agora.',
      }, status: 500);
    }
    if (request.path.endsWith('/acceptance-link')) {
      return jsonResponse(envelope({'token': 'test-link-token'}));
    }
    if (request.path.endsWith('/response')) {
      return jsonResponse(envelope({'state': 'COMPLETED'}));
    }
    return jsonResponse(
      envelope({
        'id': 'quote-1',
        'code': 'ORC-000001',
        'total': '300.00',
        'status': 'SENT',
      }),
    );
  }
}

const customer = MobileFieldCustomerContract(
  id: 'customer-1',
  name: 'Cliente selecionado',
  legalName: 'Cliente selecionado',
  status: 'ACTIVE',
  openCount: 0,
  completedCount: 0,
);
Future<void> host(
  WidgetTester tester,
  Backend backend, {
  bool quote = false,
}) async {
  tester.view.physicalSize = const Size(390, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final dio = Dio()..httpClientAdapter = ScriptedAdapter(backend.handle);
  final plain = Dio()..httpClientAdapter = ScriptedAdapter(backend.handle);
  final client = OrbitApiClient.create(
    environment: OrbitEnvironment.fromDefines(),
    storage: InMemoryTokenStorage(),
    logger: const OrbitLogger(isProduction: true),
    dio: dio,
    retryDio: plain,
  );
  final router = GoRouter(
    routes: [
      GoRoute(
        path: '/',
        builder: (_, _) => Scaffold(
          body: Builder(
            builder: (context) => TextButton(
              onPressed: () => quote
                  ? showCustomerSheet(context, customer)
                  : showNewCustomerSheet(context),
              child: const Text('Abrir'),
            ),
          ),
        ),
      ),
    ],
  );
  addTearDown(router.dispose);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(client),
        sessionProvider.overrideWith(
          (_) => sessionFrom(
            permissions: ['operations.walk_in.create'],
            roles: ['FIELD_TECHNICIAN'],
          ),
        ),
      ],
      child: MaterialApp.router(
        theme: OrbitTheme.light(),
        routerConfig: router,
        locale: const Locale('pt', 'BR'),
        localizationsDelegates: GlobalMaterialLocalizations.delegates,
        supportedLocales: const [Locale('pt', 'BR')],
      ),
    ),
  );
  await tester.tap(find.text('Abrir'));
  await tester.pumpAndSettle();
  if (quote) {
    await tester.dragUntilVisible(
      find.text('Abrir orçamento'),
      find.byType(ListView).last,
      const Offset(0, -150),
    );
    await tester.drag(find.byType(ListView).last, const Offset(0, -260));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Abrir orçamento'));
    await tester.pumpAndSettle();
  }
}

Finder field(String label) => find.widgetWithText(TextField, label);
Future<void> tap(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

Future<void> next(WidgetTester tester, String label) =>
    tap(tester, find.widgetWithText(FilledButton, 'Avançar · $label'));

void main() {
  setUpAll(() => initializeDateFormatting('pt_BR'));
  testWidgets('endereço fica oculto e é omitido quando não escolhido', (
    tester,
  ) async {
    final backend = Backend();
    await host(tester, backend);
    expect(field('CEP (opcional)'), findsNothing);
    await tester.enterText(field('Razão social'), 'Novo cliente');
    await tester.pump();
    await tap(tester, find.widgetWithText(FilledButton, 'Cadastrar'));
    expect(
      (backend.requests.singleWhere((r) => r.path == '/customers').data as Map)
          .containsKey('address'),
      isFalse,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'endereço opcional busca CEP automaticamente e salva junto com cliente',
    (tester) async {
      final backend = Backend();
      await host(tester, backend);
      await tester.enterText(field('Razão social'), 'Novo cliente');
      await tap(tester, find.text('Adicionar endereço'));
      await tester.enterText(field('CEP (opcional)'), '5005000');
      await tester.pumpAndSettle();
      expect(
        backend.requests.where((r) => r.path.startsWith('/lookups/')),
        isEmpty,
      );
      await tester.enterText(field('CEP (opcional)'), '50050000');
      await tester.pumpAndSettle();
      expect(find.text('Rua da Aurora'), findsOneWidget);
      await tester.enterText(field('Número (opcional)'), '25');
      await tap(tester, find.widgetWithText(FilledButton, 'Cadastrar'));
      final body =
          backend.requests.singleWhere((r) => r.path == '/customers').data
              as Map;
      expect(body['address'], containsPair('street', 'Rua da Aurora'));
      expect(body['address'], containsPair('number', '25'));
      expect(body['address'], containsPair('stateCode', 'PE'));
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'consulta antiga não sobrescreve CEP novo e desmarcar omite endereço',
    (tester) async {
      final backend = Backend();
      final first = Completer<ResponseBody>();
      backend.lookup = (request) async => request.path.endsWith('50050000')
          ? first.future
          : jsonResponse(
              envelope({
                'street': 'Rua nova',
                'city': 'Paulista',
                'stateCode': 'PE',
              }),
            );
      await host(tester, backend);
      await tester.enterText(field('Razão social'), 'Novo cliente');
      await tap(tester, find.text('Adicionar endereço'));
      await tester.enterText(field('CEP (opcional)'), '50050000');
      await tester.pump();
      await tester.enterText(field('CEP (opcional)'), '53400000');
      await tester.pumpAndSettle();
      first.complete(
        jsonResponse(envelope({'street': 'Rua antiga', 'city': 'Recife'})),
      );
      await tester.pumpAndSettle();
      expect(find.text('Rua nova'), findsOneWidget);
      expect(find.text('Rua antiga'), findsNothing);
      await tap(tester, find.text('Adicionar endereço'));
      await tap(tester, find.widgetWithText(FilledButton, 'Cadastrar'));
      expect(
        (backend.requests.last.data as Map).containsKey('address'),
        isFalse,
      );
    },
  );

  testWidgets('falha na busca permite endereço manual e não impede cadastro', (
    tester,
  ) async {
    final backend = Backend();
    backend.lookup = (_) async => jsonResponse({
      'code': 'SERVICE_UNAVAILABLE',
      'message': 'Serviço indisponível',
    }, status: 503);
    await host(tester, backend);
    await tester.enterText(field('Razão social'), 'Novo cliente');
    await tap(tester, find.text('Adicionar endereço'));
    await tester.enterText(field('CEP (opcional)'), '50050000');
    await tester.pumpAndSettle(const Duration(seconds: 1));
    expect(
      find.text(
        'Não foi possível consultar o CEP. Preencha o endereço manualmente.',
      ),
      findsOneWidget,
    );
    await tester.enterText(field('Logradouro (opcional)'), 'Rua manual');
    await tap(tester, find.widgetWithText(FilledButton, 'Cadastrar'));
    expect(
      (backend.requests.last.data as Map)['address'],
      containsPair('street', 'Rua manual'),
    );
  });

  testWidgets(
    'cliente sem equipamento permite cadastrar e selecionar sem sair do orçamento',
    (tester) async {
      final backend = Backend()..emptyEquipment = true;
      await host(tester, backend, quote: true);
      await tap(tester, find.text('Adicionar equipamento'));
      await tester.enterText(
        find.byKey(const ValueKey('walk-in.Nome do equipamento')),
        'Split novo do cliente',
      );
      await tap(
        tester,
        find.widgetWithText(FilledButton, 'Cadastrar equipamento'),
      );
      final created = backend.requests.singleWhere(
        (r) => r.path.endsWith('/equipment'),
      );
      expect(
        created.path,
        '/mobile/field/quotes/customers/customer-1/equipment',
      );
      expect(created.data, containsPair('businessUnitId', 'unit-1'));
      expect(find.text('Split novo do cliente'), findsOneWidget);
      final checkbox = tester.widget<CheckboxListTile>(
        find.ancestor(
          of: find.text('Split novo do cliente'),
          matching: find.byType(CheckboxListTile),
        ),
      );
      expect(checkbox.value, isTrue);
      expect(
        find.text('Nenhum equipamento cadastrado para este cliente.'),
        findsNothing,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'falha ao cadastrar mantém o formulário e os dados para nova tentativa',
    (tester) async {
      final backend = Backend()
        ..emptyEquipment = true
        ..failEquipment = true;
      await host(tester, backend, quote: true);
      await tap(tester, find.text('Adicionar equipamento'));
      await tester.enterText(
        find.byKey(const ValueKey('walk-in.Nome do equipamento')),
        'Equipamento preservado',
      );
      await tap(
        tester,
        find.widgetWithText(FilledButton, 'Cadastrar equipamento'),
      );
      expect(find.text('Equipamento preservado'), findsOneWidget);
      expect(
        find.widgetWithText(FilledButton, 'Cadastrar equipamento'),
        findsOneWidget,
      );
      backend.failEquipment = false;
      await tap(
        tester,
        find.widgetWithText(FilledButton, 'Cadastrar equipamento'),
      );
      expect(find.text('Equipamento preservado'), findsOneWidget);
      expect(
        backend.requests.where((r) => r.path.endsWith('/equipment')),
        hasLength(2),
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'operador abre wizard com cliente preenchido; retry conserva envio e aprovação pede assinatura',
    (tester) async {
      final backend = Backend()..loseFirstCreate = true;
      await host(tester, backend, quote: true);
      expect(find.text('Cliente selecionado'), findsOneWidget);
      expect(
        backend.requests.singleWhere((r) => r.path.endsWith('/options')).path,
        contains('customer-1'),
      );
      await tester.enterText(
        field('Título da proposta *'),
        'Manutenção corretiva',
      );
      await next(tester, 'Serviços e materiais');
      await tap(tester, find.text('Adicionar item manual'));
      await tester.enterText(field('Descrição'), 'Limpeza completa');
      await tester.enterText(field('Preço unitário'), '300');
      await tester.pump();
      await tap(tester, find.widgetWithText(FilledButton, 'Adicionar item'));
      await next(tester, 'Valores');
      await next(tester, 'Responsável técnico');
      await next(tester, 'Revisão');
      await tap(
        tester,
        find.text('Revisei os dados e valores deste orçamento.'),
      );
      await tap(tester, find.widgetWithText(FilledButton, 'Gerar orçamento'));
      await tap(
        tester,
        find.widgetWithText(FilledButton, 'Tentar gerar novamente'),
      );
      final creates = backend.requests
          .where((r) => r.path == '/mobile/field/quotes')
          .toList();
      expect(creates, hasLength(2));
      expect(creates[0].data, creates[1].data);
      expect(creates.last.data, containsPair('customerId', 'customer-1'));
      expect(creates.last.data, containsPair('responsibleUserId', 'user-1'));
      await tap(tester, find.text('Coletar assinatura e aprovação agora'));
      expect(find.byType(OrbitSignaturePad), findsOneWidget);
      await tester.enterText(
        field('Nome completo de quem assina *'),
        'Cliente Teste',
      );
      await tap(
        tester,
        find.text(
          'Li a proposta e autorizo os serviços e valores apresentados.',
        ),
      );
      final approve = find.widgetWithText(
        FilledButton,
        'Assinar e aprovar orçamento',
      );
      expect(tester.widget<FilledButton>(approve).onPressed, isNull);
      final pad = tester.widget<OrbitSignaturePad>(
        find.byType(OrbitSignaturePad),
      );
      pad.controller.iniciar(const Offset(10, 20));
      pad.controller.estender(const Offset(90, 60));
      pad.controller.estender(const Offset(160, 20));
      await tester.pump();
      await tester.ensureVisible(approve);
      await tester.pumpAndSettle();
      await tester.runAsync(() async {
        await tester.tap(approve);
        for (var i = 0; i < 100; i++) {
          await Future<void>.delayed(const Duration(milliseconds: 50));
          await tester.pump();
          if (find
              .text('Orçamento aprovado e assinado')
              .evaluate()
              .isNotEmpty) {
            break;
          }
        }
      });
      await tester.pumpAndSettle();
      final response = backend.requests.singleWhere(
        (r) => r.path.endsWith('/response'),
      );
      expect(response.data, containsPair('decision', 'APPROVE'));
      expect(response.data, containsPair('signerName', 'Cliente Teste'));
      expect(
        (response.data as Map)['signatureBase64'],
        startsWith('data:image/png;base64,'),
      );
      expect(find.text('Orçamento aprovado e assinado'), findsOneWidget);
      expect(find.text('Compartilhar PDF assinado'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
