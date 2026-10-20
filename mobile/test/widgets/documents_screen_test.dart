/// A tela de Documentos.
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
import 'package:orbit_operator/core/design/orbit_screen_header.dart';
import 'package:orbit_operator/core/theme/orbit_theme.dart';
import 'package:orbit_operator/features/documents/presentation/documents_screen.dart';

import '../support/fakes.dart';
import '../support/scripted_adapter.dart';

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

/// Registra o que a tela pediu — o filtro precisa virar consulta ao servidor,
/// e não recorte local de uma lista já baixada.
class Backend {
  final pedidos = <Map<String, dynamic>>[];

  Future<ResponseBody> call(RequestOptions options) async {
    pedidos.add(Map<String, dynamic>.from(options.queryParameters));
    final tipo = options.queryParameters['type'] as String?;
    return jsonResponse({
      'success': true,
      'data': {
        'data': [
          if (tipo == null || tipo == 'SERVICE_ORDER') document(),
          if (tipo == null || tipo == 'RVT')
            document(id: 'a2', type: 'RVT', label: 'RVT', state: 'PREPARING'),
          if (tipo == null || tipo == 'PMOC')
            document(id: 'a3', type: 'PMOC', label: 'PMOC', state: 'FAILED'),
        ],
        'meta': {'limit': 20, 'hasNextPage': false, 'nextCursor': null},
      },
    });
  }
}

Widget host(Backend backend, {double textScale = 1.0, double width = 390}) {
  final dio = Dio()..httpClientAdapter = ScriptedAdapter(backend.call);
  final plain = Dio()..httpClientAdapter = ScriptedAdapter(backend.call);
  final client = OrbitApiClient.create(
    environment: OrbitEnvironment.fromDefines(),
    storage: InMemoryTokenStorage(),
    logger: const OrbitLogger(isProduction: true),
    dio: dio,
    retryDio: plain,
  );

  return ProviderScope(
    overrides: [apiClientProvider.overrideWithValue(client)],
    child: MediaQuery(
      data: MediaQueryData(
        textScaler: TextScaler.linear(textScale),
        size: Size(width, 800),
      ),
      child: MaterialApp(
        theme: OrbitTheme.light(),
        home: const DocumentsScreen(),
      ),
    ),
  );
}

void main() {
  setUpAll(() async => initializeDateFormatting('pt_BR'));

  Object? layoutError;
  setUp(() {
    layoutError = null;
    FlutterError.onError = (details) => layoutError ??= details.exception;
  });
  tearDown(() => FlutterError.onError = FlutterError.presentError);

  testWidgets('lista o que o servidor emitiu, com o rótulo dele', (
    tester,
  ) async {
    await tester.pumpWidget(host(Backend()));
    await tester.pumpAndSettle();

    expect(find.text('Cliente do Documento'), findsNWidgets(3));
    expect(find.text('Ordem de serviço'), findsOneWidget);
    expect(find.text('RVT'), findsWidgets);

    /// Nenhum código cru na tela.
    expect(find.textContaining('SERVICE_ORDER'), findsNothing);
  });

  testWidgets('o filtro vira consulta ao servidor, não recorte local', (
    tester,
  ) async {
    final backend = Backend();
    await tester.pumpWidget(host(backend));
    await tester.pumpAndSettle();

    expect(backend.pedidos.single['type'], isNull);

    /// O rótulo "PMOC" aparece duas vezes: no filtro e na linha de um
    /// documento. O alvo é o filtro.
    await tester.tap(
      find.descendant(
        of: find.byType(OrbitChipStrip),
        matching: find.text('PMOC'),
      ),
    );
    await tester.pumpAndSettle();

    /// Um ciclo a mais: o `pumpAndSettle` acima volta assim que a tela para
    /// de agendar quadros, e nesse instante a segunda requisição ainda está
    /// em voo. Sem isto o teste lê a lista antes da resposta chegar.
    await tester.pump(const Duration(seconds: 1));
    await tester.pumpAndSettle();

    expect(backend.pedidos.last['type'], 'PMOC');
  });

  testWidgets('em preparo não oferece abertura', (tester) async {
    await tester.pumpWidget(host(Backend()));
    await tester.pumpAndSettle();

    expect(find.text('Preparando'), findsOneWidget);

    /// A linha não traz o atalho de compartilhar: um botão que existe e
    /// recusa é pior do que um botão que não existe.
    expect(find.byIcon(Icons.ios_share_rounded), findsOneWidget);

    /// A folha abre e **explica**, em vez de não responder ao toque. O que
    /// ela não faz é oferecer ação sobre um arquivo que ainda não existe.
    await tester.tap(find.text('Preparando'));
    await tester.pumpAndSettle();

    expect(find.textContaining('ainda está sendo preparado'), findsOneWidget);
    expect(find.text('Compartilhar documento'), findsNothing);
    expect(find.text('Baixar neste aparelho'), findsNothing);
  });

  testWidgets('o que falhou diz que falhou, e não "preparando"', (
    tester,
  ) async {
    await tester.pumpWidget(host(Backend()));
    await tester.pumpAndSettle();

    /// Preparando resolve sozinho; falhou não resolve. Chamar os dois de
    /// preparando deixa a pessoa esperando um documento que nunca chega.
    expect(find.text('Falhou'), findsOneWidget);

    await tester.tap(find.text('Falhou'));
    await tester.pumpAndSettle();

    /// A folha diz o que fazer a respeito — refazer a emissão —, porque
    /// esperar não resolve este caso.
    expect(find.textContaining('não pôde ser gerado'), findsOneWidget);
    expect(find.text('Compartilhar documento'), findsNothing);
    expect(find.text('Baixar neste aparelho'), findsNothing);
  });

  testWidgets('o disponível abre a folha com as duas ações', (tester) async {
    await tester.pumpWidget(host(Backend()));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Ordem de serviço'));
    await tester.pumpAndSettle();

    /// Compartilhar primeiro: um relatório existe para chegar ao cliente.
    expect(find.text('Compartilhar documento'), findsOneWidget);
    expect(find.text('Baixar neste aparelho'), findsOneWidget);
  });

  testWidgets('o nome do arquivo chega legível ao cliente', (tester) async {
    await tester.pumpWidget(host(Backend()));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Ordem de serviço'));
    await tester.pumpAndSettle();

    /// Sem acento virando hífen: "serviço" não pode chegar como "servi-o" no
    /// WhatsApp de quem contratou o trabalho.
    expect(
      find.text('ordem-de-servico-cliente-do-documento.pdf'),
      findsOneWidget,
    );
  });

  for (final (largura, escala) in [(320.0, 1.0), (375.0, 1.3), (430.0, 2.0)]) {
    testWidgets('cabe em ${largura.toInt()}px com texto ${escala}x', (
      tester,
    ) async {
      await tester.pumpWidget(
        host(Backend(), width: largura, textScale: escala),
      );
      await tester.pumpAndSettle();
      expect(layoutError, isNull);
    });
  }
}
