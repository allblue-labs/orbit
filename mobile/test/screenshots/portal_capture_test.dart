/// A área do cliente renderizada de verdade — páginas, fichas e perfil.
///
/// Dados de propósito difíceis: nomes longos, equipamentos sem fabricante,
/// documentos de todas as categorias, texto ampliado. Overflow de layout vira
/// falha de teste; com `ORBIT_CAPTURE=1` e `--update-goldens` as telas viram PNG em
/// `test/screenshots/out_portal/` para conferir a olho.
library;

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:mocktail/mocktail.dart';
import 'package:orbit_operator/core/theme/orbit_theme.dart';
import 'package:orbit_operator/features/customer_portal/application/portal_session.dart';
import 'package:orbit_operator/features/customer_portal/data/portal_contracts.dart';
import 'package:orbit_operator/features/customer_portal/data/portal_repository.dart';
import 'package:orbit_operator/features/customer_portal/presentation/portal_profile.dart';
import 'package:orbit_operator/features/customer_portal/presentation/portal_shell_screen.dart';
import 'package:orbit_operator/features/customer_portal/presentation/service_request_wizard.dart';
import 'package:orbit_operator/features/customer_portal/presentation/service_requests_page.dart';
import 'package:orbit_operator/features/legal/data/legal_repository.dart';

import '../support/fakes.dart';
import 'harness.dart';

class _Repo extends Mock implements PortalRepository {}

final _me = PortalMe.fromJson(const {
  'identity': {
    'id': 'i-1',
    'displayName': 'Clínica Odontológica Sol Nascente',
    'email': 'clinica.sol@clima-norte.com',
  },
  'organization': {'slug': 'clima-norte', 'displayName': 'Clima Norte'},
  'customer': {
    'id': 'c-1',
    'displayName': 'Clínica Odontológica Sol Nascente LTDA',
  },
});

Map<String, dynamic> _operacao(int n, String status, String rotulo) => {
  'id': 'op-$n',
  'code': 'OS-00008$n',
  'type': 'Manutenção preventiva',
  'title': n.isEven
      ? 'Limpeza completa e verificação de carga de gás dos splits da recepção'
      : 'Visita técnica',
  'status': {'code': status, 'label': rotulo},
  'scheduledStart': '2026-11-${10 + n}T13:00:00.000Z',
  'completedAt': status == 'completed'
      ? '2026-11-${10 + n}T16:30:00.000Z'
      : null,
  'businessUnit': {'displayName': 'Clima Norte Matriz'},
  'assets': [
    {'id': 'a-1', 'displayName': 'Split Recepção 12.000 BTUs'},
    if (n.isEven) {'id': 'a-2', 'displayName': 'Cassete Sala de Espera'},
  ],
  'responsibleTechnician': {'displayName': 'Marina Duarte da Silva'},
  'location': 'Av. Boa Viagem, 3200 — Recife/PE',
  'documentId': status == 'completed' ? 'doc-$n' : null,
  'description':
      'Troca de filtros, limpeza das serpentinas e medição de corrente.',
  'timeline': [
    {
      'id': 't1',
      'event': 'Concluído',
      'description': 'Atendimento concluído',
      'occurredAt': '2026-11-12T16:30:00.000Z',
    },
    {
      'id': 't2',
      'event': 'Iniciado',
      'description': 'Técnico iniciou o atendimento',
      'occurredAt': '2026-11-12T13:05:00.000Z',
    },
  ],
};

Map<String, dynamic> _equipamento(int n, {bool completo = true}) => {
  'id': 'a-$n',
  'displayName': n == 1
      ? 'Split Recepção 12.000 BTUs Inverter Hi-Wall'
      : 'Cassete Sala de Espera',
  'category': 'Ar-condicionado',
  'manufacturer': completo ? 'Daikin' : null,
  'model': completo ? 'FTKP12Q5VL' : null,
  'serialNumber': completo ? 'SN-2024-000873' : null,
  'identifier': 'EQ-00$n',
  'location': 'Recepção — Térreo',
  'status': {
    'code': n == 2 ? 'maintenance' : 'active',
    'label': n == 2 ? 'Em manutenção' : 'Ativo',
  },
  'installedOn': '2024-03-15',
  'warrantyUntil': '2027-03-15',
  'related': {'operations': 4, 'documents': 3},
};

