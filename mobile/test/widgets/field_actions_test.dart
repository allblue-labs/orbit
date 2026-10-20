/// Ações de execução e seção de evidências.
///
/// O ponto central: o aplicativo **não** decide se a transição é válida. Ele
/// envia a intenção e mostra a recusa do servidor.
library;

import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/app/providers.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/contracts/operation_contracts.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/core/theme/orbit_theme.dart';
import 'package:orbit_operator/core/uploads/upload_queue.dart';
import 'package:orbit_operator/core/uploads/upload_task.dart';
import 'package:orbit_operator/features/operations/data/operations_repository.dart';
import 'package:orbit_operator/features/operations/presentation/widgets/evidence_section.dart';
import 'package:orbit_operator/features/operations/presentation/widgets/field_actions.dart';

import '../support/fakes.dart';
import '../support/scripted_adapter.dart';

class _MemoryStore implements UploadQueueStore {
  List<UploadTask> tasks = const [];

  @override
  Future<List<UploadTask>> load() async => tasks;

  @override
  Future<void> save(List<UploadTask> value) async => tasks = value;
}

Operation buildOperation({String status = OperationStatus.scheduled}) =>
    Operation.fromJson({
      'id': 'op-1',
      'code': 'OP-0001',
      'title': 'Manutenção preventiva',
      'status': status,
      'kind': 'MAINTENANCE',
      'priority': 'HIGH',
      'users': const [],
      'attachments': const [],
      'checklistExecutions': const [],
    });

/// Monta a árvore com sessão autenticada e transporte controlado.
Widget wrap(
  Widget child, {
  required Future<ResponseBody> Function(RequestOptions) handler,
  UploadQueue? queue,
  List<String> permissions = const ['*'],
}) {
  final dio = Dio()..httpClientAdapter = ScriptedAdapter(handler);
  final plain = Dio()..httpClientAdapter = ScriptedAdapter(handler);
  final client = OrbitApiClient.create(
    environment: OrbitEnvironment.fromDefines(),
    storage: InMemoryTokenStorage(),
    logger: const OrbitLogger(isProduction: true),
    dio: dio,
    retryDio: plain,
  );

  return ProviderScope(
    overrides: [
      operationsRepositoryProvider.overrideWithValue(
        OperationsRepository(client: client, cache: InMemoryReadCache()),
      ),
      if (queue != null) uploadQueueProvider.overrideWithValue(queue),
      // Sessão pronta, com as permissões informadas.
      sessionProvider.overrideWith(
        (ref) => sessionFrom(permissions: permissions),
      ),
    ],
    child: MaterialApp(
      theme: OrbitTheme.light(),
      home: Scaffold(body: SingleChildScrollView(child: child)),
    ),
  );
}

void main() {
  testWidgets('oferece as ações de campo e esconde o status atual', (
    tester,
  ) async {
    await tester.pumpWidget(
      wrap(
        FieldActionsSection(operation: buildOperation()),
        handler: (_) async => jsonResponse(envelope(const <String, dynamic>{})),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Iniciar'), findsOneWidget);
    expect(find.text('Pausar'), findsOneWidget);
    expect(find.text('Concluir'), findsOneWidget);
    // "Retomar" só faz sentido a partir de pausada.
    expect(find.text('Retomar'), findsNothing);
  });

  testWidgets('a partir de pausada, oferece retomar em vez de iniciar', (
    tester,
  ) async {
    await tester.pumpWidget(
      wrap(
        FieldActionsSection(
          operation: buildOperation(status: OperationStatus.paused),
        ),
        handler: (_) async => jsonResponse(envelope(const <String, dynamic>{})),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Retomar'), findsOneWidget);
    expect(find.text('Iniciar'), findsNothing);
  });

  testWidgets('envia a transição pedida ao backend', (tester) async {
    final requests = <RequestOptions>[];
    await tester.pumpWidget(
      wrap(
        FieldActionsSection(operation: buildOperation()),
        handler: (options) async {
          requests.add(options);
          return jsonResponse(envelope(const <String, dynamic>{}));
        },
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Iniciar'));
    await tester.pumpAndSettle();

    expect(requests.single.path, '/operations/op-1/status');
    expect(
      (requests.single.data as Map<String, dynamic>)['status'],
      OperationStatus.inProgress,
    );
  });

  testWidgets('apresenta a recusa do servidor sem bloquear localmente', (
    tester,
  ) async {
    await tester.pumpWidget(
      wrap(
        FieldActionsSection(
          operation: buildOperation(status: OperationStatus.completed),
        ),
        handler: (_) async => jsonResponse(
          errorEnvelope(
            code: 'CONFLICT',
            message: 'Cannot transition from COMPLETED to IN_PROGRESS',
          ),
          status: 409,
        ),
      ),
    );
    await tester.pumpAndSettle();

    // A ação é oferecida: quem decide é o backend.
    await tester.tap(find.text('Iniciar'));
    await tester.pumpAndSettle();

    expect(
      find.text('Cannot transition from COMPLETED to IN_PROGRESS'),
      findsOneWidget,
    );
  });

  testWidgets('sem permissão, as ações não aparecem', (tester) async {
    await tester.pumpWidget(
      wrap(
        FieldActionsSection(operation: buildOperation()),
        handler: (_) async => jsonResponse(envelope(const <String, dynamic>{})),
        permissions: const ['operations.read'],
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Iniciar'), findsNothing);
    expect(
      find.text('Sua conta não pode alterar o andamento desta operação.'),
      findsOneWidget,
    );
  });

  testWidgets('evidência na fila aparece como pendente', (tester) async {
    final queue = UploadQueue(
      store: _MemoryStore(),
      logger: const OrbitLogger(isProduction: true),
      // Segura o envio para que a tarefa permaneça visível como pendente.
      executor: (task, {required onProgress, required cancellation}) =>
          Completer<void>().future,
    );
    await queue.enqueue(
      UploadTask(
        id: 'evidencia-1',
        operationId: 'op-1',
        filePath: '/tmp/foto.jpg',
        fileName: 'foto.jpg',
        mimeType: 'image/jpeg',
        sizeInBytes: 2048,
        createdAt: DateTime.now(),
      ),
    );

    await tester.pumpWidget(
      wrap(
        const EvidenceSection(operationId: 'op-1', attachments: []),
        handler: (_) async => jsonResponse(envelope(const <String, dynamic>{})),
        queue: queue,
      ),
    );
    await tester.pump();

    expect(find.text('foto.jpg'), findsOneWidget);
    expect(find.textContaining('Enviando'), findsOneWidget);
    await queue.dispose();
  });

  testWidgets('sem evidências, a seção declara o vazio', (tester) async {
    final queue = UploadQueue(
      store: _MemoryStore(),
      logger: const OrbitLogger(isProduction: true),
      executor: (task, {required onProgress, required cancellation}) async {},
    );

    await tester.pumpWidget(
      wrap(
        const EvidenceSection(operationId: 'op-1', attachments: []),
        handler: (_) async => jsonResponse(envelope(const <String, dynamic>{})),
        queue: queue,
      ),
    );
    await tester.pump();

    expect(
      find.text('Nenhuma evidência registrada nesta operação.'),
      findsOneWidget,
    );
    await queue.dispose();
  });
}
