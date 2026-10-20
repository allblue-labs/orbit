/// A tela da assinatura profissional, com o pipeline de três passos scriptado.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/core/theme/orbit_theme.dart';
import 'package:orbit_operator/features/signature/application/signature_providers.dart';
import 'package:orbit_operator/features/signature/data/signature_repository.dart';
import 'package:orbit_operator/features/signature/presentation/my_signature_screen.dart';

import '../support/fakes.dart';
import '../support/scripted_adapter.dart';

/// Um PNG 1×1 real — assinatura de arquivo válida, decodificável.
final validPng = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmM'
  'IQAAAABJRU5ErkJggg==',
);

Map<String, dynamic> status({
  bool available = false,
  bool preview = true,
  bool expired = false,
  bool externalPreview = false,
}) {
  final expiresAt = DateTime.now().toUtc().add(
    Duration(minutes: expired ? -1 : 5),
  );
  final expires = expiresAt.millisecondsSinceEpoch ~/ 1000;
  return {
    'signatureAvailable': available,
    'version': available ? 2 : null,
    'updatedAt': available ? '2026-08-20T10:00:00.000Z' : null,
    'roles': ['FIELD_TECHNICIAN', 'TECHNICAL_RESPONSIBLE'],
    'preview': available && preview
        ? {
            'url':
                '${externalPreview ? 'https://untrusted.example' : ''}'
                '/api/v1/mobile/field/me/signature/preview'
                '?expires=$expires&signature=${'a' * 64}',
            'expiresAt': expiresAt.toIso8601String(),
            'requiredHeaders': <String, String>{},
            'mimeType': 'image/png',
            'sizeBytes': validPng.length.toString(),
            'sha256': sha256.convert(validPng).toString(),
          }
        : null,
  };
}

/// Reproduz a conversa do backend: status, reserva, PUT assinado, confirmação.
class Backend {
  Backend({
    this.available = false,
    this.failSignedPut = false,
    this.failPreview = false,
    this.expiredFirstPreview = false,
    this.externalPreview = false,
  });

  final bool available;
  final bool failSignedPut;
  final bool failPreview;
  final bool expiredFirstPreview;
  final bool externalPreview;
  final paths = <String>[];
  bool confirmed = false;
  int statusCalls = 0;

  Future<ResponseBody> call(RequestOptions options) async {
    /// O caminho sem o prefixo da API: o teste fala do endpoint, não da
    /// montagem da URL base.
    final path =
        '${options.method} '
        '${options.uri.path.replaceFirst(RegExp(r'^.*?(?=/mobile/|/put/)'), '')}';
    paths.add(path);

    if (path == 'GET /mobile/field/me/signature') {
      statusCalls += 1;
      return jsonResponse({
        'success': true,
        'data': status(
          available: available || confirmed,
          expired: expiredFirstPreview && statusCalls == 1,
          externalPreview: externalPreview,
        ),
      });
    }
    if (path == 'POST /mobile/field/me/signature/uploads') {
      return jsonResponse({
        'success': true,
        'data': {
          'fileId': 'file-1',
          'upload': {
            'url': 'https://storage.example/put/file-1?sig=abc',
            'expiresAt': '2026-09-01T12:10:00.000Z',
            'requiredHeaders': {'Content-Type': 'image/png'},
          },
        },
      });
    }
    if (path == 'GET /mobile/field/me/signature/preview') {
      if (failPreview) {
        return ResponseBody.fromString('', 503);
      }
      return ResponseBody.fromBytes(
        validPng,
        200,
        headers: {
          Headers.contentTypeHeader: ['image/png'],
        },
      );
    }
    if (options.uri.host == 'storage.example' && options.method == 'PUT') {
      if (failSignedPut) {
        return ResponseBody.fromString('', 503);
      }
      return ResponseBody.fromString('', 200);
    }
    if (path == 'POST /mobile/field/me/signature') {
      confirmed = true;
      return jsonResponse({
        'success': true,

        /// O resultado é **plano**: estende o status e acrescenta a versão
        /// substituída, como `MobileSignatureUploadResultReadModel`.
        'data': {
          ...status(available: true),
          'replacedVersion': available ? 1 : null,
        },
      });
    }
    return ResponseBody.fromString('{}', 404);
  }
}

