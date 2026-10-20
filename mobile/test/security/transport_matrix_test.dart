/// A tradução de toda falha para algo que se possa mostrar.
///
/// ## O que este arquivo prova
///
/// Para **cada** forma de falhar — as do transporte e as do servidor — que a
/// mensagem pública resultante é segura, que a classificação é a certa e que o
/// diagnóstico existe separado, sem contaminar o texto.
///
/// O endereço usado nos casos é `10.0.2.2:6001` de propósito: é o do incidente.
/// Se voltar a vazar, é aqui que aparece.
library;

import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/errors/orbit_exception.dart';
import 'package:orbit_operator/core/network/orbit_interceptors.dart';

import 'public_error_guard.dart';

/// O endereço do incidente.
const enderecoDaBancada = '10.0.2.2:6001';
final uriDoIncidente = Uri.parse(
  'http://10.0.2.2:6001/api/v1/mobile/field/home',
);

/// Traduz uma falha do Dio pelo caminho real do aplicativo.
///
/// Chama o interceptor de verdade — não uma cópia da lógica. Um teste que
/// reimplementa o mapeamento prova que o teste funciona, não o produto.
OrbitException traduzir(DioException erro) =>
    ErrorMappingInterceptor(destination: enderecoDaBancada).map(erro);

DioException dioErro(
  DioExceptionType tipo, {
  Object? causa,
  Response<dynamic>? resposta,
}) => DioException(
  requestOptions: RequestOptions(
    path: '/mobile/field/home',
    baseUrl: 'http://10.0.2.2:6001/api/v1',
  ),
  type: tipo,
  error: causa,
  response: resposta,

  /// A mensagem do Dio, tal como ele a monta. É exatamente esta string que
  /// vazou para a tela do técnico.
  message: 'The request connectionTimeout was exceeded, uri: $uriDoIncidente',
);

Response<dynamic> resposta(int status, Object? corpo) => Response<dynamic>(
  requestOptions: RequestOptions(path: '/mobile/field/home'),
  statusCode: status,
  data: corpo,
);

