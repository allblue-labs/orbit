/// O que o aplicativo **escreve** sobre clientes e orçamentos.
///
/// Separado do read model de campo de propósito: aquele projeta a carteira a
/// partir do trabalho da pessoa e serve a todos; estes dois comandos exigem
/// permissão de gestão, e misturá-los faria a leitura carregar a autorização
/// da escrita.
library;

import '../../../core/network/orbit_api_client.dart';

class CustomerWriteRepository {
  const CustomerWriteRepository({required OrbitApiClient client})
    : _client = client;

  final OrbitApiClient _client;

  /// Cadastra um cliente. Só o mínimo que o domínio exige.
  ///
  /// Documento, endereço e contatos ficam de fora: o cadastro completo é uma
  /// tela de escritório, e pedi-lo inteiro num celular em campo é o caminho
  /// mais curto para ninguém cadastrar nada. O que falta se preenche depois.
  Future<String> createCustomer({
    required String type,
    required String legalName,
    String? tradeName,
    String? email,
    String? phone,
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
      },
    );
    return data['id'] as String? ?? '';
  }

  /// Abre um orçamento e adiciona as linhas.
  ///
  /// ## Por que duas chamadas, e o que acontece se a segunda falhar
  ///
  /// O contrato do servidor é assim: o orçamento nasce vazio e os itens
  /// entram depois. Não há um comando que faça as duas coisas, e inventar um
  /// "tudo ou nada" no aplicativo seria mentira — a primeira chamada já
  /// aconteceu.
  ///
  /// Então o orçamento é criado primeiro e o identificador é devolvido mesmo
  /// quando um item falha: um orçamento sem uma linha é recuperável na tela
  /// de orçamentos; um orçamento que a pessoa acha que não existe, não.
  Future<QuoteDraftResult> createQuote({
    required String customerId,
    required String title,
    String? businessUnitId,
    String? notes,
    required List<QuoteLine> items,
  }) async {
    final data = await _client.post<Map<String, dynamic>>(
      '/quotes',
      body: {
        'customerId': customerId,
        'title': title.trim(),
        if (businessUnitId != null) 'businessUnitId': businessUnitId,
        if (notes != null && notes.trim().isNotEmpty) 'notes': notes.trim(),
      },
    );
    final id = data['id'] as String? ?? '';

    var adicionados = 0;
    for (final linha in items) {
      await _client.post<Map<String, dynamic>>(
        '/quotes/$id/items',
        body: {
          'description': linha.description.trim(),
          'quantity': linha.quantity,
          'unitPrice': linha.unitPrice,
          if (linha.unit != null) 'unit': linha.unit,
        },
      );
      adicionados += 1;
    }

    return QuoteDraftResult(id: id, itemsAdded: adicionados);
  }
}

/// Uma linha do orçamento.
class QuoteLine {
  const QuoteLine({
    required this.description,
    required this.quantity,
    required this.unitPrice,
    this.unit,
  });

  final String description;
  final double quantity;
  final double unitPrice;
  final String? unit;

  double get total => quantity * unitPrice;
}

class QuoteDraftResult {
  const QuoteDraftResult({required this.id, required this.itemsAdded});

  final String id;
  final int itemsAdded;
}
