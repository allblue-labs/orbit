/// O rascunho do atendimento avulso, e o corpo que ele produz.
///
/// ## Por que fora da tela
///
/// Porque a decisão de **o que enviar** tem regras, e elas erram em silêncio:
/// mandar um endereço só com CEP cadastra um endereço que não diz onde é;
/// mandar `customerId` junto com os dados de um cliente novo faz o servidor
/// recusar depois de a pessoa ter preenchido tudo; mandar um equipamento sem
/// nome cria um aparelho anônimo no parque do cliente.
///
/// Numa `State` de widget isso não tem teste. Aqui tem.
library;

/// De onde vem o cliente deste atendimento.
enum WalkInOrigin {
  /// Já está na carteira.
  existing,

  /// Vai ser cadastrado agora.
  fresh,
}

/// Um equipamento que o técnico identificou na hora.
class WalkInEquipmentDraft {
  const WalkInEquipmentDraft({
    required this.name,
    this.category,
    this.manufacturer,
    this.model,
    this.serialNumber,
    this.location,
  });

  final String name;
  final String? category;
  final String? manufacturer;
  final String? model;
  final String? serialNumber;
  final String? location;

  /// Só o nome é exigido: "Split do quarto" já identifica o aparelho para quem
  /// está no local. A placa com o número de série costuma estar atrás da
  /// condensadora, no telhado.
  bool get isUsable => name.trim().isNotEmpty;

  Map<String, dynamic> toJson() => {
    'name': name.trim(),
    ..._opcional('category', category),
    ..._opcional('manufacturer', manufacturer),
    ..._opcional('model', model),
    ..._opcional('serialNumber', serialNumber),
    ..._opcional('location', location),
  };
}

/// O endereço preenchido na calçada.
class WalkInAddressDraft {
  const WalkInAddressDraft({
    this.postalCode,
    this.street,
    this.number,
    this.complement,
    this.district,
    this.city,
    this.state,
    this.stateCode,
    this.reference,
  });

  final String? postalCode;
  final String? street;
  final String? number;
  final String? complement;
  final String? district;
  final String? city;
  final String? state;
  final String? stateCode;

  /// Ponto de referência — em campo é o que de fato localiza.
  final String? reference;

  /// Há algo que valha enviar?
  ///
  /// Um endereço só com CEP não é endereço: o servidor o guardaria como texto
  /// livre do cliente e a aba Endereços mostraria uma linha que não diz onde é.
  bool get hasAnything => [
    postalCode,
    street,
    number,
    complement,
    district,
    city,
    state,
    stateCode,
    reference,
  ].any((value) => value?.trim().isNotEmpty ?? false);

  Map<String, dynamic> toJson() => {
    ..._opcional('postalCode', postalCode),
    ..._opcional('street', street),
    ..._opcional('number', number),
    ..._opcional('complement', complement),
    ..._opcional('district', district),
    ..._opcional('city', city),
    ..._opcional('state', state),
    ..._opcional('stateCode', stateCode),
    ..._opcional('reference', reference),
  };
}

/// O cliente que vai ser cadastrado agora.
class WalkInCustomerDraft {
  const WalkInCustomerDraft({
    required this.type,
    required this.legalName,
    this.tradeName,
    this.documentNumber,
    this.email,
    this.phone,
    this.contactName,
    this.address,
  });

  /// `COMPANY` ou `INDIVIDUAL`.
  final String type;
  final String legalName;
  final String? tradeName;
  final String? documentNumber;
  final String? email;
  final String? phone;
  final String? contactName;
  final WalkInAddressDraft? address;

  /// Um cliente sem nome não é cadastro: é uma linha anônima na carteira.
  bool get isUsable => legalName.trim().length >= 2;

  Map<String, dynamic> toJson() => {
    'type': type,
    'legalName': legalName.trim(),
    ..._opcional('tradeName', tradeName),
    ..._opcional('documentNumber', documentNumber),
    ..._opcional('email', email),
    ..._opcional('phone', phone),
    ..._opcional('contactName', contactName),
    if (address?.hasAnything ?? false) 'address': address!.toJson(),
  };
}

/// O rascunho inteiro.
class WalkInDraft {
  const WalkInDraft({
    required this.origin,
    this.customerId,
    this.customer,
    this.assetIds = const [],
    this.equipment = const [],
    this.kind = 'MAINTENANCE',
    this.title,
    this.description,
    this.priority,
    this.sector,
  });

  final WalkInOrigin origin;

  /// O cliente escolhido na carteira. Preenchido só quando `origin` é
  /// `existing`.
  final String? customerId;

  /// O cliente a cadastrar. Preenchido só quando `origin` é `fresh`.
  final WalkInCustomerDraft? customer;

  final List<String> assetIds;
  final List<WalkInEquipmentDraft> equipment;

  final String kind;
  final String? title;
  final String? description;
  final String? priority;
  final String? sector;

  /// Os equipamentos que vale enviar: nome em branco não vira aparelho.
  List<WalkInEquipmentDraft> get usableEquipment =>
      equipment.where((item) => item.isUsable).toList(growable: false);

  /// O rascunho está pronto para abrir o atendimento?
  ///
  /// Equipamento é **opcional** de propósito: o técnico pode abrir a ordem e
  /// identificar os aparelhos depois, dentro do roteiro. Exigir um aparelho
  /// aqui travaria o caso de "fui olhar e o problema é a rede elétrica".
  bool get isReady => switch (origin) {
    WalkInOrigin.existing => (customerId?.isNotEmpty ?? false),
    WalkInOrigin.fresh => customer?.isUsable ?? false,
  };

  /// Por que ainda não dá para abrir, na frase de quem está em campo.
  String? get blockedReason {
    if (isReady) return null;
    return switch (origin) {
      WalkInOrigin.existing => 'Escolha o cliente deste atendimento.',
      WalkInOrigin.fresh => 'Informe ao menos o nome do cliente.',
    };
  }

  /// O corpo do comando.
  ///
  /// `customerId` e `customer` são mutuamente exclusivos: o servidor recusa os
  /// dois juntos, e deixar essa recusa para a resposta faria a pessoa descobrir
  /// o erro depois de preencher o formulário inteiro.
  Map<String, dynamic> toJson() => {
    if (origin == WalkInOrigin.existing && customerId != null)
      'customerId': customerId,
    if (origin == WalkInOrigin.fresh && customer != null)
      'customer': customer!.toJson(),
    if (origin == WalkInOrigin.existing && assetIds.isNotEmpty)
      'assetIds': assetIds,
    if (usableEquipment.isNotEmpty)
      'equipment': usableEquipment
          .map((item) => item.toJson())
          .toList(growable: false),
    'kind': kind,
    ..._opcional('title', title),
    ..._opcional('description', description),
    ..._opcional('priority', priority),
    ..._opcional('sector', sector),
  };
}

/// Inclui a chave só quando há texto: `''` sobrescreveria o cadastro com nada.
Map<String, dynamic> _opcional(String key, String? value) {
  final limpo = value?.trim();
  return limpo != null && limpo.isNotEmpty ? {key: limpo} : const {};
}
