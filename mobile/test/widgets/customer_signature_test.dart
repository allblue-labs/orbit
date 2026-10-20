/// A assinatura do cliente, na confirmação do atendimento.
///
/// ## A distinção que estes testes existem para proteger
///
/// ```text
/// Assinatura do técnico   persistente · versionada · reutilizada entre OS
/// Assinatura do cliente   daquele atendimento · uma vez · nunca reutilizada
/// ```
///
/// A confusão entre as duas é fácil de escrever e difícil de perceber: o pad é
/// o mesmo, o upload é o mesmo, o formato é o mesmo. O que separa é o destino
/// — e é isso que se verifica aqui.
library;

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/design/orbit_signature_pad.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/core/theme/orbit_theme.dart';
import 'package:orbit_operator/features/signature/application/signature_providers.dart';
import 'package:orbit_operator/features/signature/data/signature_repository.dart';
import 'package:orbit_operator/features/signature/presentation/customer_acknowledgement_screen.dart';
import 'package:orbit_operator/features/sync/application/sync_controller.dart';
import 'package:orbit_operator/features/sync/application/sync_providers.dart';
import 'package:orbit_operator/features/sync/data/command_journal.dart';
import 'package:orbit_operator/features/sync/data/journal_file.dart';
import 'package:orbit_operator/features/sync/data/sync_projection.dart';
import 'package:orbit_operator/features/sync/data/sync_repository.dart';

import '../support/fakes.dart';
import '../support/scripted_adapter.dart';

/// O backend do atendimento, com a memória do que foi pedido.
class Backend {
  Backend({this.existing});

  /// Um aceite já registrado, quando o cenário exige.
  final Map<String, Object?>? existing;

  final paths = <String>[];
  final acknowledgements = <Map<String, dynamic>>[];
  final reservationPurposes = <String?>[];

