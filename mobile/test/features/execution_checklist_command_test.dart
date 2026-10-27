import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/features/field/application/execution_controller.dart';
import 'package:orbit_operator/features/field/data/field_operation_repository.dart';
import 'package:orbit_operator/features/sync/application/sync_controller.dart';
import 'package:orbit_operator/features/sync/data/command_journal.dart';
import 'package:orbit_operator/features/sync/data/journal_file.dart';
import 'package:orbit_operator/features/sync/data/sync_projection.dart';
import 'package:orbit_operator/features/sync/data/sync_repository.dart';
import '../support/fakes.dart';
import '../support/scripted_adapter.dart';

void main() {
  test(
    'usa a versão do checklist e transmite os itens não realizados na confirmação',
    () async {
      Map<String, dynamic>? sent;
      final dio = Dio()
        ..httpClientAdapter = ScriptedAdapter((request) async {
          if (request.path.endsWith('/execution-preparation')) {
            return jsonResponse({
              'success': true,
              'data': {
                'operation': {
                  'id': 'op-1',
                  'title': 'Visita',
                  'status': 'IN_PROGRESS',
                },
                'version': '2026-10-27T12:00:00.000Z',
                'allowedActions': ['UPDATE_CHECKLIST'],
                'checklist': [
                  {
                    'id': 'check-1',
                    'name': 'Preventiva',
                    'status': 'IN_PROGRESS',
                    'version': '2026-10-27T12:01:00.000Z',
                    'items': [
                      {'id': 'clean', 'type': 'BOOLEAN'},
                    ],
                  },
                ],
              },
            });
          }
          if (request.path.endsWith('/sync/push')) {
            sent = Map<String, dynamic>.from(
              (request.data as Map)['commands'][0] as Map,
            );
            return jsonResponse({
              'success': true,
              'data': {
                'results': [
                  {
                    'commandId': sent!['commandId'],
                    'commandType': sent!['commandType'],
                    'status': 'APPLIED',
                    'serverVersion': '2026-10-27T12:02:00.000Z',
                  },
                ],
                'serverTime': '2026-10-27T12:02:00.000Z',
                'nextRecommendedAction': 'NONE',
              },
            });
          }
          return jsonResponse({
            'success': true,
            'data': {
              'status': 'DELTA',
              'changes': [],
              'tombstones': [],
              'nextCursor': 'c1',
              'hasMore': false,
              'purgeRequired': false,
            },
          });
        });
      final client = OrbitApiClient.create(
        environment: OrbitEnvironment.fromDefines(),
        storage: InMemoryTokenStorage(),
        logger: const OrbitLogger(isProduction: true),
        dio: dio,
      );
      final sync = SyncController(
        journal: CommandJournal(file: MemoryJournalFile()),
        projection: SyncProjectionStore(file: MemoryJournalFile()),
        repository: SyncRepository(client: client),
        scope: const CommandScope(
          userId: 'u1',
          organizationId: 'org1',
          businessUnitId: 'bu1',
        ),
        scopeKey: 'u1.org1.bu1',
        onReconciled: () {},
      );
      final controller = ExecutionController(
        repository: FieldOperationRepository(client: client),
        sync: sync,
        operationId: 'op-1',
      );
      await controller.load();
      await controller.saveChecklist('check-1', {'clean': false});
      expect(sent!['expectedVersion'], '2026-10-27T12:01:00.000Z');
      expect(sent!['payload'], {
        'checklistId': 'check-1',
        'answers': {'clean': false},
        'complete': true,
      });
      controller.dispose();
      sync.dispose();
    },
  );
}
