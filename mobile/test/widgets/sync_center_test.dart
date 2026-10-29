/// A tela de sincronização, lida por quem fez o trabalho.
library;

import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:orbit_operator/app/providers.dart'
    show sharedPreferencesProvider, uploadTasksProvider, apiClientProvider;
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/contracts/mobile_offline_sync_contracts.dart';
import 'package:orbit_operator/core/contracts/mobile_evidence_contracts.dart';
import 'package:orbit_operator/core/widgets/sync_indicator.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/core/theme/orbit_theme.dart';
import 'package:orbit_operator/core/uploads/upload_task.dart';
import 'package:orbit_operator/features/evidence/data/local_media.dart';
import 'package:orbit_operator/features/evidence/data/media_store.dart';
import 'package:orbit_operator/features/evidence/application/evidence_providers.dart';
import 'package:orbit_operator/features/sync/application/sync_controller.dart';
import 'package:orbit_operator/features/sync/application/sync_providers.dart';
import 'package:orbit_operator/features/sync/application/sync_notice_preferences.dart';
import 'package:orbit_operator/features/sync/data/command_journal.dart';
import 'package:orbit_operator/features/sync/data/journal_file.dart';
import 'package:orbit_operator/features/sync/data/sync_projection.dart';
import 'package:orbit_operator/features/sync/data/sync_repository.dart';
import 'package:orbit_operator/features/sync/presentation/sync_center_screen.dart';
import 'package:orbit_operator/features/sync/presentation/widgets/sync_status_bar.dart';

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
  SharedPreferences? preferences,
  List<LocalMedia> media = const [],
  List<UploadTask> uploads = const [],
  bool showBars = false,
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
  final mediaQueue = MediaQueue(
    file: MemoryJournalFile(),
    files: MemoryMediaFileStore(),
  );
  for (final item in media) {
    (mediaQueue.files as MemoryMediaFileStore).files[item.path] =
        Uint8List.fromList([1, 2, 3]);
    await mediaQueue.enqueue(item);
  }

  return ProviderScope(
    overrides: [
      commandScopeProvider.overrideWithValue(scope),
      apiClientProvider.overrideWithValue(client),
      commandJournalProvider.overrideWithValue(journal),
      syncControllerProvider.overrideWith((ref) => controller),
      sharedPreferencesProvider.overrideWithValue(
        preferences ?? await SharedPreferences.getInstance(),
      ),
      mediaQueueProvider.overrideWithValue(mediaQueue),
      uploadTasksProvider.overrideWith((ref) => Stream.value(uploads)),
    ],
    child: MediaQuery(
      data: MediaQueryData(
        textScaler: TextScaler.linear(textScale),
        size: Size(width, 780),
      ),
      child: MaterialApp(
        theme: OrbitTheme.light(),
        home: showBars
            ? const Scaffold(
                body: SyncCenterScreen(),
                bottomNavigationBar: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [SyncStatusBar(), SyncIndicator()],
                ),
              )
            : const SyncCenterScreen(),
      ),
    ),
  );
}

