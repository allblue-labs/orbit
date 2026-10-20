/// Estado da projeção de campo.
///
/// O dashboard é uma leitura simples. A fila é uma **máquina de páginas**: ela
/// acumula o que o servidor entregou, na ordem em que entregou, e sabe pedir a
/// próxima sem duplicar nem correr consigo mesma.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/contracts/mobile_field_contracts.dart';
import '../../operations/data/operations_repository.dart' show CachedResult;
import '../../../core/errors/orbit_exception.dart';
import '../../sync/application/sync_providers.dart';
import '../data/field_repository.dart';

/// Recorte de escopo do cache.
///
/// Usuário, organização e unidade. Sem isso, trocar de contexto serviria o
/// trabalho de outra unidade a partir do cache — o vazamento mais fácil de
/// cometer e o mais difícil de perceber.
String fieldScopeKey(Ref ref) {
  final session = ref.watch(sessionProvider);
  return [
    session?.user.id ?? 'anon',
    session?.organization?.id ?? 'sem-org',
    session?.businessUnitId ?? 'sem-unidade',
  ].join('.');
}

final fieldRepositoryProvider = Provider<FieldRepository>(
  (ref) => FieldRepository(
    client: ref.watch(apiClientProvider),
    cache: ref.watch(readCacheProvider),
  ),
);

/// O dia do profissional — uma requisição.
final fieldDashboardProvider =
    FutureProvider.autoDispose<CachedResult<MobileFieldDashboardContract>>((
      ref,
    ) {
      final scope = fieldScopeKey(ref);
      return ref.watch(fieldRepositoryProvider).dashboard(scopeKey: scope);
    });

/// A tela inicial — uma requisição para tudo o que a home mostra.
final fieldHomeProvider =
    FutureProvider.autoDispose<CachedResult<MobileFieldHomeContract>>((ref) {
      final scope = fieldScopeKey(ref);
      return ref.watch(fieldRepositoryProvider).home(scopeKey: scope);
    });

/// O contexto de um item.
final fieldWorkItemProvider = FutureProvider.autoDispose
    .family<MobileFieldContextContract?, String>(
      (ref, id) => ref.watch(fieldRepositoryProvider).workItem(id),
    );

/* ------------------------------------------------------------------ */
/* Fila paginada                                                       */
/* ------------------------------------------------------------------ */

/// O que a tela da fila precisa saber.
class WorkQueueState {
  const WorkQueueState({
    this.items = const [],
    this.cursor,
    this.hasNextPage = false,
    this.isLoadingMore = false,
    this.error,
    this.isOffline = false,
  });

  /// **Na ordem do servidor**, acumulada página a página.
  final List<MobileWorkItemContract> items;
  final String? cursor;
  final bool hasNextPage;
  final bool isLoadingMore;
  final Object? error;

  /// A lista veio da projeção local, não do servidor. A tela avisa.
  final bool isOffline;

  WorkQueueState copyWith({
    List<MobileWorkItemContract>? items,
    String? cursor,
    bool? hasNextPage,
    bool? isLoadingMore,
    Object? error,
    bool? isOffline,
    bool clearError = false,
  }) => WorkQueueState(
    items: items ?? this.items,
    cursor: cursor ?? this.cursor,
    hasNextPage: hasNextPage ?? this.hasNextPage,
    isLoadingMore: isLoadingMore ?? this.isLoadingMore,
    error: clearError ? null : (error ?? this.error),
    isOffline: isOffline ?? this.isOffline,
  );
}

/// Filtro ativo da fila.
class WorkQueueFilter {
  const WorkQueueFilter({
    this.view = WorkQueueView.all,
    this.search,
    this.kind,
    this.customerId,
    this.customerName,
    this.from,
    this.to,
  });

  final WorkQueueView view;

  /// Busca livre. Fora de `activeCount` de propósito: ela tem campo próprio
  /// e visível, e contá-la faria o botão de filtros acusar algo que a pessoa
  /// está literalmente vendo.
  final String? search;

  final MobileWorkItemKind? kind;
  final String? customerId;

  /// Só para o chip da tela dizer **qual** cliente. O filtro que viaja é o id.
  final String? customerName;

  final DateTime? from;
  final DateTime? to;

