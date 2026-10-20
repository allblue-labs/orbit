/// Acesso à projeção de campo (MB-01).
///
/// Três endpoints, três leituras:
///
/// ```text
/// GET /mobile/field/home             → a tela inicial, agregada
/// GET /mobile/field/dashboard        → o dia do profissional, consolidado
/// GET /mobile/field/work-queue       → a fila, ordenada e paginada por cursor
/// GET /mobile/field/work-items/:id   → o contexto de um item
/// ```
///
/// O que **não** existe aqui é tão importante quanto o que existe: nenhuma
/// contagem é somada, nenhuma lista é reordenada e nenhum prazo é comparado.
/// O backend entrega o item já classificado, ordenado e autorizado.
library;

import '../../../core/contracts/mobile_field_contracts.dart';
import '../../../core/errors/orbit_exception.dart';
import '../../../core/network/orbit_api_client.dart';
import '../../../core/storage/read_cache.dart';
import '../../operations/data/operations_repository.dart' show CachedResult;

/// Recortes que a fila aceita — os mesmos do `MobileWorkQueueQueryDto`.
enum WorkQueueView { all, today, overdue, inProgress, upcoming }

const _viewCodes = <WorkQueueView, String>{
  WorkQueueView.all: 'ALL',
  WorkQueueView.today: 'TODAY',
  WorkQueueView.overdue: 'OVERDUE',
  WorkQueueView.inProgress: 'IN_PROGRESS',
  WorkQueueView.upcoming: 'UPCOMING',
};

const _kindCodes = <MobileWorkItemKind, String>{
  MobileWorkItemKind.serviceOperation: 'SERVICE_OPERATION',
  MobileWorkItemKind.pmoc: 'PMOC',
  MobileWorkItemKind.rvt: 'RVT',
};

class FieldRepository {
  const FieldRepository({
    required OrbitApiClient client,
    required ReadCache cache,
  }) : _client = client,
       _cache = cache;

  final OrbitApiClient _client;
  final ReadCache _cache;

  /// A tela inicial, numa requisição.
  ///
  /// O painel mais as duas listas curtas que a home mostra. Uma leitura só —
  /// pedir documentos recentes item a item transformaria a abertura do
  /// aplicativo numa cascata de chamadas.
  Future<CachedResult<MobileFieldHomeContract>> home({
    required String scopeKey,
  }) async {
    final key = 'field.home.$scopeKey';
    try {
      final data = await _client.get<Map<String, dynamic>>(
        '/mobile/field/home',
      );
      await _cache.write(key, data);
      return CachedResult(
        value: MobileFieldHomeContract.fromJson(data),
        cachedAt: null,
      );
    } on OrbitException catch (error) {
      if (!error.isOffline && !error.isServer) rethrow;
      final cached = await _cache.read(key);
      if (cached == null) rethrow;
      return CachedResult(
        value: MobileFieldHomeContract.fromJson(cached.value),
        cachedAt: cached.cachedAt,
      );
    }
  }

  /// O dashboard do dia.
  ///
  /// Uma requisição para toda a home. A chave de cache carrega o escopo —
  /// usuário, organização e unidade — porque um dashboard servido para o
  /// escopo errado mostraria o trabalho de outra pessoa.
  Future<CachedResult<MobileFieldDashboardContract>> dashboard({
    required String scopeKey,
  }) async {
    final key = 'field.dashboard.$scopeKey';
    try {
      final data = await _client.get<Map<String, dynamic>>(
        '/mobile/field/dashboard',
      );
      await _cache.write(key, data);
      return CachedResult(
        value: MobileFieldDashboardContract.fromJson(data),
        cachedAt: null,
      );
    } on OrbitException catch (error) {
      if (!error.isOffline && !error.isServer) rethrow;
      final cached = await _cache.read(key);
      if (cached == null) rethrow;
      return CachedResult(
        value: MobileFieldDashboardContract.fromJson(cached.value),
        cachedAt: cached.cachedAt,
      );
    }
  }

