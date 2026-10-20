/// Renovação de sessão.
///
/// O cenário crítico é a corrida: o backend rotaciona o refresh token a cada
/// uso, então várias requisições que recebem 401 ao mesmo tempo não podem
/// disparar renovações independentes — a segunda chegaria com um token já
/// consumido e derrubaria a sessão do usuário sem motivo.
library;

import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/network/session_authenticator.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/core/storage/token_storage.dart';

import '../support/fakes.dart';

void main() {
  late InMemoryTokenStorage storage;
  const logger = OrbitLogger(isProduction: true);

  setUp(() {
    storage = InMemoryTokenStorage(
      const TokenPair(
        accessToken: 'access-antigo',
        refreshToken: 'refresh-1',
        expiresIn: 900,
      ),
    );
  });

  test('chamadas concorrentes compartilham uma única renovação', () async {
    var backendCalls = 0;
    final completer = Completer<TokenPair>();

    final authenticator = SessionAuthenticator(
      storage: storage,
      logger: logger,
      refreshCall: (_) {
        backendCalls++;
        return completer.future;
      },
    );

    // Cinco requisições recebem 401 ao mesmo tempo.
    final futures = List.generate(5, (_) => authenticator.refresh('refresh-1'));

    completer.complete(
      const TokenPair(
        accessToken: 'access-novo',
        refreshToken: 'refresh-2',
        expiresIn: 900,
      ),
    );
    final results = await Future.wait(futures);

    expect(backendCalls, 1, reason: 'apenas uma chamada ao /identity/refresh');
    expect(results.every((pair) => pair?.accessToken == 'access-novo'), isTrue);
    expect(storage.writes, 1);
  });

  test(
    'requisição atrasada com o token antigo recebe o par já emitido',
    () async {
      var backendCalls = 0;
      final authenticator = SessionAuthenticator(
        storage: storage,
        logger: logger,
        refreshCall: (_) async {
          backendCalls++;
          return const TokenPair(
            accessToken: 'access-novo',
            refreshToken: 'refresh-2',
            expiresIn: 900,
          );
        },
      );

      // Primeira renovação conclui e rotaciona o token.
      final first = await authenticator.refresh('refresh-1');
      expect(first?.refreshToken, 'refresh-2');

      // Requisição que saiu antes da rotação chega agora, ainda com o antigo.
      final late = await authenticator.refresh('refresh-1');

      expect(
        backendCalls,
        1,
        reason: 'a janela de rotação evita o segundo uso',
      );
      expect(late?.accessToken, 'access-novo');
    },
  );

  test('token antigo fora da janela de rotação renova de novo', () async {
    var backendCalls = 0;
    final authenticator = SessionAuthenticator(
      storage: storage,
      logger: logger,
      rotationGrace: Duration.zero, // janela já vencida
      refreshCall: (_) async {
        backendCalls++;
        return TokenPair(
          accessToken: 'access-$backendCalls',
          refreshToken: 'refresh-$backendCalls',
          expiresIn: 900,
        );
      },
    );

    await authenticator.refresh('refresh-1');
    await Future<void>.delayed(const Duration(milliseconds: 1));
    await authenticator.refresh('refresh-1');

    expect(backendCalls, 2);
  });

  test('falha na renovação encerra a sessão e avisa a aplicação', () async {
    final authenticator = SessionAuthenticator(
      storage: storage,
      logger: logger,
      refreshCall: (_) async => throw Exception('refresh token inválido'),
    );

    final expired = expectLater(authenticator.onExpired, emits(null));

    final result = await authenticator.refresh('refresh-1');

    expect(result, isNull);
    expect(storage.clears, 1, reason: 'tokens são descartados');
    expect(await storage.read(), isNull);
    await expired;
  });

  test('renovações com tokens diferentes não se misturam', () async {
    final calls = <String>[];
    final authenticator = SessionAuthenticator(
      storage: storage,
      logger: logger,
      refreshCall: (token) async {
        calls.add(token);
        return TokenPair(
          accessToken: 'access-de-$token',
          refreshToken: 'novo-de-$token',
          expiresIn: 900,
        );
      },
    );

    final results = await Future.wait([
      authenticator.refresh('refresh-A'),
      authenticator.refresh('refresh-B'),
    ]);

    expect(calls, containsAll(['refresh-A', 'refresh-B']));
    expect(results[0]?.accessToken, 'access-de-refresh-A');
    expect(results[1]?.accessToken, 'access-de-refresh-B');
  });
}
