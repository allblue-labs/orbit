/// A ligação das evidências com a árvore.
library;

import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/network/orbit_api_client.dart';
import '../../../core/contracts/mobile_evidence_contracts.dart';
import '../../sync/application/sync_providers.dart';
import '../../sync/data/command_journal.dart' show CommandScope;
import '../../sync/data/journal_file.dart';
import '../data/evidence_repository.dart';
import '../data/local_media.dart';
import '../data/media_capture.dart';
import '../data/media_store.dart';
import 'media_upload_controller.dart';

/// A fila de mídia, em arquivo próprio.
///
/// Nem no journal de comandos nem na projeção: megabytes não convivem com um
/// documento reescrito a cada toque, e um full resync de estado não pode
/// ameaçar a foto que ninguém enviou.
final mediaQueueProvider = Provider<MediaQueue>(
  (ref) => MediaQueue(
    file: DocumentsJournalFile(name: 'media_queue.json'),
    files: DocumentsMediaFileStore(),
  ),
);

final evidenceRepositoryProvider = Provider<EvidenceRepository>(
  (ref) => EvidenceRepository(client: ref.watch(apiClientProvider)),
);

/// Preview lifecycle belongs to the application layer, never to a widget.
final evidenceThumbnailProvider = FutureProvider.autoDispose
    .family<Uint8List?, FieldEvidence>((ref, evidence) {
      final token = OrbitRequestCancellation();
      ref.onDispose(() => token.cancel());
      return ref
          .watch(evidenceRepositoryProvider)
          .thumbnail(evidence, cancellation: token);
    });

final mediaCaptureSourceProvider = Provider<MediaCaptureSource>(
  (ref) => const PlatformMediaCaptureSource(),
);

/// O orquestrador de mídia. Um só, coordenado com o de comandos.
final mediaUploadControllerProvider =
    StateNotifierProvider<MediaUploadController, MediaSyncState>((ref) {
      final scope = ref.watch(commandScopeProvider);
      final controller = MediaUploadController(
        queue: ref.watch(mediaQueueProvider),
        repository: ref.watch(evidenceRepositoryProvider),
        scope:
            scope ??
            const CommandScope(
              userId: '',
              organizationId: '',
              businessUnitId: null,
            ),

        /// Confirmada no servidor: a lista autoritativa é relida, em vez de o
        /// app deduzir o que passou a existir.
        onEvidenceConfirmed: (target) =>
            ref.invalidate(evidenceListProvider(target)),
      );
      unawaited(controller.restore());
      return controller;
    });

/// As evidências **confirmadas** de um alvo. Vêm do servidor, sempre.
final evidenceListProvider = FutureProvider.autoDispose
    .family<List<FieldEvidence>, FieldEvidenceTargetRef>(
      (ref, target) =>
          ref.watch(evidenceRepositoryProvider).list(target: target),
    );

/// As capturas ainda **não** confirmadas de um alvo.
///
/// Lista separada de propósito: somá-la à das confirmadas produziria uma
/// contagem que o servidor não reconhece.
final pendingMediaProvider = FutureProvider.autoDispose
    .family<List<LocalMedia>, FieldEvidenceTargetRef>((ref, target) async {
      ref.watch(mediaUploadControllerProvider);
      final scope = ref.watch(commandScopeProvider);
      if (scope == null) return const [];
      final queue = await ref.watch(mediaQueueProvider).forScope(scope);
      return queue.where((value) => value.target == target).toList();
    });

/// Toda a mídia pendente do contexto, para o centro de sincronização.
final allPendingMediaProvider = FutureProvider.autoDispose<List<LocalMedia>>((
  ref,
) async {
  ref.watch(mediaUploadControllerProvider);
  final scope = ref.watch(commandScopeProvider);
  if (scope == null) return const [];
  return ref.watch(mediaQueueProvider).forScope(scope);
});

/// Um acesso temporário para exibir a evidência.
///
/// Pedido no momento de mostrar e não guardado: a URL vale minutos, e tratá-la
/// como atributo da evidência renderia um link morto na próxima abertura.
final evidenceAccessProvider = FutureProvider.autoDispose
    .family<EvidenceAccess, String>(
      (ref, evidenceId) =>
          ref.watch(evidenceRepositoryProvider).access(evidenceId),
    );