  /// Quantos recortes estão ativos — o número no botão de filtros.
  ///
  /// A view não conta: ela tem abas próprias e está sempre visível. Contá-la
  /// faria o botão nascer com "1" e nunca zerar, que é o mesmo que não ter
  /// contador.
  int get activeCount => [
    kind != null,
    customerId != null,
    from != null || to != null,
  ].where((ativo) => ativo).length;

  WorkQueueFilter copyWith({
    WorkQueueView? view,
    String? search,
    MobileWorkItemKind? kind,
    String? customerId,
    String? customerName,
    DateTime? from,
    DateTime? to,
    bool clearKind = false,
    bool clearCustomer = false,
    bool clearDates = false,
    bool clearSearch = false,
  }) => WorkQueueFilter(
    view: view ?? this.view,
    search: clearSearch ? null : (search ?? this.search),
    kind: clearKind ? null : (kind ?? this.kind),
    customerId: clearCustomer ? null : (customerId ?? this.customerId),
    customerName: clearCustomer ? null : (customerName ?? this.customerName),
    from: clearDates ? null : (from ?? this.from),
    to: clearDates ? null : (to ?? this.to),
  );

  @override
  bool operator ==(Object other) =>
      other is WorkQueueFilter &&
      other.view == view &&
      other.search == search &&
      other.kind == kind &&
      other.customerId == customerId &&
      other.from == from &&
      other.to == to;

  @override
  int get hashCode => Object.hash(view, search, kind, customerId, from, to);
}

final workQueueFilterProvider = StateProvider.autoDispose<WorkQueueFilter>(
  (ref) => const WorkQueueFilter(),
);

/// O termo de busca da tela de Clientes.
///
/// Separado do provedor da lista para que digitar não recrie o repositório —
/// só a consulta.
final customerSearchProvider = StateProvider.autoDispose<String>((ref) => '');

/// Uma página da base de clientes, pelo termo atual.
final fieldCustomersProvider =
    FutureProvider.autoDispose<CachedResult<MobileFieldCustomerPageContract>>((
      ref,
    ) {
      final scope = fieldScopeKey(ref);
      final termo = ref.watch(customerSearchProvider);
      return ref
          .watch(fieldRepositoryProvider)
          .customers(scopeKey: scope, search: termo.isEmpty ? null : termo);
    });

/// Os clientes que aparecem na fila desta pessoa.
///
/// Carregado sob demanda, quando a folha de filtros abre: é uma leitura que
/// só interessa a quem foi filtrar, e cobrá-la na abertura da tela atrasaria
/// a lista por um dado que a maioria nunca usa.
final queueCustomersProvider =
    FutureProvider.autoDispose<List<MobileQueueCustomerContract>>(
      (ref) => ref.watch(fieldRepositoryProvider).queueCustomers(),
    );

class WorkQueueController extends StateNotifier<AsyncValue<WorkQueueState>> {
  WorkQueueController({
    required FieldRepository repository,
    required WorkQueueFilter filter,
    this.offlineItems,
  }) : _repository = repository,
       _filter = filter,
       super(const AsyncValue.loading()) {
    load();
  }

  final FieldRepository _repository;
  final WorkQueueFilter _filter;

  /// A projeção mantida pelo pull, para quando não houver rede.
  ///
  /// É a **última coisa que o servidor disse**, não uma verdade paralela: com
  /// rede, a resposta dele vence sempre. Serve para a fila não abrir vazia no
  /// meio de um prédio sem sinal.
  final Future<List<MobileWorkItemContract>> Function()? offlineItems;

  /// Guarda contra corrida de rolagem: enquanto uma página está no ar, outra
  /// não é pedida. Sem isso, um `scroll` rápido dispara a mesma página duas
  /// vezes e a lista ganha itens repetidos.
  bool _inFlight = false;

  /// Recomeça do zero — usado pelo pull-to-refresh e pela troca de filtro.
  Future<void> load() async {
    _inFlight = true;
    state = const AsyncValue.loading();
    try {
      final page = await _repository.workQueue(
        view: _filter.view,
        kind: _filter.kind,
        search: _filter.search,
        customerId: _filter.customerId,
        from: _filter.from,
        to: _filter.to,
      );
      state = AsyncValue.data(
        WorkQueueState(
          items: page.data,
          cursor: page.nextCursor,
          hasNextPage: page.hasNextPage,
        ),
      );
    } on Object catch (error, stack) {
      final cached = await _fromProjection(error);
      state = cached ?? AsyncValue.error(error, stack);
    } finally {
      _inFlight = false;
    }
  }

