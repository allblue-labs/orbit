/// Cliente HTTP e interceptors.
///
/// Exercita o transporte real do Dio com um adaptador falso, cobrindo o que a
/// aplicação depende: envelope desembrulhado, erro traduzido, token anexado,
/// `x-request-id` enviado e renovação automática no 401.
library;

import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/errors/orbit_exception.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/network/orbit_interceptors.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/core/storage/token_storage.dart';

import '../support/fakes.dart';

/// Adaptador que responde conforme uma função — sem rede.
class _ScriptedAdapter implements HttpClientAdapter {
  _ScriptedAdapter(this.handler);

  final Future<ResponseBody> Function(RequestOptions options) handler;
  final List<RequestOptions> requests = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<List<int>>? requestStream,
    Future<void>? cancelFuture,
  ) {
    requests.add(options);
    return handler(options);
  }

  @override
  void close({bool force = false}) {}
}

ResponseBody _json(Map<String, dynamic> body, {int status = 200}) {
  return ResponseBody.fromString(
    _encode(body),
    status,
    headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    },
  );
}

String _encode(Map<String, dynamic> body) => jsonEncode(body);

void main() {
  final environment = OrbitEnvironment.fromDefines();
  const logger = OrbitLogger(isProduction: true);

  ({OrbitApiClient client, _ScriptedAdapter adapter, _ScriptedAdapter plain})
  build({
    required Future<ResponseBody> Function(RequestOptions) onRequest,
    Future<ResponseBody> Function(RequestOptions)? onPlain,
    TokenStorage? storage,
  }) {
    final adapter = _ScriptedAdapter(onRequest);
    final plainAdapter = _ScriptedAdapter(onPlain ?? onRequest);
    final dio = Dio()..httpClientAdapter = adapter;
    final plain = Dio()..httpClientAdapter = plainAdapter;

    final client = OrbitApiClient.create(
      environment: environment,
      storage: storage ?? InMemoryTokenStorage(),
      logger: logger,
      dio: dio,
      retryDio: plain,
    );
    return (client: client, adapter: adapter, plain: plainAdapter);
  }

  test('desembrulha o envelope de sucesso', () async {
    final setup = build(
      onRequest: (_) async => _json(envelope({'id': 'op-1', 'code': 'OP-1'})),
    );

    final data = await setup.client.get<Map<String, dynamic>>('/operations/1');

    expect(data['id'], 'op-1');
    expect(data['code'], 'OP-1');
  });

  test('traduz o envelope de erro para OrbitException', () async {
    final setup = build(
      onRequest: (_) async => _json(
        errorEnvelope(
          code: 'CONFLICT',
          message: 'Esta mudança de status não é permitida.',
        ),
        status: 409,
      ),
    );

    await expectLater(
      setup.client.patch<Map<String, dynamic>>('/operations/1/status'),
      throwsA(
        isA<OrbitException>()
            .having((error) => error.status, 'status', 409)
            .having((error) => error.code, 'code', 'CONFLICT')
            .having(
              (error) => error.publicMessage,
              'message',
              equals('Esta mudança de status não é permitida.'),
            ),
      ),
    );
  });

  test(
    'lê detalhes estruturados de validação sem depender de texto interno',
    () {
      final error = OrbitException.fromEnvelope(
        status: 400,
        body: const {
          'success': false,
          'error': {
            'code': 'VALIDATION_ERROR',
            'message': 'Revise os campos informados.',
            'status': 400,
            'details': [
              {
                'field': 'email',
                'code': 'INVALID_FORMAT',
                'message': 'Informe um e-mail válido.',
              },
            ],
          },
        },
      );

      expect(error.code, 'VALIDATION_ERROR');
      expect(error.validationMessages, ['Informe um e-mail válido.']);
    },
  );

  test('envia x-request-id e o token guardado', () async {
    final storage = InMemoryTokenStorage(
      const TokenPair(
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresIn: 900,
      ),
    );
    final setup = build(
      onRequest: (_) async => _json(envelope(const <String, dynamic>{})),
      storage: storage,
    );

    await setup.client.get<Map<String, dynamic>>('/identity/me');

    final sent = setup.adapter.requests.single;
    expect(sent.headers['authorization'], 'Bearer access-1');
    expect(sent.headers[ContextHeaders.requestId], isNotEmpty);
    expect(sent.headers[ContextHeaders.client], 'MOBILE');
  });

  test('requisição pública não leva token', () async {
    final storage = InMemoryTokenStorage(
      const TokenPair(
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresIn: 900,
      ),
    );
    final setup = build(
      onRequest: (_) async => _json(envelope(const <String, dynamic>{})),
      storage: storage,
    );

    await setup.client.post<Map<String, dynamic>>(
      '/identity/login',
      isPublic: true,
      body: const {'email': 'a@b.com'},
    );

    expect(
      setup.adapter.requests.single.headers.containsKey('authorization'),
      isFalse,
    );
  });

  test('401 dispara renovação e repete a requisição', () async {
    final storage = InMemoryTokenStorage(
      const TokenPair(
        accessToken: 'access-vencido',
        refreshToken: 'refresh-1',
        expiresIn: 900,
      ),
    );

    var protectedCalls = 0;
    final setup = build(
      storage: storage,
      onRequest: (options) async {
        protectedCalls++;
        // Primeira tentativa: token vencido.
        if (options.headers['authorization'] == 'Bearer access-vencido') {
          return _json(
            errorEnvelope(
              code: 'UNAUTHORIZED',
              message: 'Sua sessão não é válida ou expirou.',
            ),
            status: 401,
          );
        }
        return _json(envelope({'id': 'op-1'}));
      },
      onPlain: (options) async {
        if (options.path.contains('/identity/refresh')) {
          return _json(
            envelope({
              'accessToken': 'access-novo',
              'refreshToken': 'refresh-2',
              'tokenType': 'Bearer',
              'expiresIn': 900,
            }),
          );
        }
        // Reexecução com o token renovado.
        return _json(envelope({'id': 'op-1'}));
      },
    );

    final data = await setup.client.get<Map<String, dynamic>>('/operations/1');

    expect(data['id'], 'op-1');
    expect(protectedCalls, 1, reason: 'a primeira tentativa levou 401');
    expect((await storage.read())?.accessToken, 'access-novo');
  });

  test('falha de conexão vira erro de rede legível', () async {
    final setup = build(
      onRequest: (options) async => throw DioException.connectionError(
        requestOptions: options,
        reason: 'sem rota para o host',
      ),
    );

    await expectLater(
      setup.client.get<Map<String, dynamic>>('/operations'),
      throwsA(
        isA<OrbitException>()
            .having((error) => error.isOffline, 'isOffline', isTrue)
            .having((error) => error.code, 'code', 'NETWORK'),
      ),
    );
  });

  test('remove parâmetros nulos da query', () async {
    final setup = build(
      onRequest: (_) async => _json(envelope(const <String, dynamic>{})),
    );

    await setup.client.get<Map<String, dynamic>>(
      '/operations',
      query: {'status': 'OPEN', 'search': null, 'kind': ''},
    );

    final sent = setup.adapter.requests.single;
    expect(sent.queryParameters, {'status': 'OPEN'});
  });

  group('para onde tentou ir é diagnóstico, não mensagem', () {
    /// Este grupo mudou de lado.
    ///
    /// Antes ele cobrava o contrário: que a mensagem pública **nomeasse** o
    /// destino fora de produção, para que a URL errada não ficasse invisível.
    /// A intenção era boa e o efeito foi o incidente — um técnico abriu o
    /// aplicativo e leu "(tentei 10.0.2.2:6001)".
    ///
    /// O dado continua existindo, e continua sendo o que resolve o chamado.
    /// Mudou de canal: vai para o diagnóstico, que a interface não recebe.
    DioException semRede(RequestOptions options) => DioException(
      requestOptions: options,
      type: DioExceptionType.connectionError,
      error: 'nada respondeu',
    );

    Future<OrbitException> mapear(String? destino) async {
      final dio = Dio()
        ..httpClientAdapter = _ScriptedAdapter(
          (options) async => throw semRede(options),
        )
        ..interceptors.add(ErrorMappingInterceptor(destination: destino));
      try {
        await dio.get<dynamic>('/operations');
        fail('a requisição deveria ter falhado');
      } on DioException catch (error) {
        return error.error as OrbitException;
      }
    }

    test('o destino vai para o diagnóstico', () async {
      final erro = await mapear('192.168.1.233:6001');

      expect(erro.code, 'NETWORK');
      expect(erro.diagnostics?.host, '192.168.1.233:6001');
    });

    test('e nunca para a mensagem pública', () async {
      final erro = await mapear('192.168.1.233:6001');

      expect(erro.publicMessage, isNot(contains('192.168.1.233')));
      expect(erro.publicMessage, isNot(contains('6001')));
      expect(erro.publicMessage, contains('conexão com a internet'));
    });

    test('sem destino informado, a mensagem é a mesma', () async {
      /// A frase pública não depende de haver diagnóstico — se dependesse,
      /// haveria duas mensagens para o mesmo caso, e uma delas seria a longa.
      final comDestino = await mapear('192.168.1.233:6001');
      final semDestino = await mapear(null);

      expect(semDestino.publicMessage, comDestino.publicMessage);
      expect(semDestino.diagnostics?.host, isNull);
    });

    test('o ambiente informa o destino em qualquer sabor', () {
      /// Antes era `null` em produção, porque o ambiente era a única barreira
      /// contra o vazamento. Hoje a barreira é estrutural, e quem investiga um
      /// erro em produção precisa do endereço tanto quanto em bancada.
      const producao = OrbitEnvironment(
        apiBaseUrl: 'https://api.orbit.app/api/v1',
        flavor: OrbitFlavor.production,
        connectTimeout: Duration(seconds: 15),
        receiveTimeout: Duration(seconds: 30),
      );

      expect(producao.diagnosticHost, 'api.orbit.app');
      expect(producao.apiHost, 'api.orbit.app');
    });
  });
}
