/// Escrita do cadastro de clientes. Orçamentos usam o fluxo comercial de campo.
library;

import '../../../core/network/orbit_api_client.dart';

class CustomerWriteRepository {
  const CustomerWriteRepository({required OrbitApiClient client})
    : _client = client;

  final OrbitApiClient _client;

  /// Cadastra os dados básicos e inclui o endereço somente quando escolhido.
  Future<String> createCustomer({
    required String type,
    required String legalName,
    String? tradeName,
    String? email,
    String? phone,
    Map<String, String>? address,
  }) async {
    final data = await _client.post<Map<String, dynamic>>(
      '/customers',
      body: {
        'type': type,
        'legalName': legalName.trim(),
        if (tradeName != null && tradeName.trim().isNotEmpty)
          'tradeName': tradeName.trim(),
        if (email != null && email.trim().isNotEmpty) 'email': email.trim(),
        if (phone != null && phone.trim().isNotEmpty) 'phone': phone.trim(),
        if (address != null && address.isNotEmpty) 'address': address,
      },
    );
    return data['id'] as String? ?? '';
  }
}

/// Uma linha do orçamento.
class QuoteLine {
  const QuoteLine({
    required this.description,
    required this.quantity,
    required this.unitPrice,
    this.unit,
    this.catalogItemId,
  });

  final String description;
  final double quantity;
  final double unitPrice;
  final String? unit;
  final String? catalogItemId;

  double get total => quantity * unitPrice;
}