Widget wrap(
  Backend backend, {
  double textScale = 1.0,
  double width = 400,
  Uint8List? picks,
  String fileName = 'assinatura.png',
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

  return ProviderScope(
    overrides: [
      signatureRepositoryProvider.overrideWithValue(
        SignatureRepository(client: client),
      ),
    ],
    child: MediaQuery(
      data: MediaQueryData(
        textScaler: TextScaler.linear(textScale),
        size: Size(width, 780),
      ),
      child: MaterialApp(
        theme: OrbitTheme.light(),
        home: MySignatureScreen(
          source: () async =>
              picks == null ? null : (bytes: picks, fileName: fileName),
        ),
      ),
    ),
  );
}

/// Volta ao topo da lista.
///
/// A `ListView` constrói sob demanda: depois de rolar até o botão de envio, a
/// seção de estado lá em cima deixa de existir na árvore. Quem quer verificá-la
/// precisa voltar — como uma pessoa faria.
Future<void> voltarAoTopo(WidgetTester tester) async {
  await tester.drag(find.byType(Scrollable).first, const Offset(0, 900));
  await tester.pumpAndSettle();
}

/// Traz o alvo para a árvore, sem tocar nele.
///
/// Passo de 400, e não de 200: a lista ficou mais alta quando cada seção
/// ganhou moldura, e com o passo curto a varredura terminava antes de
/// construir a última seção — o teste falhava com "No element" apontando
/// para o rolável, que é uma pista enganosa.
Future<void> rolarAte(WidgetTester tester, Finder alvo) async {
  /// Arrasto explícito, e não `scrollUntilVisible`.
  ///
  /// Com a lista mais alta — cada seção ganhou moldura —, o passo curto do
  /// `scrollUntilVisible` terminava a varredura antes de a última seção ser
  /// construída, e o erro apontava para o rolável ("No element"), que é uma
  /// pista enganosa. O laço abaixo diz exatamente o que faz.
  for (var tentativa = 0; tentativa < 12; tentativa++) {
    if (alvo.evaluate().isNotEmpty) break;
    await tester.drag(find.byType(Scrollable).first, const Offset(0, -400));
    await tester.pumpAndSettle();
  }
  await tester.pumpAndSettle();
}

/// Rola até o alvo antes de tocar.
///
/// A tela ganhou a seção de desenho acima da de envio, e o botão de enviar
/// passou a nascer fora da viewport de teste. Rolar é o que uma pessoa faria.
Future<void> tocarEm(WidgetTester tester, String texto) async {
  final alvo = find.text(texto);
  await tester.scrollUntilVisible(
    alvo,
    200,
    scrollable: find.byType(Scrollable).first,
  );
  await tester.pumpAndSettle();
  await tester.tap(alvo);
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

  testWidgets('sem assinatura, a tela convida a cadastrar', (tester) async {
    /// Viewport de telefone de verdade. O padrão do `flutter_test` é 800x600,
    /// que é mais **baixo** que qualquer aparelho, e com o desenho espaçoso o
    /// botão principal caía fora dessa altura fictícia.
    tester.view.physicalSize = const Size(1179, 2556);
    tester.view.devicePixelRatio = 3.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(wrap(Backend()));
    await tester.pumpAndSettle();

    expect(find.text('Assinatura não cadastrada'), findsOneWidget);
    expect(find.text('Escolher imagem'), findsOneWidget);

    /// Os dois papéis compartilham a mesma assinatura — não há uma por papel.
    expect(find.text('Técnico em Campo · Responsável Técnico'), findsOneWidget);
  });

  testWidgets('com assinatura, a ação é substituir e diz o efeito real', (
    tester,
  ) async {
    await tester.pumpWidget(wrap(Backend(available: true)));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('signature.preview.image')), findsOneWidget);

    /// A seção de envio ficou abaixo da de desenho: rolar é o que uma pessoa
    /// faria para chegar nela.
    ///
    /// O título da seção é desenhado em versalete — o `find.text` casa com o
    /// que o `Text` recebe, e é isso que a tela mostra. A voz continua
    /// ouvindo "Substituir assinatura", pelo `semanticsLabel`.
    await rolarAte(tester, find.text('SUBSTITUIR ASSINATURA'));

    expect(find.text('SUBSTITUIR ASSINATURA'), findsOneWidget);

    /// A voz não ouve o versalete: o `Text` carrega o rótulo escrito como
    /// gente escreve. Verificado no próprio widget, que é onde a promessa
    /// é feita.
    expect(
      tester.widget<Text>(find.text('SUBSTITUIR ASSINATURA')).semanticsLabel,
      'Substituir assinatura',
    );

    /// A ação é de substituição, e o texto diz o próximo passo concreto —
    /// "nova" é o que separa este caso do primeiro cadastro.
    expect(find.text('Escolher nova imagem'), findsOneWidget);
    expect(find.text('Escolher imagem'), findsNothing);
    expect(
      find.textContaining('documentos já emitidos permanecem como estão'),
      findsOneWidget,
    );
  });

  testWidgets('o arquivo escolhido é mostrado antes de virar assinatura', (
    tester,
  ) async {
    final backend = Backend();
    await tester.pumpWidget(wrap(backend, picks: validPng));
    await tester.pumpAndSettle();

    await tocarEm(tester, 'Escolher imagem');

    expect(find.byType(Image), findsOneWidget);
    expect(find.text('Confirmar assinatura'), findsOneWidget);
    expect(find.text('Escolher outra imagem'), findsOneWidget);

    /// Nada subiu ainda: escolher não é enviar.
    expect(backend.paths.where((p) => p.startsWith('POST')), isEmpty);
  });

  testWidgets('confirmar percorre reservar, enviar e confirmar', (
    tester,
  ) async {
    final backend = Backend();
    await tester.pumpWidget(wrap(backend, picks: validPng));
    await tester.pumpAndSettle();

    await tocarEm(tester, 'Escolher imagem');
    await tocarEm(tester, 'Confirmar assinatura');

    expect(backend.paths.take(5), [
      'GET /mobile/field/me/signature',
      'POST /mobile/field/me/signature/uploads',
      'PUT /put/file-1',
      'POST /mobile/field/me/signature',
      'GET /mobile/field/me/signature',
    ]);
    await voltarAoTopo(tester);
    expect(find.text('Assinatura cadastrada'), findsOneWidget);
  });

  testWidgets('grant expirado é renovado uma vez antes do preview', (
    tester,
  ) async {
    final backend = Backend(available: true, expiredFirstPreview: true);
    await tester.pumpWidget(wrap(backend));
    await tester.pumpAndSettle();

    expect(backend.statusCalls, 2);
    expect(find.byKey(const Key('signature.preview.image')), findsOneWidget);
    expect(
      backend.paths
          .where((path) => path == 'GET /mobile/field/me/signature/preview')
          .length,
      1,
    );
  });

  testWidgets(
    'falha de preview fica segura, limitada e permite tentar de novo',
    (tester) async {
      final backend = Backend(available: true, failPreview: true);
      await tester.pumpWidget(wrap(backend));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('signature.preview.error')), findsOneWidget);
      expect(find.textContaining('storage.example'), findsNothing);
      expect(backend.statusCalls, 2);
      expect(
        backend.paths
            .where((path) => path == 'GET /mobile/field/me/signature/preview')
            .length,
        2,
      );
      expect(find.text('Tentar novamente'), findsOneWidget);
    },
  );

  testWidgets('preview absoluto é recusado antes de expor a sessão', (
    tester,
  ) async {
    final backend = Backend(available: true, externalPreview: true);
    await tester.pumpWidget(wrap(backend));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('signature.preview.error')), findsOneWidget);
    expect(backend.statusCalls, 2);
    expect(
      backend.paths.where(
        (path) => path == 'GET /mobile/field/me/signature/preview',
      ),
      isEmpty,
    );
  });

  testWidgets('arquivo fora do contrato é recusado sem gastar rede', (
    tester,
  ) async {
    final backend = Backend();

    /// Um PDF renomeado para `.png`: a extensão mente, os bytes não.
    await tester.pumpWidget(
      wrap(backend, picks: Uint8List.fromList(utf8.encode('%PDF-1.7 x'))),
    );
    await tester.pumpAndSettle();
    await tocarEm(tester, 'Escolher imagem');

    expect(find.byType(Image), findsNothing);
    expect(find.text('Confirmar assinatura'), findsNothing);
    expect(find.textContaining('PNG, JPEG ou WEBP'), findsWidgets);
    expect(backend.paths.where((p) => p.startsWith('POST')), isEmpty);
  });

  testWidgets('falha no envio dos bytes não declara assinatura cadastrada', (
    tester,
  ) async {
    final backend = Backend(failSignedPut: true);
    await tester.pumpWidget(wrap(backend, picks: validPng));
    await tester.pumpAndSettle();

    await tocarEm(tester, 'Escolher imagem');
    await tocarEm(tester, 'Confirmar assinatura');

    /// O arquivo órfão no storage não é uma assinatura ativa.
    expect(backend.confirmed, isFalse);

    /// E a imagem escolhida continua na tela: repetir não deve exigir
    /// escolher de novo.
    expect(find.text('Confirmar assinatura'), findsOneWidget);

    await voltarAoTopo(tester);
    expect(find.text('Assinatura não cadastrada'), findsOneWidget);
  });

  for (final scale in [1.0, 1.3, 2.0]) {
    testWidgets('não estoura com texto em ${scale}x', (tester) async {
      await tester.pumpWidget(wrap(Backend(available: true), textScale: scale));
      await tester.pumpAndSettle();
      expect(layoutError, isNull);
    });
  }

  testWidgets('tela estreita continua íntegra', (tester) async {
    await tester.pumpWidget(
      wrap(Backend(available: true), width: 280, textScale: 1.3),
    );
    await tester.pumpAndSettle();
    expect(layoutError, isNull);
  });
}
