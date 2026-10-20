/// Capturas das telas reais, para olhar.
///
/// Não é teste de regressão: é o instrumento para julgar a interface. Roda com
/// `flutter test test/screenshots/capture_test.dart --update-goldens` e as
/// imagens saem em `test/screenshots/out/`.
library;

import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:orbit_operator/app/providers.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/contracts/session_contracts.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/core/theme/orbit_theme.dart';
import 'package:orbit_operator/features/field/presentation/field_dashboard_screen.dart';
import 'package:orbit_operator/features/authentication/domain/session.dart';
import 'package:orbit_operator/features/operations/data/operations_repository.dart';
import 'package:orbit_operator/features/operations/presentation/operations_screen.dart';
import 'package:orbit_operator/features/customers/presentation/customers_screen.dart';
import 'package:orbit_operator/features/field/presentation/work_item_detail_screen.dart';
import 'package:orbit_operator/features/field/presentation/work_queue_screen.dart';
import 'package:orbit_operator/features/scheduling/presentation/agenda_screen.dart';
import 'package:orbit_operator/features/signature/presentation/my_signature_screen.dart';

import '../support/fakes.dart';
import '../support/scripted_adapter.dart';
import 'harness.dart';
import 'package:orbit_operator/features/documents/presentation/documents_screen.dart';
import 'package:orbit_operator/features/authentication/presentation/change_password_screen.dart';
import 'package:orbit_operator/features/authentication/presentation/login_screen.dart';
import 'package:orbit_operator/features/notifications/presentation/notifications_screen.dart';
import 'package:orbit_operator/features/profile/presentation/profile_screen.dart';
import 'package:orbit_operator/features/sync/presentation/sync_center_screen.dart';
import 'package:orbit_operator/features/profile/presentation/settings_screen.dart';
import 'package:orbit_operator/core/design/orbit_operational.dart';
import 'package:orbit_operator/core/routing/app_shell.dart';
import 'package:orbit_operator/core/routing/orbit_router.dart';
import 'package:orbit_operator/features/field/presentation/operation_execution_screen.dart';
import 'package:orbit_operator/features/sync/application/sync_providers.dart';
import 'package:orbit_operator/features/sync/data/command_journal.dart';
import 'package:orbit_operator/features/evidence/application/evidence_providers.dart';
import 'package:orbit_operator/features/evidence/data/media_store.dart';
import 'package:orbit_operator/features/sync/data/journal_file.dart';
import 'package:orbit_operator/features/sync/data/sync_projection.dart';

Map<String, dynamic> item({
  required String id,
  required String titulo,
  required String cliente,
  required String unidade,
  String dueState = 'DUE_TODAY',
  String status = 'SCHEDULED',
  String? quando = '2026-09-08T12:00:00.000Z',
  List<String> acoes = const ['VIEW', 'START', 'REQUEST_CANCELLATION'],
  List<Map<String, dynamic>> equipamentos = const [],

  /// O endereço do atendimento, com o que a tela passou a destacar.
  ///
  /// Presente por padrão porque é o caso comum — e porque sem ele a captura não
  /// mostra complemento nem ponto de referência, que são justamente o que o
  /// redesenho veio resolver.
  Map<String, dynamic>? endereco = const {
    'label': 'Matriz',
    'street': 'Av. Agamenon Magalhães',
    'number': '1200',
    'complement': 'Bloco B, 4º andar',
    'district': 'Boa Vista',
    'city': 'Recife',
    'stateCode': 'PE',
    'postalCode': '50050-000',
    'reference': 'Portão azul nos fundos; falar com a portaria.',
    'sector': 'Casa de máquinas',
  },
  String? tipo = 'Manutenção',
}) => {
  'id': 'SERVICE_OPERATION:$id',
  'kind': 'SERVICE_OPERATION',
  'sourceId': id,
  'title': titulo,
  'businessUnit': {'id': 'bu', 'name': unidade},
  'customer': {
    'id': 'c$id',
    'name': cliente,
    'contact': {
      'name': 'Dona Rita',
      'phone': '+55 81 98888-0000',
      'email': null,
    },
  },
  if (endereco != null) 'serviceAddress': endereco,
  if (tipo != null) 'serviceType': tipo,
  'timezone': 'America/Recife',
  'scheduledFor': quando,
  'dueState': dueState,
  'operationalStatus': status,
  'auxiliaryTechnicians': const [],
  'equipmentSummary': equipamentos,
  'allowedActions': acoes,
  'navigationContext': {'kind': 'SERVICE_OPERATION', 'sourceId': id},
  'updatedAt': '2026-09-08T10:00:00.000Z',
};

Map<String, dynamic> doc({
  required String id,
  required String tipo,
  required String rotulo,
  required String cliente,
  String estado = 'AVAILABLE',
  String quando = '2026-09-08T14:00:00.000Z',
}) => {
  'artifactId': id,
  'documentType': tipo,
  'label': rotulo,
  'customerName': cliente,
  'createdAt': quando,
  'state': estado,
};

