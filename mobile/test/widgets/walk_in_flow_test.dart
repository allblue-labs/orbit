import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:orbit_operator/app/providers.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/contracts/mobile_field_contracts.dart';
import 'package:orbit_operator/core/contracts/session_contracts.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/core/routing/orbit_router.dart';
import 'package:orbit_operator/core/theme/orbit_theme.dart';
import 'package:orbit_operator/features/customers/presentation/customer_sheet.dart';
import 'package:orbit_operator/features/field/presentation/work_queue_screen.dart';
import 'package:orbit_operator/features/walk_in/presentation/walk_in_screen.dart';

import '../support/fakes.dart';
import '../support/scripted_adapter.dart';

const base = '/mobile/field/operations/walk-in';

Map<String, dynamic> company(String name) => {
  'legalName': name,
  'tradeName': '$name fantasia',
  'email': 'contato@example.test',
  'phone': '81999999999',
  'address': {
    'postalCode': '50050000',
    'street': 'Rua da Aurora',
    'number': '100',
    'district': 'Boa Vista',
    'city': 'Recife',
    'stateCode': 'PE',
  },
};
Map<String, dynamic> address(String city) => {
  'postalCode': '01001000',
  'street': 'Praça da Sé',
  'district': 'Sé',
  'city': city,
  'stateCode': 'SP',
  'state': 'São Paulo',
  'country': 'Brasil',
};

class Backend {
  final requests = <RequestOptions>[];
  Future<ResponseBody> Function(RequestOptions)? lookup;
  bool failNextCreate = false;
  Map<String, String>? conflictNextCreate;
  List<RequestOptions> get creates =>
      requests.where((r) => r.method == 'POST' && r.path == base).toList();

  Future<ResponseBody> handle(RequestOptions request) async {
    requests.add(request);
    if (request.path.startsWith('/lookups/')) {
      if (lookup != null) return lookup!(request);
      return jsonResponse(
        envelope(
          request.path.contains('/company/')
              ? company('Empresa consultada')
              : address('São Paulo'),
        ),
      );
    }
    if (request.path == '$base/customers') {
      return jsonResponse(
        envelope({
          'items': [
            {
              'id': 'cliente-1',
              'legalName': 'Cliente existente',
              'type': 'COMPANY',
              'documentNumber': '11222333000181',
              'addresses': [],
            },
            {
              'id': 'cliente-2',
              'legalName': 'Segundo cliente',
              'type': 'INDIVIDUAL',
              'addresses': [],
            },
          ],
        }),
      );
    }
    if (request.path.endsWith('/equipment')) {
      return jsonResponse(
        envelope({
          'items': [
            {
              'id': 'equip-1',
              'name': 'Split já cadastrado',
              'manufacturer': 'Marca A',
            },
            {'id': 'equip-2', 'name': 'Central já cadastrada'},
          ],
        }),
      );
    }
    if (request.method == 'POST' && request.path == base) {
      if (conflictNextCreate case final conflict?) {
        conflictNextCreate = null;
        return jsonResponse(
          errorEnvelope(code: conflict['code']!, message: conflict['message']!),
          status: 409,
        );
      }
      if (failNextCreate) {
        failNextCreate = false;
        return jsonResponse(
          errorEnvelope(code: 'VALIDATION_ERROR', message: 'Tente novamente.'),
          status: 400,
        );
      }
      return jsonResponse(envelope({'operationId': 'op-nova'}));
    }
    if (request.path == '/mobile/field/work-queue') {
      return jsonResponse(
        envelope({
          'data': [],
          'meta': {'limit': 20, 'hasNextPage': false},
        }),
      );
    }
    throw StateError('Unexpected request: ${request.method} ${request.path}');
  }
}

