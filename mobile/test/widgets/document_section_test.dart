/// A seção de documento, lida por quem está em campo.
library;

import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/contracts/mobile_field_artifact_contracts.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/core/theme/orbit_theme.dart';
import 'package:orbit_operator/features/artifact/application/artifact_providers.dart';
import 'package:orbit_operator/features/artifact/data/artifact_repository.dart';
import 'package:orbit_operator/features/artifact/data/document_file.dart';
import 'package:orbit_operator/features/artifact/presentation/widgets/document_section.dart';

import '../support/fakes.dart';
import '../support/scripted_adapter.dart';

const source = ArtifactSourceRef(
  type: FieldArtifactSourceType.operation,
  id: 'op-1',
);

Map<String, Object?> artifactJson({
  String status = 'READY',
  List<String> actions = const ['VIEW_DOCUMENT', 'DOWNLOAD_DOCUMENT'],
  String? generatedAt = '2026-09-02T10:00:00.000Z',
}) => {
  'id': 'art-1',
  'artifactExecutionId': 'exec-1',
  'sourceType': 'OPERATION',
  'sourceId': 'op-1',
  'documentType': 'SERVICE_ORDER',
  'status': status,
  'snapshotVersion': 1,
  'snapshotHash': 'abc123' * 10,
  'templateVersion': 3,
  'generatedAt': generatedAt,
  'previewAvailable': status == 'READY',
  'downloadAvailable': status == 'READY',
  'allowedActions': actions,
};

Map<String, Object?> preparationJson({
  bool eligible = true,
  List<String> blocked = const [],
  List<String> actions = const ['PREPARE_DOCUMENT'],
  Map<String, Object?>? existing,
}) => {
  'sourceType': 'OPERATION',
  'sourceId': 'op-1',
  'documentType': 'SERVICE_ORDER',
  'eligibility': {'eligible': eligible, 'blockedReasons': blocked},
  'templateVersion': 3,
  'professionalSignatures': {
    'fieldTechnician': true,
    'technicalResponsibleRequired': false,
    'technicalResponsible': false,
  },
  'customerAcknowledgement': {
    'required': false,
    'available': false,
    'valid': true,
  },
  'evidenceSummary': {'finalized': 2, 'pending': 0},
  'snapshotVersion': 1,
  'existingArtifact': existing,
  'allowedActions': actions,
};

