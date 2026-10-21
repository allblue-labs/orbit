/// O atendimento avulso: abrir uma ordem estando no local.
///
/// ## O caso de uso
///
/// A fila responde "o que me foi atribuído". Não respondia "estou na porta de
/// alguém que não tem ordem aberta" — e isso é metade do dia de uma equipe de
/// campo. Sem este caminho, o trabalho acontecia e não existia no sistema:
/// nenhuma OS, nenhum documento, nenhuma comissão.
///
/// ## Três cadastros, uma chamada
///
/// Cliente (existente ou novo), equipamentos e ordem nascem juntos. Em três
/// chamadas, a queda da rede no meio deixaria um cliente cadastrado sem
/// atendimento — e o técnico sem saber o que já foi feito.
library;

/// Um cliente da carteira, no recorte que o roteiro de campo precisa.
class WalkInCustomerContract {
  const WalkInCustomerContract({
    required this.id,
    required this.legalName,
    required this.type,
    required this.addresses,
    this.tradeName,
    this.documentNumber,
    this.phone,
    this.email,
  });

  factory WalkInCustomerContract.fromJson(Map<String, dynamic> json) =>
      WalkInCustomerContract(
        id: json['id'] as String? ?? '',
        type: json['type'] as String? ?? 'COMPANY',
        legalName: json['legalName'] as String? ?? '',
        tradeName: json['tradeName'] as String?,
        documentNumber: json['documentNumber'] as String?,
        phone: json['phone'] as String?,
        email: json['email'] as String?,
        addresses: (json['addresses'] as List<dynamic>? ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(WalkInAddressContract.fromJson)
            .toList(growable: false),
      );

  final String id;
  final String type;
  final String legalName;
  final String? tradeName;
  final String? documentNumber;
  final String? phone;
  final String? email;
  final List<WalkInAddressContract> addresses;

  /// O nome que a equipe usa: fantasia quando existe, razão social quando não.
  String get displayName =>
      (tradeName?.trim().isNotEmpty ?? false) ? tradeName! : legalName;

  bool get isIndividual => type == 'INDIVIDUAL';
}

/// Um endereço de atendimento do cliente.
class WalkInAddressContract {
  const WalkInAddressContract({
    required this.id,
    required this.label,
    required this.street,
    required this.city,
    this.number,
    this.complement,
    this.district,
    this.stateCode,
    this.postalCode,
    this.reference,
  });

  factory WalkInAddressContract.fromJson(Map<String, dynamic> json) =>
      WalkInAddressContract(
        id: json['id'] as String? ?? '',
        label: json['label'] as String? ?? '',
        street: json['street'] as String? ?? '',
        number: json['number'] as String?,
        complement: json['complement'] as String?,
        district: json['district'] as String?,
        city: json['city'] as String? ?? '',
        stateCode: json['stateCode'] as String?,
        postalCode: json['postalCode'] as String?,
        reference: json['reference'] as String?,
      );

  final String id;
  final String label;
  final String street;
  final String? number;
  final String? complement;
  final String? district;
  final String city;
  final String? stateCode;
  final String? postalCode;

  /// Ponto de referência: em campo é o que de fato localiza.
  final String? reference;

  /// Uma linha, como alguém diria o endereço em voz alta.
  String get oneLine {
    final partes = <String>[
      [street, number].whereType<String>().where(_preenchido).join(', '),
      district ?? '',
      [city, stateCode].whereType<String>().where(_preenchido).join(' - '),
    ];
    return partes.where(_preenchido).join(' · ');
  }

  static bool _preenchido(String value) => value.trim().isNotEmpty;
}

/// Um equipamento já cadastrado do cliente.
class WalkInEquipmentContract {
  const WalkInEquipmentContract({
    required this.id,
    required this.name,
    this.category,
    this.manufacturer,
    this.model,
    this.serialNumber,
    this.identifier,
    this.location,
  });