final _captureNow = DateTime(2026, 9, 8, 9);

final payloadRico = {
  'dashboard': {
    'next': item(
      id: '1',
      titulo: 'Manutenção preventiva — Chiller 40TR',
      cliente: 'Shopping Recife',
      unidade: 'Matriz',
      quando: '2026-09-08T12:30:00.000Z',
      equipamentos: const [
        {'id': 'e1', 'tag': 'CH-01', 'name': 'Chiller Carrier 40TR'},
      ],
    ),
    'counters': {'today': 6, 'overdue': 2, 'inProgress': 1, 'upcoming': 9},
    'today': [
      item(
        id: '1',
        titulo: 'Manutenção preventiva — Chiller 40TR',
        cliente: 'Shopping Recife',
        unidade: 'Matriz',
        quando: '2026-09-08T12:30:00.000Z',
      ),
      item(
        id: '2',
        titulo: 'Corretiva — Split não gela',
        cliente: 'Hospital Santa Joana',
        unidade: 'Matriz',
        quando: '2026-09-08T15:00:00.000Z',
      ),
      item(
        id: '3',
        titulo: 'PMOC trimestral — Casa de máquinas',
        cliente: 'Edifício Empresarial Norte',
        unidade: 'Filial Sul',
        quando: '2026-09-08T17:30:00.000Z',
      ),
    ],
    'overdue': [
      item(
        id: '9',
        titulo: 'Corretiva — Vazamento de gás',
        cliente: 'Frigorífico Boa Carne',
        unidade: 'Filial Sul',
        dueState: 'OVERDUE',
        quando: '2026-09-05T09:00:00.000Z',
      ),
    ],
    'inProgress': [
      item(
        id: '5',
        titulo: 'Instalação — VRF 8 evaporadoras',
        cliente: 'Clínica Vida',
        unidade: 'Matriz',
        status: 'IN_PROGRESS',
        dueState: 'IN_PROGRESS',
        acoes: const ['VIEW', 'RESUME'],
      ),
    ],
    'capabilities': {'canScanEquipment': true, 'canCreateAdHocRvt': true},
  },
  'recentDocuments': [
    doc(
      id: 'a1',
      tipo: 'SERVICE_ORDER',
      rotulo: 'Ordem de serviço 2026-0148',
      cliente: 'Shopping Recife',
      quando: '2026-09-08T11:20:00.000Z',
    ),
    doc(
      id: 'a2',
      tipo: 'RVT',
      rotulo: 'Relatório de visita técnica',
      cliente: 'Hospital Santa Joana',
      quando: '2026-09-08T08:05:00.000Z',
    ),
    doc(
      id: 'a3',
      tipo: 'PMOC',
      rotulo: 'PMOC — ciclo mensal',
      cliente: 'Frigorífico Boa Carne',
      estado: 'PREPARING',
      quando: '2026-09-07T16:40:00.000Z',
    ),
    doc(
      id: 'a4',
      tipo: 'SERVICE_ORDER',
      rotulo: 'Ordem de serviço 2026-0147',
      cliente: 'Clínica Vida',
      quando: '2026-09-07T10:15:00.000Z',
    ),
    doc(
      id: 'a5',
      tipo: 'RVT',
      rotulo: 'Relatório de visita técnica',
      cliente: 'Supermercado Nordeste — Loja Boa Viagem',
      quando: '2026-09-04T15:30:00.000Z',
    ),
    doc(
      id: 'a6',
      tipo: 'SERVICE_ORDER',
      rotulo: 'Ordem de serviço 2026-0141',
      cliente: 'Shopping Recife',
      estado: 'FAILED',
      quando: '2026-09-04T09:00:00.000Z',
    ),
  ],
  'recentAppointments': const [],
};

late Uint8List _signaturePng;

Future<Uint8List> _signatureFixture() async {
  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder)..drawColor(Colors.white, BlendMode.src);
  final ink = Paint()
    ..color = const Color(0xFF172033)
    ..style = PaintingStyle.stroke
    ..strokeWidth = 6
    ..strokeCap = StrokeCap.round
    ..strokeJoin = StrokeJoin.round;
  final path = Path()
    ..moveTo(70, 118)
    ..cubicTo(120, 24, 122, 156, 166, 82)
    ..cubicTo(188, 45, 193, 132, 226, 86)
    ..cubicTo(258, 42, 250, 137, 296, 91)
    ..cubicTo(330, 56, 344, 111, 390, 82)
    ..cubicTo(425, 60, 452, 103, 520, 75);
  canvas.drawPath(path, ink);
  canvas.drawLine(
    const Offset(92, 137),
    const Offset(520, 137),
    ink..strokeWidth = 3,
  );
  final image = await recorder.endRecording().toImage(600, 180);
  final data = await image.toByteData(format: ui.ImageByteFormat.png);
  image.dispose();
  return data!.buffer.asUint8List();
}

