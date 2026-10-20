/// A seção de evidências, lida por quem está em campo.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/contracts/mobile_evidence_contracts.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/core/theme/orbit_theme.dart';
import 'package:orbit_operator/features/evidence/application/evidence_providers.dart';
import 'package:orbit_operator/features/evidence/data/evidence_intake.dart';
import 'package:orbit_operator/features/evidence/data/evidence_repository.dart';
import 'package:orbit_operator/features/evidence/data/local_media.dart';
import 'package:orbit_operator/features/evidence/data/media_store.dart';
import 'package:orbit_operator/features/evidence/presentation/widgets/evidence_section.dart';
import 'package:orbit_operator/features/sync/application/sync_providers.dart';
import 'package:orbit_operator/features/sync/data/command_journal.dart'
    show CommandScope;
import 'package:orbit_operator/features/sync/data/journal_file.dart';

import '../support/fakes.dart';
import '../support/scripted_adapter.dart';

const scope = CommandScope(
  userId: 'u1',
  organizationId: 'org1',
  businessUnitId: 'bu1',
);

const target = FieldEvidenceTargetRef(
  type: FieldEvidenceTarget.operation,
  id: '0192f0c0-0000-7000-8000-0000000000aa',
);

final png = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmM'
  'IQAAAABJRU5ErkJggg==',
);

Map<String, Object?> evidence({
  String id = 'ev-1',
  String filename = 'antes.png',
  String category = 'BEFORE',
}) => {
  'id': id,
  'target': {'type': 'OPERATION', 'id': target.id},
  'category': category,
  'filename': filename,
  'mimeType': 'image/png',
  'sizeBytes': '1234',
  'sha256': 'a' * 64,
  'capturedAt': null,
  'uploadedAt': '2026-09-01T10:00:00.000Z',
  'capturedBy': {'id': 'u1', 'name': 'Técnico'},
  'source': 'CAMERA',
  'localMediaId': 'lm-1',
  'previewAvailable': true,
  'downloadAvailable': true,
};

