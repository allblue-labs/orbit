/// Quando o aplicativo não sabe se o comando foi aplicado.
///
/// ## O problema
///
/// Um técnico toca em "Concluir". A requisição sai. O elevador engole o sinal.
/// O aparelho não recebe resposta.
///
/// Dizer "falhou" faz a pessoa concluir de novo um atendimento que já foi
/// concluído. Dizer "pronto" registra como fato algo que ninguém confirmou. As
/// duas mentiras custam caro, e a diferença entre elas está no transporte.
library;

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/errors/orbit_exception.dart';
import 'package:orbit_operator/core/errors/orbit_public_copy.dart';
import 'package:orbit_operator/core/network/orbit_interceptors.dart';

import 'public_error_guard.dart';

OrbitException falhaDe(DioExceptionType tipo, {Response<dynamic>? resposta}) =>
    ErrorMappingInterceptor(destination: '10.0.2.2:6001').map(
      DioException(
        requestOptions: RequestOptions(
          path: '/mobile/field/operations/op-1/commands/complete',
          baseUrl: 'http://10.0.2.2:6001/api/v1',
        ),
        type: tipo,
        response: resposta,
      ),
    );

void main() {
  group('nada saiu do aparelho', () {
    test('a conexão nem abriu — não houve o que processar', () {
      final falha = falhaDe(DioExceptionType.connectionTimeout);

      expect(falha.mayHaveBeenApplied, isFalse);
      expect(falha.publicMessageForCommand, falha.publicMessage);
      expect(falha.publicMessageForCommand, isNot(contains('confirmar')));
    });

    test('sem rede — idem', () {
      final falha = falhaDe(DioExceptionType.connectionError);
      expect(falha.mayHaveBeenApplied, isFalse);
    });
  });

  group('pode ter sido processado', () {
    test('parou enviando', () {
      final falha = falhaDe(DioExceptionType.sendTimeout);

      expect(falha.mayHaveBeenApplied, isTrue);
      expect(falha.publicMessageForCommand, OrbitPublicCopy.resultUnknown);
    });

    test('enviou e não recebeu resposta', () {
      final falha = falhaDe(DioExceptionType.receiveTimeout);

      expect(falha.mayHaveBeenApplied, isTrue);

      /// A frase pede reconciliação antes de nova tentativa — e não diz que
      /// falhou, porque não se sabe.
      expect(falha.publicMessageForCommand, contains('confirmar o resultado'));
      expect(falha.publicMessageForCommand, contains('Atualize os dados'));
    });

    test('o servidor recebeu e quebrou', () {
      final falha = falhaDe(
        DioExceptionType.badResponse,
        resposta: Response<dynamic>(
          requestOptions: RequestOptions(path: '/x'),
          statusCode: 500,
          data: null,
        ),
      );

      expect(falha.mayHaveBeenApplied, isTrue);
      expect(falha.publicMessageForCommand, OrbitPublicCopy.resultUnknown);
    });
  });

  group('recusas continuam sendo recusas', () {
    test('409 não vira ambiguidade', () {
      final falha = falhaDe(
        DioExceptionType.badResponse,
        resposta: Response<dynamic>(
          requestOptions: RequestOptions(path: '/x'),
          statusCode: 409,
          data: const {
            'success': false,
            'error': {
              'code': 'VERSION_CONFLICT',
              'message': 'Os dados foram alterados. Atualize e tente de novo.',
            },
          },
        ),
      );

      /// O servidor respondeu, e disse não. Não há o que confirmar.
      expect(falha.mayHaveBeenApplied, isFalse);
      expect(falha.publicMessageForCommand, falha.publicMessage);
      expect(falha.code, 'VERSION_CONFLICT');
    });

    test('403 idem', () {
      final falha = falhaDe(
        DioExceptionType.badResponse,
        resposta: Response<dynamic>(
          requestOptions: RequestOptions(path: '/x'),
          statusCode: 403,
          data: null,
        ),
      );
      expect(falha.mayHaveBeenApplied, isFalse);
    });
  });

  test('nenhuma das frases de comando vaza infraestrutura', () {
    for (final tipo in DioExceptionType.values) {
      final falha = falhaDe(tipo);
      expectSafePublicError(
        falha.publicMessageForCommand,
        onde: 'comando com ${tipo.name}',
      );
    }
  });
}
