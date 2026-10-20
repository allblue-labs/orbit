/// Operações: leitura, cache offline e escrita.
library;

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/contracts/operation_contracts.dart';
import 'package:orbit_operator/core/errors/orbit_exception.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/features/operations/data/operations_repository.dart';

import '../support/fakes.dart';
import '../support/scripted_adapter.dart';

Map<String, dynamic> _operationJson({
  String id = 'op-1',
  String status = 'IN_PROGRESS',
}) => {
  'id': id,
  'code': 'OP-0001',
  'title': 'Manutenção preventiva',
  'status': status,
  'kind': 'MAINTENANCE',
  'priority': 'HIGH',
  'description': 'Troca de filtros',
  'scheduledStart': '2026-08-01T13:00:00.000Z',
  'businessUnit': {
    'id': 'unit-1',
    'legalName': 'Acme LTDA',
    'tradeName': 'Acme',
  },
  'customer': {'id': 'cus-1', 'legalName': 'Cliente Um', 'tradeName': 'Um'},
  // O contrato publica uma lista: o técnico atende os aparelhos do endereço.
  'assets': [
    {
      'id': 'ast-1',
      'name': 'Chiller 200TR',
      'identifier': 'CH-200',
      'status': 'ACTIVE',
    },
  ],
  'users': [
    {
      'userId': 'user-1',
      'assignedAt': '2026-07-21T09:00:00.000Z',
      'user': {'id': 'user-1', 'displayName': 'Marina Duarte'},
    },
  ],
  'attachments': [
    {
      'id': 'att-1',
      'fileName': 'laudo.pdf',
      'mimeType': 'application/pdf',
      'size': 2048,
      'createdAt': '2026-07-22T10:00:00.000Z',
    },
  ],
  'checklistExecutions': [
    {
      'id': 'chk-1',
      'status': 'IN_PROGRESS',
      'progress': 60,
      'updatedAt': '2026-07-29T10:00:00.000Z',
    },
  ],
  'updatedAt': '2026-07-30T12:00:00.000Z',
};

Map<String, dynamic> _page(List<Map<String, dynamic>> data) => {
  'data': data,
  'meta': {
    'page': 1,
    'limit': 20,
    'total': data.length,
    'totalPages': 1,
    'hasNextPage': false,
    'hasPreviousPage': false,
  },
};