Map<String, dynamic> _documento(int n, String categoria, String rotulo) => {
  'id': 'doc-$n',
  'fileName': 'documento-$n.pdf',
  'title': n == 1
      ? 'Relatório de manutenção preventiva — Splits da recepção e sala de espera'
      : '$rotulo OS-00008$n',
  'code': 'OS-00008$n',
  'category': categoria,
  'categoryLabel': rotulo,
  'operationId': 'op-$n',
  'issuedAt': '2026-11-1${n}T16:30:00.000Z',
  'sizeBytes': 120000,
};

Map<String, dynamic> _chamado(
  String status,
  String rotulo, {
  List<String>? acoes,
}) => {
  'id': 'csr-$status',
  'code': 'CH-2026-${status.substring(0, 3)}',
  'category': {'code': 'EQUIPMENT_PROBLEM', 'label': 'Problema em equipamento'},
  'subject': 'Ar da recepção desligou sozinho e não liga mais',
  'status': {'code': status, 'label': rotulo},
  'urgency': {'code': 'URGENT', 'label': 'Urgente'},
  'asset': {
    'id': 'a-1',
    'name': 'Split Recepção 12.000 BTUs',
    'identifier': 'EQ-001',
  },
  'submittedAt': '2026-11-20T12:00:00.000Z',
  'updatedAt': '2026-11-20T15:00:00.000Z',
  'version': 3,
  'allowedActions': acoes ?? ['REPLY'],
  'description': 'Desligou durante a manhã. O visor mostra E5 e não liga mais.',
  'details': {
    'equipmentCondition': {'code': 'STOPPED', 'label': 'Parado'},
    'siteLocation': 'Recepção, térreo',
    'availability': 'Hoje até 18h',
    'contactName': 'Ana Souza',
    'contactPhone': '(81) 99999-0000',
  },
  'timeline': [
    {
      'id': 'e1',
      'type': 'CREATED',
      'actor': {'type': 'CUSTOMER_PORTAL', 'displayName': 'Clínica'},
      'message': null,
      'statusChange': {'from': null, 'to': 'OPEN'},
      'createdAt': '2026-11-20T12:00:00.000Z',
    },
    {
      'id': 'e2',
      'type': 'STATUS_CHANGED',
      'actor': {'type': 'INTERNAL_USER', 'displayName': 'Marina Duarte'},
      'message': 'Podemos ir hoje às 16h. Alguém estará no local?',
      'statusChange': {'from': 'OPEN', 'to': 'WAITING_CUSTOMER'},
      'createdAt': '2026-11-20T13:00:00.000Z',
    },
    {
      'id': 'e3',
      'type': 'CUSTOMER_MESSAGE',
      'actor': {'type': 'CUSTOMER_PORTAL', 'displayName': 'Clínica'},
      'message': 'Sim, a Ana recebe vocês.',
      'statusChange': {'from': 'WAITING_CUSTOMER', 'to': 'IN_PROGRESS'},
      'createdAt': '2026-11-20T13:20:00.000Z',
    },
  ],
};

PortalPage<T> _page<T>(List<T> items) =>
    PortalPage(items: items, total: items.length, hasNextPage: false);

