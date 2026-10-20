/// Smoke contra o backend real.
///
/// Fundação só se prova contra o servidor de verdade: é ele que emite o
/// envelope, rotaciona o token e recusa o que não é permitido. Um duplo de
/// teste provaria apenas que o duplo concorda com o que se espera dele.
///
/// Quando a API não está no ar, cada teste é **pulado com motivo** — nunca
/// substituído por dado fabricado. Um smoke que passa sem servidor não é
/// smoke.
///
/// Escopo deliberadamente estreito (PR-FL-01): sessão, uma rota protegida,
/// decodificação de contrato e as recusas. Os fluxos de campo são das
/// próximas PRs.
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/contracts/agenda_contracts.dart';
import 'package:orbit_operator/core/errors/orbit_exception.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/core/storage/token_storage.dart';

const _baseUrl = String.fromEnvironment(
  'ORBIT_API_URL',
  defaultValue: 'http://localhost:6001/api/v1',
);
const _email = String.fromEnvironment(
  'ORBIT_OWNER_EMAIL',
  defaultValue: 'owner@orbit.local',
);
const _password = String.fromEnvironment(
  'ORBIT_OWNER_PASSWORD',
  defaultValue: 'OrbitOwner@2026',
);

/// Guarda os tokens em memória: o smoke não deve tocar o keychain da máquina.
class _MemoryTokenStorage implements TokenStorage {
  TokenPair? _pair;

  @override
  Future<void> clear() async => _pair = null;

  @override
  Future<TokenPair?> read() async => _pair;

  @override
  Future<void> write(TokenPair pair) async => _pair = pair;
}

Future<bool> _apiIsUp() async {
  try {
    final uri = Uri.parse(_baseUrl);
    final socket = await Socket.connect(
      uri.host,
      uri.port,
      timeout: const Duration(seconds: 2),
    );
    socket.destroy();
    return true;
  } on Object {
    return false;
  }
}

void main() {
  late bool available;
  late OrbitApiClient client;
  late _MemoryTokenStorage storage;

  setUpAll(() async {
    available = await _apiIsUp();
    if (!available) return;
    storage = _MemoryTokenStorage();
    client = OrbitApiClient.create(
      environment: OrbitEnvironment(
        apiBaseUrl: _baseUrl,
        flavor: OrbitFlavor.development,
        connectTimeout: const Duration(seconds: 10),
        receiveTimeout: const Duration(seconds: 20),
      ),
      storage: storage,
      logger: const OrbitLogger(isProduction: false),
    );
  });

  /// Uma sessão real. Devolve `false` quando não há API.
  Future<bool> authenticate() async {
    if (!available) return false;
    final data = await client.post<Map<String, dynamic>>(
      '/identity/login',
      body: {'email': _email, 'password': _password},
      isPublic: true,
    );
    await storage.write(TokenPair.fromJson(data));
    return true;
  }

  test(
    'a sessão é emitida pelo backend e o envelope é desembrulhado',
    () async {
      if (!available) {
        markTestSkipped('API indisponível em $_baseUrl');
        return;
      }

      expect(await authenticate(), isTrue);
      final pair = await storage.read();
      expect(pair?.accessToken, isNotEmpty);
      expect(pair?.refreshToken, isNotEmpty);
    },
  );

  test('rota protegida responde e o contrato decodifica', () async {
    if (!available) {
      markTestSkipped('API indisponível em $_baseUrl');
      return;
    }
    await authenticate();

    final data = await client.get<Map<String, dynamic>>(
      '/scheduling/agenda',
      query: {'view': 'DAY', 'date': DateTime.now().toUtc().toIso8601String()},
    );
    final agenda = Agenda.fromJson(data);

    /// O servidor diz em que fuso resolveu o dia — é essa a autoridade que o
    /// app consome em vez de calcular.
    expect(agenda.range.timezone, isNotEmpty);
    expect(agenda.view, 'DAY');

    /// Um dia sem compromissos devolve **zero** dias: o backend agrupa
    /// eventos por data civil, e sem eventos não há grupo. Exigir lista
    /// preenchida aqui amarraria o teste à agenda do tenant, não ao contrato.
    if (agenda.days.isNotEmpty) {
      expect(agenda.civilDate, isNotNull);
      expect(agenda.days.first.date, isNotNull);
    }
  });

  test('sem sessão, a rota protegida recusa', () async {
    if (!available) {
      markTestSkipped('API indisponível em $_baseUrl');
      return;
    }
    await storage.clear();

    await expectLater(
      client.get<Map<String, dynamic>>(
        '/scheduling/agenda',
        query: {
          'view': 'DAY',
          'date': DateTime.now().toUtc().toIso8601String(),
        },
      ),
      throwsA(
        isA<OrbitException>().having(
          (error) => error.isUnauthorized,
          'isUnauthorized',
          isTrue,
        ),
      ),
    );
  });

  test('recurso inexistente vira 404 mapeado, com requestId', () async {
    if (!available) {
      markTestSkipped('API indisponível em $_baseUrl');
      return;
    }
    await authenticate();

    try {
      await client.get<Map<String, dynamic>>(
        '/operations/01a00000-0000-7000-8000-000000000000',
      );
      fail('esperava recusa do backend');
    } on OrbitException catch (error) {
      expect(error.isNotFound, isTrue);

      /// O `requestId` do envelope é o que liga a tela ao log do servidor.
      expect(error.requestId, isNotNull);
    }
  });
}
