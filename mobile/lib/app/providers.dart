/// Composição de dependências.
///
/// Um único lugar monta ambiente, armazenamento, cliente HTTP, fila de
/// uploads, repositórios e controlador de sessão. Widgets consomem providers;
/// nunca instanciam Dio nem repositório.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/config/environment.dart';
import '../core/location/location_service.dart';
import '../core/network/connectivity_monitor.dart';
import '../core/network/orbit_api_client.dart';
import '../core/observability/orbit_logger.dart';
import '../core/storage/read_cache.dart';
import '../core/storage/token_storage.dart';
import '../core/uploads/evidence_capture.dart';
import '../core/uploads/upload_executor.dart';
import '../core/uploads/upload_queue.dart';
import '../core/uploads/upload_queue_store.dart';
import '../core/uploads/upload_task.dart';
import '../features/authentication/application/auth_controller.dart';
import '../features/authentication/data/auth_repository.dart';
import '../features/authentication/domain/session.dart';
import '../features/operations/data/operations_repository.dart';
import '../features/scheduling/data/agenda_repository.dart';

final environmentProvider = Provider<OrbitEnvironment>(
  (ref) => OrbitEnvironment.fromDefines(),
);

final loggerProvider = Provider<OrbitLogger>(
  (ref) => OrbitLogger.forEnvironment(ref.watch(environmentProvider)),
);

final tokenStorageProvider = Provider<TokenStorage>(
  (ref) => SecureTokenStorage(),
);

/// Preenchido no `main` com `overrideWithValue`, porque a leitura das
/// preferências é assíncrona e a árvore precisa dela pronta.
final sharedPreferencesProvider = Provider<SharedPreferences>(
  (ref) =>
      throw UnimplementedError('sharedPreferencesProvider não inicializado'),
);

final readCacheProvider = Provider<ReadCache>(
  (ref) => PreferencesReadCache(ref.watch(sharedPreferencesProvider)),
);

final connectivityProvider = Provider<ConnectivityMonitor>(
  (ref) => PlatformConnectivityMonitor(),
);

final locationServiceProvider = Provider<LocationService>(
  (ref) => const GeolocatorLocationService(),
);

final apiClientProvider = Provider<OrbitApiClient>((ref) {
  return OrbitApiClient.create(
    environment: ref.watch(environmentProvider),
    storage: ref.watch(tokenStorageProvider),
    logger: ref.watch(loggerProvider),
  );
});

/// Fila de uploads — viva enquanto o app estiver aberto.
///
/// Acorda com a volta da conexão e é restaurada no `main`, para que evidências
/// pendentes de uma sessão anterior voltem a ser enviadas.
final uploadQueueProvider = Provider<UploadQueue>((ref) {
  final queue = UploadQueue(
    store: FileUploadQueueStore(),
    executor: createAttachmentUploadExecutor(ref.watch(apiClientProvider)),
    logger: ref.watch(loggerProvider),
    connectivity: ref.watch(connectivityProvider).onStatusChange,
  );
  ref.onDispose(queue.dispose);
  return queue;
});

/// Estado da fila para a interface observar.
final uploadTasksProvider = StreamProvider<List<UploadTask>>((ref) {
  final queue = ref.watch(uploadQueueProvider);
  return queue.changes;
});

/// Tarefas de uma operação específica.
final operationUploadsProvider = Provider.family<List<UploadTask>, String>((
  ref,
  operationId,
) {
  final tasks = ref.watch(uploadTasksProvider).valueOrNull ?? const [];
  return tasks
      .where((task) => task.operationId == operationId)
      .toList(growable: false);
});

final evidenceRepositoryProvider = Provider<EvidenceRepository>(
  (ref) => EvidenceRepository(
    source: PlatformEvidenceSource(),
    queue: ref.watch(uploadQueueProvider),
    logger: ref.watch(loggerProvider),
  ),
);

final authRepositoryProvider = Provider<AuthRepository>(
  (ref) => AuthRepository(
    client: ref.watch(apiClientProvider),
    storage: ref.watch(tokenStorageProvider),
  ),
);

final authControllerProvider = StateNotifierProvider<AuthController, AuthState>(
  (ref) {
    return AuthController(
      repository: ref.watch(authRepositoryProvider),
      authenticator: ref.watch(apiClientProvider).authenticator,
    );
  },
);

/// Sessão ativa, ou `null` quando não autenticado.
final sessionProvider = Provider<OrbitSession?>((ref) {
  final state = ref.watch(authControllerProvider);
  return state is AuthAuthenticated ? state.session : null;
});

final operationsRepositoryProvider = Provider<OperationsRepository>(
  (ref) => OperationsRepository(
    client: ref.watch(apiClientProvider),
    cache: ref.watch(readCacheProvider),
  ),
);

final agendaRepositoryProvider = Provider<AgendaRepository>(
  (ref) => AgendaRepository(
    client: ref.watch(apiClientProvider),
    cache: ref.watch(readCacheProvider),
  ),
);