void main() {
  group('transporte', () {
    test('connection timeout vira demora, sem endereço', () {
      final falha = traduzir(dioErro(DioExceptionType.connectionTimeout));

      expect(falha.kind, OrbitErrorKind.timeout);
      expect(falha.code, 'TIMEOUT');
      expect(falha.isRetryable, isTrue);
      expectSafePublicError(falha.publicMessage, onde: 'timeout de conexão');
      expect(falha.publicMessage, contains('demorando mais que o esperado'));
    });

    test('send e receive timeout caem na mesma categoria', () {
      for (final tipo in [
        DioExceptionType.sendTimeout,
        DioExceptionType.receiveTimeout,
      ]) {
        final falha = traduzir(dioErro(tipo));
        expect(falha.kind, OrbitErrorKind.timeout, reason: tipo.name);
        expectSafePublicError(falha.publicMessage, onde: tipo.name);
      }
    });

    test('conexão recusada vira falta de conexão', () {
      final falha = traduzir(
        dioErro(
          DioExceptionType.connectionError,
          causa: const SocketException(
            'Connection refused',
            osError: OSError('Connection refused', 61),
            address: null,
            port: 6001,
          ),
        ),
      );

      expect(falha.kind, OrbitErrorKind.network);
      expect(falha.isOffline, isTrue);
      expect(falha.isRetryable, isTrue);
      expectSafePublicError(falha.publicMessage, onde: 'conexão recusada');
    });

    test('falha de DNS não vaza o host que não resolveu', () {
      final falha = traduzir(
        dioErro(
          DioExceptionType.connectionError,
          causa: const SocketException(
            'Failed host lookup: api.interna.lab',
            osError: OSError('nodename nor servname provided', 8),
          ),
        ),
      );

      expect(falha.kind, OrbitErrorKind.network);
      expectSafePublicError(falha.publicMessage, onde: 'DNS');
    });

    test('handshake TLS tem categoria própria, e não vira "sem internet"', () {
      final falha = traduzir(
        dioErro(
          DioExceptionType.connectionError,
          causa: const HandshakeException(
            'CERTIFICATE_VERIFY_FAILED: self signed certificate',
          ),
        ),
      );

      /// Mandar conferir o wi-fi por um certificado inválido faria a pessoa
      /// procurar o problema no lugar errado.
      expect(falha.kind, OrbitErrorKind.insecure);
      expect(falha.code, 'SECURE_CONNECTION_FAILED');
      expect(falha.isRetryable, isFalse);
      expect(falha.publicMessage, contains('conexão segura'));
      expectSafePublicError(falha.publicMessage, onde: 'TLS');
    });

    test('certificado recusado pelo Dio também', () {
      final falha = traduzir(dioErro(DioExceptionType.badCertificate));
      expect(falha.kind, OrbitErrorKind.insecure);
      expectSafePublicError(falha.publicMessage, onde: 'badCertificate');
    });

    test('cancelamento é classificado, e não é para assustar ninguém', () {
      final falha = traduzir(dioErro(DioExceptionType.cancel));

      expect(falha.kind, OrbitErrorKind.cancelled);
      expect(falha.isCancelled, isTrue);
      expect(falha.isRetryable, isFalse);
      expectSafePublicError(falha.publicMessage, onde: 'cancelamento');
    });

    test('desconhecido sem resposta cai em falta de conexão', () {
      final falha = traduzir(dioErro(DioExceptionType.unknown));
      expect(falha.kind, OrbitErrorKind.network);
      expectSafePublicError(falha.publicMessage, onde: 'desconhecido');
    });
  });

  group('respostas do servidor', () {
    test('o contrato do backend é preservado — código e mensagem', () {
      final falha = traduzir(
        dioErro(
          DioExceptionType.badResponse,
          resposta: resposta(409, {
            'success': false,
            'error': {
              'code': 'CUSTOMER_DOCUMENT_ALREADY_EXISTS',
              'message': 'Já existe um cliente com este documento.',
              'status': 409,
            },
            'requestId': 'req-1',
          }),
        ),
      );

      /// `code` é a autoridade de máquina; a mensagem é a copy pública que o
      /// servidor já sanitizou. Nenhuma das duas é reescrita aqui.
      expect(falha.code, 'CUSTOMER_DOCUMENT_ALREADY_EXISTS');
      expect(falha.publicMessage, 'Já existe um cliente com este documento.');
      expect(falha.requestId, 'req-1');
      expect(falha.status, 409);
      expectSafePublicError(falha.publicMessage, onde: '409 do contrato');
    });

    test('HTML de proxy nunca vira mensagem', () {
      final falha = traduzir(
        dioErro(
          DioExceptionType.badResponse,
          resposta: resposta(
            502,
            '<html><head><title>502 Bad Gateway</title></head>'
            '<body><center><h1>502 Bad Gateway</h1></center>'
            '<hr><center>nginx/1.25.3</center></body></html>',
          ),
        ),
      );

      expect(falha.code, 'INTERNAL_SERVER_ERROR');
      expect(falha.publicMessage, contains('Não foi possível acessar'));
      expectSafePublicError(falha.publicMessage, onde: '502 com HTML');
    });

    test('JSON que não é o contrato também não vira mensagem', () {
      /// Um proxy que fala JSON e tem `message` na raiz. O contrato exige a
      /// mensagem dentro de `error`; fora dali, não é do Orbit.
      final falha = traduzir(
        dioErro(
          DioExceptionType.badResponse,
          resposta: resposta(503, {
            'message': 'upstream connect error to 10.0.2.2:6001',
            'code': 'UPSTREAM_FAILURE',
          }),
        ),
      );

      expectSafePublicError(falha.publicMessage, onde: '503 fora do contrato');
      expect(falha.publicMessage, isNot(contains('upstream')));
    });

    test('504 sem corpo vira indisponibilidade', () {
      final falha = traduzir(
        dioErro(DioExceptionType.badResponse, resposta: resposta(504, null)),
      );
      expect(falha.isServer, isTrue);
      expect(falha.isRetryable, isTrue);
      expectSafePublicError(falha.publicMessage, onde: '504');
    });

    test('401 não fala de HTTP', () {
      final falha = traduzir(
        dioErro(DioExceptionType.badResponse, resposta: resposta(401, null)),
      );
      expect(falha.code, 'UNAUTHORIZED');
      expect(falha.isUnauthorized, isTrue);
      expect(falha.publicMessage, contains('sessão'));
      expectSafePublicError(falha.publicMessage, onde: '401');
    });

    test('403 não fala de capability', () {
      final falha = traduzir(
        dioErro(
          DioExceptionType.badResponse,
          resposta: resposta(403, {
            'success': false,
            'error': {
              'code': 'FORBIDDEN',
              'message': 'Você não tem permissão para realizar esta ação.',
            },
          }),
        ),
      );
      expect(falha.publicMessage, isNot(contains('capability')));
      expect(falha.publicMessage, isNot(contains('operations.manage')));
      expectSafePublicError(falha.publicMessage, onde: '403');
    });

    test('404 não mostra a rota', () {
      final falha = traduzir(
        dioErro(DioExceptionType.badResponse, resposta: resposta(404, null)),
      );
      expect(falha.publicMessage, isNot(contains('/mobile')));
      expectSafePublicError(falha.publicMessage, onde: '404');
    });

    test('429 orienta a esperar, sem número técnico', () {
      final falha = traduzir(
        dioErro(DioExceptionType.badResponse, resposta: resposta(429, null)),
      );
      expect(falha.code, 'TOO_MANY_REQUESTS');
      expect(falha.isRetryable, isTrue);
      expectSafePublicError(falha.publicMessage, onde: '429');
    });

    test('422 preserva as mensagens estruturadas de validação', () {
      final falha = traduzir(
        dioErro(
          DioExceptionType.badResponse,
          resposta: resposta(422, {
            'success': false,
            'error': {
              'code': 'VALIDATION_ERROR',
              'message': 'Revise os campos informados.',
              'details': [
                {'field': 'email', 'message': 'Informe um e-mail válido.'},
              ],
            },
          }),
        ),
      );
      expect(falha.validationMessages, ['Informe um e-mail válido.']);
      expectSafePublicErrorAll([
        falha.publicMessage,
        ...falha.validationMessages,
      ], onde: '422');
    });
  });

  group('diagnóstico', () {
    test('o endereço existe — no diagnóstico, não na mensagem', () {
      final falha = traduzir(dioErro(DioExceptionType.connectionTimeout));

      /// O dado que resolve o chamado não se perdeu: mudou de canal.
      expect(falha.diagnostics?.host, enderecoDaBancada);
      expect(falha.diagnostics?.transport, 'connectionTimeout');
      expect(falha.diagnostics?.path, '/mobile/field/home');

      /// E a mensagem continua limpa.
      expectSafePublicError(falha.publicMessage, onde: 'timeout');
    });

    test('toString não devolve o endereço pela janela', () {
      final falha = traduzir(dioErro(DioExceptionType.connectionTimeout));

      /// `toString` acaba em log automático e em relatório de erro. Se ele
      /// carregasse o host, a separação teria sido inútil.
      expectSafePublicError(falha.toString(), onde: 'toString');
    });

    test('o diagnóstico não guarda query string', () {
      final erro = DioException(
        requestOptions: RequestOptions(
          path: '/mobile/field/work-queue',
          baseUrl: 'http://10.0.2.2:6001/api/v1',
          queryParameters: const {'cursor': 'eyJ2IjoxfQ', 'limit': 20},
        ),
        type: DioExceptionType.connectionTimeout,
      );
      final falha = traduzir(erro);

      expect(falha.diagnostics?.path, isNot(contains('cursor')));
      expect(falha.diagnostics?.path, isNot(contains('?')));
    });
  });
}