_Repo _repositorio({bool comAssinatura = false}) {
  final repo = _Repo();
  when(
    () => repo.authenticator,
  ).thenReturn(InMemorySessionAuthenticator.create());
  when(() => repo.summary()).thenAnswer(
    (_) async => PortalSummary.fromJson(const {
      'recentOperations': 4,
      'assets': 2,
      'activePmocPlans': 1,
      'upcomingVisits': 1,
      'availableDocuments': 4,
    }),
  );
  final operacoes = [
    _operacao(1, 'scheduled', 'Agendado'),
    _operacao(2, 'completed', 'Concluído'),
    _operacao(3, 'inProgress', 'Em andamento'),
    _operacao(4, 'completed', 'Concluído'),
  ].map(PortalOperation.fromJson).toList();
  when(
    () => repo.operations(
      page: any(named: 'page'),
      assetId: any(named: 'assetId'),
      limit: any(named: 'limit'),
    ),
  ).thenAnswer((_) async => _page(operacoes));
  when(() => repo.operation(any())).thenAnswer(
    (_) async =>
        PortalOperation.fromJson(_operacao(2, 'completed', 'Concluído')),
  );
  final equipamentos = [
    PortalAsset.fromJson(_equipamento(1)),
    PortalAsset.fromJson(_equipamento(2, completo: false)),
  ];
  when(
    () => repo.assets(
      page: any(named: 'page'),
      search: any(named: 'search'),
    ),
  ).thenAnswer((_) async => _page(equipamentos));
  when(
    () => repo.asset(any()),
  ).thenAnswer((_) async => PortalAsset.fromJson(_equipamento(1)));
  final documentos = [
    _documento(1, 'service', 'Relatório de atendimento'),
    _documento(2, 'pmoc', 'PMOC'),
    _documento(3, 'quote', 'Orçamento'),
    _documento(4, 'receipt', 'Recibo'),
  ].map(PortalDocument.fromJson).toList();
  when(
    () => repo.documents(
      page: any(named: 'page'),
      category: any(named: 'category'),
      operationId: any(named: 'operationId'),
      assetId: any(named: 'assetId'),
      limit: any(named: 'limit'),
    ),
  ).thenAnswer((_) async => _page(documentos));
  when(() => repo.profile()).thenAnswer(
    (_) async => comAssinatura
        ? const PortalProfile(
            avatar: PortalMedia.none,
            signature: PortalMedia(available: true),
          )
        : PortalProfile.empty,
  );
  final chamados = [
    _chamado('WAITING_CUSTOMER', 'Aguardando cliente'),
    _chamado('OPEN', 'Aberto', acoes: ['EDIT', 'REPLY', 'CANCEL']),
    _chamado('RESOLVED', 'Resolvido', acoes: []),
  ].map(ServiceRequest.fromJson).toList();
  when(
    () => repo.serviceRequests(page: any(named: 'page')),
  ).thenAnswer((_) async => _page(chamados));
  when(() => repo.serviceRequest(any())).thenAnswer(
    (_) async => ServiceRequest.fromJson(
      _chamado('IN_PROGRESS', 'Em atendimento', acoes: ['REPLY']),
    ),
  );
  return repo;
}

Widget _app(Widget home, _Repo repo) => ProviderScope(
  overrides: [
    portalTokenStorageProvider.overrideWithValue(InMemoryTokenStorage()),
    portalRepositoryProvider.overrideWithValue(repo),
    portalSessionProvider.overrideWith(
      (ref) => PortalSessionController(
        repository: repo,
        authenticator: repo.authenticator,
        initial: PortalSignedIn(_me),
      ),
    ),
    legalDocumentProvider.overrideWith(
      (ref, kind) async => LegalDocument(
        title: kind.title,
        version: '2026-11-01',
        effectiveAt: '2026-11-01',
        provider: const {},
        sections: const [],
      ),
    ),
  ],
  child: MaterialApp(
    theme: OrbitTheme.light(),
    debugShowCheckedModeBanner: false,
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(
        context,
      ).copyWith(textScaler: TextScaler.linear(captureScale)),
      child: child!,
    ),
    home: home,
  ),
);

/// Imagens só quando pedidas (`ORBIT_CAPTURE=1 flutter test … --update-goldens`).
/// Sem isso o teste renderiza e falha só por erro de layout — as imagens são
/// para conferir a olho, não um contrato pixel a pixel.
final _capturar = Platform.environment['ORBIT_CAPTURE'] == '1';

Future<void> _foto(WidgetTester tester, String nome) async {
  if (!_capturar) return;
  await expectLater(
    find.byType(MaterialApp),
    matchesGoldenFile(
      'out_portal/${captureWidth.toInt()}_${captureScale}_$nome.png',
    ),
  );
}

