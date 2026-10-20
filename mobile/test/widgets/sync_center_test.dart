/// A tela de sincronização, lida por quem fez o trabalho.
library;

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/contracts/mobile_offline_sync_contracts.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/core/theme/orbit_theme.dart';
import 'package:orbit_operator/features/sync/application/sync_controller.dart';
import 'package:orbit_operator/features/sync/application/sync_providers.dart';
import 'package:orbit_operator/features/sync/data/command_journal.dart';
import 'package:orbit_operator/features/sync/data/journal_file.dart';
import 'package:orbit_operator/features/sync/data/sync_projection.dart';
import 'package:orbit_operator/features/sync/data/sync_repository.dart';
import 'package:orbit_operator/features/sync/presentation/sync_center_screen.dart';

import '../support/fakes.dart';
import '../support/scripted_adapter.dart';

const scope = CommandScope(
  userId: 'u1',
  organizationId: 'org1',
  businessUnitId: 'bu1',
);

String uuid(int n) =>
    '0192f0c0-0000-7000-8000-${n.toString().padLeft(12, '0')}';

PendingCommand command({
  int id = 1,
  OfflineCommandType type = OfflineCommandType.operationChecklistUpdate,
  PendingCommandState state = PendingCommandState.pending,
  OfflineCommandResult? receipt,
}) => PendingCommand(
  envelope: OfflineCommandEnvelope(
    commandId: uuid(id),
    idempotencyKey: uuid(id),
    commandType: type,
    aggregateId: 'op-a',
    expectedVersion: '2026-09-01T10:00:00.000Z',
    occurredAt: DateTime.utc(2026, 9, 1, 10, 30),
    payload: const {},
  ),
  scope: scope,
  state: state,
  enqueuedAt: DateTime.utc(2026, 9, 1, 10, 30),
  receipt: receipt,
);

OfflineCommandResult conflictReceipt(OfflineConflictCode code) =>
    OfflineCommandResult(
      commandId: uuid(1),
      commandType: 'OPERATION_CHECKLIST_UPDATE',
      status: OfflineCommandStatus.conflict,
      serverVersion: null,
      authoritativeResourceRef: null,
      conflict: OfflineCommandConflict(
        code: code,
        message: 'mensagem do servidor',
        refreshRequired: true,
      ),
      error: null,
    );

class Harness {
  Harness({this.pushes = 0});

  int pushes;

  Future<ResponseBody> call(RequestOptions options) async {
    if (options.uri.path.endsWith('/sync/push')) {
      pushes += 1;
      return jsonResponse({
        'success': true,
        'data': {
          'results': const [],
          'serverTime': '2026-09-01T11:00:00.000Z',
          'nextRecommendedAction': 'PULL',
        },
      });
    }
    return jsonResponse({
      'success': true,
      'data': {
        'status': 'DELTA',
        'changes': const [],
        'tombstones': const [],
        'nextCursor': 'c1',
        'hasMore': false,
        'purgeRequired': false,
      },
    });
  }
}

Future<Widget> host(
  List<PendingCommand> commands, {
  Harness? harness,
  double textScale = 1.0,
  double width = 400,
}) async {
  final backend = harness ?? Harness();
  final dio = Dio()..httpClientAdapter = ScriptedAdapter(backend.call);
  final plain = Dio()..httpClientAdapter = ScriptedAdapter(backend.call);
  final client = OrbitApiClient.create(
    environment: OrbitEnvironment.fromDefines(),
    storage: InMemoryTokenStorage(),
    logger: const OrbitLogger(isProduction: true),
    dio: dio,
    retryDio: plain,
  );

  final journal = CommandJournal(file: MemoryJournalFile());
  for (final value in commands) {
    await journal.enqueue(value);
  }

  final controller = SyncController(
    journal: journal,
    projection: SyncProjectionStore(file: MemoryJournalFile()),
    repository: SyncRepository(client: client),
    scope: scope,
    scopeKey: 'u1.org1.bu1',
    onReconciled: () {},
  );
  await controller.restore();

  return ProviderScope(
    overrides: [
      commandScopeProvider.overrideWithValue(scope),
      commandJournalProvider.overrideWithValue(journal),
      syncControllerProvider.overrideWith((ref) => controller),
    ],
    child: MediaQuery(
      data: MediaQueryData(
        textScaler: TextScaler.linear(textScale),
        size: Size(width, 780),
      ),
      child: MaterialApp(
        theme: OrbitTheme.light(),
        home: const SyncCenterScreen(),
      ),
    ),
  );
}

