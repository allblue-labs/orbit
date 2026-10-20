/// Providers de operações.
///
/// Cada seção do detalhe tem o seu provider: recarregar a timeline não
/// recarrega os checklists, e uma falha isolada não derruba a tela.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/contracts/operation_contracts.dart';
import '../../authentication/domain/session.dart';
import '../data/operations_repository.dart';

/// Filtros da listagem, mantidos enquanto a aba estiver viva.
class OperationsFilterNotifier extends StateNotifier<OperationQuery> {
  OperationsFilterNotifier(super.initial);

  void setSearch(String? value) => state = state.copyWith(
    search: value?.trim().isEmpty ?? true ? null : value!.trim(),
    clearSearch: value?.trim().isEmpty ?? true,
    page: 1,
  );

  void setStatus(String? value) => state = state.copyWith(
    status: value,
    clearStatus: value == null,
    page: 1,
  );

  void setKind(String? value) =>
      state = state.copyWith(kind: value, clearKind: value == null, page: 1);

  void nextPage() => state = state.copyWith(page: state.page + 1);

  void previousPage() {
    if (state.page > 1) state = state.copyWith(page: state.page - 1);
  }

  void reset() => state = OperationQuery(
    assignedUserId: state.assignedUserId,
    businessUnitId: state.businessUnitId,
    limit: state.limit,
  );
}

final operationsFilterProvider =
    StateNotifierProvider<OperationsFilterNotifier, OperationQuery>((ref) {
      final session = ref.watch(sessionProvider);
      // Operador vê o próprio trabalho por padrão; gestor vê a unidade.
      final isOwner = session?.profile == OrbitProfile.owner;
      return OperationsFilterNotifier(
        OperationQuery(
          assignedUserId: isOwner ? null : session?.user.id,
          businessUnitId: session?.businessUnitId,
        ),
      );
    });

final operationsListProvider =
    FutureProvider.autoDispose<CachedResult<Paginated<Operation>>>((ref) {
      final query = ref.watch(operationsFilterProvider);
      return ref.watch(operationsRepositoryProvider).list(query);
    });

final operationDetailProvider = FutureProvider.autoDispose
    .family<CachedResult<Operation>, String>(
      (ref, id) => ref.watch(operationsRepositoryProvider).detail(id),
    );

final operationTimelineProvider = FutureProvider.autoDispose
    .family<OperationTimeline, String>(
      (ref, id) => ref.watch(operationsRepositoryProvider).timeline(id),
    );

final operationHistoryProvider = FutureProvider.autoDispose
    .family<List<OperationHistoryEntry>, String>(
      (ref, id) => ref.watch(operationsRepositoryProvider).history(id),
    );

final operationChecklistsProvider = FutureProvider.autoDispose
    .family<Paginated<OperationChecklistSummary>, String>(
      (ref, id) => ref.watch(operationsRepositoryProvider).checklists(id),
    );

/// Recarrega tudo que uma escrita na operação afeta.
///
/// O backend registra histórico em qualquer mutação, então detalhe, timeline e
/// histórico saem juntos — e a listagem, porque status aparece nela.
void invalidateOperation(WidgetRef ref, String id) {
  ref
    ..invalidate(operationDetailProvider(id))
    ..invalidate(operationTimelineProvider(id))
    ..invalidate(operationHistoryProvider(id))
    ..invalidate(operationsListProvider);
}