void main() {
  setUpAll(() async {
    await initializeDateFormatting('pt_BR');
  });

  for (final (largura, escala) in [(390.0, 1.0), (320.0, 1.3)]) {
    group('${largura.toInt()}px ${escala}x', () {
      setUp(() {
        captureWidth = largura;
        captureScale = escala;
      });

      testWidgets('início', (tester) async {
        await carregarFontes();
        prepararTela(tester);
        await tester.pumpWidget(
          _app(const PortalShellScreen(), _repositorio()),
        );
        await tester.pumpAndSettle();
        await _foto(tester, '1_inicio');
      });

      testWidgets('equipamentos', (tester) async {
        await carregarFontes();
        prepararTela(tester);
        await tester.pumpWidget(
          _app(const PortalShellScreen(), _repositorio()),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.text('Equipamentos').last);
        await tester.pumpAndSettle();
        await _foto(tester, '2_equipamentos');
      });

      testWidgets('documentos', (tester) async {
        await carregarFontes();
        prepararTela(tester);
        await tester.pumpWidget(
          _app(const PortalShellScreen(), _repositorio()),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.text('Documentos').last);
        await tester.pumpAndSettle();
        await _foto(tester, '3_documentos');
      });

      testWidgets('ficha do atendimento', (tester) async {
        await carregarFontes();
        prepararTela(tester);
        await tester.pumpWidget(
          _app(const PortalShellScreen(), _repositorio()),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.textContaining('Limpeza completa').first);
        await tester.pumpAndSettle();
        await _foto(tester, '4_atendimento');
      });

      testWidgets('ficha do equipamento', (tester) async {
        await carregarFontes();
        prepararTela(tester);
        await tester.pumpWidget(
          _app(const PortalShellScreen(), _repositorio()),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.text('Equipamentos').last);
        await tester.pumpAndSettle();
        await tester.tap(find.textContaining('Split Recepção').first);
        await tester.pumpAndSettle();
        await _foto(tester, '5_equipamento');
      });

      testWidgets('perfil', (tester) async {
        await carregarFontes();
        prepararTela(tester);
        await tester.pumpWidget(
          _app(const PortalShellScreen(), _repositorio()),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Seu perfil'));
        await tester.pumpAndSettle();
        await _foto(tester, '6_perfil');
      });

      testWidgets('chamados', (tester) async {
        await carregarFontes();
        prepararTela(tester);
        await tester.pumpWidget(
          _app(const PortalShellScreen(), _repositorio()),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.text('Chamados').last);
        await tester.pumpAndSettle();
        await _foto(tester, '8_chamados');
      });

      testWidgets('ficha do chamado', (tester) async {
        await carregarFontes();
        prepararTela(tester);
        await tester.pumpWidget(
          _app(const PortalShellScreen(), _repositorio()),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.text('Chamados').last);
        await tester.pumpAndSettle();
        await tester.tap(find.byType(ServiceRequestCard).first);
        await tester.pumpAndSettle();
        await _foto(tester, '9_chamado');
        await tester.drag(find.text('O QUE VOCÊ PEDIU'), const Offset(0, -500));
        await tester.pumpAndSettle();
        await _foto(tester, '9b_chamado_conversa');
      });

      for (final passo in [0, 1, 2, 3, 4]) {
        testWidgets('assistente — passo ${passo + 1}', (tester) async {
          await carregarFontes();
          prepararTela(tester);
          await tester.pumpWidget(
            _app(const ServiceRequestWizard(), _repositorio()),
          );
          await tester.pumpAndSettle();
          if (passo >= 1) {
            await tester.tap(find.text('Problema em equipamento'));
            await tester.tap(find.byKey(const Key('wizard.next')));
            await tester.pumpAndSettle();
          }
          if (passo >= 2) {
            await tester.tap(find.textContaining('Split Recepção').first);
            await tester.pumpAndSettle();
            await tester.tap(find.text('Parado'));
            await tester.pumpAndSettle();
            if (passo == 1) return;
            await tester.tap(find.byKey(const Key('wizard.next')));
            await tester.pumpAndSettle();
            await tester.enterText(
              find.byKey(const Key('wizard.description')),
              'Desligou sozinho e o visor mostra E5.',
            );
            await tester.pumpAndSettle();
          }
          if (passo >= 3) {
            await tester.tap(find.byKey(const Key('wizard.next')));
            await tester.pumpAndSettle();
          }
          if (passo >= 4) {
            await tester.tap(find.byKey(const Key('wizard.next')));
            await tester.pumpAndSettle();
          }
          await _foto(tester, '10_assistente_${passo + 1}');
        });
      }

      testWidgets('cadastro da assinatura', (tester) async {
        await carregarFontes();
        prepararTela(tester);
        await tester.pumpWidget(
          _app(const PortalSignatureCaptureScreen(), _repositorio()),
        );
        await tester.pumpAndSettle();
        await _foto(tester, '7_assinatura');
      });
    });
  }
}
