/// Public contracts for authenticated Equipment QR field resolution.
///
/// The QR token is a physical lookup key, never an authorization grant. Mobile
/// must render only `allowedActions` returned by the backend.
enum EquipmentFieldAction {
  viewDetails,
  startServiceOrder,
  executePmoc,
  addToRvt,
  viewHistory,
}

/// Traduz o código publicado para o enum interno.
///
/// Código desconhecido devolve `null` e some da lista: uma ação que este app
/// não sabe executar não deve virar botão. Quem chega com o app atualizado a
/// verá.
EquipmentFieldAction? equipmentFieldActionFrom(String value) => switch (value) {
  'VIEW_DETAILS' => EquipmentFieldAction.viewDetails,
  'START_SERVICE_ORDER' => EquipmentFieldAction.startServiceOrder,
  'EXECUTE_PMOC' => EquipmentFieldAction.executePmoc,
  'ADD_TO_RVT' => EquipmentFieldAction.addToRvt,
  'VIEW_HISTORY' => EquipmentFieldAction.viewHistory,
  _ => null,
};

class EquipmentPmocContextContract {
  const EquipmentPmocContextContract({
    required this.planId,
    required this.planName,
    required this.eligible,
    this.cycleId,
    this.dueOn,
    this.blockedReason,
  });

  factory EquipmentPmocContextContract.fromJson(Map<String, dynamic> json) =>
      EquipmentPmocContextContract(
        planId: json['planId'] as String? ?? '',
        planName: json['planName'] as String? ?? '',
        cycleId: json['cycleId'] as String?,
        dueOn: DateTime.tryParse(json['dueOn'] as String? ?? ''),
        eligible: json['eligible'] as bool? ?? false,
        blockedReason: json['blockedReason'] as String?,
      );

  final String planId;
  final String planName;
  final String? cycleId;
  final DateTime? dueOn;
  final bool eligible;
  final String? blockedReason;
}

/// Resumo do cliente, como o contexto de campo o publica.
class EquipmentFieldCustomerContract {
  const EquipmentFieldCustomerContract({
    required this.id,
    required this.name,
    this.contactName,
    this.contactPhone,
  });

  factory EquipmentFieldCustomerContract.fromJson(Map<String, dynamic> json) {
    final contact = json['contact'] as Map<String, dynamic>?;
    return EquipmentFieldCustomerContract(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      contactName: contact?['name'] as String?,
      contactPhone: contact?['phone'] as String?,
    );
  }

  final String id;
  final String name;
  final String? contactName;
  final String? contactPhone;
}

/// O último atendimento registrado no equipamento.
class EquipmentLastServiceContract {
  const EquipmentLastServiceContract({
    required this.date,
    required this.type,
    required this.status,
  });

  factory EquipmentLastServiceContract.fromJson(Map<String, dynamic> json) =>
      EquipmentLastServiceContract(
        date: DateTime.tryParse(json['date'] as String? ?? ''),
        type: json['type'] as String? ?? '',
        status: json['status'] as String? ?? '',
      );

  /// Instante — quando aconteceu.
  final DateTime? date;
  final String type;
  final String status;
}

/// Disponibilidade operacional do equipamento.
class EquipmentAvailabilityContract {
  const EquipmentAvailabilityContract({
    required this.active,
    required this.rvtExecutionIds,
  });

  factory EquipmentAvailabilityContract.fromJson(Map<String, dynamic> json) =>
      EquipmentAvailabilityContract(
        active: json['active'] as bool? ?? false,
        rvtExecutionIds: (json['rvtExecutionIds'] as List<dynamic>? ?? const [])
            .whereType<String>()
            .toList(growable: false),
      );

  final bool active;

  /// Visitas técnicas em aberto que já incluem este equipamento.
  final List<String> rvtExecutionIds;
}

