/// A Área do proprietário renderizada de verdade — menu, listas, fichas e
/// formulário.
///
/// Dados de propósito difíceis: nomes longos, valores grandes, campos vazios,
/// texto ampliado. Overflow de layout vira falha de teste; com
/// `ORBIT_CAPTURE=1` e `--update-goldens` as telas viram PNG em
/// `test/screenshots/out_owner/` para conferir a olho.
library;

import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:orbit_operator/app/providers.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/core/theme/orbit_theme.dart';
import 'package:orbit_operator/features/owner/data/owner_repository.dart';
import 'package:orbit_operator/features/owner/presentation/owner_screen.dart';

import '../support/fakes.dart';
import '../support/scripted_adapter.dart';
import 'harness.dart';

const _areas = {
  'operations',
  'authorization',
  'quotes',
  'sales',
  'receipts',
  'finance',
  'customers',
  'equipment',
  'pmoc',
  'rvt',
  'team',
};

Map<String, dynamic> _operation(int n, String status) => {
  'id': 'op-$n',
  'title': n.isEven
      ? 'Limpeza completa e verificação de carga de gás dos splits da recepção'
      : 'Visita técnica',
  'serviceOrderCode': 'OS-2026-00$n',
  'status': status,
  'customer': {'legalName': 'Clínica Odontológica Sol Nascente LTDA'},
  'scheduledStart': '2026-11-2${n}T13:00:00.000Z',
  'responsibleFieldTechnician': {'displayName': 'Marina Duarte da Silva'},
  'description':
      'Troca de filtros, limpeza das serpentinas e medição de corrente.',
  'assets': [
    {'name': 'Split Recepção 12.000 BTUs'},
    {'name': 'Cassete Sala de Espera'},
  ],
  'transitions': ['CANCELLED'],
};

final _customers = [
  {
    'id': 'c-1',
    'type': 'COMPANY',
    'legalName': 'Clínica Odontológica Sol Nascente LTDA',
    'tradeName': 'Clínica Sol Nascente',
    'documentNumber': '12.345.678/0001-95',
    'email': 'contato@clinicasol.com.br',
    'phone': '(81) 99999-0000',
    'status': 'ACTIVE',
    'notes': 'Acesso pela recepção; falar com Ana.',
  },
  {
    'id': 'c-2',
    'type': 'INDIVIDUAL',
    'legalName': 'João Pedro Albuquerque',
    'status': 'PROSPECT',
  },
  {
    'id': 'c-3',
    'type': 'COMPANY',
    'legalName': 'Padaria Lua Cheia',
    'status': 'BLOCKED',
  },
];

final _entries = [
  {
    'id': 'e-1',
    'description': 'Manutenção mensal — Clínica Sol',
    'type': 'INCOME',
    'amount': '1850.00',
    'status': 'CONFIRMED',
    'dueDate': '2026-11-20',
  },
  {
    'id': 'e-2',
    'description': 'Compra de gás refrigerante R-410A',
    'type': 'EXPENSE',
    'amount': '12430.90',
    'status': 'PENDING',
    'dueDate': '2026-11-28',
  },
];

final _sale = {
  'id': 's-1',
  'customerName': 'Clínica Odontológica Sol Nascente LTDA',
  'paidOn': '2026-11-21',
  'total': '1260.00',
  'discount': '40.00',
  'receipt': {'code': 'REC-000123', 'renderStatus': 'READY'},
  'items': [
    {
      'name': 'Filtro de ar lavável 12k',
      'unit': 'un',
      'quantity': '2.000',
      'total': '300.00',
    },
    {
      'name': 'Gás refrigerante R-410A (kg)',
      'unit': 'kg',
      'quantity': '3.500',
      'total': '1000.00',
    },
  ],
  'payments': [
    {'method': 'PIX', 'amount': '1000.00'},
    {'method': 'CREDIT_CARD', 'amount': '260.00', 'installments': 2},
  ],
  'notes': 'Retirada no balcão.',
};

final _members = [
  {
    'id': 'u-2',
    'displayName': 'Marina Duarte da Silva',
    'email': 'marina@clima-norte.com',
    'status': 'ACTIVE',
    'role': {'key': 'FIELD_TECHNICIAN', 'name': 'Técnico Operacional'},
    'businessUnits': [
      {'name': 'Matriz Recife'},
    ],
  },
  {
    'id': 'u-3',
    'displayName': 'Carlos Henrique',
    'email': 'carlos@clima-norte.com',
    'status': 'SUSPENDED',
    'role': {'key': 'FIELD_TECHNICIAN', 'name': 'Técnico Operacional'},
  },
];

Object _payload(RequestOptions request) {
  final path = request.uri.path.replaceFirst(RegExp(r'^.*/api/v1'), '');
  return switch (path) {
    '/operations' => {
      'data': [
        _operation(2, 'SCHEDULED'),
        _operation(3, 'IN_PROGRESS'),
        _operation(4, 'COMPLETED'),
        _operation(5, 'CANCELLED'),
      ],
    },
    '/operations/op-2' => _operation(2, 'SCHEDULED'),
    '/customers' => {'data': _customers, 'hasNextPage': true},
    '/customers/c-1' => _customers.first,
    '/financial/entries' => {'data': _entries},
    '/sales' => {
      'data': [_sale],
    },
    '/organizations/current/members' => {'data': _members},
    _ => {'data': <Object>[]},
  };
}

