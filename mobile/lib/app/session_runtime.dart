import 'dart:async';
import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/storage/read_cache.dart';
import '../core/uploads/upload_queue.dart';
import '../core/uploads/upload_queue_store.dart';
import '../core/uploads/upload_executor.dart';
import '../features/artifact/application/artifact_providers.dart';
import '../features/artifact/data/document_file.dart';
import '../features/authentication/application/auth_controller.dart';
import '../features/authentication/domain/session.dart';
import '../features/notifications/application/push_providers.dart';
import '../features/legal/data/legal_repository.dart';
import '../features/sync/application/sync_providers.dart';
import '../features/evidence/application/evidence_providers.dart'
    show mediaQueueProvider;
import 'providers.dart';

/// Local state has exactly one authenticated owner, including all provider families.
/// No parent container: a future provider must not inherit another account's value.
class SessionRuntime {
  SessionRuntime({
    required ProviderContainer root,
    required OrbitSession? session,
  }) {
    final environment = root.read(environmentProvider);
    final preferences = root.read(sharedPreferencesProvider);
    scopeKey = sha256
        .convert(
          utf8.encode(
            jsonEncode([
              environment.apiBaseUrl,
              session?.user.id,
              session?.organizationId,
              session?.businessUnitId,
            ]),
          ),
        )
        .toString();
    final client = root.read(apiClientProvider).scoped();
    if (session == null) client.closeScope();
    final cache = PreferencesReadCache(preferences, namespace: scopeKey);
    if (session == null) cache.close();
    final files = TemporaryDocumentFileStore(scopeKey: scopeKey);
    if (session == null) files.close();
    _close = () {
      client.closeScope();
      cache.close();
      files.close();
      unawaited(cache.clear().catchError((Object _) {}));
      if (session != null) {
        final projectionScope = [
          session.user.id,
          session.organizationId ?? 'sem-org',
          session.businessUnitId ?? 'sem-unidade',
        ].join('.');
        unawaited(
          root
              .read(syncProjectionProvider)
              .resetScope(projectionScope)
              .then<void>((_) {})
              .catchError((Object _) {}),
        );
      }
    };
    _files = files;
    container = ProviderContainer(
      overrides: [
        environmentProvider.overrideWithValue(environment),
        loggerProvider.overrideWithValue(root.read(loggerProvider)),
        tokenStorageProvider.overrideWithValue(root.read(tokenStorageProvider)),
        sharedPreferencesProvider.overrideWithValue(preferences),
        connectivityProvider.overrideWithValue(root.read(connectivityProvider)),
        apiClientProvider.overrideWithValue(client),
        legalRepositoryProvider.overrideWithValue(
          root.read(legalRepositoryProvider),
        ),
        readCacheProvider.overrideWithValue(cache),
        // These journals already carry an explicit owner on every entry. Share
        // their serialized stores, never a running controller, across sessions.
        commandJournalProvider.overrideWithValue(
          root.read(commandJournalProvider),
        ),
        syncProjectionProvider.overrideWithValue(
          root.read(syncProjectionProvider),
        ),
        mediaQueueProvider.overrideWithValue(root.read(mediaQueueProvider)),
        authRepositoryProvider.overrideWithValue(
          root.read(authRepositoryProvider),
        ),
        authControllerProvider.overrideWith(
          (ref) =>
              AuthController.mirror(root.read(authControllerProvider.notifier)),
        ),
        documentFileStoreProvider.overrideWithValue(files),
        pushTokenSourceProvider.overrideWithValue(
          root.read(pushTokenSourceProvider),
        ),
        uploadQueueProvider.overrideWith((ref) {
          final queue = UploadQueue(
            store: FileUploadQueueStore(namespace: scopeKey),
            executor: createAttachmentUploadExecutor(client),
            logger: ref.watch(loggerProvider),
            connectivity: session == null
                ? null
                : ref.watch(connectivityProvider).onStatusChange,
          );
          ref.onDispose(queue.dispose);
          if (session != null) unawaited(queue.restore());
          return queue;
        }),
      ],
    );
  }

  late final String scopeKey;
  late final ProviderContainer container;
  late final void Function() _close;
  late final TemporaryDocumentFileStore _files;
  bool _retired = false;

  void retire() {
    if (_retired) return;
    _retired = true;
    _close();
    unawaited(_files.purge().catchError((Object _) {}));
  }

  void dispose() {
    retire();
    container.dispose();
  }
}