  factory WalkInEquipmentContract.fromJson(Map<String, dynamic> json) =>
      WalkInEquipmentContract(
        id: json['id'] as String? ?? '',
        name: json['name'] as String? ?? '',
        category: json['category'] as String?,
        manufacturer: json['manufacturer'] as String?,
        model: json['model'] as String?,
        serialNumber: json['serialNumber'] as String?,
        identifier: json['identifier'] as String?,
        location: json['location'] as String?,
      );

  final String id;
  final String name;
  final String? category;
  final String? manufacturer;
  final String? model;
  final String? serialNumber;
  final String? identifier;
  final String? location;

  /// Marca, modelo e local, no que existir.
  String get subtitle => [
    manufacturer,
    model,
    location,
  ].where((part) => part?.trim().isNotEmpty ?? false).join(' · ');
}

/// O endereço que a consulta de CEP devolveu.
class PostalAddressContract {
  const PostalAddressContract({
    required this.postalCode,
    required this.street,
    required this.district,
    required this.city,
    required this.state,
    required this.stateCode,
    required this.country,
  });

  factory PostalAddressContract.fromJson(Map<String, dynamic> json) =>
      PostalAddressContract(
        postalCode: json['postalCode'] as String? ?? '',
        street: json['street'] as String? ?? '',
        district: json['district'] as String? ?? '',
        city: json['city'] as String? ?? '',
        state: json['state'] as String? ?? '',
        stateCode: json['stateCode'] as String? ?? '',
        country: json['country'] as String? ?? 'Brasil',
      );

  final String postalCode;
  final String street;
  final String district;
  final String city;
  final String state;
  final String stateCode;
  final String country;
}

/// A empresa que a consulta de CNPJ devolveu.
///
/// Cada campo pode vir ausente — é sugestão para preencher o formulário, não
/// cadastro. O que vier preenche; o resto segue editável.
class CompanyLookupContract {
  const CompanyLookupContract({
    required this.documentNumber,
    required this.legalName,
    required this.address,
    this.tradeName,
    this.email,
    this.phone,
    this.status,
  });

  factory CompanyLookupContract.fromJson(Map<String, dynamic> json) {
    final endereco = json['address'] as Map<String, dynamic>? ?? const {};
    return CompanyLookupContract(
      documentNumber: json['documentNumber'] as String? ?? '',
      legalName: json['legalName'] as String? ?? '',
      tradeName: json['tradeName'] as String?,
      email: json['email'] as String?,
      phone: json['phone'] as String?,
      status: json['status'] as String?,
      address: CompanyAddressContract.fromJson(endereco),
    );
  }

  final String documentNumber;
  final String legalName;
  final String? tradeName;
  final String? email;
  final String? phone;
  final String? status;
  final CompanyAddressContract address;
}

class CompanyAddressContract {
  const CompanyAddressContract({
    required this.postalCode,
    required this.street,
    required this.district,
    required this.city,
    required this.stateCode,
    this.number,
    this.complement,
  });

  factory CompanyAddressContract.fromJson(Map<String, dynamic> json) =>
      CompanyAddressContract(
        postalCode: json['postalCode'] as String? ?? '',
        street: json['street'] as String? ?? '',
        number: json['number'] as String?,
        complement: json['complement'] as String?,
        district: json['district'] as String? ?? '',
        city: json['city'] as String? ?? '',
        stateCode: json['stateCode'] as String? ?? '',
      );

  final String postalCode;
  final String street;
  final String? number;
  final String? complement;
  final String district;
  final String city;
  final String stateCode;
}

/// O que o comando devolveu: a ordem aberta, e se foi reenvio.
class WalkInResultContract {
  const WalkInResultContract({
    required this.operationId,
    required this.replayed,
  });

  factory WalkInResultContract.fromJson(Map<String, dynamic> json) {
    final idempotency =
        json['idempotency'] as Map<String, dynamic>? ?? const {};
    return WalkInResultContract(
      operationId: json['operationId'] as String? ?? '',
      replayed: idempotency['replayed'] as bool? ?? false,
    );
  }

  final String operationId;

  /// O servidor reconheceu a chave e devolveu a ordem que já existia.
  ///
  /// A tela usa isto para não anunciar "atendimento criado" duas vezes — e,
  /// principalmente, para não tentar criar um terceiro.
  final bool replayed;
}