  /// Uma página da fila.
  ///
  /// `cursor` é o do servidor, opaco. Repetir a mesma página devolve os mesmos
  /// itens: o cursor aponta para o último item entregue, e a ordenação é
  /// determinística.
  Future<MobileWorkQueuePageContract> workQueue({
    WorkQueueView view = WorkQueueView.all,
    MobileWorkItemKind? kind,
    String? search,
    String? customerId,
    DateTime? from,
    DateTime? to,
    int limit = 20,
    String? cursor,
  }) async {
    final data = await _client.get<Map<String, dynamic>>(
      '/mobile/field/work-queue',
      query: {
        'view': _viewCodes[view],
        if (kind != null) 'kind': _kindCodes[kind],
        if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
        if (customerId != null) 'customerId': customerId,

        /// Data **civil**, sem hora e sem fuso: o servidor resolve a janela
        /// no fuso da unidade. Mandar um instante daqui faria o dia começar
        /// na hora do aparelho, e dois técnicos em fusos diferentes veriam
        /// listas diferentes para "hoje".
        if (from != null) 'from': _dataCivil(from),
        if (to != null) 'to': _dataCivil(to),
        'limit': limit,
        if (cursor != null) 'cursor': cursor,
      },
    );
    return MobileWorkQueuePageContract.fromJson(data);
  }

  static String _dataCivil(DateTime valor) =>
      '${valor.year.toString().padLeft(4, '0')}-'
      '${valor.month.toString().padLeft(2, '0')}-'
      '${valor.day.toString().padLeft(2, '0')}';

  /// Uma página da base de clientes, com o trabalho desta pessoa anotado.
  ///
  /// A busca vai ao servidor porque a base pode ter milhares: filtrar no
  /// aparelho exigiria trazer todos, e a primeira versão desta tela mostrava
  /// apenas 65 de 498 justamente por tentar derivar a lista localmente.
  Future<CachedResult<MobileFieldCustomerPageContract>> customers({
    required String scopeKey,
    String? search,
    String? cursor,
    int limit = 30,
  }) async {
    final key = 'field.customers.$scopeKey';
    final buscando = search != null && search.trim().isNotEmpty;
    try {
      final data = await _client.get<Map<String, dynamic>>(
        '/mobile/field/customers',
        query: {
          'limit': limit,
          if (buscando) 'search': search.trim(),
          if (cursor != null) 'cursor': cursor,
        },
      );

      /// Só a primeira página sem busca vira cache: é a que abre a tela
      /// offline. Guardar o resultado de uma busca faria a próxima abertura
      /// mostrar um recorte que ninguém pediu.
      if (!buscando && cursor == null) await _cache.write(key, data);
      return CachedResult(
        value: MobileFieldCustomerPageContract.fromJson(data),
        cachedAt: null,
      );
    } on OrbitException catch (error) {
      if (!error.isOffline && !error.isServer) rethrow;
      if (buscando || cursor != null) rethrow;
      final cached = await _cache.read(key);
      if (cached == null) rethrow;
      return CachedResult(
        value: MobileFieldCustomerPageContract.fromJson(cached.value),
        cachedAt: cached.cachedAt,
      );
    }
  }

  /// Os clientes com trabalho desta pessoa, para o filtro.
  Future<List<MobileQueueCustomerContract>> queueCustomers() async {
    final data = await _client.get<List<dynamic>>(
      '/mobile/field/queue-customers',
    );
    return data
        .whereType<Map<String, dynamic>>()
        .map(MobileQueueCustomerContract.fromJson)
        .toList(growable: false);
  }

  /// O contexto de um item. `null` quando o servidor devolve algo que esta
  /// versão do app não sabe representar.
  Future<MobileFieldContextContract?> workItem(String id) async {
    final data = await _client.get<Map<String, dynamic>>(
      '/mobile/field/work-items/${Uri.encodeComponent(id)}',
    );
    return MobileFieldContextContract.fromJson(data);
  }
}