Future<Widget> host({
  List<Map<String, Object?>> confirmed = const [],
  List<LocalMedia> pending = const [],
  bool canCapture = true,
  double textScale = 1.0,
  double width = 400,
}) async {
  Future<ResponseBody> handler(RequestOptions options) async => jsonResponse({
    'success': true,
    'data': {'items': confirmed, 'limit': 50},
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

  final files = MemoryMediaFileStore();
  final queue = MediaQueue(file: MemoryJournalFile(), files: files);
  for (final media in pending) {
    await queue.enqueue(media);
  }

  return ProviderScope(
    overrides: [
      evidenceRepositoryProvider.overrideWithValue(
        EvidenceRepository(client: client),
      ),
      commandScopeProvider.overrideWithValue(scope),
      mediaQueueProvider.overrideWithValue(queue),
    ],
    child: MediaQuery(
      data: MediaQueryData(
        textScaler: TextScaler.linear(textScale),
        size: Size(width, 780),
      ),
      child: MaterialApp(
        theme: OrbitTheme.light(),
        home: Scaffold(
          body: SingleChildScrollView(
            child: EvidenceSection(target: target, canCapture: canCapture),
          ),
        ),
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

  Future<LocalMedia> media({
    LocalMediaState state = LocalMediaState.pending,
    String filename = 'foto.png',
    String? failureCode,
  }) async {
    final value = await intakeEvidence(
      files: MemoryMediaFileStore(),
      bytes: Uint8List.fromList(png),
      filename: filename,
      mimeType: 'image/png',
      scope: scope,
      target: target,
      category: EvidenceCategory.general,
      source: EvidenceSource.camera,
    );
    return value.copyWith(state: state, failureCode: failureCode);
  }

  testWidgets('sem evidência, a seção diz isso e oferece registrar', (
    tester,
  ) async {
    await tester.pumpWidget(await host());
    await tester.pumpAndSettle();

    expect(
      find.text('Nenhuma evidência registrada neste atendimento.'),
      findsOneWidget,
    );
    expect(find.text('Registrar evidência'), findsOneWidget);
  });

  testWidgets('sem ADD_EVIDENCE não há botão de captura', (tester) async {
    await tester.pumpWidget(await host(canCapture: false));
    await tester.pumpAndSettle();

    /// Quem autoriza anexar é o servidor. A interface mostra o que foi
    /// publicado, não o que seria conveniente.
    expect(find.text('Registrar evidência'), findsNothing);
  });

  testWidgets('confirmadas e pendentes são contadas em separado', (
    tester,
  ) async {
    await tester.pumpWidget(
      await host(
        confirmed: [
          evidence(id: 'ev-1'),
          evidence(id: 'ev-2'),
        ],
        pending: [
          await media(),
          await media(filename: 'outra.png'),
        ],
      ),
    );
    await tester.pumpAndSettle();

    /// "4" seria uma afirmação que o servidor não fez — e é justamente a
    /// contagem dele que decide se o limite foi atingido.
    expect(find.text('2 confirmadas · 2 aguardando envio'), findsOneWidget);
    expect(find.textContaining('4'), findsNothing);
  });

  testWidgets('pendente aparece com selo, nunca como confirmada', (
    tester,
  ) async {
    await tester.pumpWidget(await host(pending: [await media()]));
    await tester.pumpAndSettle();

    expect(find.text('Aguardando envio'), findsOneWidget);

    final body = tester
        .widgetList<Text>(find.byType(Text))
        .map((widget) => widget.data ?? '')
        .join(' ');
    expect(body, isNot(contains('Confirmada')));

    /// Nada de caminho de arquivo, hash ou chave de objeto na tela.
    expect(body, isNot(contains('/memoria/')));
    expect(body, isNot(contains('lm-')));
    expect(body, isNot(contains('sha')));
  });

  testWidgets('finalizando é um estado próprio, distinto de confirmada', (
    tester,
  ) async {
    await tester.pumpWidget(
      await host(pending: [await media(state: LocalMediaState.finalizing)]),
    );
    await tester.pumpAndSettle();

    /// Os bytes já subiram; a evidência ainda não existe. É o estado que
    /// separa "o arquivo chegou" de "o servidor aceitou".
    expect(find.text('Finalizando'), findsOneWidget);
    expect(find.text('O servidor está conferindo o arquivo.'), findsOneWidget);
    expect(find.text('Confirmada'), findsNothing);
  });

  testWidgets('recusa mostra o motivo e oferece descartar', (tester) async {
    await tester.pumpWidget(
      await host(
        pending: [
          await media(
            state: LocalMediaState.rejected,
            failureCode: 'EVIDENCE_LIMIT_REACHED',
          ),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(
      find.text('Este atendimento já atingiu o limite de evidências.'),
      findsOneWidget,
    );
    expect(find.text('Descartar'), findsOneWidget);
  });

  testWidgets('pendente não oferece descarte', (tester) async {
    await tester.pumpWidget(await host(pending: [await media()]));
    await tester.pumpAndSettle();

    /// Pode estar em voo; apagá-la deixaria bytes no storage sem ninguém para
    /// finalizá-los.
    expect(find.text('Descartar'), findsNothing);
  });

  testWidgets('descartar pede confirmação e explica o efeito', (tester) async {
    await tester.pumpWidget(
      await host(
        pending: [
          await media(
            state: LocalMediaState.rejected,
            failureCode: 'INVALID_MIME',
          ),
        ],
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Descartar'));
    await tester.pumpAndSettle();

    expect(find.text('Descartar esta evidência?'), findsOneWidget);
    expect(
      find.textContaining('não foi registrado no atendimento'),
      findsOneWidget,
    );
  });

  testWidgets('a evidência confirmada mostra nome e categoria', (tester) async {
    await tester.pumpWidget(
      await host(confirmed: [evidence(filename: 'serpentina.png')]),
    );
    await tester.pumpAndSettle();

    expect(find.text('serpentina.png'), findsOneWidget);
    expect(find.textContaining('Antes'), findsOneWidget);
  });

  for (final scale in [1.0, 1.3, 2.0]) {
    testWidgets('não estoura com texto em ${scale}x', (tester) async {
      await tester.pumpWidget(
        await host(
          confirmed: [evidence()],
          pending: [
            await media(),
            await media(
              state: LocalMediaState.rejected,
              filename: 'documento-com-nome-bastante-longo.pdf',
              failureCode: 'FILE_TOO_LARGE',
            ),
          ],
          textScale: scale,
        ),
      );
      await tester.pumpAndSettle();
      expect(layoutError, isNull);
    });
  }

  testWidgets('tela estreita continua íntegra', (tester) async {
    await tester.pumpWidget(
      await host(
        confirmed: [
          evidence(filename: 'evaporadora-frontal-antes-da-limpeza.png'),
        ],
        pending: [await media(filename: 'condensadora-depois.png')],
        width: 280,
        textScale: 1.3,
      ),
    );
    await tester.pumpAndSettle();
    expect(layoutError, isNull);
  });
}
