/// O orquestrador contra um backend scriptado.
library;

import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/contracts/mobile_offline_sync_contracts.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/features/sync/application/sync_controller.dart';
import 'package:orbit_operator/features/sync/data/command_journal.dart';
import 'package:orbit_operator/features/sync/data/journal_file.dart';
import 'package:orbit_operator/features/sync/data/sync_projection.dart';
import 'package:orbit_operator/features/sync/data/sync_repository.dart';

import '../support/fakes.dart';
import '../support/scripted_adapter.dart';

const scope = CommandScope(
  userId: 'u1',
  organizationId: 'org1',
  businessUnitId: 'bu1',
);

String uuid(int n) =>
    '0192f0c0-0000-7000-8000-${n.toString().padLeft(12, '0')}';

OfflineCommandEnvelope envelope(
  int n, {
  OfflineCommandType type = OfflineCommandType.operationAddNote,
  String aggregate = 'op-a',
  Map<String, Object?> payload = const {'note': 'x'},
}) => OfflineCommandEnvelope(
  commandId: uuid(n),
  idempotencyKey: uuid(n),
  commandType: type,
  aggregateId: aggregate,
  expectedVersion: '2026-09-01T10:00:00.000Z',
  occurredAt: DateTime.utc(2026, 9, 1, 10, 30),
  payload: payload,
);

Map<String, Object?> receipt(
  int n,
  String status, {
  Map<String, Object?>? conflict,
  Map<String, Object?>? error,
}) => {
  'commandId': uuid(n),
  'commandType': 'OPERATION_ADD_NOTE',
  'status': status,
  'serverVersion': '2026-09-01T11:00:00.000Z',
  'authoritativeResourceRef': 'SERVICE_OPERATION:op-a',
  'conflict': conflict,
  'error': error,
};

Map<String, Object?> pullPage({
  List<Map<String, Object?>> changes = const [],
  List<Map<String, Object?>> tombstones = const [],
  String? nextCursor = 'cursor-1',
  bool hasMore = false,
  String status = 'DELTA',
}) => {
  'status': status,
  'changes': changes,
  'tombstones': tombstones,
  'nextCursor': nextCursor,
  'hasMore': hasMore,
  'purgeRequired': false,
};

Map<String, Object?> workItem(String id) => {
  'id': id,
  'kind': 'SERVICE_OPERATION',
  'sourceId': 'op-a',
  'title': 'Manutenção',
  'businessUnit': {'id': 'bu1', 'name': 'Recife'},
  'timezone': 'America/Recife',
  'dueState': 'DUE_TODAY',
  'operationalStatus': 'SCHEDULED',
  'auxiliaryTechnicians': const [],
  'equipmentSummary': const [],
  'artifacts': const [],
  'allowedActions': const [],
  'navigationContext': {'kind': 'SERVICE_OPERATION', 'sourceId': 'op-a'},
  'updatedAt': '2026-09-01T10:00:00.000Z',
};

/// Um backend controlado pelo teste, que conta o que recebeu.
class Backend {
  Backend({required this.onPush, required this.onPull});

  final List<Map<String, Object?>> Function(List<dynamic> commands) onPush;
  final Map<String, Object?> Function(String? cursor) onPull;

  final pushes = <List<dynamic>>[];
  final pulls = <String?>[];

  Future<ResponseBody> call(RequestOptions options) async {
    final body = options.data is String
        ? jsonDecode(options.data as String) as Map<String, dynamic>
        : (options.data as Map<String, dynamic>? ?? const {});

    if (options.uri.path.endsWith('/sync/push')) {
      final commands = body['commands'] as List<dynamic>;
      pushes.add(commands);
      return jsonResponse({
        'success': true,
        'data': {
          'results': onPush(commands),
          'serverTime': '2026-09-01T11:00:00.000Z',
          'nextRecommendedAction': 'PULL',
        },
      });
    }
    if (options.uri.path.endsWith('/sync/pull')) {
      final cursor = body['cursor'] as String?;
      pulls.add(cursor);
      return jsonResponse({'success': true, 'data': onPull(cursor)});
    }
    return ResponseBody.fromString('{}', 404);
  }
}

