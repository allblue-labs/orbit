/// Estado da lista de documentos.
///
/// A mesma máquina de páginas da fila de campo, com o mesmo cuidado: uma
/// página no ar por vez, acumulação na ordem do servidor, e nenhuma
/// reordenação local.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/contracts/mobile_field_contracts.dart';
import '../../artifact/application/artifact_providers.dart';
import '../../artifact/application/document_downloader.dart';
import '../data/documents_repository.dart';
import 'document_sharing.dart';

final documentsRepositoryProvider = Provider<DocumentsRepository>(
  (ref) => DocumentsRepository(client: ref.watch(apiClientProvider)),
);

/// O recorte completo da tela: tipo, busca e janela de datas.
///
/// Um objeto só porque ele é a **chave de recarga** do controlador: espalhado
/// em três provedores, mudar dois de uma vez dispararia duas cargas e a
/// segunda resposta poderia chegar antes da primeira.
class DocumentQuery {
  const DocumentQuery({
    this.filter = DocumentFilter.todos,
    this.search,
    this.from,
    this.to,
  });

  final DocumentFilter filter;
  final String? search;
  final DateTime? from;
  final DateTime? to;

  /// A busca não conta: ela tem campo próprio e visível.
  int get activeCount => [
    filter != DocumentFilter.todos,
    from != null || to != null,
  ].where((ativo) => ativo).length;

  DocumentQuery copyWith({
    DocumentFilter? filter,
    String? search,
    DateTime? from,
    DateTime? to,
    bool clearSearch = false,
    bool clearDates = false,
  }) => DocumentQuery(
    filter: filter ?? this.filter,
    search: clearSearch ? null : (search ?? this.search),
    from: clearDates ? null : (from ?? this.from),
    to: clearDates ? null : (to ?? this.to),
  );

  @override
  bool operator ==(Object other) =>
      other is DocumentQuery &&
      other.filter == filter &&
      other.search == search &&
      other.from == from &&
      other.to == to;

  @override
  int get hashCode => Object.hash(filter, search, from, to);
}

/// Baixar e entregar um documento pela folha do sistema.
final documentSharingProvider = Provider<DocumentSharing>(
  (ref) => DocumentSharing(
    downloader: DocumentDownloader(
      repository: ref.watch(artifactRepositoryProvider),
      files: ref.watch(documentFileStoreProvider),
    ),
  ),
);

final documentQueryProvider = StateProvider.autoDispose<DocumentQuery>(
  (ref) => const DocumentQuery(),
);

class DocumentsState {
  const DocumentsState({
    this.items = const [],
    this.cursor,
    this.hasNextPage = false,
    this.isLoadingMore = false,
    this.error,
  });

  final List<MobileRecentDocumentContract> items;
  final String? cursor;
  final bool hasNextPage;
  final bool isLoadingMore;
  final Object? error;

  DocumentsState copyWith({
    List<MobileRecentDocumentContract>? items,
    String? cursor,
    bool? hasNextPage,
    bool? isLoadingMore,
    Object? error,
    bool clearError = false,
  }) => DocumentsState(
    items: items ?? this.items,
    cursor: cursor ?? this.cursor,
    hasNextPage: hasNextPage ?? this.hasNextPage,
    isLoadingMore: isLoadingMore ?? this.isLoadingMore,
    error: clearError ? null : (error ?? this.error),
  );
}

class DocumentsController extends StateNotifier<AsyncValue<DocumentsState>> {
  DocumentsController({
    required DocumentsRepository repository,
    required DocumentQuery query,
  }) : _repository = repository,
       _query = query,
       super(const AsyncValue.loading()) {
    load();
  }

  final DocumentsRepository _repository;
  final DocumentQuery _query;

  /// Guarda contra corrida de rolagem: com duas páginas no ar, a mesma volta
  /// duas vezes e a lista ganha repetidas.
  bool _inFlight = false;

  Future<void> load() async {
    _inFlight = true;
    state = const AsyncValue.loading();
    try {
      final page = await _repository.list(
        filter: _query.filter,
        search: _query.search,
        from: _query.from,
        to: _query.to,
      );
      state = AsyncValue.data(
        DocumentsState(
          items: page.data,
          cursor: page.nextCursor,
          hasNextPage: page.hasNextPage,
        ),
      );
    } on Object catch (error, stack) {
      state = AsyncValue.error(error, stack);
    } finally {
      _inFlight = false;
    }
  }

  Future<void> loadMore() async {
    final current = state.valueOrNull;
    if (current == null || !current.hasNextPage || _inFlight) return;

    _inFlight = true;
    state = AsyncValue.data(
      current.copyWith(isLoadingMore: true, clearError: true),
    );
    try {
      final page = await _repository.list(
        filter: _query.filter,
        search: _query.search,
        from: _query.from,
        to: _query.to,
        cursor: current.cursor,
      );
      state = AsyncValue.data(
        current.copyWith(
          items: mergeDocuments(current.items, page.data),
          cursor: page.nextCursor,
          hasNextPage: page.hasNextPage,
          isLoadingMore: false,
        ),
      );
    } on Object catch (error) {
      /// A falha de uma página não descarta o que já está na tela.
      state = AsyncValue.data(
        current.copyWith(isLoadingMore: false, error: error),
      );
    } finally {
      _inFlight = false;
    }
  }
}

/// Junta a página nova **preservando a ordem** e sem repetir. A identidade é o
/// id do artefato; data e cliente se repetem legitimamente.
List<MobileRecentDocumentContract> mergeDocuments(
  List<MobileRecentDocumentContract> current,
  List<MobileRecentDocumentContract> incoming,
) {
  final seen = current.map((document) => document.artifactId).toSet();
  return [
    ...current,
    ...incoming.where((document) => seen.add(document.artifactId)),
  ];
}

final documentsControllerProvider =
    StateNotifierProvider.autoDispose<
      DocumentsController,
      AsyncValue<DocumentsState>
    >(
      (ref) => DocumentsController(
        repository: ref.watch(documentsRepositoryProvider),
        query: ref.watch(documentQueryProvider),
      ),
    );
