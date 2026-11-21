/// O que as três páginas do cliente leem.
///
/// `autoDispose`: o cliente abre o app de vez em quando, e o que ele vê deve
/// ser o de agora — guardar a lista de ontem não ajuda quem quer saber se o
/// técnico já foi.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/portal_contracts.dart';
import 'portal_session.dart';

final portalSummaryProvider = FutureProvider.autoDispose<PortalSummary>(
  (ref) => ref.watch(portalRepositoryProvider).summary(),
);

/// Os atendimentos mais recentes — a linha do tempo da página Início.
final portalRecentOperationsProvider =
    FutureProvider.autoDispose<PortalPage<PortalOperation>>(
      (ref) => ref.watch(portalRepositoryProvider).operations(limit: 30),
    );

final portalOperationProvider = FutureProvider.autoDispose
    .family<PortalOperation, String>(
      (ref, id) => ref.watch(portalRepositoryProvider).operation(id),
    );

/// A busca da página Equipamentos — vazia lista todos.
final portalAssetSearchProvider = StateProvider.autoDispose<String>((_) => '');

final portalAssetsProvider =
    FutureProvider.autoDispose<PortalPage<PortalAsset>>((ref) {
      final search = ref.watch(portalAssetSearchProvider);
      return ref.watch(portalRepositoryProvider).assets(search: search);
    });

final portalAssetProvider = FutureProvider.autoDispose
    .family<PortalAsset, String>(
      (ref, id) => ref.watch(portalRepositoryProvider).asset(id),
    );

/// O histórico de um equipamento: os atendimentos que o incluem.
final portalAssetHistoryProvider = FutureProvider.autoDispose
    .family<PortalPage<PortalOperation>, String>(
      (ref, assetId) => ref
          .watch(portalRepositoryProvider)
          .operations(assetId: assetId, limit: 50),
    );

final portalAssetDocumentsProvider = FutureProvider.autoDispose
    .family<PortalPage<PortalDocument>, String>(
      (ref, assetId) =>
          ref.watch(portalRepositoryProvider).documents(assetId: assetId),
    );

final portalOperationDocumentsProvider = FutureProvider.autoDispose
    .family<PortalPage<PortalDocument>, String>(
      (ref, operationId) => ref
          .watch(portalRepositoryProvider)
          .documents(operationId: operationId),
    );

/// O filtro da página Documentos — `null` mostra todos.
final portalDocumentCategoryProvider =
    StateProvider.autoDispose<PortalDocumentCategory?>((_) => null);

final portalDocumentsProvider =
    FutureProvider.autoDispose<PortalPage<PortalDocument>>((ref) {
      final category = ref.watch(portalDocumentCategoryProvider);
      return ref
          .watch(portalRepositoryProvider)
          .documents(category: category, limit: 50);
    });

final portalProfileProvider = FutureProvider.autoDispose<PortalProfile>(
  (ref) => ref.watch(portalRepositoryProvider).profile(),
);

final portalServiceRequestsProvider =
    FutureProvider.autoDispose<PortalPage<ServiceRequest>>(
      (ref) => ref.watch(portalRepositoryProvider).serviceRequests(),
    );

final portalServiceRequestProvider = FutureProvider.autoDispose
    .family<ServiceRequest, String>(
      (ref, id) => ref.watch(portalRepositoryProvider).serviceRequest(id),
    );

/// Todos os equipamentos, para o passo "qual equipamento" do assistente.
final portalAllAssetsProvider =
    FutureProvider.autoDispose<PortalPage<PortalAsset>>(
      (ref) => ref.watch(portalRepositoryProvider).assets(),
    );
