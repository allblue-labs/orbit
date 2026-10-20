/// A ligação do documento com a árvore.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/contracts/mobile_field_artifact_contracts.dart';
import '../data/artifact_repository.dart';
import '../data/document_file.dart';
import 'artifact_controller.dart';

final artifactRepositoryProvider = Provider<ArtifactRepository>(
  (ref) => ArtifactRepository(client: ref.watch(apiClientProvider)),
);

/// Arquivos de documento vivem no diretório temporário.
final documentFileStoreProvider = Provider<DocumentFileStore>(
  (ref) => TemporaryDocumentFileStore(),
);

/// A fonte de um documento: tipo e id, como o backend os endereça.
final class ArtifactSourceRef {
  const ArtifactSourceRef({required this.type, required this.id});

  final FieldArtifactSourceType type;
  final String id;

  @override
  bool operator ==(Object other) =>
      other is ArtifactSourceRef && other.type == type && other.id == id;

  @override
  int get hashCode => Object.hash(type, id);
}

/// O documento de uma fonte.
///
/// `autoDispose` de propósito: sair da tela cancela o acompanhamento da
/// renderização. Não há consulta em segundo plano.
final artifactControllerProvider = StateNotifierProvider.autoDispose
    .family<ArtifactController, ArtifactState, ArtifactSourceRef>(
      (ref, source) => ArtifactController(
        repository: ref.watch(artifactRepositoryProvider),
        files: ref.watch(documentFileStoreProvider),
        sourceType: source.type,
        sourceId: source.id,
      ),
    );
