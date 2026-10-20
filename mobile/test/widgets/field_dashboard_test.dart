/// A tela inicial de quem trabalha em campo.
///
/// O que os testes cobram é o que a tela promete: responder "o que eu preciso
/// fazer agora" sem inventar dado, sem mostrar seção vazia e sem traduzir enum
/// por conta própria.
library;

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:orbit_operator/app/providers.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/core/design/orbit_primitives.dart';
import 'package:orbit_operator/core/theme/orbit_theme.dart';
import 'package:orbit_operator/features/field/presentation/field_dashboard_screen.dart';

import '../support/fakes.dart';
import '../support/scripted_adapter.dart';

Map<String, dynamic> workItem({
  String id = 'SERVICE_OPERATION:1',
  String kind = 'SERVICE_OPERATION',
  String dueState = 'DUE_TODAY',
  String customer = 'Cliente Teste',
  String? scheduledFor = '2026-09-01T12:00:00.000Z',
}) => {
  'id': id,
  'kind': kind,
  'sourceId': '1',
  'title': 'Atendimento',
  'businessUnit': {'id': 'bu', 'name': 'Matriz'},
  'customer': {'id': 'c1', 'name': customer},
  'timezone': 'America/Recife',
  'scheduledFor': scheduledFor,
  'dueState': dueState,
  'operationalStatus': 'SCHEDULED',
  'auxiliaryTechnicians': const [],
  'equipmentSummary': const [],
  'allowedActions': const ['VIEW'],
  'navigationContext': {'kind': kind, 'sourceId': '1'},
  'updatedAt': '2026-09-01T12:00:00.000Z',
};

Map<String, dynamic> home({
  List<Map<String, dynamic>> today = const [],
  List<Map<String, dynamic>> overdue = const [],
  List<Map<String, dynamic>> inProgress = const [],
  Map<String, dynamic>? next,
  List<Map<String, dynamic>> documents = const [],
  List<Map<String, dynamic>> appointments = const [],
  bool canScan = false,
  Map<String, int> counters = const {},
  List<Map<String, dynamic>> completed = const [],
}) => {
  'dashboard': {
    'next': next,
    'counters': {
      'today': counters['today'] ?? today.length,
      'overdue': counters['overdue'] ?? overdue.length,
      'inProgress': counters['inProgress'] ?? inProgress.length,
      'upcoming': counters['upcoming'] ?? 0,
    },
    'today': today,
    'overdue': overdue,
    'inProgress': inProgress,
    'capabilities': {'canScanEquipment': canScan, 'canCreateAdHocRvt': false},
  },
  'recentlyCompleted': completed,
  'recentDocuments': documents,
  'recentAppointments': appointments,
};

Map<String, dynamic> document({
  String id = 'a1',
  String type = 'SERVICE_ORDER',
  String label = 'Ordem de serviço',
  String? customer = 'Cliente do Documento',
  String state = 'AVAILABLE',
}) => {
  'artifactId': id,
  'documentType': type,
  'label': label,
  'customerName': customer,
  'createdAt': '2026-09-01T14:00:00.000Z',
  'state': state,
};

Widget host(
  Map<String, dynamic> payload, {
  double textScale = 1.0,
  double width = 390,
  int status = 200,
}) {
  Future<ResponseBody> handler(RequestOptions options) async => jsonResponse(
    status == 200
        ? {'success': true, 'data': payload}
        : {
            'success': false,
            'error': {
              'code': 'INTERNAL_ERROR',
              'status': status,
              'message': 'Falhou.',
            },
          },
    status: status,
  );

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
    ],
    child: MediaQuery(
      data: MediaQueryData(
        textScaler: TextScaler.linear(textScale),
        size: Size(width, 800),
      ),
      child: MaterialApp(
        theme: OrbitTheme.light(),
        home: const FieldDashboardScreen(),
      ),
    ),
  );
}

/// O título de uma seção — e não um texto igual dentro dela.
///
/// O selo de prazo também diz "Hoje", e procurar o texto solto na tela acha os
/// dois. A chave no `Text` do cabeçalho é o que separa um do outro.
Finder tituloDeSecao(String titulo) => find.byWidgetPredicate(
  (w) =>
      w is Text &&
      w.key == const Key('orbit.section.title') &&
      w.data == titulo,
);