Future<void> open(
  WidgetTester tester,
  Backend backend, {
  String? initial,
  List<String> permissions = const [
    'operations.walk_in.create',
    'operations.read',
    'operations.status.update',
    'customers.read',
  ],
  bool isOwner = false,
  SessionAccess? access,
  double width = 390,
  double scale = 1,
}) async {
  tester.view.physicalSize = Size(width, 1000);
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
    initialLocation: initial ?? OrbitRoutes.walkIn(),
    routes: [
      GoRoute(
        path: OrbitRoutes.workQueue,
        builder: (_, _) => const WorkQueueScreen(),
      ),
      GoRoute(
        path: '${OrbitRoutes.workQueue}/avulso',
        builder: (_, state) => WalkInScreen(
          customerId: state.uri.queryParameters['cliente'],
          customerName: state.uri.queryParameters['nome'],
        ),
      ),
      GoRoute(
        path: '${OrbitRoutes.workQueue}/execucao/:id',
        builder: (_, state) =>
            Scaffold(body: Text('Execução ${state.pathParameters['id']}')),
      ),
      GoRoute(
        path: '/clientes',
        builder: (context, _) => Scaffold(
          body: Center(
            child: TextButton(
              onPressed: () => showCustomerSheet(
                context,
                const MobileFieldCustomerContract(
                  id: 'cliente-1',
                  name: 'Cliente & Filhos',
                  legalName: 'Cliente & Filhos',
                  status: 'ACTIVE',
                  openCount: 0,
                  completedCount: 0,
                ),
              ),
              child: const Text('Abrir cliente'),
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
        readCacheProvider.overrideWithValue(InMemoryReadCache()),
        sessionProvider.overrideWith(
          (ref) => sessionFrom(
            permissions: permissions,
            roles: isOwner ? const ['OWNER'] : const ['FIELD_TECHNICIAN'],
            isOrganizationOwner: isOwner,
          ).copyWith(access: access),
        ),
      ],
      child: MaterialApp.router(
        theme: OrbitTheme.light(),
        routerConfig: router,
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: TextScaler.linear(scale)),
          child: child!,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Finder field(String label) => find.byKey(ValueKey('walk-in.$label'));
Future<void> fill(WidgetTester tester, String label, String value) async {
  await tester.ensureVisible(field(label));
  await tester.enterText(field(label), value);
  await tester.pump();
}

String valueOf(WidgetTester tester, String label) =>
    tester.widget<TextField>(field(label)).controller!.text;
Future<void> tap(WidgetTester tester, String label) async {
  tester.testTextInput.hide();
  await tester.pumpAndSettle();
  final finder = find.text(label).last;
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

Future<void> fresh(WidgetTester tester) async {
  await tap(tester, 'Criar avulso (novo cliente)');
  await tap(tester, 'Avançar · Cliente');
}

Future<void> equipment(WidgetTester tester, String name) async {
  await tap(tester, 'Acrescentar equipamento');
  await fill(tester, 'Nome do equipamento', name);
  await tap(tester, 'Acrescentar');
}

void main() {
  for (final initial in [OrbitRoutes.workQueue, '/clientes']) {
    testWidgets(
      'acesso atualizado exibe o botão em $initial com token antigo',
      (tester) async {
        await open(
          tester,
          Backend(),
          initial: initial,
          permissions: ['operations.read', 'customers.read'],
          access: const SessionAccess(
            roles: ['FIELD_TECHNICIAN'],
            permissions: ['operations.walk_in.create', 'customers.read'],
            surfaceAccess: ['MOBILE'],
            unitIds: ['unit-1'],
          ),
        );
        if (initial == '/clientes') await tap(tester, 'Abrir cliente');
        await tap(tester, 'Iniciar um atendimento');
        if (initial == '/clientes') {
          expect(find.text('Criar avulso (novo cliente)'), findsNothing);
        } else {
          expect(find.text('Criar avulso (novo cliente)'), findsOneWidget);
        }
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets('a fila abre o mesmo wizard pelo botão de iniciar atendimento', (
    tester,
  ) async {
    await open(tester, Backend(), initial: OrbitRoutes.workQueue);
    await tap(tester, 'Iniciar um atendimento');
    expect(find.text('Criar para cliente existente'), findsOneWidget);
    expect(find.text('Criar avulso (novo cliente)'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a ação de criação respeita a permissão da sessão', (
    tester,
  ) async {
    await open(
      tester,
      Backend(),
      initial: OrbitRoutes.workQueue,
      permissions: ['operations.read'],
    );
    expect(find.text('Iniciar um atendimento'), findsNothing);
  });

  testWidgets('permissão geral de criação mantém o botão disponível', (
    tester,
  ) async {
    await open(
      tester,
      Backend(),
      initial: OrbitRoutes.workQueue,
      permissions: ['operations.create', 'customers.read'],
    );
    await tap(tester, 'Iniciar um atendimento');
    expect(find.text('Criar avulso (novo cliente)'), findsOneWidget);
  });

  testWidgets('proprietário tem a ação sem depender da permissão na lista', (
    tester,
  ) async {
    await open(
      tester,
      Backend(),
      initial: OrbitRoutes.workQueue,
      permissions: [],
      isOwner: true,
    );
    await tap(tester, 'Iniciar um atendimento');
    expect(find.text('Criar para cliente existente'), findsOneWidget);
  });

  testWidgets('ficha do cliente não concede criação a quem só pode consultar', (
    tester,
  ) async {
    await open(
      tester,
      Backend(),
      initial: '/clientes',
      permissions: ['customers.read'],
    );
    await tap(tester, 'Abrir cliente');
    expect(find.text('Iniciar um atendimento'), findsNothing);
    expect(find.text('Nada em aberto'), findsOneWidget);
  });

  testWidgets('seleciona cliente e vários equipamentos da unidade ativa', (
    tester,
  ) async {
    final backend = Backend();
    await open(tester, backend);
    await tap(tester, 'Criar para cliente existente');
    await tap(tester, 'Avançar · Cliente');
    await tap(tester, 'Cliente existente');
    await tap(tester, 'Avançar · Equipamentos');
    await tap(tester, 'Split já cadastrado');
    await tap(tester, 'Central já cadastrada');
    final request = backend.requests.firstWhere(
      (r) => r.path.endsWith('/equipment'),
    );
    expect(request.queryParameters['businessUnitId'], 'unit-1');
    await tap(tester, 'Avançar · Atendimento');
    await tap(tester, 'Abrir atendimento');
    expect(find.text('Execução op-nova'), findsOneWidget);
    final body = backend.creates.single.data as Map<String, dynamic>;
    expect(body['customerId'], 'cliente-1');
    expect(body['assetIds'], ['equip-1', 'equip-2']);
    expect(body['businessUnitId'], 'unit-1');
    expect(body.containsKey('customer'), isFalse);
  });

  testWidgets('cliente novo aceita somente os nomes e vários equipamentos', (
    tester,
  ) async {
    final backend = Backend();
    await open(tester, backend);
    await fresh(tester);
    await tap(tester, 'Pessoa física');
    await fill(tester, 'Nome', 'Maria Souza');
    await tap(tester, 'Avançar · Equipamentos');
    await equipment(tester, 'Split do quarto');
    await equipment(tester, 'Split da sala');
    expect(find.text('Novo equipamento'), findsNWidgets(2));
    final card = find.byKey(const ValueKey('walk-in.equipment.0'));
    expect(
      tester.getRect(find.text('Split do quarto')).left -
          tester.getRect(card).left,
      greaterThanOrEqualTo(16),
    );
    expect(
      tester.getRect(find.byTooltip('Remover Split do quarto')).right,
      lessThan(tester.getRect(card).right),
    );
    await tap(tester, 'Avançar · Atendimento');
    await tap(tester, 'Abrir atendimento');
    final body = backend.creates.single.data as Map<String, dynamic>;
    expect(body['customer'], {
      'type': 'INDIVIDUAL',
      'legalName': 'Maria Souza',
    });
    expect((body['equipment'] as List).length, 2);
    expect(body.containsKey('customerId'), isFalse);
    expect(find.text('Execução op-nova'), findsOneWidget);
  });

  testWidgets(
    'equipamento envia identificação, data e informação técnica opcionais',
    (tester) async {
      final backend = Backend();
      await open(
        tester,
        backend,
        initial: OrbitRoutes.walkIn(
          customerId: 'cliente-1',
          customerName: 'Cliente existente',
        ),
      );
      await tap(tester, 'Avançar · Equipamentos');
      await tap(tester, 'Acrescentar equipamento');
      await fill(tester, 'Nome do equipamento', 'Split da recepção');
      await fill(tester, 'Marca', 'Marca A');
      await fill(tester, 'Número de série', 'ABC123');
      await tap(tester, 'Identificação e detalhes técnicos');
      await fill(tester, 'Identificador / etiqueta', 'ET-1');
      await tester.ensureVisible(field('Instalação'));
      await tester.pumpAndSettle();
      await tester.tap(field('Instalação'));
      await tester.pumpAndSettle();
      await tap(tester, 'Confirmar');
      final selectedDate = valueOf(tester, 'Instalação').split('/');
      await tap(tester, 'Adicionar informação técnica');
      final name = find.widgetWithText(TextField, 'Informação técnica');
      final value = find.widgetWithText(TextField, 'Valor');
      await tester.ensureVisible(name);
      await tester.enterText(name, 'Capacidade');
      await tester.ensureVisible(value);
      await tester.enterText(value, '12.000 BTU/h');
      await tap(tester, 'Acrescentar');
      await tap(tester, 'Avançar · Atendimento');
      await tap(tester, 'Abrir atendimento');
      final body = backend.creates.single.data as Map<String, dynamic>;
      expect((body['equipment'] as List).single, {
        'name': 'Split da recepção',
        'category': 'EQUIPMENT',
        'manufacturer': 'Marca A',
        'serialNumber': 'ABC123',
        'identifier': 'ET-1',
        'identifierType': 'INTERNAL_CODE',
        'installationAt':
            '${selectedDate[2]}-${selectedDate[1]}-${selectedDate[0]}T00:00:00.000Z',
        'specifications': {'Capacidade': '12.000 BTU/h'},
      });
      expect(find.text('Execução op-nova'), findsOneWidget);
    },
  );

  testWidgets(
    'CNPJ e CEP completos consultam automaticamente e preservam número e complemento',
    (tester) async {
      final backend = Backend();
      await open(tester, backend);
      await fresh(tester);
      await fill(tester, 'CNPJ', '11222333000181');
      await tester.pump(const Duration(milliseconds: 600));
      await tester.pumpAndSettle();
      expect(valueOf(tester, 'Razão social'), 'Empresa consultada');
      expect(valueOf(tester, 'E-mail'), 'contato@example.test');
      await fill(tester, 'Número', '42');
      await fill(tester, 'Complemento', 'Portão lateral');
      await fill(tester, 'CEP', '01001000');
      await tester.pump(const Duration(milliseconds: 600));
      await tester.pumpAndSettle();
      expect(valueOf(tester, 'Cidade'), 'São Paulo');
      expect(valueOf(tester, 'UF'), 'SP');
      expect(valueOf(tester, 'Número'), '42');
      expect(valueOf(tester, 'Complemento'), 'Portão lateral');
      expect(
        backend.requests.where((r) => r.path.contains('/company/')).length,
        1,
      );
      expect(
        backend.requests.where((r) => r.path.contains('/postal-code/')).length,
        1,
      );
    },
  );

  testWidgets('mudar para CPF invalida consulta de CNPJ em andamento', (
    tester,
  ) async {
    final backend = Backend();
    final response = Completer<ResponseBody>();
    backend.lookup = (_) => response.future;
    await open(tester, backend);
    await fresh(tester);
    await fill(tester, 'CNPJ', '11222333000181');
    await tester.pump(const Duration(milliseconds: 600));
    tester.testTextInput.hide();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.ensureVisible(find.text('Pessoa física'));
    await tester.pump(const Duration(milliseconds: 300));
    await tester.tap(find.text('Pessoa física'));
    await tester.pump();
    await fill(tester, 'Nome', 'Maria Souza');
    response.complete(jsonResponse(envelope(company('Empresa antiga'))));
    await tester.pumpAndSettle();
    expect(valueOf(tester, 'Nome'), 'Maria Souza');
    expect(valueOf(tester, 'CPF'), isEmpty);
    expect(find.text('Empresa antiga'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('resposta antiga do CEP não substitui o endereço mais recente', (
    tester,
  ) async {
    final backend = Backend();
    final first = Completer<ResponseBody>(), second = Completer<ResponseBody>();
    backend.lookup = (r) =>
        r.path.endsWith('50050000') ? first.future : second.future;
    await open(tester, backend);
    await fresh(tester);
    await fill(tester, 'CEP', '50050000');
    await tester.pump(const Duration(milliseconds: 600));
    await fill(tester, 'CEP', '01001000');
    await tester.pump(const Duration(milliseconds: 600));
    second.complete(jsonResponse(envelope(address('São Paulo'))));
    await tester.pumpAndSettle();
    first.complete(jsonResponse(envelope(address('Recife antigo'))));
    await tester.pumpAndSettle();
    expect(valueOf(tester, 'Cidade'), 'São Paulo');
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'falha da consulta permite preenchimento manual e nova tentativa',
    (tester) async {
      final backend = Backend();
      backend.lookup = (_) async => jsonResponse(
        errorEnvelope(code: 'NOT_FOUND', message: 'Empresa não encontrada.'),
        status: 404,
      );
      await open(tester, backend);
      await fresh(tester);
      await fill(tester, 'CNPJ', '11222333000181');
      await tester.pump(const Duration(milliseconds: 600));
      await tester.pumpAndSettle();
      expect(
        find.textContaining('Você pode preencher os dados manualmente.'),
        findsOneWidget,
      );
      backend.lookup = null;
      await tester.ensureVisible(find.byTooltip('Buscar dados do CNPJ'));
      await tester.tap(find.byTooltip('Buscar dados do CNPJ'));
      await tester.pumpAndSettle();
      expect(valueOf(tester, 'Razão social'), 'Empresa consultada');
    },
  );

  testWidgets(
    'a ficha inicia para o cliente escolhido e cabe em tela estreita',
    (tester) async {
      final backend = Backend();
      await open(
        tester,
        backend,
        initial: '/clientes',
        width: 320,
        scale: 1.25,
      );
      await tap(tester, 'Abrir cliente');
      await tap(tester, 'Iniciar um atendimento');
      expect(find.text('Cliente & Filhos'), findsOneWidget);
      expect(find.text('Criar avulso (novo cliente)'), findsNothing);
      expect(find.text('Criar para cliente existente'), findsNothing);
      await tap(tester, 'Avançar · Equipamentos');
      expect(
        backend.requests.any(
          (r) => r.path == '$base/customers/cliente-1/equipment',
        ),
        isTrue,
      );
      expect(backend.requests.any((r) => r.path == '$base/customers'), isFalse);
    },
  );

  testWidgets('repetir após erro mantém a chave de idempotência', (
    tester,
  ) async {
    final backend = Backend()..failNextCreate = true;
    await open(
      tester,
      backend,
      initial: OrbitRoutes.walkIn(
        customerId: 'cliente-1',
        customerName: 'Cliente existente',
      ),
    );
    await tap(tester, 'Avançar · Equipamentos');
    await tap(tester, 'Avançar · Atendimento');
    await tap(tester, 'Abrir atendimento');
    expect(backend.creates.length, 1);
    await tap(tester, 'Abrir atendimento');
    expect(backend.creates.length, 2);
    final keys = backend.creates
        .map(
          (r) => r.headers.entries
              .firstWhere((e) => e.key.toLowerCase() == 'idempotency-key')
              .value,
        )
        .toList();
    expect(keys[0], isNotEmpty);
    expect(keys[0], keys[1]);
    expect(find.text('Execução op-nova'), findsOneWidget);
  });

  testWidgets(
    'conflito explica o documento duplicado, fica visível e preserva o rascunho',
    (tester) async {
      const message =
          'Já existe um cliente com este CPF ou CNPJ. Volte à etapa Origem e selecione o cliente existente.';
      final backend = Backend()
        ..conflictNextCreate = {
          'code': 'WALK_IN_CUSTOMER_DOCUMENT_EXISTS',
          'message': message,
        };
      await open(tester, backend, width: 320, scale: 1.25);
      await fresh(tester);
      await tap(tester, 'Pessoa física');
      await fill(tester, 'Nome', 'Maria Souza');
      await tap(tester, 'Avançar · Equipamentos');
      await equipment(tester, 'Split do quarto');
      await tap(tester, 'Avançar · Atendimento');
      await tap(tester, 'Abrir atendimento');
      expect(backend.creates, hasLength(1));
      expect(find.text(message).hitTestable(), findsOneWidget);
      expect(
        find.text('Os dados foram alterados. Atualize e tente novamente.'),
        findsNothing,
      );
      expect(find.text('Execução op-nova'), findsNothing);
      await tap(tester, 'Voltar');
      expect(find.text('Split do quarto'), findsOneWidget);
      await tap(tester, 'Voltar');
      expect(valueOf(tester, 'Nome'), 'Maria Souza');
      expect(tester.takeException(), isNull);
    },
  );
}
