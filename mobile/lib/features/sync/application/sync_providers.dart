/// A ligação do sincronismo com a árvore.
library;

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/storage/device_identity.dart';
import '../../field/application/field_providers.dart';
import '../data/command_journal.dart';
import '../data/journal_file.dart';
import '../data/sync_projection.dart';
import '../data/sync_repository.dart';
import 'sync_controller.dart';

/// Os dois arquivos, separados de propósito: o full resync alcança só o
/// segundo.
final commandJournalProvider = Provider<CommandJournal>(
  (ref) =>
      CommandJournal(file: DocumentsJournalFile(name: 'command_journal.json')),
);

final syncProjectionProvider = Provider<SyncProjectionStore>(
  (ref) => SyncProjectionStore(
    file: DocumentsJournalFile(name: 'sync_projection.json'),
  ),
);

final syncRepositoryProvider = Provider<SyncRepository>(
  (ref) => SyncRepository(client: ref.watch(apiClientProvider)),
);

/// O identificador desta instalação, resolvido uma vez.
final deviceInstanceIdProvider = FutureProvider<String>(
  (ref) => deviceInstanceId(ref.watch(sharedPreferencesProvider)),
);

/// O escopo dos comandos: quem, onde, em qual unidade.
///
/// `null` sem sessão — sem escopo não há o que enviar, e enviar a fila de
/// alguém sob o token de outra pessoa trocaria o autor do trabalho.
final commandScopeProvider = Provider<CommandScope?>((ref) {
  final session = ref.watch(sessionProvider);
  final organizationId = session?.organizationId;
  if (session == null || organizationId == null) return null;
  return CommandScope(
    userId: session.user.id,
    organizationId: organizationId,
    businessUnitId: session.businessUnitId,
  );
});

/// O orquestrador. Um só, vivo enquanto houver sessão.
final syncControllerProvider = StateNotifierProvider<SyncController, SyncState>(
  (ref) {
    final scope = ref.watch(commandScopeProvider);
    final controller = SyncController(
      journal: ref.watch(commandJournalProvider),
      projection: ref.watch(syncProjectionProvider),
      repository: ref.watch(syncRepositoryProvider),

      /// Sem sessão, um escopo que não casa com comando nenhum: o
      /// orquestrador existe, e não envia nada.
      scope:
          scope ??
          const CommandScope(
            userId: '',
            organizationId: '',
            businessUnitId: null,
          ),
      scopeKey: fieldScopeKey(ref),

      /// Quando o servidor confirma algo, as telas releem dele — não do
      /// que o app achou que tinha acontecido.
      onReconciled: () {
        ref.invalidate(fieldDashboardProvider);
        ref.invalidate(workQueueControllerProvider);
      },
    );
    unawaited(controller.restore());
    return controller;
  },
);

/// A fila visível: só o que pertence ao contexto atual.
final pendingCommandsProvider =
    FutureProvider.autoDispose<List<PendingCommand>>((ref) async {
      /// Recontado a cada mudança do orquestrador — é o que mantém a tela de
      /// sincronização viva sem um segundo relógio.
      ref.watch(syncControllerProvider);
      final scope = ref.watch(commandScopeProvider);
      if (scope == null) return const [];
      final snapshot = await ref.watch(commandJournalProvider).read();
      return snapshot.commands
          .where((value) => value.scope.matches(scope))
          .toList(growable: false);
    });