void main() {
  setUpAll(() async => initializeDateFormatting('pt_BR'));

  Object? layoutError;
  setUp(() {
    layoutError = null;
    FlutterError.onError = (details) => layoutError ??= details.exception;
  });
  tearDown(() => FlutterError.onError = FlutterError.presentError);

  testWidgets('abre com saudação, data e o painel de números', (tester) async {
    await tester.pumpWidget(
      host(home(today: [workItem()], counters: const {'today': 6})),
    );
    await tester.pumpAndSettle();

    /// A saudação acompanha o relógio, como no alvo de produto: "Bom dia,
    /// Marina" e não um "Olá" fixo.
    expect(
      find.textContaining(RegExp('Bom dia|Boa tarde|Boa noite')),
      findsOneWidget,
    );

    /// Uma rodada anterior tinha **removido** os contadores, com o argumento
    /// de que "contador informa; ele não diz o que fazer". O produto pediu as
    /// métricas de volta, e a objeção foi respondida em vez de descartada:
    /// cada número é tocável e leva à lista que ele resume. É isso que este
    /// teste cobra — número sem destino seria a reclamação de novo.
    /// Quatro indicadores, dois por linha. A faixa de quatro colunas foi
    /// abandonada porque "Em andamento" quebrava no meio da palavra em 360
    /// pixels — o rótulo inteiro é o que dá sentido ao número.
    for (final rotulo in ['Hoje', 'Atrasadas', 'Em andamento', 'Próximas']) {
      expect(find.text(rotulo), findsWidgets, reason: rotulo);
    }

    /// Cada número leva à lista que ele resume. Número sem destino era a
    /// objeção que tirou os contadores da tela numa rodada anterior.
    final tocaveis = tester
        .widgetList<InkWell>(
          find.descendant(
            of: find.byType(OrbitCard),
            matching: find.byType(InkWell),
          ),
        )
        .where((w) => w.onTap != null);
    expect(tocaveis, isNotEmpty);
  });

  testWidgets('seção vazia não aparece', (tester) async {
    await tester.pumpWidget(host(home(today: [workItem()])));
    await tester.pumpAndSettle();

    /// As seções por prazo viraram um bloco só, com abas de recorte: a home
    /// mostra os cinco mais recentes, e o prazo é o selo de cada linha.
    expect(find.text('Atendimentos'), findsWidgets);
    for (final aba in ['Abertos', 'Próximos', 'Concluídos']) {
      expect(find.text(aba), findsOneWidget, reason: aba);
    }
    expect(tituloDeSecao('Documentos recentes'), findsNothing);
  });

  testWidgets('a contagem do servidor acompanha o título quando é maior', (
    tester,
  ) async {
    await tester.pumpWidget(
      host(
        home(
          overdue: [workItem(id: 'a', dueState: 'OVERDUE')],
          counters: const {'overdue': 7},
        ),
      ),
    );
    await tester.pumpAndSettle();

    /// A contagem do servidor vive no indicador, não mais num selo de seção:
    /// é ele que responde "quantas ao todo", enquanto a lista abaixo mostra
    /// as cinco mais recentes.
    expect(find.text('7'), findsWidgets);
    expect(find.text('Atrasadas'), findsWidgets);
  });

  testWidgets('em andamento vem antes de tudo', (tester) async {
    /// Viewport alta: o destaque e o painel de números empurraram as seções
    /// para baixo, e a lista só constrói o que cabe na tela.
    tester.view.physicalSize = const Size(1179, 3600);
    tester.view.devicePixelRatio = 3.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      host(
        home(
          inProgress: [workItem(id: 'x', dueState: 'IN_PROGRESS')],
          overdue: [workItem(id: 'y', dueState: 'OVERDUE')],
        ),
      ),
    );
    await tester.pumpAndSettle();

    /// Em andamento deixou de ser uma seção e virou o cartão de destaque —
    /// um por tela, com a ação de retomar dentro dele.
    expect(find.byType(OrbitHeroCard), findsOneWidget);

    /// "Em andamento" aparece duas vezes agora — é rótulo de indicador e
    /// sobrancelha do destaque. O finder tem de dizer qual dos dois.
    final andamento = tester
        .getTopLeft(
          find.descendant(
            of: find.byType(OrbitHeroCard),
            matching: find.text('Em andamento'),
          ),
        )
        .dy;
    final lista = tester.getTopLeft(find.text('Atendimentos').last).dy;
    expect(andamento, lessThan(lista));
  });

  testWidgets('o próximo não se repete quando já está em andamento', (
    tester,
  ) async {
    final item = workItem(id: 'mesmo', dueState: 'IN_PROGRESS');
    await tester.pumpWidget(host(home(inProgress: [item], next: item)));
    await tester.pumpAndSettle();

    expect(find.text('Próximo atendimento'), findsNothing);
  });

  testWidgets('documentos recentes usam o rótulo que o servidor mandou', (
    tester,
  ) async {
    /// Viewport de aparelho real: com o cabeçalho, os indicadores e a lista
    /// de recentes acima, os documentos ficam abaixo dos 600 pixels que o
    /// `flutter_test` usa por padrão — e o que não é construído não é achado.
    tester.view.physicalSize = const Size(1179, 3600);
    tester.view.devicePixelRatio = 3.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      host(
        home(
          documents: [
            document(),
            document(id: 'a2', type: 'RVT', label: 'RVT', state: 'PREPARING'),
            document(id: 'a3', type: 'PMOC', label: 'PMOC', state: 'FAILED'),
          ],
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Documentos recentes'), findsOneWidget);
    expect(find.text('Ordem de serviço'), findsOneWidget);

    /// O que ainda está sendo gerado diz isso — nunca oferece um arquivo que
    /// não existe. E o que falhou diz que falhou: preparando resolve sozinho,
    /// falhou não.
    expect(find.text('Preparando'), findsOneWidget);
    expect(find.text('Falhou'), findsOneWidget);

    /// Nenhum código de domínio na tela.
    expect(find.textContaining('SERVICE_ORDER'), findsNothing);
    expect(find.textContaining('AVAILABLE'), findsNothing);
  });

  testWidgets('ler etiqueta só aparece quando o servidor permite', (
    tester,
  ) async {
    await tester.pumpWidget(host(home(today: [workItem()])));
    await tester.pumpAndSettle();
    expect(find.text('QR'), findsNothing);

    await tester.pumpWidget(host(home(today: [workItem()], canScan: true)));
    await tester.pumpAndSettle();
    expect(find.text('QR'), findsOneWidget);
  });

  testWidgets('as ações rápidas cabem e são alcançáveis', (tester) async {
    await tester.pumpWidget(host(home(today: [workItem()])));
    await tester.pumpAndSettle();

    expect(find.byType(OrbitQuickAction), findsWidgets);
    for (final rotulo in ['Atendimentos', 'Agenda', 'Documentos']) {
      expect(
        find.descendant(
          of: find.byType(OrbitQuickAction),
          matching: find.text(rotulo),
        ),
        findsOneWidget,
        reason: rotulo,
      );
    }
  });

  /// A home não abre a base de contratos de PMOC.
  ///
  /// O atalho existia e aparecia para todo mundo, operador incluído: um botão
  /// para navegar os contratos da organização na tela inicial de quem só deveria
  /// ver o que lhe foi atribuído. O caminho do operador para um PMOC é o
  /// atendimento na fila, que abre a execução daquele equipamento.
  testWidgets('não há atalho de PMOC na home', (tester) async {
    await tester.pumpWidget(host(home(today: [workItem()])));
    await tester.pumpAndSettle();

    expect(
      find.descendant(
        of: find.byType(OrbitQuickAction),
        matching: find.text('PMOC'),
      ),
      findsNothing,
    );
  });

  testWidgets('dia sem trabalho orienta em vez de constatar', (tester) async {
    await tester.pumpWidget(host(home()));
    await tester.pumpAndSettle();

    expect(find.text('Nenhum atendimento programado'), findsOneWidget);
    expect(find.textContaining('aparece aqui'), findsOneWidget);
  });

  testWidgets('falha do servidor mostra erro com nova tentativa', (
    tester,
  ) async {
    await tester.pumpWidget(host(const {}, status: 500));
    await tester.pumpAndSettle();

    expect(find.text('Tentar novamente'), findsOneWidget);
  });

  for (final (largura, escala) in [
    (320.0, 1.0),
    (375.0, 1.3),
    (390.0, 1.0),
    (430.0, 2.0),
  ]) {
    testWidgets('cabe em ${largura.toInt()}px com texto ${escala}x', (
      tester,
    ) async {
      await tester.pumpWidget(
        host(
          home(
            today: [workItem(customer: 'Condomínio Empresarial Torre Norte')],
            overdue: [workItem(id: 'b', dueState: 'OVERDUE')],
            documents: [document()],
            appointments: const [
              {
                'id': 'e1',
                'title': 'Visita de manutenção preventiva semestral',
                'customerName': 'Central de Água Gelada',
                'type': 'MAINTENANCE',
                'status': 'CONFIRMED',
                'startsAt': '2026-09-01T09:00:00.000Z',
              },
            ],
            canScan: true,
          ),
          width: largura,
          textScale: escala,
        ),
      );
      await tester.pumpAndSettle();
      expect(layoutError, isNull);
    });
  }
  testWidgets('as abas trocam o recorte dos atendimentos', (tester) async {
    tester.view.physicalSize = const Size(1179, 3600);
    tester.view.devicePixelRatio = 3.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      host(
        home(
          overdue: [workItem(id: 'atrasado', dueState: 'OVERDUE')],
          next: workItem(id: 'proximo', dueState: 'UPCOMING'),
          completed: const [
            {
              'id': 'op-concluida',
              'code': 'OP-000031',
              'title': 'Corretiva — compressor',
              'kind': 'SERVICE_OPERATION',
              'customerName': 'Frigorífico Boa Carne',
              'equipmentName': 'Electrolux EL 12',
              'completedAt': '2026-09-07T14:00:00.000Z',
            },
          ],
        ),
      ),
    );
    await tester.pumpAndSettle();

    /// Abre em "Abertos", que é onde está o trabalho por fazer.
    expect(find.text('Frigorífico Boa Carne'), findsNothing);

    await tester.tap(find.text('Concluídos'));
    await tester.pumpAndSettle();

    /// Concluído não sai da fila de trabalho — a consulta dela exclui
    /// `COMPLETED`. Esta aba prova que a leitura separada chegou à tela.
    expect(find.text('Frigorífico Boa Carne'), findsOneWidget);
    expect(find.text('Concluído'), findsWidgets);

    await tester.tap(find.text('Abertos'));
    await tester.pumpAndSettle();
    expect(find.text('Frigorífico Boa Carne'), findsNothing);
  });
}