final _capturar = Platform.environment['ORBIT_CAPTURE'] == '1';

Future<void> _foto(WidgetTester tester, String nome) async {
  if (!_capturar) return;
  await expectLater(
    find.byType(MaterialApp),
    matchesGoldenFile(
      'out_owner/${captureWidth.toInt()}_${captureScale}_$nome.png',
    ),
  );
}

Widget _app() {
  final adapter = ScriptedAdapter(
    (request) async =>
        jsonResponse({'success': true, 'data': _payload(request)}),
  );
  final client = OrbitApiClient.create(
    environment: OrbitEnvironment.fromDefines(),
    storage: InMemoryTokenStorage(),
    logger: const OrbitLogger(isProduction: true),
    dio: Dio()..httpClientAdapter = adapter,
    retryDio: Dio()..httpClientAdapter = adapter,
  );
  return ProviderScope(
    overrides: [
      apiClientProvider.overrideWithValue(client),
      sessionProvider.overrideWithValue(sessionFrom(isOrganizationOwner: true)),
      ownerAccessProvider.overrideWith(
        (_) async => const OwnerAccess(_areas, true),
      ),
    ],
    child: MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: OrbitTheme.light(),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(captureScale)),
        child: child!,
      ),
      home: const OwnerScreen(),
    ),
  );
}

void main() {
  setUpAll(() async {
    await initializeDateFormatting('pt_BR');
  });

  Future<void> abrir(WidgetTester tester, String rotulo) async {
    /* Listas preguiçosas: o que está fora da tela ainda não existe. */
    if (find.text(rotulo).evaluate().isEmpty) {
      await tester.scrollUntilVisible(
        find.text(rotulo),
        300,
        scrollable: find.byType(Scrollable).last,
      );
    }
    final alvo = find.text(rotulo).first;
    await tester.ensureVisible(alvo);
    await tester.pumpAndSettle();
    await tester.tap(alvo);
    await tester.pumpAndSettle();
  }

  for (final (largura, escala) in [(390.0, 1.0), (320.0, 1.3)]) {
    group('${largura.toInt()}px ${escala}x', () {
      setUp(() {
        captureWidth = largura;
        captureScale = escala;
      });

      Future<void> iniciar(WidgetTester tester) async {
        await carregarFontes();
        prepararTela(tester);
        await tester.pumpWidget(_app());
        await tester.pumpAndSettle();
      }

      testWidgets('menu', (tester) async {
        await iniciar(tester);
        expect(find.text('HOJE'), findsOneWidget);
        expect(find.text('ATENDIMENTOS'), findsOneWidget);
        await _foto(tester, '1_menu');
      });

      testWidgets('operações e ficha', (tester) async {
        await iniciar(tester);
        await abrir(tester, 'Operações e OS');
        expect(find.text('Em andamento'), findsOneWidget);
        await _foto(tester, '2_operacoes');
        await abrir(
          tester,
          'Limpeza completa e verificação de carga de gás dos splits da recepção',
        );
        expect(find.text('Técnico responsável'), findsOneWidget);
        expect(find.text('Cancelar atendimento'), findsOneWidget);
        await _foto(tester, '3_operacao_ficha');
      });

      testWidgets('clientes, ficha e formulário', (tester) async {
        await iniciar(tester);
        await abrir(tester, 'Clientes');
        expect(find.text('Prospecto'), findsOneWidget);
        await _foto(tester, '4_clientes');
        await abrir(tester, 'Clínica Sol Nascente');
        expect(find.text('CNPJ'), findsOneWidget);
        await _foto(tester, '5_cliente_ficha');
        Navigator.of(tester.element(find.text('CNPJ'))).pop();
        await tester.pumpAndSettle();
        await abrir(tester, 'Novo cliente');
        expect(find.text('Campos com * são obrigatórios.'), findsOneWidget);
        await _foto(tester, '6_cliente_formulario');
      });

      testWidgets('entradas e saídas', (tester) async {
        await iniciar(tester);
        await abrir(tester, 'Entradas e saídas');
        expect(find.textContaining('12.430,90'), findsOneWidget);
        await _foto(tester, '7_financeiro');
      });

      testWidgets('vendas e recibo', (tester) async {
        await iniciar(tester);
        await abrir(tester, 'Vendas');
        await _foto(tester, '8_vendas');
        await abrir(tester, 'Clínica Odontológica Sol Nascente LTDA');
        expect(find.text('Recibo pronto'), findsWidgets);
        await _foto(tester, '9_venda_recibo');
      });

      testWidgets('equipe e ficha', (tester) async {
        await iniciar(tester);
        await abrir(tester, 'Equipe de campo');
        expect(find.text('Suspenso'), findsOneWidget);
        await _foto(tester, '10_equipe');
        await abrir(tester, 'Marina Duarte da Silva');
        expect(find.text('Desligar da equipe'), findsOneWidget);
        await _foto(tester, '11_equipe_ficha');
      });
    });
  }
}
