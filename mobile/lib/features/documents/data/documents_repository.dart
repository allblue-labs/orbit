/// Acesso à lista de documentos de campo.
///
/// ```text
/// GET /mobile/field/documents  → o que já foi emitido, paginado
/// ```
///
/// O rótulo de cada tipo (`Ordem de serviço`, `PMOC`, `RVT`) chega pronto do
/// servidor, e o estado de disponibilidade também. Este arquivo desserializa;
/// não traduz enum nem decide se um documento pode ser aberto.
library;

import '../../../core/contracts/mobile_field_contracts.dart';
import '../../../core/network/orbit_api_client.dart';

/// O recorte da lista. `todos` não manda filtro nenhum.
enum DocumentFilter { todos, ordemServico, pmoc, rvt }

const _filterCodes = <DocumentFilter, String?>{
  DocumentFilter.todos: null,
  DocumentFilter.ordemServico: 'SERVICE_ORDER',
  DocumentFilter.pmoc: 'PMOC',
  DocumentFilter.rvt: 'RVT',
};

const documentFilterLabels = <DocumentFilter, String>{
  DocumentFilter.todos: 'Todos',
  DocumentFilter.ordemServico: 'OS',
  DocumentFilter.pmoc: 'PMOC',
  DocumentFilter.rvt: 'RVT',
};

/// Uma página de documentos, como o servidor a entregou.
class DocumentsPage {
  const DocumentsPage({
    required this.data,
    required this.hasNextPage,
    this.nextCursor,
  });

  factory DocumentsPage.fromJson(Map<String, dynamic> json) {
    final meta = json['meta'] as Map<String, dynamic>? ?? const {};
    return DocumentsPage(
      data: (json['data'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(MobileRecentDocumentContract.fromJson)
          .toList(growable: false),
      nextCursor: meta['nextCursor'] as String?,
      hasNextPage: meta['hasNextPage'] as bool? ?? false,
    );
  }

  /// **Na ordem do servidor** — emissão mais recente primeiro.
  final List<MobileRecentDocumentContract> data;
  final String? nextCursor;
  final bool hasNextPage;
}

class DocumentsRepository {
  const DocumentsRepository({required OrbitApiClient client})
    : _client = client;

  final OrbitApiClient _client;

  Future<DocumentsPage> list({
    DocumentFilter filter = DocumentFilter.todos,
    String? search,
    DateTime? from,
    DateTime? to,
    int limit = 20,
    String? cursor,
  }) async {
    final data = await _client.get<Map<String, dynamic>>(
      '/mobile/field/documents',
      query: {
        if (_filterCodes[filter] case final String type) 'type': type,
        if (search != null && search.trim().isNotEmpty) 'search': search.trim(),

        /// Data civil: o servidor resolve a janela no fuso da unidade.
        if (from != null) 'from': _dataCivil(from),
        if (to != null) 'to': _dataCivil(to),
        'limit': limit,
        if (cursor != null) 'cursor': cursor,
      },
    );
    return DocumentsPage.fromJson(data);
  }

  static String _dataCivil(DateTime valor) =>
      '${valor.year.toString().padLeft(4, '0')}-'
      '${valor.month.toString().padLeft(2, '0')}-'
      '${valor.day.toString().padLeft(2, '0')}';
}