void main() {
  setUpAll(() async => initializeDateFormatting('pt_BR'));

  Object? layoutError;
  setUp(() {
    layoutError = null;
    FlutterError.onError = (details) => layoutError ??= details.exception;
  });
  tearDown(() => FlutterError.onError = FlutterError.presentError);

  testWidgets('fila vazia diz que tudo chegou', (tester) async {
    await tester.pumpWidget(await host(const []));
    await tester.pumpAndSettle();

    expect(find.text('Nenhuma ação pendente neste aparelho.'), findsOneWidget);
    expect(
      find.text('Tudo o que você registrou já chegou ao servidor.'),
      findsOneWidget,
    );
  });

  testWidgets('pendente aparece em português, sem vocabulário de protocolo', (
    tester,
  ) async {
    await tester.pumpWidget(await host([command()]));
    await tester.pumpAndSettle();

    expect(find.text('Checklist atualizado'), findsOneWidget);
    expect(
      find.textContaining('Será enviado quando houver conexão'),
      findsOneWidget,
    );

    /// Nada de identificador, versão ou nome de comando na tela.
    final body = tester
        .widgetList<Text>(find.byType(Text))
        .map((widget) => widget.data ?? '')
        .join(' ');
    expect(body, isNot(contains(uuid(1))));
    expect(body, isNot(contains('OPERATION_')));
    expect(body, isNot(contains('expectedVersion')));
    expect(body, isNot(contains('2026-09-01T10:00:00.000Z')));
  });

  testWidgets('conflito mostra o motivo traduzido e oferece descarte', (
    tester,
  ) async {
    await tester.pumpWidget(
      await host([
        command(
          state: PendingCommandState.conflict,
          receipt: conflictReceipt(OfflineConflictCode.assignmentChanged),
        ),
      ]),
    );
    await tester.pumpAndSettle();

    expect(
      find.text('Este atendimento não está mais atribuído a você.'),
      findsOneWidget,
    );
    expect(find.text('Descartar esta ação'), findsOneWidget);
  });

  testWidgets('pendente não oferece descarte', (tester) async {
    await tester.pumpWidget(await host([command()]));
    await tester.pumpAndSettle();

    /// Pode estar em voo neste instante: jogá-la fora deixaria o app achando
    /// que nada aconteceu enquanto o servidor aplicava.
    expect(find.text('Descartar esta ação'), findsNothing);
  });

  testWidgets('descartar pede confirmação e explica o efeito', (tester) async {
    await tester.pumpWidget(
      await host([
        command(
          state: PendingCommandState.rejected,
          receipt: conflictReceipt(OfflineConflictCode.resourceRemoved),
        ),
      ]),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Descartar esta ação'));
    await tester.pumpAndSettle();

    expect(find.text('Descartar esta ação?'), findsOneWidget);
    expect(find.textContaining('não foi aplicada no servidor'), findsOneWidget);

    await tester.tap(find.text('Manter'));
    await tester.pumpAndSettle();
    expect(find.text('Checklist atualizado'), findsOneWidget);
  });

  testWidgets('sincronizar agora dispara um push', (tester) async {
    final harness = Harness();
    await tester.pumpWidget(await host([command()], harness: harness));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Sincronizar agora'));
    await tester.pumpAndSettle();

    expect(harness.pushes, 1);
  });

  testWidgets('o que travou aparece antes do que só espera', (tester) async {
    await tester.pumpWidget(
      await host([
        command(id: 1, type: OfflineCommandType.operationAddNote),
        command(
          id: 2,
          type: OfflineCommandType.operationAddMaterial,
          state: PendingCommandState.conflict,
          receipt: conflictReceipt(OfflineConflictCode.materialStockConflict),
        ),
      ]),
    );
    await tester.pumpAndSettle();

    final material = tester.getTopLeft(find.text('Material registrado'));
    final note = tester.getTopLeft(find.text('Observação registrada'));
    expect(material.dy, lessThan(note.dy));
  });

  testWidgets('código desconhecido não vira tela crua', (tester) async {
    await tester.pumpWidget(
      await host([
        command(
          state: PendingCommandState.rejected,
          receipt: OfflineCommandResult(
            commandId: uuid(1),
            commandType: 'OPERATION_CHECKLIST_UPDATE',
            status: OfflineCommandStatus.rejected,
            serverVersion: null,
            authoritativeResourceRef: null,
            conflict: null,
            error: const OfflineCommandError(
              code: 'ALGO_QUE_O_APP_NAO_CONHECE',
              message: 'texto interno',
              retryable: false,
            ),
          ),
        ),
      ]),
    );
    await tester.pumpAndSettle();

    expect(
      find.text('Não foi possível sincronizar esta ação.'),
      findsOneWidget,
    );
    expect(find.textContaining('ALGO_QUE_O_APP'), findsNothing);
  });

  for (final scale in [1.0, 1.3, 2.0]) {
    testWidgets('não estoura com texto em ${scale}x', (tester) async {
      await tester.pumpWidget(
        await host([
          command(),
          command(
            id: 2,
            state: PendingCommandState.conflict,
            receipt: conflictReceipt(OfflineConflictCode.checklistChanged),
          ),
        ], textScale: scale),
      );
      await tester.pumpAndSettle();
      expect(layoutError, isNull);
    });
  }

  testWidgets('tela estreita continua íntegra', (tester) async {
    await tester.pumpWidget(
      await host(
        [
          command(
            state: PendingCommandState.conflict,
            receipt: conflictReceipt(OfflineConflictCode.acknowledgementStale),
          ),
        ],
        width: 280,
        textScale: 1.3,
      ),
    );
    await tester.pumpAndSettle();
    expect(layoutError, isNull);
  });
}
