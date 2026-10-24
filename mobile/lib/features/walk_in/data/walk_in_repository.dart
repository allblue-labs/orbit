/// O transporte do atendimento avulso.
///
/// Quatro chamadas e nenhuma decisão: a carteira, os equipamentos de um
/// cliente, as duas consultas públicas que poupam digitação, e o comando que
/// abre a ordem.
library;

import '../../../core/contracts/walk_in_contracts.dart';
import '../../../core/network/orbit_api_client.dart';

class WalkInRepository {
  const WalkInRepository({required OrbitApiClient client}) : _client = client;

  final OrbitApiClient _client;

  /// Os clientes da carteira, filtrados pelo servidor.
  ///
  /// A busca é **do servidor**: carregar a carteira inteira para filtrar aqui
  /// pareceria mais simples até o primeiro cliente com dois mil cadastros.
  Future<List<WalkInCustomerContract>> customers({String? search}) async {
    final data = await _client.get<Map<String, dynamic>>(
      '/mobile/field/operations/walk-in/customers',
      query: {
        if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
      },
    );
    return (data['items'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(WalkInCustomerContract.fromJson)
        .toList(growable: false);
  }

  Future<List<WalkInEquipmentContract>> equipment(
    String customerId, {
    String? businessUnitId,
  }) async {
    final data = await _client.get<Map<String, dynamic>>(
      '/mobile/field/operations/walk-in/customers/$customerId/equipment',
      query: {if (businessUnitId != null) 'businessUnitId': businessUnitId},
    );
    return (data['items'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(WalkInEquipmentContract.fromJson)
        .toList(growable: false);
  }

  /// O endereço de um CEP.
  ///
  /// Pela API, e não pelo serviço externo: o aplicativo fala com o Orbit, e é
  /// o Orbit que conhece o provedor, o tempo limite e o que fazer quando ele
  /// está fora.
  Future<PostalAddressContract> postalCode(String value) async {
    final digits = value.replaceAll(RegExp(r'\D'), '');
    final data = await _client.get<Map<String, dynamic>>(
      '/lookups/postal-code/$digits',
    );
    return PostalAddressContract.fromJson(data);
  }

  Future<CompanyLookupContract> company(String documentNumber) async {
    final digits = documentNumber.replaceAll(RegExp(r'\D'), '');
    final data = await _client.get<Map<String, dynamic>>(
      '/lookups/company/$digits',
    );
    return CompanyLookupContract.fromJson(data);
  }

  /// Abre o atendimento.
  ///
  /// `idempotencyKey` é obrigatória e vem de quem chama, estável durante toda
  /// a sessão do roteiro: a resposta pode se perder na volta — é o caso normal
  /// com a rede oscilando na calçada — e tocar de novo não pode abrir a
  /// segunda ordem.
  Future<WalkInResultContract> create({
    required String idempotencyKey,
    String? customerId,
    Map<String, dynamic>? customer,
    List<String> assetIds = const [],
    List<Map<String, dynamic>> equipment = const [],
    String? businessUnitId,
    String? kind,
    String? title,
    String? description,
    String? priority,
    String? sector,
  }) async {
    final data = await _client.post<Map<String, dynamic>>(
      '/mobile/field/operations/walk-in',
      headers: {'Idempotency-Key': idempotencyKey},
      body: {
        if (customerId != null) 'customerId': customerId,
        if (customer != null) 'customer': customer,
        if (assetIds.isNotEmpty) 'assetIds': assetIds,
        if (equipment.isNotEmpty) 'equipment': equipment,
        if (businessUnitId != null) 'businessUnitId': businessUnitId,
        if (kind != null) 'kind': kind,
        if (title != null && title.trim().isNotEmpty) 'title': title.trim(),
        if (description != null && description.trim().isNotEmpty)
          'description': description.trim(),
        if (priority != null) 'priority': priority,
        if (sector != null && sector.trim().isNotEmpty) 'sector': sector.trim(),
      },
    );
    return WalkInResultContract.fromJson(data);
  }
}
