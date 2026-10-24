import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:orbit_operator/app/providers.dart';
import 'package:orbit_operator/app/session_runtime.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/contracts/session_contracts.dart';
import 'package:orbit_operator/core/errors/orbit_exception.dart';
import 'package:orbit_operator/core/network/connectivity_monitor.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/core/storage/read_cache.dart';
import 'package:orbit_operator/core/storage/token_storage.dart';
import 'package:orbit_operator/core/push/push_channel.dart';
import 'package:orbit_operator/main.dart';
import 'package:orbit_operator/features/notifications/application/push_providers.dart';
import 'package:orbit_operator/features/sync/application/sync_providers.dart';
import 'package:orbit_operator/features/sync/data/command_journal.dart';
import 'package:orbit_operator/features/sync/data/journal_file.dart';
import 'package:orbit_operator/features/sync/data/sync_projection.dart';
import 'package:orbit_operator/features/evidence/application/evidence_providers.dart'
    show mediaQueueProvider;
import 'package:orbit_operator/features/evidence/data/media_store.dart';
import 'package:orbit_operator/features/authentication/application/auth_controller.dart';
import 'package:orbit_operator/features/authentication/data/auth_repository.dart';
import 'package:orbit_operator/features/authentication/domain/session.dart';
import 'package:orbit_operator/features/documents/application/documents_providers.dart';
import 'package:orbit_operator/features/profile/application/profile_providers.dart';

import '../support/fakes.dart';
import '../support/scripted_adapter.dart';

class HarnessAuth extends AuthController {
  HarnessAuth(OrbitApiClient client, TokenStorage storage)
    : super(
        repository: AuthRepository(client: client, storage: storage),
        authenticator: client.authenticator,
      );

  void use(OrbitSession session) => state = AuthAuthenticated(session);
  void out() => state = const AuthUnauthenticated();
  @override
  Future<void> restore() async {}
}

class OfflineConnectivity implements ConnectivityMonitor {
  @override
  Stream<bool> get onStatusChange => const Stream.empty();
  @override
  Future<bool> isOnline() async => false;
}

OrbitSession session(
  String user, {
  String org = 'org-1',
  String unit = 'unit-1',
}) => OrbitSession(
  user: OrbitUser(id: user, email: '$user@example.test', displayName: user),
  claims: AccessTokenClaims.fromJson({
    'sub': user,
    'sid': 'session-$user',
    'organizationId': org,
    'businessUnitId': unit,
    'businessUnitIds': [unit],
    'permissions': ['*'],
  }),
);

Map<String, dynamic> documents(String user) => envelope({
  'data': [
    {
      'artifactId': 'document-$user',
      'label': 'Documento de $user',
      'customerName': 'Cliente de $user',
      'documentType': 'SERVICE_ORDER',
      'state': 'AVAILABLE',
      'createdAt': '2026-10-24T12:00:00Z',
    },
  ],
  'meta': {'hasNextPage': false},
});

Future<void> settle() => Future<void>.delayed(const Duration(milliseconds: 25));