Future<void> _settleMemoryImages(WidgetTester tester) async {
  final images = tester.widgetList<Image>(find.byType(Image)).toList();
  if (images.isEmpty) return;
  final context = tester.element(find.byType(MaterialApp));
  await tester.runAsync(() async {
    for (final image in images) {
      await precacheImage(image.image, context);
    }
  });
  await tester.pumpAndSettle();
}

Widget host(
  Map<String, dynamic> payload,
  Widget tela, {
  bool profile = false,
  OrbitSession? session,
}) {
  Future<ResponseBody> handler(RequestOptions options) async {
    /// Avisos: a home lê `/notifications` em paralelo, e sem uma resposta
    /// aqui o carrossel simplesmente não aparece na captura.
    /// Clientes do filtro: sem esta resposta a folha mostra um erro na
    /// captura, e o erro é do fixture, não da tela.
    /// Preferências de aviso: `data` é uma **lista**, não um objeto.
    ///
    /// O fixture antigo vinha embrulhado duas vezes (`data.data`), e o
    /// repositório desembrulhava duas vezes junto — os dois errados do mesmo
    /// jeito, então a captura passava. Contra o servidor de verdade a tela
    /// mostraria tudo ligado, em silêncio.
    if (options.uri.path.endsWith('/notifications/preferences')) {
      return jsonResponse({
        'success': true,
        'data': [
          {
            'type': 'WORK_ASSIGNED',
            'enabled': true,
            'channels': ['IN_APP', 'REALTIME', 'PUSH'],
          },

          /// Um desligado de propósito: com todos ligados a captura não
          /// mostraria como é o estado desligado.
          {
            'type': 'SYNC_ATTENTION_REQUIRED',
            'enabled': false,
            'channels': <String>[],
          },

          /// `ARTIFACT_AVAILABLE` fica **ausente** — é o caso que o servidor
          /// não guarda, e que a tela precisa desenhar como ligado.
        ],
      });
    }

    if (options.uri.path.endsWith('/mobile/field/customers')) {
      return jsonResponse({
        'success': true,
        'data': {
          'data': [
            {
              'id': 'c1',
              'name': 'Shopping Recife',
              'legalName': 'Shopping Recife S.A.',
              'documentNumber': '12345678000190',
              'status': 'ACTIVE',
              'openCount': 4,
              'completedCount': 18,
              'lastServiceAt': '2026-09-05T14:00:00.000Z',
              'nextServiceAt': '2026-09-08T12:30:00.000Z',
            },
            {
              'id': 'c2',
              'name': 'Hospital Santa Joana',
              'legalName': 'Hospital Santa Joana LTDA',
              'documentNumber': null,
              'status': 'ACTIVE',
              'openCount': 2,
              'completedCount': 31,
              'lastServiceAt': '2026-09-06T09:00:00.000Z',
              'nextServiceAt': '2026-09-08T15:00:00.000Z',
            },
            {
              'id': 'c3',
              'name': 'Frigorífico Boa Carne',
              'legalName': 'Frigorífico Boa Carne ME',
              'documentNumber': null,
              'status': 'ACTIVE',
              'openCount': 1,
              'completedCount': 7,
              'lastServiceAt': '2026-08-28T11:00:00.000Z',
              'nextServiceAt': null,
            },
            {
              'id': 'c4',
              'name': 'Condomínio Parque das Águas',
              'legalName': 'Condomínio Parque das Águas',
              'documentNumber': null,
              'status': 'ACTIVE',
              'openCount': 0,
              'completedCount': 0,
              'lastServiceAt': null,
              'nextServiceAt': null,
            },
          ],
          'meta': {'limit': 30, 'hasNextPage': false, 'nextCursor': null},
        },
      });
    }

    if (options.uri.path.endsWith('/mobile/field/queue-customers')) {
      return jsonResponse({
        'success': true,
        'data': [
          {'id': 'c1', 'name': 'Shopping Recife', 'workCount': 12},
          {'id': 'c2', 'name': 'Hospital Santa Joana', 'workCount': 7},
          {'id': 'c3', 'name': 'Frigorífico Boa Carne', 'workCount': 3},
        ],
      });
    }

    if (options.uri.path.endsWith('/notifications')) {
      return jsonResponse({
        'success': true,
        'data': {
          'data': [
            {
              'id': 'n1',
              'type': 'WORK_ASSIGNED',
              'title': 'Novo atendimento atribuído',
              'body': 'Hospital Santa Joana — corretiva para hoje às 15h.',
              'readAt': null,
              'createdAt': '2026-09-08T11:00:00.000Z',
              'payload': <String, dynamic>{},
            },
            {
              'id': 'n2',
              'type': 'PMOC_DUE_SOON',
              'title': 'PMOC vence em 3 dias',
              'body': 'Edifício Empresarial Norte — ciclo trimestral.',
              'readAt': null,
              'createdAt': '2026-09-08T09:00:00.000Z',
              'payload': <String, dynamic>{},
            },

            /// Um já lido: sem ele a captura não mostraria o segundo grupo
            /// nem a diferença entre lido e não lido.
            {
              'id': 'n3',
              'type': 'ARTIFACT_AVAILABLE',
              'title': 'Documento disponível',
              'body': 'Ordem de serviço 2026-0141 — Shopping Recife.',
              'readAt': '2026-09-07T18:10:00.000Z',
              'createdAt': '2026-09-07T17:45:00.000Z',
              'payload': <String, dynamic>{},
            },
          ],
          'meta': {
            'page': 1,
            'limit': 10,
            'total': 3,
            'totalPages': 1,
            'hasNextPage': false,
            'hasPreviousPage': false,
          },
          'unread': 2,
        },
      });
    }

    if (options.uri.path.endsWith('/mobile/field/me/signature/preview')) {
      return ResponseBody.fromBytes(
        _signaturePng,
        200,
        headers: {
          Headers.contentTypeHeader: ['image/png'],
        },
      );
    }
    if (options.uri.path.endsWith('/mobile/field/me/signature')) {
      final expiresAt = DateTime.now().toUtc().add(const Duration(minutes: 10));
      final expires = expiresAt.millisecondsSinceEpoch ~/ 1000;
      return jsonResponse({
        'success': true,
        'data': {
          'signatureAvailable': true,
          'version': 2,
          'updatedAt': '2026-09-08T10:00:00.000Z',
          'roles': ['FIELD_TECHNICIAN', 'TECHNICAL_RESPONSIBLE'],
          'preview': {
            'url':
                '/api/v1/mobile/field/me/signature/preview'
                '?expires=$expires&signature=${'a' * 64}',
            'expiresAt': expiresAt.toIso8601String(),
            'requiredHeaders': <String, String>{},
            'mimeType': 'image/png',
            'sizeBytes': _signaturePng.length.toString(),
            'sha256': sha256.convert(_signaturePng).toString(),
          },
        },
      });
    }
    return jsonResponse({'success': true, 'data': payload});
  }

  final dio = Dio()..httpClientAdapter = ScriptedAdapter(handler);
  final plain = Dio()..httpClientAdapter = ScriptedAdapter(handler);
  final client = OrbitApiClient.create(
    environment: OrbitEnvironment.fromDefines(),
    storage: InMemoryTokenStorage(),
    logger: const OrbitLogger(isProduction: true),
    dio: dio,
    retryDio: plain,
  );

  return ProviderScope(
    overrides: [
      apiClientProvider.overrideWithValue(client),
      readCacheProvider.overrideWithValue(InMemoryReadCache()),

      /// A sessão é sobreposta sempre que a tela depende dela.
      ///
      /// A condição antiga listava duas telas pelo nome, e qualquer tela nova
      /// que lesse permissão nascia sem sessão — o botão sumia da captura e a
      /// imagem mentia sobre o que o produto mostra.
      if (profile ||
          session != null ||
          tela is FieldDashboardScreen ||
          tela is CustomersScreen)
        sessionProvider.overrideWithValue(
          (session ??
                  sessionFrom(
                    permissions: const ['operations.read'],
                    roles: const ['TECHNICIAN'],
                  ))
              .copyWith(
                organization: const Organization(
                  id: 'org-1',
                  displayName: 'Clima Engenharia',
                  subscriptionStatus: 'ACTIVE',
                  businessUnits: [
                    BusinessUnit(id: 'unit-1', legalName: 'Unidade Recife'),
                  ],
                ),
              ),
        ),
      commandJournalProvider.overrideWithValue(
        CommandJournal(file: MemoryJournalFile()),
      ),
      syncProjectionProvider.overrideWithValue(
        SyncProjectionStore(file: MemoryJournalFile()),
      ),

      /// A fila de mídia também sai da memória: sem isto, qualquer tela que
      /// a leia cai em `path_provider`, que não existe no ambiente de teste.
      mediaQueueProvider.overrideWithValue(
        MediaQueue(file: MemoryJournalFile(), files: MemoryMediaFileStore()),
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
      home: Scaffold(
        body: tela,

        /// As abas vêm do produto, não de uma cópia.
        ///
        /// Enquanto a lista vivia duplicada aqui, a captura mostrava uma
        /// navegação que já não existia — uma aba trocada no shell não
        /// aparecia na imagem, e a imagem é justamente o que se olha.
        bottomNavigationBar: OrbitBottomNav(
          /// A posição sai da rota, não de um número escrito à mão.
          ///
          /// Escrito à mão, o perfil ficou marcado na casa 3 no dia em que
          /// Documentos entrou como quarta aba — a captura passaria a
          /// iluminar a aba errada sem nenhum teste reclamar.
          selected: switch (tela) {
            ProfileScreen() => _aba(OrbitRoutes.profile),
            DocumentsScreen() => _aba(OrbitRoutes.documents),
            CustomersScreen() => _aba(OrbitRoutes.customers),
            WorkQueueScreen() => _aba(OrbitRoutes.workQueue),
            _ => _aba(OrbitRoutes.home),
          },
          onSelect: (_) {},
          items: [
            for (final d in orbitShellDestinations)
              (
                label: d.navLabel,
                fullLabel: d.label,
                icon: d.icon,
                selectedIcon: d.selectedIcon,
              ),
          ],
        ),
      ),
    ),
  );
}

int _aba(String rota) =>
    orbitShellDestinations.indexWhere((destino) => destino.route == rota);

void main() {
  setUpAll(() async {
    await initializeDateFormatting('pt_BR');
    _signaturePng = await _signatureFixture();
  });

  test('fixture de assinatura contém tinta visível', () async {
    final codec = await ui.instantiateImageCodec(_signaturePng);
    final frame = await codec.getNextFrame();
    final pixels = await frame.image.toByteData(
      format: ui.ImageByteFormat.rawRgba,
    );
    final bytes = pixels!.buffer.asUint8List();
    var darkPixels = 0;
    for (var index = 0; index < bytes.length; index += 4) {
      if (bytes[index + 3] > 200 &&
          bytes[index] < 80 &&
          bytes[index + 1] < 80 &&
          bytes[index + 2] < 80) {
        darkPixels += 1;
      }
    }
    frame.image.dispose();
    codec.dispose();
    expect(darkPixels, greaterThan(500));
  });

  for (final width in [320.0, 375.0, 390.0, 430.0]) {
    for (final scale in [1.0, 1.3, 1.5, 2.0]) {
      group('${width.toInt()}px ${scale}x', () {
        setUp(() {
          captureWidth = width;
          captureScale = scale;
        });
        registerCaptures();
      });
    }
  }

  testWidgets('Home canônica — Owner', (tester) async {
    captureWidth = 390;
    captureScale = 1;
    await carregarFontes();
    prepararTela(tester, tamanho: tamanhoTelefone);
    await tester.pumpWidget(
      host(
        payloadRico,
        FieldDashboardScreen(now: _captureNow),
        session: sessionFrom(),
      ),
    );
    await tester.pumpAndSettle();
    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('out/final/owner_home.png'),
    );
  });

  testWidgets('Home canônica — Técnico em Campo', (tester) async {
    captureWidth = 390;
    captureScale = 1;
    await carregarFontes();
    prepararTela(tester, tamanho: tamanhoTelefone);
    await tester.pumpWidget(
      host(
        payloadRico,
        FieldDashboardScreen(now: _captureNow),
        session: sessionFrom(
          permissions: const ['operations.read'],
          roles: const ['FIELD_TECHNICIAN'],
        ),
      ),
    );
    await tester.pumpAndSettle();
    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('out/final/technician_home.png'),
    );
  });

  testWidgets('pad de assinatura em retrato', (tester) async {
    captureWidth = 390;
    captureScale = 1;
    await carregarFontes();
    prepararTela(tester, tamanho: tamanhoTelefone);
    await tester.pumpWidget(host({}, const MySignatureScreen()));
    await tester.pumpAndSettle();
    await _settleMemoryImages(tester);
    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('out/final/signature_pad.png'),
    );
  });
}