({SyncController controller, CommandJournal journal, SyncProjectionStore store})
build(
  Backend backend, {
  JournalFile? journalFile,
  void Function()? onReconciled,
}) {
  final dio = Dio()..httpClientAdapter = ScriptedAdapter(backend.call);
  final plain = Dio()..httpClientAdapter = ScriptedAdapter(backend.call);
  final client = OrbitApiClient.create(
    environment: OrbitEnvironment.fromDefines(),
    storage: InMemoryTokenStorage(),
    logger: const OrbitLogger(isProduction: true),
    dio: dio,
    retryDio: plain,
  );
  final journal = CommandJournal(file: journalFile ?? MemoryJournalFile());
  final store = SyncProjectionStore(file: MemoryJournalFile());
  return (
    controller: SyncController(
      journal: journal,
      projection: store,
      repository: SyncRepository(client: client),
      scope: scope,
      scopeKey: 'u1.org1.bu1',
      onReconciled: onReconciled ?? () {},
    ),
    journal: journal,
    store: store,
  );
}

void main() {
  group('push', () {
    test('cada comando recebe o seu próprio recibo', () async {
      /// O servidor responde ao que recebeu, não a uma lista fixa: é assim
      /// que dá para provar que cada recibo encontra o seu comando.
      final backend = Backend(
        onPush: (commands) => [
          for (final command in commands)
            if ((command as Map)['commandId'] == uuid(1))
              receipt(1, 'APPLIED')
            else
              receipt(
                2,
                'CONFLICT',
                conflict: {
                  'code': 'VERSION_CONFLICT',
                  'message': 'mudou',
                  'refreshRequired': true,
                },
              ),
        ],
        onPull: (_) => pullPage(),
      );
      final harness = build(backend);

      await harness.controller.enqueue(envelope(1));
      await harness.controller.enqueue(envelope(2));

      final snapshot = await harness.journal.read();

      /// Um comando falhar não apaga o outro: o aplicado saiu com recibo, o
      /// conflitante ficou para uma pessoa decidir.
      expect(snapshot.receipts.map((r) => r.commandId), contains(uuid(1)));
      expect(snapshot.commands.single.envelope.commandId, uuid(2));
      expect(snapshot.commands.single.state, PendingCommandState.conflict);
    });

    test('conflito não vira nova tentativa sozinho', () async {
      final backend = Backend(
        onPush: (_) => [
          receipt(
            1,
            'CONFLICT',
            conflict: {
              'code': 'ASSIGNMENT_CHANGED',
              'message': 'não é mais seu',
              'refreshRequired': true,
            },
          ),
        ],
        onPull: (_) => pullPage(),
      );
      final harness = build(backend);
      await harness.controller.enqueue(envelope(1));

      /// Uma segunda sincronização não pode reenviá-lo: o mundo mudou, e
      /// insistir sozinho é como se sobrescreve o trabalho de outra pessoa.
      await harness.controller.sync(manual: true);
      expect(backend.pushes, hasLength(1));
    });

    test('recusa terminal também não é repetida', () async {
      final backend = Backend(
        onPush: (_) => [
          receipt(
            1,
            'REJECTED',
            error: {
              'code': 'AUTHORIZATION_CHANGED',
              'message': 'sem permissão',
              'retryable': false,
            },
          ),
        ],
        onPull: (_) => pullPage(),
      );
      final harness = build(backend);
      await harness.controller.enqueue(envelope(1));
      await harness.controller.sync(manual: true);

      expect(backend.pushes, hasLength(1));
      final snapshot = await harness.journal.read();
      expect(snapshot.commands.single.state, PendingCommandState.rejected);
    });

    test('janela expirada é apresentada como tal', () async {
      final backend = Backend(
        onPush: (_) => [
          receipt(
            1,
            'REJECTED',
            error: {
              'code': 'OFFLINE_REPLAY_WINDOW_EXPIRED',
              'message': 'fora da janela',
              'retryable': false,
            },
          ),
        ],
        onPull: (_) => pullPage(),
      );
      final harness = build(backend);
      await harness.controller.enqueue(envelope(1));

      final snapshot = await harness.journal.read();
      expect(snapshot.commands.single.state, PendingCommandState.expired);
    });

    test('erro temporário mantém o comando e agenda espera', () async {
      final backend = Backend(
        onPush: (commands) => [
          for (final _ in commands)
            receipt(
              1,
              'RETRYABLE_ERROR',
              error: {
                'code': 'PROCESSING_ERROR',
                'message': 'temporário',
                'retryable': true,
              },
            ),
        ],
        onPull: (_) => pullPage(),
      );
      final harness = build(backend);
      await harness.controller.enqueue(envelope(1));

      final snapshot = await harness.journal.read();
      expect(snapshot.commands.single.state, PendingCommandState.pending);

      /// Gatilho automático respeita o backoff; o manual não.
      await harness.controller.sync();
      expect(backend.pushes, hasLength(1));
      await harness.controller.sync(manual: true);
      expect(backend.pushes, hasLength(2));
    });

    test('bloqueado volta para a fila sem virar falha', () async {
      var round = 0;
      final backend = Backend(
        onPush: (_) {
          round += 1;
          return round == 1
              ? [
                  receipt(
                    1,
                    'CONFLICT',
                    conflict: {
                      'code': 'STATE_CONFLICT',
                      'message': 'estado',
                      'refreshRequired': true,
                    },
                  ),
                  receipt(
                    2,
                    'BLOCKED',
                    error: {
                      'code': 'DEPENDENCY_BLOCKED',
                      'message': 'anterior não aplicado',
                      'retryable': false,
                    },
                  ),
                ]
              : [receipt(2, 'APPLIED')];
        },
        onPull: (_) => pullPage(),
      );
      final harness = build(backend);
      await harness.controller.enqueue(envelope(1));
      await harness.controller.enqueue(envelope(2));

      /// O segundo não falhou — o primeiro é que travou. Descartado o
      /// bloqueio, ele segue.
      await harness.controller.discard(uuid(1));
      await harness.controller.sync(manual: true);

      final snapshot = await harness.journal.read();
      expect(snapshot.commands, isEmpty);
      expect(snapshot.receipts.map((r) => r.commandId), contains(uuid(2)));
    });

    test('o lote respeita o teto do DTO', () async {
      final backend = Backend(
        onPush: (commands) => [
          for (final command in commands)
            {
              'commandId': (command as Map)['commandId'],
              'commandType': 'OPERATION_ADD_NOTE',
              'status': 'APPLIED',
              'serverVersion': null,
              'authoritativeResourceRef': null,
              'conflict': null,
              'error': null,
            },
        ],
        onPull: (_) => pullPage(),
      );
      final harness = build(backend);
      for (var i = 1; i <= 55; i += 1) {
        await harness.journal.enqueue(
          PendingCommand(
            envelope: envelope(i),
            scope: scope,
            state: PendingCommandState.pending,
            enqueuedAt: DateTime.utc(2026, 9, 1),
          ),
        );
      }
      await harness.controller.sync(manual: true);

      /// Mais de 50 faria o `ArrayMaxSize` recusar a leva inteira — nenhum
      /// comando avançaria, e nada explicaria por quê.
      expect(backend.pushes.first, hasLength(50));
      expect(backend.pushes[1], hasLength(5));
      expect((await harness.journal.read()).commands, isEmpty);
    });
  });

  group('desfecho incerto', () {
    test('reenvia com o mesmo commandId', () async {
      var attempt = 0;
      final backend = Backend(
        onPush: (_) {
          attempt += 1;
          if (attempt == 1) throw StateError('rede caiu');
          return [receipt(1, 'ALREADY_APPLIED')];
        },
        onPull: (_) => pullPage(),
      );
      final harness = build(backend);
      await harness.controller.enqueue(envelope(1));

      /// Depois do timeout o comando volta pendente, com a identidade
      /// intacta. É a idempotência que resolve o "não sei se chegou".
      var snapshot = await harness.journal.read();
      expect(snapshot.commands.single.state, PendingCommandState.pending);
      expect(snapshot.commands.single.envelope.commandId, uuid(1));

      await harness.controller.sync(manual: true);
      snapshot = await harness.journal.read();
      expect(snapshot.commands, isEmpty);

      /// Os dois envios carregaram o mesmo identificador e o mesmo conteúdo.
      expect(
        (backend.pushes[0].first as Map)['commandId'],
        (backend.pushes[1].first as Map)['commandId'],
      );
      expect(
        (backend.pushes[0].first as Map)['expectedVersion'],
        (backend.pushes[1].first as Map)['expectedVersion'],
      );
      expect(
        (backend.pushes[0].first as Map)['occurredAt'],
        (backend.pushes[1].first as Map)['occurredAt'],
      );
    });
  });

  group('aceite do cliente', () {
    test('o reenvio leva a mesma assinatura, e não uma segunda', () async {
      /// O caso real: o técnico confirma, a rede cai antes da resposta, e o
      /// journal tenta de novo. Se o reenvio gerasse outro comando — ou
      /// perdesse o arquivo da assinatura —, o cliente apareceria assinando
      /// duas vezes, ou assinando nada.
      var attempt = 0;
      final backend = Backend(
        onPush: (_) {
          attempt += 1;
          if (attempt == 1) throw StateError('rede caiu');
          return [receipt(1, 'ALREADY_APPLIED')];
        },
        onPull: (_) => pullPage(),
      );
      final harness = build(backend);

      await harness.controller.enqueue(
        envelope(
          1,
          type: OfflineCommandType.customerAcknowledgement,
          payload: const {
            'signerName': 'Maria Zeladora',
            'contentHash': 'abc',
            'signatureStorageFileId': 'file-cliente-1',
          },
        ),
      );
      await harness.controller.sync(manual: true);

      /// Duas tentativas, um comando.
      expect(backend.pushes, hasLength(2));
      expect((await harness.journal.read()).commands, isEmpty);

      final primeiro = backend.pushes[0].first as Map;
      final segundo = backend.pushes[1].first as Map;
      expect(segundo['commandId'], primeiro['commandId']);

      /// E a assinatura é a mesma imagem — não uma coletada de novo.
      expect(
        (segundo['payload'] as Map)['signatureStorageFileId'],
        'file-cliente-1',
      );
      expect(
        (primeiro['payload'] as Map)['signatureStorageFileId'],
        'file-cliente-1',
      );
    });

    test('aceite sem assinatura não inventa uma', () async {
      final backend = Backend(
        onPush: (_) => [receipt(1, 'APPLIED')],
        onPull: (_) => pullPage(),
      );
      final harness = build(backend);

      await harness.controller.enqueue(
        envelope(
          1,
          type: OfflineCommandType.customerAcknowledgement,
          payload: const {'signerName': 'Maria Zeladora', 'contentHash': 'abc'},
        ),
      );

      final payload = (backend.pushes.single.first as Map)['payload'] as Map;
      expect(payload.containsKey('signatureStorageFileId'), isFalse);
    });
  });

  group('mutex', () {
    test('sincronizações concorrentes viram uma só', () async {
      final backend = Backend(
        onPush: (_) => [receipt(1, 'APPLIED')],
        onPull: (_) => pullPage(),
      );
      final harness = build(backend);
      await harness.journal.enqueue(
        PendingCommand(
          envelope: envelope(1),
          scope: scope,
          state: PendingCommandState.pending,
          enqueuedAt: DateTime.utc(2026, 9, 1),
        ),
      );

      /// Uma tempestade de conectividade não pode virar dez levas.
      await Future.wait([
        harness.controller.sync(manual: true),
        harness.controller.sync(manual: true),
        harness.controller.sync(manual: true),
      ]);

      expect(backend.pushes, hasLength(1));
      expect(backend.pulls, hasLength(1));
    });
  });

  group('pull', () {
    test('avança o cursor e guarda os itens', () async {
      final backend = Backend(
        onPush: (_) => const [],
        onPull: (cursor) => pullPage(
          changes: [
            {
              'sequence': '10',
              'resourceType': 'WORK_ITEM',
              'resourceId': 'SERVICE_OPERATION:op-a',
              'changeType': 'UPSERTED',
              'version': '2026-09-01T10:00:00.000Z',
              'snapshot': workItem('SERVICE_OPERATION:op-a'),
            },
          ],
          nextCursor: 'cursor-2',
        ),
      );
      final harness = build(backend);
      await harness.controller.sync(manual: true);

      final projection = await harness.store.read();
      expect(projection.cursors['u1.org1.bu1'], 'cursor-2');
      expect(projection.itemsFor('u1.org1.bu1'), hasLength(1));

      /// Na volta seguinte o cursor guardado é o enviado.
      await harness.controller.sync(manual: true);
      expect(backend.pulls.last, 'cursor-2');
    });

    test('tombstone apaga a projeção local', () async {
      var round = 0;
      final backend = Backend(
        onPush: (_) => const [],
        onPull: (_) {
          round += 1;
          return round == 1
              ? pullPage(
                  changes: [
                    {
                      'sequence': '10',
                      'resourceType': 'WORK_ITEM',
                      'resourceId': 'SERVICE_OPERATION:op-a',
                      'changeType': 'UPSERTED',
                      'version': '2026-09-01T10:00:00.000Z',
                      'snapshot': workItem('SERVICE_OPERATION:op-a'),
                    },
                  ],
                )
              : pullPage(
                  tombstones: [
                    {
                      'resourceId': 'SERVICE_OPERATION:op-a',
                      'reason': 'OUT_OF_SCOPE',
                    },
                  ],
                );
        },
      );
      final harness = build(backend);
      await harness.controller.sync(manual: true);
      expect(
        (await harness.store.read()).itemsFor('u1.org1.bu1'),
        hasLength(1),
      );

      await harness.controller.sync(manual: true);

      /// Um item que saiu do escopo não pode continuar parecendo trabalho a
      /// fazer.
      expect((await harness.store.read()).itemsFor('u1.org1.bu1'), isEmpty);
    });

    test('mudança de saída também apaga', () async {
      final backend = Backend(
        onPush: (_) => const [],
        onPull: (_) => pullPage(
          changes: [
            {
              'sequence': '11',
              'resourceType': 'WORK_ITEM',
              'resourceId': 'SERVICE_OPERATION:op-a',
              'changeType': 'OUT_OF_SCOPE',
              'version': null,
              'snapshot': null,
            },
          ],
        ),
      );
      final harness = build(backend);
      await harness.controller.sync(manual: true);
      expect((await harness.store.read()).itemsFor('u1.org1.bu1'), isEmpty);
    });
  });

  group('full resync', () {
    test('recomeça a projeção e preserva a fila', () async {
      var round = 0;
      final backend = Backend(
        onPush: (_) => [
          receipt(
            1,
            'CONFLICT',
            conflict: {
              'code': 'VERSION_CONFLICT',
              'message': 'mudou',
              'refreshRequired': true,
            },
          ),
        ],
        onPull: (_) {
          round += 1;
          if (round == 1) {
            return pullPage(
              changes: [
                {
                  'sequence': '10',
                  'resourceType': 'WORK_ITEM',
                  'resourceId': 'SERVICE_OPERATION:op-a',
                  'changeType': 'UPSERTED',
                  'version': '2026-09-01T10:00:00.000Z',
                  'snapshot': workItem('SERVICE_OPERATION:op-a'),
                },
              ],
            );
          }
          if (round == 2) {
            return pullPage(status: 'FULL_RESYNC_REQUIRED', nextCursor: null);
          }
          return pullPage(nextCursor: 'cursor-novo');
        },
      );
      final harness = build(backend);
      await harness.controller.enqueue(envelope(1));
      expect(
        (await harness.store.read()).itemsFor('u1.org1.bu1'),
        hasLength(1),
      );

      await harness.controller.sync(manual: true);

      final projection = await harness.store.read();
      expect(projection.itemsFor('u1.org1.bu1'), isEmpty);
      expect(projection.cursors['u1.org1.bu1'], 'cursor-novo');

      /// A garantia central: refazer o estado do servidor não pode destruir a
      /// intenção que ainda não chegou nele.
      final snapshot = await harness.journal.read();
      expect(snapshot.commands.single.envelope.commandId, uuid(1));
      expect(snapshot.commands.single.state, PendingCommandState.conflict);
    });
  });

  group('reconciliação', () {
    test('avisa as telas só quando o servidor confirmou algo', () async {
      var reconciled = 0;
      final backend = Backend(
        onPush: (_) => [receipt(1, 'APPLIED')],
        onPull: (_) => pullPage(),
      );
      final harness = build(backend, onReconciled: () => reconciled += 1);

      await harness.controller.sync(manual: true);
      expect(reconciled, 0, reason: 'nada a enviar, nada a reler');

      await harness.controller.enqueue(envelope(1));
      expect(reconciled, 1);
    });
  });

  group('espera entre tentativas', () {
    test('cresce e não é infinita', () {
      expect(syncBackoff(1) < syncBackoff(2), isTrue);
      expect(syncBackoff(2) < syncBackoff(3), isTrue);
      expect(syncBackoff(99), const Duration(minutes: 30));
    });
  });
}
