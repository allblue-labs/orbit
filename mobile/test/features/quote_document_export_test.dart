import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/errors/orbit_exception.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/core/storage/token_storage.dart';
import 'package:orbit_operator/features/artifact/data/document_file.dart';
import 'package:orbit_operator/features/customers/data/mobile_quote_repository.dart';

import '../support/fakes.dart';
import '../support/scripted_adapter.dart';

const _pdf = '%PDF-1.7\nconteudo\n%%EOF';
const _signedUrl =
    'https://storage.example.test/exports/orcamento.pdf?X-Amz-Signature=abc';

ResponseBody _error(int status, String code) => jsonResponse({
  'success': false,
  'error': {'code': code, 'status': status, 'message': 'x'},
}, status: status);

ResponseBody _status(String situation) => jsonResponse({
  'success': true,
  'data': {
    'exportId': 'e1',
    'kind': 'QUOTE',
    'status': situation,
    'fileName': situation == 'COMPLETED' ? 'ORC-000042.pdf' : null,
    'contentType': situation == 'COMPLETED' ? 'application/pdf' : null,
    'errorCode': null,
    'download': situation == 'COMPLETED'
        ? {'url': _signedUrl, 'expiresAt': '2026-11-23T10:05:00.000Z'}
        : null,
  },
});

({
  MobileQuoteRepository quotes,
  List<RequestOptions> requests,
  List<Duration> slept,
})
_build(Future<ResponseBody> Function(RequestOptions request) handler) {
  final requests = <RequestOptions>[];
  final slept = <Duration>[];
  final dio = Dio()
    ..httpClientAdapter = ScriptedAdapter((request) {
      requests.add(request);
      return handler(request);
    });
  final environment = OrbitEnvironment.fromDefines();
  final client = OrbitApiClient.create(
    environment: environment,
    storage: InMemoryTokenStorage(
      const TokenPair(
        accessToken: 'export-test-token',
        refreshToken: 'export-test-refresh',
        expiresIn: 3600,
      ),
    ),
    logger: const OrbitLogger(isProduction: true),
    dio: dio,
  );
  var clock = DateTime(2026, 11, 23, 10);
  final quotes = MobileQuoteRepository(
    client: client,
    apiBaseUrl: environment.apiBaseUrl,
    sleep: (duration) async {
      slept.add(duration);
      clock = clock.add(duration);
    },
    now: () => clock,
  );
  return (quotes: quotes, requests: requests, slept: slept);
}

void main() {
  test(
    'pede (202), acompanha e baixa da URL assinada sem o token da sessão',
    () async {
      final respostas = ['PENDING', 'PROCESSING', 'COMPLETED'];
      final built = _build((request) async {
        if (request.method == 'POST') {
          return jsonResponse({
            'success': true,
            'data': {'exportId': 'e1', 'jobId': 'j1', 'status': 'PENDING'},
          }, status: 202);
        }
        if (request.uri.host == 'storage.example.test') {
          return ResponseBody.fromBytes(
            utf8.encode(_pdf),
            200,
            headers: {
              Headers.contentTypeHeader: ['application/pdf'],
            },
          );
        }
        return _status(respostas.removeAt(0));
      });
      final files = MemoryDocumentFileStore();

      final path = await built.quotes.document('quote-1', files);

      expect(await files.exists(path), isTrue);
      expect(path, endsWith('ORC-000042.pdf'));
      final paths = built.requests.map((r) => r.uri.path).toList();
      expect(
        paths.first,
        endsWith('/mobile/field/quotes/quote-1/document/exports'),
      );
      expect(
        paths.where((p) => p.endsWith('/document-exports/e1')),
        hasLength(3),
      );
      expect(built.slept.map((d) => d.inMilliseconds), [1500, 2250, 3375]);
      final download = built.requests.last;
      expect(download.uri.host, 'storage.example.test');
      expect(download.headers['authorization'], isNull);
      expect(
        built.requests.first.headers['authorization'],
        'Bearer export-test-token',
      );
    },
  );

  test('servidor anterior às exportações: usa a rota síncrona', () async {
    final built = _build((request) async {
      if (request.method == 'POST') return _error(404, 'NOT_FOUND');
      return ResponseBody.fromBytes(
        utf8.encode(_pdf),
        200,
        headers: {
          Headers.contentTypeHeader: ['application/pdf'],
        },
      );
    });
    final files = MemoryDocumentFileStore();

    final path = await built.quotes.document('quote-1', files);

    expect(await files.exists(path), isTrue);
    expect(
      built.requests.last.uri.path,
      endsWith('/mobile/field/quotes/quote-1/document'),
    );
  });

  test('429 vira aviso de muitos documentos em geração', () async {
    final built = _build((request) async => _error(429, 'RATE_LIMITED'));

    await expectLater(
      built.quotes.document('quote-1', MemoryDocumentFileStore()),
      throwsA(
        isA<OrbitException>()
            .having((e) => e.status, 'status', 429)
            .having(
              (e) => e.publicMessage,
              'mensagem',
              contains('muitos documentos'),
            ),
      ),
    );
  });

  test('FAILED vira mensagem amigável', () async {
    final built = _build((request) async {
      if (request.method == 'POST') {
        return jsonResponse({
          'success': true,
          'data': {'exportId': 'e1', 'jobId': 'j1', 'status': 'PENDING'},
        }, status: 202);
      }
      return _status('FAILED');
    });

    await expectLater(
      built.quotes.document('quote-1', MemoryDocumentFileStore()),
      throwsA(
        isA<OrbitException>().having(
          (e) => e.publicMessage,
          'mensagem',
          contains('Não foi possível gerar o documento'),
        ),
      ),
    );
  });

  test('desiste depois de 2 minutos', () async {
    final built = _build((request) async {
      if (request.method == 'POST') {
        return jsonResponse({
          'success': true,
          'data': {'exportId': 'e1', 'jobId': 'j1', 'status': 'PENDING'},
        }, status: 202);
      }
      return _status('PROCESSING');
    });

    await expectLater(
      built.quotes.document('quote-1', MemoryDocumentFileStore()),
      throwsA(
        isA<OrbitException>().having(
          (e) => e.code,
          'código',
          'DOCUMENT_EXPORT_TIMEOUT',
        ),
      ),
    );
    final total = built.slept.fold<int>(0, (sum, d) => sum + d.inMilliseconds);
    expect(total, greaterThanOrEqualTo(120000));
  });
}
