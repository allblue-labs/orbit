/// Cliente HTTP e interceptors.
///
/// Exercita o transporte real do Dio com um adaptador falso, cobrindo o que a
/// aplicação depende: envelope desembrulhado, erro traduzido, token anexado,
/// `x-request-id` enviado e renovação automática no 401.
library;

import 'dart:convert';
import 'dart:async';

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

class _RecordingLogger extends OrbitLogger {
  _RecordingLogger() : super(isProduction: true);
  final events = <Map<String, Object?>?>[];
  @override
  void info(String message, {Map<String, Object?>? data}) => events.add(data);
}

void main() {
  final environment = OrbitEnvironment.fromDefines();
  const logger = OrbitLogger(isProduction: true);

  for (final method in ['GET', 'PUT']) {
    for (final status in [200, 403]) {
      test(
        '$method assinado ($status) mantém assinatura só na requisição',
        () async {
          final logs = _RecordingLogger();
          final adapter = _ScriptedAdapter(
            (_) async => ResponseBody.fromBytes([1, 2], status),
          );
          final client = OrbitApiClient.create(
            environment: environment,
            storage: InMemoryTokenStorage(
              const TokenPair(
                accessToken: 'secret-token',
                refreshToken: 'secret-refresh',
                expiresIn: 900,
              ),
            ),
            logger: logs,
            dio: Dio()..httpClientAdapter = adapter,
          );
          final url = Uri.parse(
            'https://storage.example.test/object?signature=private-signature&key=customer-path',
          );
          final request = method == 'GET'
              ? client.getBytes(url: url)
              : client.putBytes(url: url, bytes: [1, 2], headers: {});
          if (status == 200) {
            await request;
          } else {
            await expectLater(
              request,
              throwsA(
                isA<OrbitException>().having(
                  (e) => e.diagnostics?.path,
                  'diagnostic path',
                  '/object',
                ),
              ),
            );
          }
          expect(
            adapter.requests.single.uri.queryParameters['signature'],
            'private-signature',
          );
          expect(
            adapter.requests.single.headers.keys.map((e) => e.toLowerCase()),
            isNot(contains('authorization')),
          );
          expect(logs.events, isNotEmpty);
          expect(logs.events.toString(), isNot(contains('private-signature')));
          expect(logs.events.toString(), isNot(contains('customer-path')));
          expect(logs.events.map((e) => e?['path']), everyElement('/object'));
        },
      );
    }
  }

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

  test('repete uma leitura após falha transitória de conexão', () async {
    var attempts = 0;
    final setup = build(
      onRequest: (request) async {
        if (++attempts == 1) {
          throw DioException(
            requestOptions: request,
            type: DioExceptionType.connectionError,
          );
        }
        return _json(envelope({'id': 'op-1'}));
      },
    );
    expect(await setup.client.get<dynamic>('/operations/op-1'), {'id': 'op-1'});
    expect(attempts, 2);
  });

  test(
    'download de avatar repete sem enviar token para URL assinada',
    () async {
      var attempts = 0;
      final setup = build(
        onRequest: (request) async {
          if (++attempts == 1) {
            throw DioException(
              requestOptions: request,
              type: DioExceptionType.connectionError,
            );
          }
          return ResponseBody.fromBytes([1, 2, 3], 200);
        },
      );
      final result = await setup.client.getBytes(
        url: Uri.parse('https://storage.example.test/avatar?signature=private'),
      );
      expect(result.bytes, [1, 2, 3]);
      expect(attempts, 2);
      for (final request in setup.adapter.requests) {
        expect(
          request.headers.keys.map((key) => key.toLowerCase()),
          isNot(contains('authorization')),
        );
        expect(request.uri.queryParameters['signature'], 'private');
      }
    },
  );

  test('limita a duas tentativas quando a conexão não retorna', () async {
    var attempts = 0;
    final setup = build(
      onRequest: (request) async {
        attempts++;
        throw DioException(
          requestOptions: request,
          type: DioExceptionType.connectionError,
        );
      },
    );
    await expectLater(
      setup.client.get<dynamic>('/operations'),
      throwsA(isA<OrbitException>()),
    );
    expect(attempts, 2);
  });

  for (final method in ['POST', 'PATCH', 'PUT', 'DELETE']) {
    test('não repete $method após perda de conexão', () async {
      var attempts = 0;
      final setup = build(
        onRequest: (request) async {
          attempts++;
          throw DioException(
            requestOptions: request,
            type: DioExceptionType.connectionError,
          );
        },
      );
      final request = switch (method) {
        'POST' => setup.client.post<dynamic>('/operations'),
        'PATCH' => setup.client.patch<dynamic>('/operations/1'),
        'PUT' => setup.client.put<dynamic>('/operations/1'),
        _ => setup.client.delete<dynamic>('/operations/1'),
      };
      await expectLater(request, throwsA(isA<OrbitException>()));
      expect(attempts, 1);
    });
  }

  test('não repete leitura após cancelamento durante a pausa', () async {
    final token = CancelToken();
    final failed = Completer<void>();
    final setup = build(
      onRequest: (request) async {
        failed.complete();
        throw DioException(
          requestOptions: request,
          type: DioExceptionType.connectionError,
        );
      },
    );
    final result = setup.client.get<dynamic>('/operations', cancelToken: token);
    final assertion = expectLater(
      result,
      throwsA(
        isA<OrbitException>().having((e) => e.isCancelled, 'cancelled', true),
      ),
    );
    await failed.future;
    token.cancel();
    await assertion;
    expect(setup.adapter.requests, hasLength(1));
  });

  test(
    'não repete uma leitura como outra conta após troca da sessão',
    () async {
      final failed = Completer<void>();
      final setup = build(
        onRequest: (request) async {
          failed.complete();
          throw DioException(
            requestOptions: request,
            type: DioExceptionType.connectionError,
          );
        },
      );
      final result = setup.client.scoped().get<dynamic>('/private-A');
      final assertion = expectLater(
        result,
        throwsA(
          isA<OrbitException>().having(
            (e) => e.code,
            'code',
            'SESSION_CHANGED',
          ),
        ),
      );
      await failed.future;
      await setup.client.authenticator.clearSession();
      await assertion;
      expect(setup.adapter.requests, hasLength(1));
    },
  );

  test(
    '401 atrasado não reexecuta a requisição da conta anterior como o novo usuário',
    () async {
      final late = Completer<ResponseBody>();
      final started = Completer<void>();
      final storage = InMemoryTokenStorage(
        const TokenPair(
          accessToken: 'access-A',
          refreshToken: 'refresh-A',
          expiresIn: 900,
        ),
      );
      final setup = build(
        storage: storage,
        onRequest: (_) {
          started.complete();
          return late.future;
        },
      );
      final pending = setup.client.scoped().get<dynamic>('/private-A');
      final assertion = expectLater(
        pending,
        throwsA(
          isA<OrbitException>().having(
            (e) => e.code,
            'code',
            'SESSION_CHANGED',
          ),
        ),
      );
      await started.future;
      await setup.client.authenticator.clearSession();
      await setup.client.authenticator.storeTokens(
        const TokenPair(
          accessToken: 'access-B',
          refreshToken: 'refresh-B',
          expiresIn: 900,
        ),
        generation: setup.client.authenticator.generation,
      );
      late.complete(
        _json(
          errorEnvelope(code: 'UNAUTHORIZED', message: 'Expired'),
          status: 401,
        ),
      );
      await assertion;
      expect(setup.plain.requests, isEmpty);
      expect((await storage.read())?.accessToken, 'access-B');
    },
  );

  test(
    'download assinado antigo é rejeitado depois de encerrar seu contexto',
    () async {
      final late = Completer<ResponseBody>();
      final started = Completer<void>();
      final setup = build(
        onRequest: (_) {
          started.complete();
          return late.future;
        },
      );
      final scoped = setup.client.scoped();
      final pending = scoped.getBytes(
        url: Uri.parse('https://storage.example.test/private-A.pdf'),
      );
      final assertion = expectLater(
        pending,
        throwsA(
          isA<OrbitException>().having(
            (e) => e.code,
            'code',
            'SESSION_CHANGED',
          ),
        ),
      );
      await started.future;
      scoped.closeScope();
      late.complete(ResponseBody.fromBytes([37, 80, 68, 70, 45], 200));
      await assertion;
    },
  );

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
      expect(erro.publicMessage, contains('conectar ao Orbit'));
      expect(erro.publicMessage, isNot(contains('Sem conexão')));
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
