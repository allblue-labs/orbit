import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:orbit_operator/features/field/presentation/operation_execution_screen.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/errors/orbit_exception.dart';
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

class AttendanceBackend {
  String status = 'OPEN';
  int version = 1;
  bool canExecute = true;
  bool failStart = false;
  bool pendingComplete = false;
  bool rejectComplete = false;
  final commands = <Map<String, dynamic>>[];
  final slowReads = <Completer<ResponseBody>>[];
  bool delayReads = false;
  String get currentVersion =>
      '2026-10-28T12:00:${version.toString().padLeft(2, '0')}.000Z';

  Map<String, dynamic> preparation() => {
    'operation': {
      'id': 'op-1',
      'title': 'Atendimento avulso',
      'status': status,
      if (status == 'COMPLETED') 'completedAt': currentVersion,
    },
    'version': currentVersion,
    'allowedActions': [
      'VIEW',
      if (canExecute) ...[
        if (status == 'OPEN') 'START',
        if (status == 'IN_PROGRESS') 'COMPLETE',
      ],
    ],
    'executionEligibility': {'eligible': canExecute, 'blockers': []},
  };

  Future<ResponseBody> handle(RequestOptions request) async {
    if (request.path.endsWith('/execution-preparation')) {
      if (delayReads) {
        final read = Completer<ResponseBody>();
        slowReads.add(read);
        return read.future;
      }
      return jsonResponse(envelope(preparation()));
    }
    if (request.path.endsWith('/sync/push')) {
      final results = <Map<String, dynamic>>[];
      for (final raw in (request.data as Map)['commands'] as List) {
        final command = Map<String, dynamic>.from(raw as Map);
        commands.add(command);
        final id = command['commandId'] as String;
        final type = command['commandType'];
        final retry =
            (type == 'OPERATION_START' && failStart) ||
            (type == 'OPERATION_COMPLETE' && pendingComplete);
        if (!retry && !rejectComplete) {
          expect(command['expectedVersion'], currentVersion);
          if (type == 'OPERATION_START') status = 'IN_PROGRESS';
          if (type == 'OPERATION_COMPLETE') status = 'COMPLETED';
          version++;
        }
        results.add({
          'commandId': id,
          'commandType': type,
          'status': retry
              ? 'RETRYABLE_ERROR'
              : rejectComplete
              ? 'REJECTED'
              : 'APPLIED',
          'serverVersion': currentVersion,
          if (retry || rejectComplete)
            'error': {
              'code': retry ? 'TEMPORARY' : 'EXECUTION_REJECTED',
              'message': retry
                  ? 'Aguarde a conexão.'
                  : 'O atendimento foi cancelado pelo escritório.',
              'retryable': retry,
            },
        });
      }
      return jsonResponse(
        envelope({
          'results': results,
          'serverTime': currentVersion,
          'nextRecommendedAction': 'NONE',
        }),
      );
    }
    return jsonResponse(
      envelope({
        'status': 'DELTA',
        'changes': [],
        'tombstones': [],
        'nextCursor': 'c1',
        'hasMore': false,
        'purgeRequired': false,
      }),
    );
  }
}