/// O contexto de campo de um equipamento (`EquipmentFieldDetailsReadModel`).
///
/// Espelha o Read Model **inteiro**. A versão anterior deste arquivo declarava
/// só metade dos campos: cliente, setor, último atendimento, próxima
/// manutenção, contextos de PMOC e disponibilidade simplesmente não existiam
/// aqui. O app compilava, os testes passavam, e o dado chegava do servidor para
/// ser descartado em silêncio — o tipo de falha que só aparece quando alguém
/// pergunta por que a tela está vazia.
class EquipmentQrResolvedContract {
  const EquipmentQrResolvedContract({
    required this.id,
    required this.code,
    required this.name,
    required this.type,
    required this.status,
    required this.allowedActions,
    required this.pmocExecutableContexts,
    required this.availability,
    this.brand,
    this.model,
    this.serialNumber,
    this.serviceLocation,
    this.sector,
    this.customer,
    this.lastService,
    this.nextMaintenance,
  });

  factory EquipmentQrResolvedContract.fromJson(Map<String, dynamic> json) =>
      EquipmentQrResolvedContract(
        id: json['id'] as String? ?? '',
        code: json['code'] as String? ?? '',
        name: json['name'] as String? ?? '',
        type: json['type'] as String? ?? '',
        status: json['status'] as String? ?? '',
        brand: json['brand'] as String?,
        model: json['model'] as String?,
        serialNumber: json['serialNumber'] as String?,
        serviceLocation: json['serviceLocation'] as String?,
        sector: json['sector'] as String?,
        customer: json['customer'] == null
            ? null
            : EquipmentFieldCustomerContract.fromJson(
                json['customer'] as Map<String, dynamic>,
              ),
        lastService: json['lastService'] == null
            ? null
            : EquipmentLastServiceContract.fromJson(
                json['lastService'] as Map<String, dynamic>,
              ),
        nextMaintenance: DateTime.tryParse(
          json['nextMaintenance'] as String? ?? '',
        ),
        pmocExecutableContexts:
            (json['pmocExecutableContexts'] as List<dynamic>? ?? const [])
                .whereType<Map<String, dynamic>>()
                .map(EquipmentPmocContextContract.fromJson)
                .toList(growable: false),
        allowedActions: (json['allowedActions'] as List<dynamic>? ?? const [])
            .whereType<String>()
            .map(equipmentFieldActionFrom)
            .whereType<EquipmentFieldAction>()
            .toList(growable: false),
        availability: EquipmentAvailabilityContract.fromJson(
          json['availability'] as Map<String, dynamic>? ?? const {},
        ),
      );

  final String id;
  final String code;
  final String name;
  final String type;
  final String status;
  final String? brand;
  final String? model;
  final String? serialNumber;
  final String? serviceLocation;
  final String? sector;
  final EquipmentFieldCustomerContract? customer;
  final EquipmentLastServiceContract? lastService;

  /// Instante do próximo vencimento, quando o servidor o conhece.
  final DateTime? nextMaintenance;
  final List<EquipmentPmocContextContract> pmocExecutableContexts;

  /// **A autoridade sobre o que pode ser feito.** O app renderiza esta lista;
  /// não a deduz do status nem a completa.
  final List<EquipmentFieldAction> allowedActions;
  final EquipmentAvailabilityContract availability;
}

class EquipmentServiceOrderPreparationContract {
  const EquipmentServiceOrderPreparationContract({
    required this.equipmentId,
    required this.businessUnitId,
    required this.operationCreated,
    this.customerId,
    this.address,
    this.serviceLocation,
  });

  final String equipmentId;
  final String businessUnitId;
  final String? customerId;
  final Map<String, Object?>? address;
  final String? serviceLocation;
  final bool operationCreated;
}

class RvtAddExistingEquipmentContextContract {
  const RvtAddExistingEquipmentContextContract({
    required this.executionId,
    required this.equipmentId,
  });

  final String executionId;
  final String equipmentId;
}