  Future<ResponseBody> call(RequestOptions options) async {
    final path =
        '${options.method} '
        '${options.uri.path.replaceFirst(RegExp(r'^.*?(?=/mobile/|/put/)'), '')}';
    paths.add(path);

    if (path.endsWith('/customer-acknowledgement/preparation')) {
      return jsonResponse({
        'success': true,
        'data': {
          'executionType': 'OPERATION',
          'executionId': 'op-1',
          'customer': {'id': 'c1', 'name': 'Condomínio Central'},
          'equipment': [
            {'id': 'e1', 'code': 'TAG-1', 'name': 'Split Cassete'},
          ],
          'serviceSummary': 'Manutenção preventiva realizada.',
          'performedAt': '2026-09-01T12:00:00.000Z',
          'signerPolicy': {
            'signatureRequired': false,
            'signatureOptional': true,
          },
          'existingAcknowledgement': existing,
          'contentVersion': '2026-09-01T12:00:00.000Z',
          'contentHash': 'a' * 64,
        },
      });
    }

    if (path == 'POST /mobile/field/me/signature/uploads') {
      final body = options.data as Map<String, dynamic>? ?? const {};
      reservationPurposes.add(body['purpose'] as String?);
      return jsonResponse({
        'success': true,
        'data': {
          'fileId': 'file-cliente-1',
          'upload': {
            'url': 'https://storage.example/put/file-cliente-1?sig=abc',
            'expiresAt': '2026-09-01T12:10:00.000Z',
            'requiredHeaders': {'Content-Type': 'image/png'},
          },
        },
      });
    }

    if (options.uri.host == 'storage.example') {
      return ResponseBody.fromString('', 200);
    }

    if (path == 'POST /mobile/field/offline/sync/push') {
      final body = options.data as Map<String, dynamic>? ?? const {};
      final comandos = (body['commands'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .toList();
      for (final comando in comandos) {
        acknowledgements.add(
          Map<String, dynamic>.from(
            comando['payload'] as Map<String, dynamic>? ?? const {},
          )..['commandId'] = comando['commandId'],
        );
      }
      return jsonResponse({
        'success': true,
        'data': {
          'results': [
            for (final comando in comandos)
              {
                'commandId': comando['commandId'],
                'commandType': comando['commandType'],
                'status': 'APPLIED',
                'serverVersion': '2026-09-01T12:05:00.000Z',
              },
          ],
          'serverTime': '2026-09-01T12:05:00.000Z',
          'nextRecommendedAction': 'NONE',
        },
      });
    }

    return jsonResponse({
      'success': true,
      'data': {
        'status': 'DELTA',
        'changes': const [],
        'tombstones': const [],
        'nextCursor': 'c1',
        'hasMore': false,
        'purgeRequired': false,
      },
    });
  }
}

/// O que `wrap` monta, com o orquestrador à mão para o teste.
typedef Cenario = ({Widget widget, SyncController sync});

Widget wrap(
  Backend backend, {
  String operationId = 'op-1',
  double textScale = 1.0,
  double width = 390,
}) => cenario(
  backend,
  operationId: operationId,
  textScale: textScale,
  width: width,
).widget;

Cenario cenario(
  Backend backend, {
  String operationId = 'op-1',
  double textScale = 1.0,
  double width = 390,
}) {
  final dio = Dio()..httpClientAdapter = ScriptedAdapter(backend.call);
  final plain = Dio()..httpClientAdapter = ScriptedAdapter(backend.call);
  final client = OrbitApiClient.create(
    environment: OrbitEnvironment.fromDefines(),
    storage: InMemoryTokenStorage(),
    logger: const OrbitLogger(isProduction: true),
    dio: dio,
    retryDio: plain,
  );

  /// O orquestrador de sincronização real, com journal em memória.
  ///
  /// Real de propósito: é ele que dá idempotência e ordem ao aceite, e um
  /// dublê provaria só que o dublê funciona.
  final controller = SyncController(
    journal: CommandJournal(file: MemoryJournalFile()),
    projection: SyncProjectionStore(file: MemoryJournalFile()),
    repository: SyncRepository(client: client),
    scope: const CommandScope(
      userId: 'u1',
      organizationId: 'org1',
      businessUnitId: 'bu1',
    ),
    scopeKey: 'u1.org1.bu1',
    onReconciled: () {},
  );

  final widget = ProviderScope(
    overrides: [
      signatureRepositoryProvider.overrideWithValue(
        SignatureRepository(client: client),
      ),
      syncControllerProvider.overrideWith((ref) => controller),
    ],
    child: MediaQuery(
      data: MediaQueryData(
        textScaler: TextScaler.linear(textScale),
        size: Size(width, 800),
      ),
      child: MaterialApp(
        theme: OrbitTheme.light(),
        home: CustomerAcknowledgementScreen(operationId: operationId),
      ),
    ),
  );

  return (widget: widget, sync: controller);
}

/// Confirma o atendimento com uma assinatura desenhada.
///
/// `runAsync` é obrigatório: transformar o traço em PNG passa por
/// `Picture.toImage` e `Image.toByteData`, que precisam do laço de eventos
/// real. Sob o relógio falso do teste a exportação nunca completa, e o envio
/// ficaria parado esperando um `Future` que ninguém resolve.
Future<void> confirmarComAssinatura(WidgetTester tester) async {
  final alvo = find.text('Confirmar atendimento');
  await tester.scrollUntilVisible(
    alvo,
    200,
    scrollable: find.byType(Scrollable).first,
  );
  await tester.pumpAndSettle();

  await tester.runAsync(() async {
    await tester.tap(alvo);

    /// Tempo real para a exportação e para a cadeia que vem depois dela:
    /// reserva, envio dos bytes, enfileiramento e a sincronização que o
    /// enfileiramento dispara.
    ///
    /// O laço alterna espera real e `pump`: parte da cadeia só avança quando
    /// o widget reconstrói, e um `delayed` único deixaria o envio parado no
    /// meio do caminho.
    for (var i = 0; i < 20; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 50));
      await tester.pump();
    }
  });
  await tester.pumpAndSettle();
}