Widget host(
  Map<String, Object?> preparation, {
  double textScale = 1.0,
  double width = 400,
}) {
  Future<ResponseBody> handler(RequestOptions options) async {
    if (options.uri.host == 'storage.example') {
      return ResponseBody.fromBytes(
        utf8.encode('%PDF-1.7 documento'),
        200,
        headers: {
          Headers.contentTypeHeader: ['application/pdf'],
        },
      );
    }
    if (options.uri.path.endsWith('/access')) {
      return jsonResponse({
        'success': true,
        'data': {
          'artifactId': 'art-1',
          'operation': 'download',
          'url': 'https://storage.example/doc.pdf',
          'expiresAt': '2099-01-01T00:00:00.000Z',
          'requiredHeaders': const <String, Object?>{},
        },
      });
    }
    return jsonResponse({'success': true, 'data': preparation});
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
      artifactRepositoryProvider.overrideWithValue(
        ArtifactRepository(client: client),
      ),
      documentFileStoreProvider.overrideWithValue(MemoryDocumentFileStore()),
    ],
    child: MediaQuery(
      data: MediaQueryData(
        textScaler: TextScaler.linear(textScale),
        size: Size(width, 780),
      ),
      child: MaterialApp(
        theme: OrbitTheme.light(),
        home: Scaffold(
          body: SingleChildScrollView(child: DocumentSection(source: source)),
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

  testWidgets('atendimento concluído sem documento diz exatamente isso', (
    tester,
  ) async {
    await tester.pumpWidget(host(preparationJson()));
    await tester.pumpAndSettle();

    expect(find.text('Documento ainda não emitido'), findsOneWidget);
    expect(find.textContaining('etapa à parte'), findsOneWidget);

    /// Em lugar nenhum se afirma que o atendimento está "concluído e
    /// assinado".
    final body = tester
        .widgetList<Text>(find.byType(Text))
        .map((widget) => widget.data ?? '')
        .join(' ');
    expect(body, isNot(contains('assinado')));
  });

  testWidgets('bloqueio aparece como frase, com o caminho da solução', (
    tester,
  ) async {
    await tester.pumpWidget(
      host(
        preparationJson(
          eligible: false,
          blocked: const ['FIELD_TECHNICIAN_SIGNATURE_MISSING'],
          actions: const [],
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(
      find.textContaining('Falta a assinatura do técnico em campo'),
      findsOneWidget,
    );
    expect(find.text('Preparar documento'), findsNothing);
  });

  testWidgets('sem ação publicada, nenhum botão de emissão aparece', (
    tester,
  ) async {
    await tester.pumpWidget(
      host(
        preparationJson(
          eligible: false,
          blocked: const ['SOURCE_NOT_COMPLETED'],
          actions: const [],
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Preparar documento'), findsNothing);
    expect(find.text('Emitir documento'), findsNothing);
    expect(find.text('Baixar'), findsNothing);

    /// Atualizar continua: sem notificação, é como a pessoa descobre que algo
    /// mudou.
    expect(find.text('Atualizar'), findsOneWidget);
  });

  testWidgets('em processamento mostra progresso, não download', (
    tester,
  ) async {
    await tester.pumpWidget(
      host(
        preparationJson(
          actions: const [],
          existing: artifactJson(
            status: 'RENDERING',
            actions: const [],
            generatedAt: null,
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    expect(find.text('Documento em processamento'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(find.text('Baixar'), findsNothing);
  });

  testWidgets('emitido oferece entregar, ver e baixar', (tester) async {
    await tester.pumpWidget(
      host(
        preparationJson(
          actions: const ['VIEW_DOCUMENT', 'DOWNLOAD_DOCUMENT'],
          existing: artifactJson(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Relatório emitido'), findsOneWidget);
    expect(find.textContaining('Emitido em'), findsOneWidget);

    /// Compartilhar é a ação que resolve o caso de campo: o cliente pede a OS na
    /// hora, e o que serve é a folha do sistema — não um arquivo guardado no
    /// aparelho do técnico.
    expect(find.text('Compartilhar'), findsOneWidget);
    expect(find.text('Visualizar'), findsOneWidget);
    expect(find.text('Baixar'), findsOneWidget);
  });

  testWidgets('antes de emitir, não há o que entregar', (tester) async {
    /// Sem documento, compartilhar não aparece: ele mandaria um anexo que não
    /// existe, e o erro chegaria ao cliente em vez de ao técnico.
    await tester.pumpWidget(
      host(preparationJson(actions: const ['PREPARE_DOCUMENT'])),
    );
    await tester.pumpAndSettle();

    expect(find.text('Emitir relatório'), findsOneWidget);
    expect(find.text('Compartilhar'), findsNothing);
  });

  testWidgets('falha oferece tentar novamente', (tester) async {
    await tester.pumpWidget(
      host(
        preparationJson(
          actions: const ['GENERATE_DOCUMENT'],
          existing: artifactJson(
            status: 'FAILED',
            actions: const ['GENERATE_DOCUMENT'],
            generatedAt: null,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Não foi possível emitir o documento'), findsOneWidget);
    expect(find.text('Tentar novamente'), findsOneWidget);
  });

  testWidgets('baixar anuncia cada etapa e termina salvo', (tester) async {
    await tester.pumpWidget(
      host(
        preparationJson(
          actions: const ['DOWNLOAD_DOCUMENT'],
          existing: artifactJson(actions: const ['DOWNLOAD_DOCUMENT']),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Baixar'));
    await tester.pumpAndSettle();

    expect(find.text('Documento salvo neste aparelho'), findsOneWidget);
  });

  testWidgets('a tela não mostra hash nem jargão do motor', (tester) async {
    await tester.pumpWidget(
      host(
        preparationJson(
          actions: const ['DOWNLOAD_DOCUMENT'],
          existing: artifactJson(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    final body = tester
        .widgetList<Text>(find.byType(Text))
        .map((widget) => widget.data ?? '')
        .join(' ');
    expect(body, isNot(contains('abc123')));
    expect(body, isNot(contains('art-1')));
    expect(body, isNot(contains('exec-1')));
    expect(body, isNot(contains('RENDERING')));
    expect(body, isNot(contains('Snapshot')));
  });

  testWidgets('estado desconhecido não deixa a seção em branco', (
    tester,
  ) async {
    await tester.pumpWidget(
      host(
        preparationJson(
          actions: const [],
          existing: artifactJson(
            status: 'ALGO_QUE_O_APP_NAO_CONHECE',
            actions: const [],
            generatedAt: null,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Situação do documento indisponível'), findsOneWidget);
  });

  for (final scale in [1.0, 1.3, 2.0]) {
    testWidgets('não estoura com texto em ${scale}x', (tester) async {
      await tester.pumpWidget(
        host(
          preparationJson(
            eligible: false,
            blocked: const [
              'FIELD_TECHNICIAN_SIGNATURE_MISSING',
              'ACKNOWLEDGEMENT_STALE',
              'EVIDENCE_PENDING',
            ],
            actions: const ['VIEW_DOCUMENT', 'DOWNLOAD_DOCUMENT'],
            existing: artifactJson(),
          ),
          textScale: scale,
        ),
      );
      await tester.pumpAndSettle();
      expect(layoutError, isNull);
    });
  }

  testWidgets('tela estreita continua íntegra', (tester) async {
    await tester.pumpWidget(
      host(
        preparationJson(
          eligible: false,
          blocked: const ['TECHNICAL_RESPONSIBLE_MISSING'],
          actions: const ['VIEW_DOCUMENT', 'DOWNLOAD_DOCUMENT'],
          existing: artifactJson(),
        ),
        width: 280,
        textScale: 1.3,
      ),
    );
    await tester.pumpAndSettle();
    expect(layoutError, isNull);
  });
}