void main() {
  final environment = OrbitEnvironment.fromDefines();
  const logger = OrbitLogger(isProduction: true);

  ({
    OperationsRepository repository,
    InMemoryReadCache cache,
    ScriptedAdapter adapter,
  })
  build(Future<ResponseBody> Function(RequestOptions) handler) {
    final adapter = ScriptedAdapter(handler);
    final dio = Dio()..httpClientAdapter = adapter;
    final plain = Dio()..httpClientAdapter = ScriptedAdapter(handler);
    final cache = InMemoryReadCache();
    final client = OrbitApiClient.create(
      environment: environment,
      storage: InMemoryTokenStorage(),
      logger: logger,
      dio: dio,
      retryDio: plain,
    );
    return (
      repository: OperationsRepository(client: client, cache: cache),
      cache: cache,
      adapter: adapter,
    );
  }

  test('lê a lista paginada e converte o contrato', () async {
    final setup = build(
      (_) async => jsonResponse(envelope(_page([_operationJson()]))),
    );

    final result = await setup.repository.list(const OperationQuery());

    expect(result.isFromCache, isFalse);
    expect(result.value.total, 1);
    final operation = result.value.data.single;
    expect(operation.code, 'OP-0001');
    expect(operation.customer?.name, 'Um');
    expect(operation.asset?.detail, 'CH-200');
    expect(operation.assignees.single.displayName, 'Marina Duarte');
    expect(operation.checklists.single.progress, 60);
  });

  test('envia apenas os filtros aceitos pelo backend', () async {
    final setup = build((_) async => jsonResponse(envelope(_page(const []))));

    await setup.repository.list(
      const OperationQuery(status: 'OPEN', search: 'chiller', page: 2),
    );

    final sent = setup.adapter.requests.single.queryParameters;
    expect(sent['status'], 'OPEN');
    expect(sent['search'], 'chiller');
    expect(sent['page'], 2);
    // Nada de ordenação: o DTO do backend não aceita.
    expect(sent.containsKey('sort'), isFalse);
    expect(sent.containsKey('order'), isFalse);
  });

  test(
    'sem rede, devolve a última lista consultada e sinaliza o cache',
    () async {
      var online = true;
      final setup = build((options) async {
        if (!online) {
          throw DioException.connectionError(
            requestOptions: options,
            reason: 'sem rede',
          );
        }
        return jsonResponse(envelope(_page([_operationJson()])));
      });

      const query = OperationQuery();
      await setup.repository.list(query); // popula o cache

      online = false;
      final offline = await setup.repository.list(query);

      expect(offline.isFromCache, isTrue);
      expect(offline.cachedAt, isNotNull);
      expect(offline.value.data.single.code, 'OP-0001');
    },
  );

  test('sem rede e sem cache, o erro chega à interface', () async {
    final setup = build(
      (options) async => throw DioException.connectionError(
        requestOptions: options,
        reason: 'sem rede',
      ),
    );

    await expectLater(
      setup.repository.list(const OperationQuery()),
      throwsA(
        isA<OrbitException>().having((e) => e.isOffline, 'offline', isTrue),
      ),
    );
  });

  test('403 não cai para o cache — o usuário precisa ver a recusa', () async {
    final setup = build(
      (_) async => jsonResponse(
        errorEnvelope(
          code: 'FORBIDDEN',
          message: 'Missing required permission',
        ),
        status: 403,
      ),
    );

    await expectLater(
      setup.repository.list(const OperationQuery()),
      throwsA(
        isA<OrbitException>().having((e) => e.isForbidden, 'forbidden', isTrue),
      ),
    );
  });

  test('timeline separa eventos e anexos', () async {
    final setup = build(
      (_) async => jsonResponse(
        envelope({
          'events': [
            {
              'id': 'h1',
              'action': 'STATUS_CHANGED',
              'fromStatus': 'SCHEDULED',
              'toStatus': 'IN_PROGRESS',
              'createdAt': '2026-07-29T14:00:00.000Z',
              'user': {'id': 'user-1', 'displayName': 'Marina'},
            },
          ],
          'attachments': [
            {
              'id': 'att-1',
              'fileName': 'laudo.pdf',
              'mimeType': 'application/pdf',
              'size': 100,
            },
          ],
        }),
      ),
    );

    final timeline = await setup.repository.timeline('op-1');

    expect(
      timeline.events.single.label,
      'Status alterado: Agendada → Em execução',
    );
    expect(timeline.attachments.single.fileName, 'laudo.pdf');
  });

  test('transição recusada pelo backend chega como conflito', () async {
    final setup = build(
      (_) async => jsonResponse(
        errorEnvelope(
          code: 'CONFLICT',
          message: 'Cannot transition from COMPLETED to OPEN',
        ),
        status: 409,
      ),
    );

    await expectLater(
      setup.repository.changeStatus(id: 'op-1', status: 'OPEN'),
      throwsA(
        isA<OrbitException>()
            .having((e) => e.isConflict, 'conflict', isTrue)
            .having(
              (e) => e.publicMessage,
              'message',
              contains('Cannot transition'),
            ),
      ),
    );
  });

  test('mudança de status envia o motivo quando informado', () async {
    final setup = build(
      (_) async => jsonResponse(envelope(_operationJson(status: 'PAUSED'))),
    );

    final operation = await setup.repository.changeStatus(
      id: 'op-1',
      status: 'PAUSED',
      reason: 'aguardando peça',
    );

    expect(operation.status, 'PAUSED');
    final body = setup.adapter.requests.single.data as Map<String, dynamic>;
    expect(body['status'], 'PAUSED');
    expect(body['reason'], 'aguardando peça');
  });
}