/// Rola até o alvo e toca nele.
Future<void> tocarEm(WidgetTester tester, String texto) async {
  final alvo = find.text(texto);
  await tester.scrollUntilVisible(
    alvo,
    200,
    scrollable: find.byType(Scrollable).first,
  );
  await tester.pumpAndSettle();

  /// `scrollUntilVisible` para assim que o alvo entra no viewport do
  /// rolável — que pode ser abaixo da borda da tela. `ensureVisible` traz o
  /// alvo para dentro do que de fato recebe toque.
  await tester.ensureVisible(alvo);
  await tester.pumpAndSettle();
  await tester.tap(alvo);
  await tester.pumpAndSettle();
}

/// Desenha uma assinatura de verdade no pad da tela.
Future<void> assinar(WidgetTester tester) async {
  final pad = find.byType(OrbitSignaturePad);
  await tester.scrollUntilVisible(
    pad,
    200,
    scrollable: find.byType(Scrollable).first,
  );
  await tester.pumpAndSettle();

  final centro = tester.getCenter(pad);
  final gesto = await tester.startGesture(centro - const Offset(60, 10));
  for (var i = 0; i < 12; i++) {
    await gesto.moveBy(Offset(10, i.isEven ? 6 : -6));
    await tester.pump(const Duration(milliseconds: 8));
  }
  await gesto.up();
  await tester.pumpAndSettle();
}