({ExecutionController execution, SyncController sync}) fixture(
  AttendanceBackend backend, {
  bool disposeExecution = true,
}) {
  final client = OrbitApiClient.create(
    environment: OrbitEnvironment.fromDefines(),
    storage: InMemoryTokenStorage(),
    logger: const OrbitLogger(isProduction: true),
    dio: Dio()..httpClientAdapter = ScriptedAdapter(backend.handle),
    retryDio: Dio()..httpClientAdapter = ScriptedAdapter(backend.handle),
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
  final execution = ExecutionController(
    repository: FieldOperationRepository(client: client),
    sync: sync,
    operationId: 'op-1',
  );
  addTearDown(() {
    if (disposeExecution) execution.dispose();
    sync.dispose();
  });
  return (execution: execution, sync: sync);
}

void main() {
  testWidgets(
    'início pendente bloqueia as etapas e permite repetir sem criar outra intenção',
    (tester) async {
      final backend = AttendanceBackend()..failStart = true;
      final subject = fixture(backend, disposeExecution: false);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            executionControllerProvider(
              'op-1',
            ).overrideWith((ref) => subject.execution),
          ],
          child: const MaterialApp(
            home: OperationExecutionScreen(operationId: 'op-1'),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('INÍCIO DO ATENDIMENTO PENDENTE'), findsOneWidget);
      expect(find.text('Sem checklist previsto'), findsNothing);
      backend.failStart = false;
      await tester.tap(find.text('Tentar novamente'));
      await tester.pumpAndSettle();
      expect(find.text('Sem checklist previsto'), findsOneWidget);
      expect(backend.commands, hasLength(2));
      expect(
        backend.commands[1]['commandId'],
        backend.commands[0]['commandId'],
      );
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
  testWidgets(
    'abrir a tela de execução de um avulso inicia antes de liberar o wizard',
    (tester) async {
      final backend = AttendanceBackend();
      final subject = fixture(backend, disposeExecution: false);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            executionControllerProvider(
              'op-1',
            ).overrideWith((ref) => subject.execution),
          ],
          child: const MaterialApp(
            home: OperationExecutionScreen(operationId: 'op-1'),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(backend.commands.single['commandType'], 'OPERATION_START');
      expect(backend.status, 'IN_PROGRESS');
      expect(find.text('Sem checklist previsto'), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
  test(
    'entrar no atendimento aberto envia START uma vez e permite concluir',
    () async {
      final backend = AttendanceBackend();
      final subject = fixture(backend).execution;
      await Future.wait([
        subject.prepareForAttendance(),
        subject.prepareForAttendance(),
      ]);
      expect(backend.commands.map((command) => command['commandType']), [
        'OPERATION_START',
      ]);
      await subject.prepareForAttendance();
      expect(backend.commands, hasLength(1));
      expect(await subject.finishAfterConfirmation(), isTrue);
      expect(backend.commands.map((command) => command['commandType']), [
        'OPERATION_START',
        'OPERATION_COMPLETE',
      ]);
      expect(subject.state.preparation!.operation.completedAt, isNotNull);
      expect(await subject.finishAfterConfirmation(), isTrue);
      expect(backend.commands, hasLength(2));
    },
  );

  test('relê a versão e as ações depois do aceite antes de concluir', () async {
    final backend = AttendanceBackend();
    final subject = fixture(backend).execution;
    await subject.load();
    backend.status = 'IN_PROGRESS';
    backend.version++;
    expect(await subject.finishAfterConfirmation(), isTrue);
    expect(
      backend.commands.single['expectedVersion'],
      '2026-10-28T12:00:02.000Z',
    );
  });

  test(
    'consulta não inicia; sem ação START publicada não envia comandos',
    () async {
      final backend = AttendanceBackend()..canExecute = false;
      final subject = fixture(backend).execution;
      await subject.load();
      expect(backend.commands, isEmpty);
      await subject.prepareForAttendance();
      await expectLater(
        subject.finishAfterConfirmation(),
        throwsA(
          isA<OrbitException>().having(
            (error) => error.code,
            'code',
            'COMPLETION_NOT_ALLOWED',
          ),
        ),
      );
      expect(backend.commands, isEmpty);
    },
  );

  test(
    'falha temporária no início permanece pendente e não libera conclusão',
    () async {
      final backend = AttendanceBackend()..failStart = true;
      final subject = fixture(backend).execution;
      await subject.prepareForAttendance();
      expect(backend.status, 'OPEN');
      await expectLater(
        subject.finishAfterConfirmation(),
        throwsA(
          isA<OrbitException>().having(
            (error) => error.code,
            'code',
            'RECORDS_PENDING',
          ),
        ),
      );
      expect(
        backend.commands.every(
          (command) => command['commandType'] == 'OPERATION_START',
        ),
        isTrue,
      );
    },
  );
  test(
    'tentar o início novamente conserva a chave e não duplica atendimento',
    () async {
      final backend = AttendanceBackend()..failStart = true;
      final subject = fixture(backend).execution;
      await subject.prepareForAttendance();
      backend.failStart = false;
      await subject.prepareForAttendance();
      expect(backend.status, 'IN_PROGRESS');
      expect(backend.commands, hasLength(2));
      expect(
        backend.commands[1]['commandId'],
        backend.commands[0]['commandId'],
      );
      expect(await subject.finishAfterConfirmation(), isTrue);
    },
  );

  test(
    'conclusão aguardando envio não é apresentada como concluída nem duplicada',
    () async {
      final backend = AttendanceBackend()
        ..status = 'IN_PROGRESS'
        ..pendingComplete = true;
      final subject = fixture(backend).execution;
      await subject.load();
      expect(await subject.finishAfterConfirmation(), isFalse);
      expect(subject.state.preparation!.operation.completedAt, isNull);
      expect(await subject.finishAfterConfirmation(), isFalse);
      expect(backend.commands, hasLength(1));
    },
  );

  test(
    'preserva o motivo de recusa da conclusão publicado pelo servidor',
    () async {
      final backend = AttendanceBackend()
        ..status = 'IN_PROGRESS'
        ..rejectComplete = true;
      final subject = fixture(backend).execution;
      await subject.load();
      await expectLater(
        subject.finishAfterConfirmation(),
        throwsA(
          isA<OrbitException>().having(
            (error) => error.publicMessage,
            'message',
            'O atendimento foi cancelado pelo escritório.',
          ),
        ),
      );
    },
  );

  test(
    'uma leitura antiga não sobrescreve uma preparação mais recente',
    () async {
      final backend = AttendanceBackend();
      final subject = fixture(backend).execution;
      await subject.load();
      backend.delayReads = true;
      final old = subject.load();
      final recent = subject.load();
      while (backend.slowReads.length < 2) {
        await Future<void>.delayed(Duration.zero);
      }
      final snapshot = backend.preparation();
      backend.status = 'IN_PROGRESS';
      backend.version++;
      backend.slowReads[1].complete(
        jsonResponse(envelope(backend.preparation())),
      );
      await recent;
      backend.slowReads[0].complete(jsonResponse(envelope(snapshot)));
      await old;
      expect(subject.state.preparation!.operation.status, 'IN_PROGRESS');
    },
  );
}