void main() {
  setUpAll(() async => initializeDateFormatting('pt_BR'));

  Object? layoutError;
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    layoutError = null;
    FlutterError.onError = (details) => layoutError ??= details.exception;
  });
  tearDown(() => FlutterError.onError = FlutterError.presentError);

  LocalMedia capture() => LocalMedia(
    localMediaId: 'photo-1',
    scope: scope,
    target: const FieldEvidenceTargetRef(
      type: FieldEvidenceTarget.operation,
      id: 'op-a',
    ),
    path: '/memoria/photo-1.jpg',
    filename: 'evidencia.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 3,
    sha256: 'hash',
    capturedAt: DateTime.utc(2026, 10, 29),
    category: EvidenceCategory.general,
    source: EvidenceSource.camera,
    state: LocalMediaState.rejected,
    idempotencyKey: 'photo-1',
    failureCode: 'FILE_TOO_LARGE',
    failureMessage: 'A imagem ultrapassa o tamanho permitido.',
  );

  testWidgets('oculta e reexibe aviso de ação sem descartar o comando', (
    tester,
  ) async {
    final preferences = await SharedPreferences.getInstance();
    final commands = [command(state: PendingCommandState.rejected)];
    await tester.pumpWidget(
      await host(commands, preferences: preferences, showBars: true),
    );
    await tester.pumpAndSettle();
    final container = ProviderScope.containerOf(
      tester.element(find.byType(SyncCenterScreen)),
    );
    await tester.ensureVisible(find.text('Ocultar aviso'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Ocultar aviso'));
    await tester.pumpAndSettle();
    expect(find.text('Checklist atualizado'), findsNothing);
    expect(find.byTooltip('Ocultar aviso da barra'), findsNothing);
    expect(
      (await container.read(commandJournalProvider).read()).commands,
      hasLength(1),
    );
    expect(container.read(syncControllerProvider).rejected, 1);
    expect(
      find.text('Aviso ocultado. O registro foi preservado.'),
      findsOneWidget,
    );
    await tester.pump(const Duration(seconds: 3));
    await tester.pumpAndSettle();
    expect(
      find.text('Aviso ocultado. O registro foi preservado.'),
      findsNothing,
    );
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpWidget(
      await host(commands, preferences: preferences, showBars: true),
    );
    await tester.pumpAndSettle();
    expect(find.text('Checklist atualizado'), findsNothing);
    await tester.tap(find.text('Mostrar avisos ocultos (1)'));
    await tester.pumpAndSettle();
    expect(find.text('Checklist atualizado'), findsOneWidget);
    await tester.ensureVisible(find.text('Reexibir aviso'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Reexibir aviso'));
    await tester.pumpAndSettle();
    expect(find.byTooltip('Ocultar aviso da barra'), findsOneWidget);
    expect(layoutError, isNull);
  });

  testWidgets('permite desfazer antes do aviso desaparecer', (tester) async {
    await tester.pumpWidget(
      await host([
        command(state: PendingCommandState.rejected),
      ], showBars: true),
    );
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Ocultar aviso'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Ocultar aviso'));
    await tester.pumpAndSettle();
    expect(find.text('Checklist atualizado'), findsNothing);
    await tester.tap(find.text('Desfazer'));
    await tester.pumpAndSettle();
    expect(find.text('Checklist atualizado'), findsOneWidget);
    expect(find.byTooltip('Ocultar aviso da barra'), findsOneWidget);
    expect(layoutError, isNull);
  });

  testWidgets('ocultar falha de evidência preserva o arquivo e sua fila', (
    tester,
  ) async {
    await tester.pumpWidget(
      await host(const [], media: [capture()], showBars: true),
    );
    await tester.pumpAndSettle();
    final container = ProviderScope.containerOf(
      tester.element(find.byType(SyncCenterScreen)),
    );
    expect(find.text('1 evidência precisa da sua atenção'), findsOneWidget);
    await tester.ensureVisible(find.text('Ocultar aviso'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Ocultar aviso'));
    await tester.pumpAndSettle();
    final queue = container.read(mediaQueueProvider);
    expect(await queue.forScope(scope), hasLength(1));
    expect(await queue.files.exists(capture().path), isTrue);
    expect(find.text('evidencia.jpg'), findsNothing);
    expect(find.byTooltip('Ocultar aviso da barra'), findsNothing);
    expect(container.read(syncNoticePreferencesProvider).hidden, {
      mediaNoticeKey(capture()),
    });
    await tester.ensureVisible(find.text('Mostrar avisos ocultos (1)'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Mostrar avisos ocultos (1)'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('evidencia.jpg'));
    expect(
      find.text('A imagem ultrapassa o tamanho permitido.'),
      findsOneWidget,
    );
    expect(layoutError, isNull);
  });

  testWidgets(
    'dispensa a faixa, mantém a lista e avisa um item novo com a mesma contagem',
    (tester) async {
      final preferences = await SharedPreferences.getInstance();
      final commands = [command(state: PendingCommandState.conflict)];
      await tester.pumpWidget(
        await host(commands, preferences: preferences, showBars: true),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Ocultar aviso da barra'));
      await tester.pumpAndSettle();
      expect(find.byTooltip('Ocultar aviso da barra'), findsNothing);
      expect(find.text('Checklist atualizado'), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpWidget(
        await host(commands, preferences: preferences, showBars: true),
      );
      await tester.pumpAndSettle();
      expect(find.byTooltip('Ocultar aviso da barra'), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpWidget(
        await host(
          [command(id: 2, state: PendingCommandState.conflict)],
          preferences: preferences,
          showBars: true,
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byTooltip('Ocultar aviso da barra'), findsOneWidget);
      expect(layoutError, isNull);
    },
  );

  testWidgets(
    'envio antigo também pode ter a faixa dispensada e o aviso ocultado',
    (tester) async {
      final upload = UploadTask(
        id: 'upload-old',
        operationId: 'op-a',
        filePath: '/foto.jpg',
        fileName: 'foto-antiga.jpg',
        mimeType: 'image/jpeg',
        sizeInBytes: 3,
        createdAt: DateTime.utc(2026, 10, 29),
        status: UploadStatus.failed,
        lastError: 'Não foi possível enviar esta imagem.',
      );
      await tester.pumpWidget(
        await host(const [], uploads: [upload], showBars: true),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Ocultar aviso de envio'));
      await tester.pumpAndSettle();
      expect(find.byTooltip('Ocultar aviso de envio'), findsNothing);
      await tester.drag(find.byType(ListView), const Offset(0, -500));
      await tester.pumpAndSettle();
      expect(find.text('foto-antiga.jpg'), findsOneWidget);
      await tester.drag(find.byType(ListView), const Offset(0, 1000));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Reexibir avisos da barra'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Reexibir avisos da barra'));
      await tester.pumpAndSettle();
      expect(find.byTooltip('Ocultar aviso de envio'), findsOneWidget);
      await tester.drag(find.byType(ListView), const Offset(0, -500));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Ocultar aviso'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Ocultar aviso'));
      await tester.pumpAndSettle();
      expect(find.text('foto-antiga.jpg'), findsNothing);
      expect(find.byTooltip('Ocultar aviso de envio'), findsNothing);
      final container = ProviderScope.containerOf(
        tester.element(find.byType(SyncCenterScreen)),
      );
      expect(
        container.read(uploadTasksProvider).requireValue.single.status,
        UploadStatus.failed,
      );
      expect(layoutError, isNull);
    },
  );

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
