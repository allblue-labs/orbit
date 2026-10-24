import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/errors/orbit_exception.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/network/session_authenticator.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/core/storage/token_storage.dart';
import 'package:orbit_operator/features/authentication/data/auth_repository.dart';

import '../support/fakes.dart';
import '../support/scripted_adapter.dart';

const logger = OrbitLogger(isProduction: true);
const a = TokenPair(
  accessToken: 'access-A',
  refreshToken: 'refresh-A',
  expiresIn: 900,
);
const b = TokenPair(
  accessToken: 'access-B',
  refreshToken: 'refresh-B',
  expiresIn: 900,
);

ResponseBody tokenResponse(TokenPair pair) => jsonResponse(
  envelope({
    'accessToken': pair.accessToken,
    'refreshToken': pair.refreshToken,
    'expiresIn': pair.expiresIn,
  }),
);

OrbitApiClient client(
  TokenStorage storage,
  Future<ResponseBody> Function(RequestOptions) handler,
) => OrbitApiClient.create(
  environment: OrbitEnvironment.fromDefines(),
  storage: storage,
  logger: logger,
  dio: Dio()..httpClientAdapter = ScriptedAdapter(handler),
  retryDio: Dio()..httpClientAdapter = ScriptedAdapter(handler),
);

class SlowTokenStorage implements TokenStorage {
  TokenPair? pair = a;
  final writing = Completer<void>();
  final release = Completer<void>();
  @override
  Future<TokenPair?> read() async => pair;
  @override
  Future<void> clear() async {
    pair = null;
  }

  @override
  Future<void> write(TokenPair value) async {
    if (value.accessToken == 'late-A') {
      writing.complete();
      await release.future;
    }
    pair = value;
  }
}

void main() {
  test('login A respondendo depois do login B não grava tokens de A', () async {
    final storage = InMemoryTokenStorage();
    final late = Completer<ResponseBody>(), started = Completer<void>();
    final api = client(storage, (request) async {
      final body = request.data is String
          ? jsonDecode(request.data as String) as Map<String, dynamic>
          : request.data as Map<String, dynamic>;
      if (body['email'] == 'a@example.test') {
        started.complete();
        return late.future;
      }
      return tokenResponse(b);
    });
    final repository = AuthRepository(client: api, storage: storage);
    final first = repository.login(
      email: 'a@example.test',
      password: 'test-password',
    );
    final rejected = expectLater(
      first,
      throwsA(
        isA<OrbitException>().having((e) => e.code, 'code', 'SESSION_CHANGED'),
      ),
    );
    await started.future;
    await repository.login(email: 'b@example.test', password: 'test-password');
    late.complete(tokenResponse(a));
    await rejected;
    expect((await storage.read())?.accessToken, 'access-B');
  });

  test(
    'logout revoga o aparelho com a credencial antiga sem apagar a conta nova',
    () async {
      final storage = InMemoryTokenStorage(a);
      final revoking = Completer<void>(), release = Completer<ResponseBody>();
      final seen = <RequestOptions>[];
      final api = client(storage, (request) async {
        seen.add(request);
        if (request.method == 'DELETE') {
          expect(
            await storage.read(),
            isNull,
            reason: 'o logout local vem antes da espera pela rede',
          );
          revoking.complete();
          return release.future;
        }
        return jsonResponse(envelope({}));
      });
      final repository = AuthRepository(
        client: api,
        storage: storage,
        deviceInstanceId: () async => 'installation-test',
      );
      final logout = repository.logout();
      await revoking.future;
      api.authenticator.reset();
      await api.authenticator.storeTokens(
        b,
        generation: api.authenticator.generation,
      );
      release.complete(jsonResponse(envelope({})));
      await logout;
      expect(
        seen.map((r) => r.headers['authorization']),
        everyElement('Bearer access-A'),
      );
      expect(seen.first.path, '/mobile/devices/installation-test');
      expect(seen.last.path, '/identity/logout');
      expect((await storage.read())?.accessToken, 'access-B');
    },
  );

  test(
    'logout ordena a limpeza depois de uma escrita de refresh já em andamento',
    () async {
      final storage = SlowTokenStorage();
      final auth = SessionAuthenticator(
        storage: storage,
        logger: logger,
        refreshCall: (_) async => const TokenPair(
          accessToken: 'late-A',
          refreshToken: 'late-refresh-A',
          expiresIn: 900,
        ),
      );
      final old = auth.refresh('refresh-A');
      await storage.writing.future;
      final clearing = auth.clearSession();
      final newSession = auth.storeTokens(b, generation: auth.generation);
      storage.release.complete();
      await clearing;
      await newSession;
      expect(await old, isNull);
      expect((await storage.read())?.accessToken, 'access-B');
    },
  );
}