void registerCaptures() {
  setUpAll(() async => initializeDateFormatting('pt_BR'));

  testWidgets('documentos', (tester) async {
    await carregarFontes();
    prepararTela(tester);
    await tester.pumpWidget(
      host({
        'data': payloadRico['recentDocuments'],
        'meta': {'limit': 20, 'hasNextPage': false, 'nextCursor': null},
      }, DocumentsScreen(now: _captureNow)),
    );
    await tester.pumpAndSettle();
    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile(
        'out/${captureWidth.toInt()}_$captureScale/05_documentos.png',
      ),
    );
  });

  testWidgets('folha de documento', (tester) async {
    await carregarFontes();
    prepararTela(tester);
    await tester.pumpWidget(
      host({
        'data': payloadRico['recentDocuments'],
        'meta': {'limit': 20, 'hasNextPage': false, 'nextCursor': null},
      }, DocumentsScreen(now: _captureNow)),
    );
    await tester.pumpAndSettle();

    /// A primeira linha, e não uma escolhida pelo nome: com o texto
    /// ampliado a lista fica mais alta, a quarta linha sai da tela e o
    /// `ListView.builder` nem a constrói — o finder falhava em 1.5× e 2.0×.
    await tester.tap(find.byType(DocumentRow).first);
    await tester.pumpAndSettle();

    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile(
        'out/${captureWidth.toInt()}_$captureScale/05d_documento.png',
      ),
    );
  });

  testWidgets('perfil', (tester) async {
    await carregarFontes();
    prepararTela(tester);
    await tester.pumpWidget(host({}, const ProfileScreen(), profile: true));
    await tester.pumpAndSettle();
    await _settleMemoryImages(tester);

    /// A foto é o tema da tela, não um canto dela: 88 pixels, centralizada.
    expect(tester.getSize(find.byType(OrbitAvatar)).width, 88);
    final avatar = tester.getCenter(find.byType(OrbitAvatar)).dx;
    expect(avatar, closeTo(captureWidth / 2, 1));

    /// Os dois atalhos arredondados, lado a lado.
    expect(find.text('Assinatura'), findsOneWidget);
    expect(find.text('Configurações'), findsOneWidget);

    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile(
        'out/${captureWidth.toInt()}_$captureScale/06_perfil.png',
      ),
    );
  });

  testWidgets('entrar', (tester) async {
    await carregarFontes();
    prepararTela(tester);
    await tester.pumpWidget(host(const {}, const LoginScreen()));
    await tester.pumpAndSettle();

    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile(
        'out/${captureWidth.toInt()}_$captureScale/00_entrar.png',
      ),
    );
  });

  /// A troca obrigatória — três campos numa tela que não deixa sair.
  ///
  /// Capturada em todas as larguras porque é a **primeira** tela de quem o dono
  /// da organização cadastrou: se ela estourar em 320px com fonte grande, a
  /// pessoa não consegue nem começar a usar o aplicativo.
  testWidgets('definir senha', (tester) async {
    await carregarFontes();
    prepararTela(tester);
    await tester.pumpWidget(host(const {}, const ChangePasswordScreen()));
    await tester.pumpAndSettle();

    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile(
        'out/${captureWidth.toInt()}_$captureScale/00b_definir_senha.png',
      ),
    );
  });

  testWidgets('detalhe do atendimento', (tester) async {
    await carregarFontes();
    prepararTela(tester);
    await tester.pumpWidget(
      host({
        'workItem': item(
          id: 'OPERATION:op-1',
          titulo: 'Manutenção preventiva — Chiller 40TR',
          cliente: 'Shopping Recife',
          unidade: 'Matriz',
          quando: '2026-09-08T12:30:00.000Z',
        ),
        'request': {
          'description':
              'Cliente relata ruído no compressor desde segunda-feira, '
              'com queda de rendimento no período da tarde.',
        },
        'procedures': <Map<String, dynamic>>[],
        'documentContext': <Map<String, dynamic>>[],
        /* O valor só existe quando o responsável liberou aquele atendimento.
           Presente aqui para a captura mostrar a seção; ausente, ela some. */
        'financialSummary': {
          'currency': 'BRL',
          'approvedAmount': '8450.00',
          'paymentStatus': 'APPROVED',
        },
        'snapshotVersion': 3,
      }, const WorkItemDetailScreen(workItemId: 'OPERATION:op-1')),
    );
    await tester.pumpAndSettle();

    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile(
        'out/${captureWidth.toInt()}_$captureScale/03c_detalhe.png',
      ),
    );
  });

  testWidgets('avisos', (tester) async {
    await carregarFontes();
    prepararTela(tester);
    await tester.pumpWidget(
      host(const {}, const NotificationsScreen(), profile: true),
    );
    await tester.pumpAndSettle();

    /// Dois grupos: o não lido em cima, o lido embaixo.
    expect(find.text('2 NÃO LIDOS'), findsOneWidget);
    expect(find.text('ANTERIORES'), findsOneWidget);

    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile(
        'out/${captureWidth.toInt()}_$captureScale/08_avisos.png',
      ),
    );
  });

  testWidgets('sincronizacao', (tester) async {
    await carregarFontes();
    prepararTela(tester);
    await tester.pumpWidget(
      host(const {}, const SyncCenterScreen(), profile: true),
    );
    await tester.pumpAndSettle();

    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile(
        'out/${captureWidth.toInt()}_$captureScale/09_sincronizacao.png',
      ),
    );
  });

  testWidgets('configuracoes', (tester) async {
    await carregarFontes();
    prepararTela(tester);
    await tester.pumpWidget(
      host(const {}, const SettingsScreen(), profile: true),
    );
    await tester.pumpAndSettle();

    final interruptores = tester
        .widgetList<Switch>(find.byType(Switch))
        .toList();
    expect(interruptores.length, 3);
    expect(interruptores[0].value, isTrue);
    expect(interruptores[1].value, isTrue, reason: 'ausente = ligado');
    expect(interruptores[2].value, isFalse);

    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile(
        'out/${captureWidth.toInt()}_$captureScale/06b_configuracoes.png',
      ),
    );
  });

  testWidgets('folha de dados', (tester) async {
    await carregarFontes();
    prepararTela(tester);
    await tester.pumpWidget(host({}, const ProfileScreen(), profile: true));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Meus dados'));
    await tester.pumpAndSettle();

    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile(
        'out/${captureWidth.toInt()}_$captureScale/06c_meus_dados.png',
      ),
    );
  });

  testWidgets('wizard', (tester) async {
    await carregarFontes();
    prepararTela(tester);
    await tester.pumpWidget(
      host({
        'operation': {
          'id': 'op-1',
          'code': 'OS-024',
          'title': 'Manutenção preventiva',
          'status': 'SCHEDULED',
          'priority': 'NORMAL',
        },
        'customer': {'id': 'customer-1', 'name': 'Clínica Santa Maria'},
        'equipment': <Map<String, dynamic>>[],
        'auxiliaryTechnicians': <Map<String, dynamic>>[],
        'checklist': <Map<String, dynamic>>[],
        'materialPolicy': {'enabled': true},
        'allowedTransitions': ['IN_PROGRESS'],
        'allowedActions': ['START'],
        'primaryAction': 'START',
        'version': '2026-09-08T12:00:00.000Z',
        'executionEligibility': {'eligible': true, 'blockers': <String>[]},
      }, const OperationExecutionScreen(operationId: 'op-1')),
    );
    await tester.pumpAndSettle();
    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile(
        'out/${captureWidth.toInt()}_$captureScale/07_wizard.png',
      ),
    );
  });

  testWidgets('dashboard de campo', (tester) async {
    await carregarFontes();
    prepararTela(tester);

    await tester.pumpWidget(
      host(payloadRico, FieldDashboardScreen(now: _captureNow)),
    );
    await tester.pumpAndSettle();

    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile(
        'out/${captureWidth.toInt()}_$captureScale/01_field_dashboard.png',
      ),
    );
  });

  testWidgets('lista de servicos', (tester) async {
    await carregarFontes();
    prepararTela(tester);

    Map<String, dynamic> op(
      String id,
      String titulo,
      String status,
      String prioridade,
      String quando,
    ) => {
      'id': id,
      'code': 'OP-${id.padLeft(4, '0')}',
      'title': titulo,
      'status': status,
      'kind': 'MAINTENANCE',
      'priority': prioridade,
      'scheduledStart': quando,
      'users': const [],
      'attachments': const [],
      'checklistExecutions': const [],
    };

    final dados = [
      op(
        '1',
        'Manutencao preventiva - Chiller 40TR',
        'IN_PROGRESS',
        'HIGH',
        '2026-09-08T12:30:00.000Z',
      ),
      op(
        '2',
        'Corretiva - Split nao gela',
        'SCHEDULED',
        'URGENT',
        '2026-09-08T15:00:00.000Z',
      ),
      op(
        '3',
        'PMOC trimestral - Casa de maquinas',
        'SCHEDULED',
        'MEDIUM',
        '2026-09-08T17:30:00.000Z',
      ),
      op(
        '4',
        'Instalacao - VRF 8 evaporadoras',
        'COMPLETED',
        'LOW',
        '2026-09-06T11:00:00.000Z',
      ),
    ];

    Future<ResponseBody> handler(RequestOptions options) async => jsonResponse({
      'success': true,
      'data': {
        'data': dados,
        'meta': {
          'page': 1,
          'limit': 20,
          'total': dados.length,
          'totalPages': 1,
          'hasNextPage': false,
          'hasPreviousPage': false,
        },
      },
    });

    final dio = Dio()..httpClientAdapter = ScriptedAdapter(handler);
    final plain = Dio()..httpClientAdapter = ScriptedAdapter(handler);
    final client = OrbitApiClient.create(
      environment: OrbitEnvironment.fromDefines(),
      storage: InMemoryTokenStorage(),
      logger: const OrbitLogger(isProduction: true),
      dio: dio,
      retryDio: plain,
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          operationsRepositoryProvider.overrideWithValue(
            OperationsRepository(client: client, cache: InMemoryReadCache()),
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
          home: const OperationsScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile(
        'out/${captureWidth.toInt()}_$captureScale/02_servicos.png',
      ),
    );
  });

  testWidgets('clientes', (tester) async {
    await carregarFontes();
    prepararTela(tester);

    await tester.pumpWidget(host(const {}, const CustomersScreen()));
    await tester.pumpAndSettle();

    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile(
        'out/${captureWidth.toInt()}_$captureScale/05_clientes.png',
      ),
    );
  });

  testWidgets('novo orcamento', (tester) async {
    await carregarFontes();
    prepararTela(tester);

    await tester.pumpWidget(
      host(
        const {},
        const CustomersScreen(),
        session: sessionFrom(
          permissions: const ['operations.read', 'quotes.manage'],
          roles: const ['OWNER'],
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Shopping Recife'));
    await tester.pumpAndSettle();

    /// A folha abre em 58% da altura e a seção Comercial fica abaixo. Rolar
    /// é o que a pessoa faria.
    await tester.dragUntilVisible(
      find.text('Abrir orçamento'),
      find.byType(ListView).last,
      const Offset(0, -80),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Abrir orçamento'));
    await tester.pumpAndSettle();

    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile(
        'out/${captureWidth.toInt()}_$captureScale/05c_orcamento.png',
      ),
    );
  });

  testWidgets('folha do cliente', (tester) async {
    await carregarFontes();
    prepararTela(tester);

    await tester.pumpWidget(host(const {}, const CustomersScreen()));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Shopping Recife'));
    await tester.pumpAndSettle();

    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile(
        'out/${captureWidth.toInt()}_$captureScale/05b_cliente.png',
      ),
    );
  });

  testWidgets('folha de filtros', (tester) async {
    await carregarFontes();
    prepararTela(tester);

    final fila = {
      'data': [
        item(
          id: '1',
          titulo: 'Manutenção preventiva — Chiller 40TR',
          cliente: 'Shopping Recife',
          unidade: 'Matriz',
        ),
      ],
      'nextCursor': null,
    };

    await tester.pumpWidget(host(fila, const WorkQueueScreen()));
    await tester.pumpAndSettle();

    await tester.tap(find.byIcon(Icons.tune_rounded));
    await tester.pumpAndSettle();

    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile(
        'out/${captureWidth.toInt()}_$captureScale/03b_filtros.png',
      ),
    );
  });

  testWidgets('fila de trabalho', (tester) async {
    await carregarFontes();
    prepararTela(tester);

    /// Na ordem que o servidor manda.
    ///
    /// `MobileFieldService.compare` ordena por prazo — em andamento, atrasado,
    /// hoje, próximo — e só depois por horário. Um fixture fora dessa ordem
    /// faria a captura mostrar grupos repetidos ("Hoje", "Atrasado", "Hoje")
    /// e a tela pareceria quebrada por culpa do teste, não do produto.
    final fila = {
      'data': [
        item(
          id: '5',
          titulo: 'Instalação — VRF 8 evaporadoras',
          cliente: 'Clínica Vida',
          unidade: 'Matriz',
          dueState: 'IN_PROGRESS',
          status: 'IN_PROGRESS',
          quando: '2026-09-08T11:00:00.000Z',
        ),
        item(
          id: '9',
          titulo: 'Corretiva — Vazamento de gás',
          cliente: 'Frigorífico Boa Carne',
          unidade: 'Filial Sul',
          dueState: 'OVERDUE',
          quando: '2026-09-05T09:00:00.000Z',
        ),
        item(
          id: '1',
          titulo: 'Manutenção preventiva — Chiller 40TR',
          cliente: 'Shopping Recife',
          unidade: 'Matriz',
          quando: '2026-09-08T12:30:00.000Z',
        ),
        item(
          id: '3',
          titulo: 'PMOC trimestral — Casa de máquinas',
          cliente: 'Edifício Empresarial Norte',
          unidade: 'Filial Sul',
          quando: '2026-09-08T17:30:00.000Z',
        ),
        item(
          id: '7',
          titulo: 'Visita técnica — laudo de climatização',
          cliente: 'Hospital Santa Joana',
          unidade: 'Matriz',
          dueState: 'UPCOMING',
          quando: '2026-09-12T13:00:00.000Z',
        ),
      ],
      'nextCursor': null,
    };

    await tester.pumpWidget(host(fila, const WorkQueueScreen()));
    await tester.pumpAndSettle();

    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile(
        'out/${captureWidth.toInt()}_$captureScale/03_fila.png',
      ),
    );
  });

  testWidgets('agenda', (tester) async {
    await carregarFontes();
    prepararTela(tester);

    Map<String, dynamic> evento(
      String id,
      String titulo,
      String inicio,
      String fim,
      String prioridade,
    ) => {
      'occurrenceId': id,
      'eventId': id,
      'title': titulo,
      'startsAt': inicio,
      'endsAt': fim,
      'status': 'SCHEDULED',
      'priority': prioridade,
      'type': 'SERVICE',
    };

    final agenda = {
      'view': 'DAY',
      'range': {'start': '2026-09-08', 'end': '2026-09-08'},
      'summary': {'total': 3, 'hoursAllocated': 6.5},
      'days': [
        {
          'date': '2026-09-08',
          'events': [
            evento(
              'e1',
              'Shopping Recife — Manutenção preventiva Chiller 40TR',
              '2026-09-08T12:30:00.000Z',
              '2026-09-08T14:00:00.000Z',
              'HIGH',
            ),
            evento(
              'e2',
              'Hospital Santa Joana — Corretiva, split não gela',
              '2026-09-08T15:00:00.000Z',
              '2026-09-08T16:30:00.000Z',
              'URGENT',
            ),
            evento(
              'e3',
              'Edifício Empresarial Norte — PMOC trimestral',
              '2026-09-08T17:30:00.000Z',
              '2026-09-08T19:00:00.000Z',
              'NORMAL',
            ),
          ],
        },
      ],
      'generatedAt': '2026-09-08T10:00:00.000Z',
    };

    await tester.pumpWidget(host(agenda, const AgendaScreen()));
    await tester.pumpAndSettle();

    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile(
        'out/${captureWidth.toInt()}_$captureScale/04_agenda.png',
      ),
    );
  });
}