Future<DocumentsState> loaded(ProviderContainer container) async {
  final done = Completer<DocumentsState>();
  final sub = container.listen(documentsControllerProvider, (_, next) {
    if (next.hasValue && !done.isCompleted) done.complete(next.requireValue);
    if (next.hasError && !done.isCompleted) {
      done.completeError(next.error!, next.stackTrace);
    }
  }, fireImmediately: true);
  try {
    return await done.future;
  } finally {
    sub.close();
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() => initializeDateFormatting('pt_BR'));
  late ProviderContainer root;
  late OrbitApiClient client;
  late InMemoryTokenStorage storage;
  late HarnessAuth auth;
  late SharedPreferences preferences;
  final runtimes = <SessionRuntime>[];
  Future<ResponseBody> Function(RequestOptions)? custom;

  Future<ResponseBody> respond(RequestOptions request) async {
    if (custom != null) return custom!(request);
    final user = request.headers['authorization'] == 'Bearer access-A'
        ? 'A'
        : 'B';
    if (request.path == '/identity/me/avatar') {
      return jsonResponse(
        envelope({
          'available': true,
          'url': 'https://storage.example.test/avatar-$user',
          'expiresAt': DateTime.now()
              .add(const Duration(hours: 1))
              .toIso8601String(),
        }),
      );
    }
    if (request.path.contains('storage.example.test')) {
      return ResponseBody.fromBytes(
        user == 'A' || request.path.endsWith('avatar-A')
            ? [1, 2, 3]
            : [4, 5, 6],
        200,
      );
    }
    if (request.path == '/mobile/field/documents') {
      return jsonResponse(documents(user));
    }
    throw StateError('Unexpected request: ${request.path}');
  }

  setUp(() async {
    custom = null;
    SharedPreferences.setMockInitialValues({});
    preferences = await SharedPreferences.getInstance();
    storage = InMemoryTokenStorage(
      const TokenPair(
        accessToken: 'access-A',
        refreshToken: 'refresh-A',
        expiresIn: 900,
      ),
    );
    client = OrbitApiClient.create(
      environment: OrbitEnvironment.fromDefines(),
      storage: storage,
      logger: const OrbitLogger(isProduction: true),
      dio: Dio()..httpClientAdapter = ScriptedAdapter(respond),
      retryDio: Dio()..httpClientAdapter = ScriptedAdapter(respond),
    );
    auth = HarnessAuth(client, storage)..use(session('A'));
    root = ProviderContainer(
      overrides: [
        apiClientProvider.overrideWithValue(client),
        tokenStorageProvider.overrideWithValue(storage),
        sharedPreferencesProvider.overrideWithValue(preferences),
        connectivityProvider.overrideWithValue(OfflineConnectivity()),
        authControllerProvider.overrideWith((_) => auth),
        pushTokenSourceProvider.overrideWithValue(
          const SilentPushTokenSource(),
        ),
        commandJournalProvider.overrideWithValue(
          CommandJournal(file: MemoryJournalFile()),
        ),
        syncProjectionProvider.overrideWithValue(
          SyncProjectionStore(file: MemoryJournalFile()),
        ),
        mediaQueueProvider.overrideWithValue(
          MediaQueue(file: MemoryJournalFile(), files: MemoryMediaFileStore()),
        ),
      ],
    );
  });

  tearDown(() {
    for (final runtime in runtimes) {
      runtime.dispose();
    }
    runtimes.clear();
    root.dispose();
  });

  SessionRuntime runtime(OrbitSession? value) {
    final result = SessionRuntime(root: root, session: value);
    runtimes.add(result);
    return result;
  }

  Future<void> switchAccount(String user) async {
    await client.authenticator.clearSession();
    await client.authenticator.storeTokens(
      TokenPair(
        accessToken: 'access-$user',
        refreshToken: 'refresh-$user',
        expiresIn: 900,
      ),
      generation: client.authenticator.generation,
    );
    auth.use(session(user));
  }

  test(
    'troca de usuário na mesma organização não reutiliza avatar nem documentos',
    () async {
      final a = runtime(session('A'));
      final subA = a.container.listen(documentsControllerProvider, (_, _) {});
      expect(await a.container.read(avatarBytesProvider.future), [1, 2, 3]);
      await settle();
      expect(
        a.container
            .read(documentsControllerProvider)
            .requireValue
            .items
            .single
            .artifactId,
        'document-A',
      );
      a.retire();
      await switchAccount('B');
      final b = runtime(session('B'));
      final subB = b.container.listen(documentsControllerProvider, (_, _) {});
      expect(b.container.read(avatarBytesProvider).valueOrNull, isNull);
      expect(b.container.read(documentsControllerProvider).valueOrNull, isNull);
      expect(await b.container.read(avatarBytesProvider.future), [4, 5, 6]);
      expect((await loaded(b.container)).items.single.artifactId, 'document-B');
      subA.close();
      subB.close();
    },
  );

  test(
    'cache separa usuário, tenant e unidade e recusa acesso após encerrar',
    () async {
      final a = runtime(session('A'));
      final cache = a.container.read(readCacheProvider);
      await cache.write('operations', {'private': 'A'});
      for (final value in [
        session('B'),
        session('A', org: 'org-2'),
        session('A', unit: 'unit-2'),
      ]) {
        final other = runtime(value);
        expect(other.scopeKey, isNot(a.scopeKey));
        expect(
          await other.container.read(readCacheProvider).read('operations'),
          isNull,
        );
      }
      a.retire();
      expect(await cache.read('operations'), isNull);
      await cache.write('late', {'private': 'late-A'});
      expect(
        await runtime(
          session('A'),
        ).container.read(readCacheProvider).read('late'),
        isNull,
      );
    },
  );

  test('cache legado sem proprietário é descartado', () async {
    await preferences.setString('orbit.cache.operations', 'old-private-data');
    await preferences.setString(
      'orbit.cache.v2.owner.operations',
      'scoped-data',
    );
    await PreferencesReadCache.purgeLegacy(preferences);
    expect(preferences.getString('orbit.cache.operations'), isNull);
    expect(
      preferences.getString('orbit.cache.v2.owner.operations'),
      'scoped-data',
    );
  });

  test(
    'requisição de documentos de A terminando após logout não entra no estado de B',
    () async {
      final pending = Completer<ResponseBody>();
      final started = Completer<void>();
      custom = (request) async {
        if (request.headers['authorization'] == 'Bearer access-A') {
          started.complete();
          return pending.future;
        }
        return jsonResponse(documents('B'));
      };
      final a = runtime(session('A'));
      a.container.listen(documentsControllerProvider, (_, _) {});
      await started.future;
      a.dispose();
      runtimes.remove(a);
      await switchAccount('B');
      final b = runtime(session('B'));
      b.container.listen(documentsControllerProvider, (_, _) {});
      pending.complete(jsonResponse(documents('A')));
      expect((await loaded(b.container)).items.single.artifactId, 'document-B');
    },
  );

  test(
    'repositório antigo não pode fazer chamadas com as credenciais novas',
    () async {
      final a = runtime(session('A'));
      final oldRepository = a.container.read(documentsRepositoryProvider);
      a.retire();
      await switchAccount('B');
      await expectLater(
        oldRepository.list(),
        throwsA(
          isA<OrbitException>().having(
            (e) => e.code,
            'code',
            'SESSION_CHANGED',
          ),
        ),
      );
    },
  );

  test('sem autenticação não há leitura de dados privados nem cache', () async {
    final anon = runtime(null);
    await expectLater(
      anon.container.read(documentsRepositoryProvider).list(),
      throwsA(isA<OrbitException>()),
    );
    await anon.container.read(readCacheProvider).write('operations', {
      'private': true,
    });
    expect(
      await anon.container.read(readCacheProvider).read('operations'),
      isNull,
    );
  });

  test(
    'descartar o estado das telas não descarta o controlador raiz de autenticação',
    () async {
      final a = runtime(session('A'));
      expect(a.container.read(sessionProvider)?.user.id, 'A');
      a.dispose();
      runtimes.remove(a);
      await switchAccount('B');
      final b = runtime(session('B'));
      expect(b.container.read(sessionProvider)?.user.id, 'B');
      expect(root.read(sessionProvider)?.user.id, 'B');
    },
  );

  testWidgets('o app real recria navegação e telas ao mudar a conta', (
    tester,
  ) async {
    custom = (request) async {
      final user = request.headers['authorization'] == 'Bearer access-A'
          ? 'A'
          : 'B';
      if (request.path == '/mobile/field/documents') {
        return jsonResponse(documents(user));
      }
      if (request.path == '/identity/me/avatar') {
        return jsonResponse(envelope({'available': false}));
      }
      if (request.path == '/mobile/sync/pull') {
        return jsonResponse(
          envelope({
            'status': 'OK',
            'changes': [],
            'tombstones': [],
            'nextCursor': null,
            'hasMore': false,
            'purgeRequired': false,
          }),
        );
      }
      return jsonResponse(envelope({}));
    };
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: root,
        child: const OrbitOperatorApp(),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Documentos').last);
    await tester.pumpAndSettle();
    expect(find.text('Documento de A'), findsOneWidget);
    await tester.runAsync(() => switchAccount('B'));
    await tester.pump();
    expect(find.text('Documento de A'), findsNothing);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Documentos').last);
    await tester.pumpAndSettle();
    expect(find.text('Documento de B'), findsOneWidget);
    expect(find.text('Documento de A'), findsNothing);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    await tester.pumpAndSettle();
  });

  testWidgets(
    'login recusado mantém os campos e mostra o erro na sessão anônima',
    (tester) async {
      auth.out();
      custom = (_) async => jsonResponse(
        errorEnvelope(
          code: 'INVALID_CREDENTIALS',
          message: 'E-mail ou senha incorretos.',
        ),
        status: 401,
      );
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: root,
          child: const OrbitOperatorApp(),
        ),
      );
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('login.email')),
        'b@example.test',
      );
      await tester.enterText(
        find.byKey(const Key('login.password')),
        'test-password',
      );
      await tester.tap(find.byKey(const Key('login.submit')));
      await tester.runAsync(() => settle());
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<TextFormField>(find.byKey(const Key('login.email')))
            .controller!
            .text,
        'b@example.test',
      );
      expect(find.text('E-mail ou senha incorretos.'), findsOneWidget);
      expect(root.read(authControllerProvider), isA<AuthUnauthenticated>());
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      await tester.pumpAndSettle();
    },
  );
}