  /// A fila da projeção, quando a falha foi de rede.
  ///
  /// Só para falha de conexão: um 403 servido do cache esconderia justamente a
  /// informação de que a pessoa perdeu acesso ao trabalho.
  Future<AsyncValue<WorkQueueState>?> _fromProjection(Object error) async {
    if (error is! OrbitException || !error.isOffline) return null;
    final items = await offlineItems?.call() ?? const [];
    if (items.isEmpty) return null;

    /// Sem paginação: o que existe localmente é o que existe.
    return AsyncValue.data(
      WorkQueueState(
        items: items,
        cursor: null,
        hasNextPage: false,
        isOffline: true,
      ),
    );
  }

  /// Próxima página, uma de cada vez.
  Future<void> loadMore() async {
    final current = state.valueOrNull;
    if (current == null || !current.hasNextPage || _inFlight) return;

    _inFlight = true;
    state = AsyncValue.data(
      current.copyWith(isLoadingMore: true, clearError: true),
    );
    try {
      final page = await _repository.workQueue(
        view: _filter.view,
        kind: _filter.kind,
        search: _filter.search,
        customerId: _filter.customerId,
        from: _filter.from,
        to: _filter.to,
        cursor: current.cursor,
      );
      state = AsyncValue.data(
        current.copyWith(
          items: mergeWorkItems(current.items, page.data),
          cursor: page.nextCursor,
          hasNextPage: page.hasNextPage,
          isLoadingMore: false,
        ),
      );
    } on Object catch (error) {
      /// A falha de uma página não descarta o que já está na tela: o
      /// profissional continua vendo a fila e pode tentar de novo.
      state = AsyncValue.data(
        current.copyWith(isLoadingMore: false, error: error),
      );
    } finally {
      _inFlight = false;
    }
  }
}

/// Junta a página nova à lista, **preservando a ordem** e sem repetir.
///
/// A identidade é o ID canônico do item — nunca nome de cliente ou de
/// equipamento, que se repetem legitimamente: o mesmo cliente tem vários
/// atendimentos no mesmo dia.
///
/// Reenviar o mesmo cursor devolve a mesma página; aqui isso vira operação
/// sem efeito, em vez de duplicata.
List<MobileWorkItemContract> mergeWorkItems(
  List<MobileWorkItemContract> current,
  List<MobileWorkItemContract> incoming,
) {
  final seen = current.map((item) => item.id).toSet();
  return [...current, ...incoming.where((item) => seen.add(item.id))];
}

final workQueueControllerProvider =
    StateNotifierProvider.autoDispose<
      WorkQueueController,
      AsyncValue<WorkQueueState>
    >((ref) {
      final filter = ref.watch(workQueueFilterProvider);
      final scopeKey = fieldScopeKey(ref);
      return WorkQueueController(
        repository: ref.watch(fieldRepositoryProvider),
        filter: filter,
        offlineItems: () async =>
            (await ref.read(syncProjectionProvider).read()).itemsFor(scopeKey),
      );
    });

/* ------------------------------------------------------------------ */
/* Ponte agenda → item de trabalho                                     */
/* ------------------------------------------------------------------ */

/// De evento de agenda para item de trabalho.
///
/// A correspondência é publicada pelos dois lados: o item carrega
/// `schedulingId`, o evento carrega `eventId`. O app apenas casa os dois — não
/// remonta identidade, que é opaca por contrato.
///
/// Uma requisição indexa a fila inteira (o teto é 50). Nem todo evento tem
/// item: bloqueios de agenda e trabalho de outra pessoa existem legitimamente
/// no calendário e não viram fila de campo.
final agendaWorkItemIndexProvider =
    FutureProvider.autoDispose<Map<String, String>>((ref) async {
      final page = await ref
          .watch(fieldRepositoryProvider)
          .workQueue(limit: 50);
      return {
        for (final item in page.data)
          if (item.schedulingId case final String scheduling)
            scheduling: item.id,
      };
    });
