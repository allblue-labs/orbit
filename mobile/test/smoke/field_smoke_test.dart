/// Smoke da projeção de campo contra o backend real.
///
/// Prova o que só o servidor pode provar: que os três endpoints do MB-01
/// respondem, que os contratos desserializam o payload de verdade, e que a
/// ordenação e o cursor são os dele.
///
/// Sem API no ar, cada teste é pulado com motivo — nunca substituído por dado
/// fabricado.
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/contracts/mobile_field_contracts.dart';
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

/// Posição de cada faixa na ordem que o backend publica.
const _rank = <MobileDueState, int>{
  MobileDueState.inProgress: 0,
  MobileDueState.overdue: 1,
  MobileDueState.dueToday: 2,
  MobileDueState.upcoming: 3,
  MobileDueState.unscheduled: 4,
};

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

  Future<void> authenticate() async {
    final data = await client.post<Map<String, dynamic>>(
      '/identity/login',
      body: {'email': _email, 'password': _password},
      isPublic: true,
    );
    await storage.write(TokenPair.fromJson(data));
  }

  bool skipIfDown() {
    if (available) return false;
    markTestSkipped('API indisponível em $_baseUrl');
    return true;
  }

  test('o dashboard responde e desserializa numa requisição', () async {
    if (skipIfDown()) return;
    await authenticate();

    final data = await client.get<Map<String, dynamic>>(
      '/mobile/field/dashboard',
    );
    final dashboard = MobileFieldDashboardContract.fromJson(data);

    /// As contagens são do servidor — o teste só prova que chegaram inteiras.
    expect(dashboard.counters.today, isA<int>());
    expect(dashboard.counters.overdue, isA<int>());
    expect(dashboard.counters.inProgress, isA<int>());
    expect(dashboard.counters.upcoming, isA<int>());
  });

  test('a fila vem ordenada pelo servidor, e o app não reordena', () async {
    if (skipIfDown()) return;
    await authenticate();

    final data = await client.get<Map<String, dynamic>>(
      '/mobile/field/work-queue',
      query: {'view': 'ALL', 'limit': 50},
    );
    final page = MobileWorkQueuePageContract.fromJson(data);

    /// A ordem por faixa é monotônica: em andamento, atrasado, hoje,
    /// próximos, sem data. Isto confere o que **chegou** — não recria a regra.
    var previous = -1;
    for (final item in page.data) {
      final rank = _rank[item.dueState]!;
      expect(
        rank,
        greaterThanOrEqualTo(previous),
        reason: 'ordem quebrada em ${item.id}',
      );
      previous = rank;
    }

    /// IDs canônicos e únicos dentro da página.
    final ids = page.data.map((item) => item.id).toSet();
    expect(ids.length, page.data.length);
  });

  test(
    'repetir a mesma página com o mesmo cursor não muda o resultado',
    () async {
      if (skipIfDown()) return;
      await authenticate();

      final first = MobileWorkQueuePageContract.fromJson(
        await client.get<Map<String, dynamic>>(
          '/mobile/field/work-queue',
          query: {'view': 'ALL', 'limit': 1},
        ),
      );
      if (!first.hasNextPage) {
        markTestSkipped('fila com menos de dois itens neste tenant');
        return;
      }

      Future<List<String>> secondPage() async {
        final page = MobileWorkQueuePageContract.fromJson(
          await client.get<Map<String, dynamic>>(
            '/mobile/field/work-queue',
            query: {'view': 'ALL', 'limit': 1, 'cursor': first.nextCursor},
          ),
        );
        return page.data.map((item) => item.id).toList();
      }

      /// O cursor é estável: a mesma consulta devolve o mesmo item. É isso que
      /// torna o `retry` seguro e a junção idempotente.
      expect(await secondPage(), await secondPage());
    },
  );

  test('o contexto de um item vem numa requisição só', () async {
    if (skipIfDown()) return;
    await authenticate();

    final queue = MobileWorkQueuePageContract.fromJson(
      await client.get<Map<String, dynamic>>(
        '/mobile/field/work-queue',
        query: {'view': 'ALL', 'limit': 1},
      ),
    );
    if (queue.data.isEmpty) {
      markTestSkipped('sem itens de campo neste tenant');
      return;
    }

    final id = queue.data.first.id;
    final detail = MobileFieldContextContract.fromJson(
      await client.get<Map<String, dynamic>>(
        '/mobile/field/work-items/${Uri.encodeComponent(id)}',
      ),
    );

    expect(detail, isNotNull);
    expect(detail!.workItem.id, id);

    /// Cliente e equipamento chegam agregados — sem consulta por linha.
    expect(detail.workItem.navigationContext.kind, queue.data.first.kind);
  });
}