void main() {
  setUpAll(() async => initializeDateFormatting('pt_BR'));

  Object? layoutError;
  setUp(() {
    layoutError = null;
    FlutterError.onError = (details) => layoutError ??= details.exception;
  });
  tearDown(() => FlutterError.onError = FlutterError.presentError);

  testWidgets('o cliente pode assinar na confirmação do atendimento', (
    tester,
  ) async {
    final backend = Backend();
    await tester.pumpWidget(wrap(backend));
    await tester.pumpAndSettle();

    expect(find.byType(OrbitSignaturePad), findsOneWidget);
    expect(find.text('Assine neste espaço'), findsOneWidget);
    expect(find.text('Limpar'), findsOneWidget);
  });

  testWidgets('OS B abre com o pad vazio — a assinatura da OS A não volta', (
    tester,
  ) async {
    /// O caso que este teste protege: a assinatura do cliente pertence ao
    /// atendimento. Reaproveitá-la faria o cliente da OS B "assinar" um
    /// serviço que ele não viu.
    final primeira = Backend();
    await tester.pumpWidget(wrap(primeira, operationId: 'op-1'));
    await tester.pumpAndSettle();
    await assinar(tester);

    final padA = tester.widget<OrbitSignaturePad>(
      find.byType(OrbitSignaturePad),
    );
    expect(padA.controller.temTraco, isTrue);

    /// Outro atendimento, com aceite já registrado no primeiro.
    final segunda = Backend(
      existing: const {
        'signerName': 'Zelador do prédio',
        'acknowledgedAt': '2026-09-01T12:05:00.000Z',
        'hasSignature': true,
      },
    );
    await tester.pumpWidget(wrap(segunda, operationId: 'op-2'));
    await tester.pumpAndSettle();

    /// Rola até o pad antes de lê-lo: a lista o constrói sob demanda, e com
    /// o aceite anterior no topo ele nasce abaixo da dobra.
    await tester.scrollUntilVisible(
      find.byType(OrbitSignaturePad),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();

    final padB = tester.widget<OrbitSignaturePad>(
      find.byType(OrbitSignaturePad),
    );

    /// Vazio. Mesmo existindo um aceite anterior com assinatura, o pad não é
    /// pré-preenchido — o servidor publica `hasSignature`, não a imagem.
    expect(padB.controller.temTraco, isFalse);
  });

  testWidgets('a imagem sobe marcada como aceite, não como assinatura própria', (
    tester,
  ) async {
    final backend = Backend();
    await tester.pumpWidget(wrap(backend));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), 'Maria Zeladora');
    await assinar(tester);
    await confirmarComAssinatura(tester);

    /// A trilha do arquivo diz o que ele é. Registrar a assinatura de um
    /// cliente como assinatura profissional seria uma linha falsa na auditoria.
    expect(backend.reservationPurposes, ['CUSTOMER_ACKNOWLEDGEMENT']);

    /// E **não** ativou assinatura profissional nenhuma.
    expect(
      backend.paths.where((p) => p == 'POST /mobile/field/me/signature'),
      isEmpty,
    );
  });

  testWidgets('o comando carrega o arquivo da assinatura', (tester) async {
    final backend = Backend();
    await tester.pumpWidget(wrap(backend));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), 'Maria Zeladora');
    await assinar(tester);
    await confirmarComAssinatura(tester);

    expect(backend.acknowledgements, hasLength(1));
    final comando = backend.acknowledgements.single;
    expect(comando['signerName'], 'Maria Zeladora');
    expect(comando['signatureStorageFileId'], 'file-cliente-1');

    /// O hash do resumo viaja verbatim: é ele que amarra o aceite ao texto
    /// que o cliente leu.
    expect(comando['contentHash'], 'a' * 64);
  });

  testWidgets('sem assinatura, o aceite ainda vale com o nome', (tester) async {
    /// A assinatura gráfica é opcional por política do servidor. Bloquear a
    /// confirmação por falta dela criaria uma regra que o backend não tem.
    final backend = Backend();
    await tester.pumpWidget(wrap(backend));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), 'Maria Zeladora');
    await tocarEm(tester, 'Confirmar atendimento');

    expect(backend.acknowledgements, hasLength(1));
    expect(
      backend.acknowledgements.single.containsKey('signatureStorageFileId'),
      isFalse,
    );

    /// E nenhum arquivo foi reservado à toa.
    expect(backend.reservationPurposes, isEmpty);
  });

  testWidgets('nome curto demais não registra nada', (tester) async {
    final backend = Backend();
    await tester.pumpWidget(wrap(backend));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), 'M');
    await assinar(tester);
    await tocarEm(tester, 'Confirmar atendimento');

    expect(backend.acknowledgements, isEmpty);
  });

  testWidgets('limpar apaga o traço sem tocar no nome', (tester) async {
    final backend = Backend();
    await tester.pumpWidget(wrap(backend));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), 'Maria Zeladora');
    await assinar(tester);

    final pad = tester.widget<OrbitSignaturePad>(
      find.byType(OrbitSignaturePad),
    );
    expect(pad.controller.temTraco, isTrue);

    await tocarEm(tester, 'Limpar');

    expect(pad.controller.temTraco, isFalse);
    expect(find.text('Maria Zeladora'), findsOneWidget);
  });

  testWidgets('a tela não deixa confirmar duas vezes em sequência', (
    tester,
  ) async {
    final backend = Backend();
    await tester.pumpWidget(wrap(backend));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), 'Maria Zeladora');

    final alvo = find.text('Confirmar atendimento');
    await tester.scrollUntilVisible(
      alvo,
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.ensureVisible(alvo);
    await tester.pumpAndSettle();

    /// Dois toques no mesmo instante — o que um dedo nervoso produz.
    await tester.tap(alvo, warnIfMissed: false);
    await tester.tap(alvo, warnIfMissed: false);
    await tester.pumpAndSettle();

    expect(backend.acknowledgements, hasLength(1));
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
        wrap(Backend(), width: largura, textScale: escala),
      );
      await tester.pumpAndSettle();
      expect(layoutError, isNull);
    });
  }
}
