/// Contratos da área do cliente.
///
/// Espelham `backend/src/modules/customer-portal/*.read-models.ts`. Só o que
/// a área do cliente mostra: o servidor publica mais, e o app ignora o resto
/// em vez de fingir que usa.
library;

String _str(Object? value, [String fallback = '']) =>
    value is String ? value : fallback;
String? _strOrNull(Object? value) =>
    value is String && value.isNotEmpty ? value : null;
int _int(Object? value) => value is num ? value.toInt() : 0;
DateTime? _date(Object? value) =>
    value is String ? DateTime.tryParse(value)?.toLocal() : null;
Map<String, dynamic> _map(Object? value) =>
    value is Map<String, dynamic> ? value : const {};
List<Map<String, dynamic>> _list(Object? value) => value is List
    ? value.whereType<Map<String, dynamic>>().toList(growable: false)
    : const [];

/// Quem entrou: o cliente, da organização que o atende.
class PortalMe {
  const PortalMe({
    required this.identityId,
    required this.displayName,
    required this.email,
    required this.organizationName,
    required this.organizationSlug,
    required this.customerId,
    required this.customerName,
    required this.mustChangePassword,
  });

  factory PortalMe.fromJson(Map<String, dynamic> json) {
    final identity = _map(json['identity']);
    final organization = _map(json['organization']);
    final customer = _map(json['customer']);
    return PortalMe(
      identityId: _str(identity['id']),
      displayName: _str(identity['displayName']),
      email: _str(identity['email']),
      organizationName: _str(organization['displayName']),
      organizationSlug: _str(organization['slug']),
      customerId: _str(customer['id']),
      customerName: _str(customer['displayName']),
      mustChangePassword: json['mustChangePassword'] == true,
    );
  }

  final String identityId;
  final String displayName;
  final String email;
  final String organizationName;
  final String organizationSlug;
  final String customerId;
  final String customerName;
  final bool mustChangePassword;

  PortalMe copyWith({bool? mustChangePassword}) => PortalMe(
    identityId: identityId,
    displayName: displayName,
    email: email,
    organizationName: organizationName,
    organizationSlug: organizationSlug,
    customerId: customerId,
    customerName: customerName,
    mustChangePassword: mustChangePassword ?? this.mustChangePassword,
  );
}

class PortalStatus {
  const PortalStatus({required this.code, required this.label});

  factory PortalStatus.fromJson(Object? json) {
    final map = _map(json);
    return PortalStatus(code: _str(map['code']), label: _str(map['label']));
  }

  final String code;
  final String label;
}

class PortalPage<T> {
  const PortalPage({
    required this.items,
    required this.total,
    required this.hasNextPage,
  });

  factory PortalPage.fromJson(
    Map<String, dynamic> json,
    T Function(Map<String, dynamic>) item,
  ) {
    final meta = _map(json['meta']);
    return PortalPage(
      items: _list(json['data']).map(item).toList(growable: false),
      total: _int(meta['total']),
      hasNextPage: meta['hasNextPage'] == true,
    );
  }

  final List<T> items;
  final int total;
  final bool hasNextPage;
}

class PortalSummary {
  const PortalSummary({
    required this.recentOperations,
    required this.assets,
    required this.activePmocPlans,
    required this.upcomingVisits,
    required this.availableDocuments,
  });

  factory PortalSummary.fromJson(Map<String, dynamic> json) => PortalSummary(
    recentOperations: _int(json['recentOperations']),
    assets: _int(json['assets']),
    activePmocPlans: _int(json['activePmocPlans']),
    upcomingVisits: _int(json['upcomingVisits']),
    availableDocuments: _int(json['availableDocuments']),
  );

  final int recentOperations;
  final int assets;
  final int activePmocPlans;
  final int upcomingVisits;
  final int availableDocuments;
}

class PortalNamedRef {
  const PortalNamedRef({required this.id, required this.name});

  factory PortalNamedRef.fromJson(Map<String, dynamic> json) =>
      PortalNamedRef(id: _str(json['id']), name: _str(json['displayName']));

  final String id;
  final String name;
}

class PortalTimelineEvent {
  const PortalTimelineEvent({
    required this.id,
    required this.event,
    required this.description,
    required this.occurredAt,
  });

  factory PortalTimelineEvent.fromJson(Map<String, dynamic> json) =>
      PortalTimelineEvent(
        id: _str(json['id']),
        event: _str(json['event']),
        description: _str(json['description']),
        occurredAt: _date(json['occurredAt']),
      );

  final String id;
  final String event;
  final String description;
  final DateTime? occurredAt;
}

/// Um atendimento do cliente — lista e detalhe usam o mesmo tipo.
class PortalOperation {
  const PortalOperation({
    required this.id,
    required this.code,
    required this.type,
    required this.title,
    required this.status,
    required this.scheduledStart,
    required this.completedAt,
    required this.unitName,
    required this.assets,
    required this.technician,
    required this.location,
    required this.documentId,
    this.description,
    this.startedAt,
    this.timeline = const [],
  });

  factory PortalOperation.fromJson(Map<String, dynamic> json) =>
      PortalOperation(
        id: _str(json['id']),
        code: _str(json['code']),
        type: _str(json['type']),
        title: _str(json['title']),
        status: PortalStatus.fromJson(json['status']),
        scheduledStart: _date(json['scheduledStart']),
        completedAt: _date(json['completedAt']),
        unitName: _str(_map(json['businessUnit'])['displayName']),
        assets: _list(
          json['assets'],
        ).map(PortalNamedRef.fromJson).toList(growable: false),
        technician: _strOrNull(
          _map(json['responsibleTechnician'])['displayName'],
        ),
        location: _strOrNull(json['location']),
        documentId: _strOrNull(json['documentId']),
        description: _strOrNull(json['description']),
        startedAt: _date(json['startedAt']),
        timeline: _list(
          json['timeline'],
        ).map(PortalTimelineEvent.fromJson).toList(growable: false),
      );

  final String id;
  final String code;
  final String type;
  final String title;
  final PortalStatus status;
  final DateTime? scheduledStart;
  final DateTime? completedAt;
  final String unitName;
  final List<PortalNamedRef> assets;
  final String? technician;
  final String? location;

  /// O documento do atendimento, pronto para abrir. `null` enquanto não há.
  final String? documentId;
  final String? description;
  final DateTime? startedAt;
  final List<PortalTimelineEvent> timeline;

  /// A data que importa para quem lê: quando foi feito, ou quando vai ser.
  DateTime? get when => completedAt ?? scheduledStart;
}

class PortalAsset {
  const PortalAsset({
    required this.id,
    required this.name,
    required this.category,
    required this.manufacturer,
    required this.model,
    required this.serialNumber,
    required this.identifier,
    required this.location,
    required this.status,
    this.installedOn,
    this.warrantyUntil,
    this.relatedOperations,
    this.relatedDocuments,
  });

  factory PortalAsset.fromJson(Map<String, dynamic> json) {
    final related = _map(json['related']);
    return PortalAsset(
      id: _str(json['id']),
      name: _str(json['displayName']),
      category: _str(json['category']),
      manufacturer: _strOrNull(json['manufacturer']),
      model: _strOrNull(json['model']),
      serialNumber: _strOrNull(json['serialNumber']),
      identifier: _strOrNull(json['identifier']),
      location: _strOrNull(json['location']),
      status: PortalStatus.fromJson(json['status']),
      installedOn: _strOrNull(json['installedOn']),
      warrantyUntil: _strOrNull(json['warrantyUntil']),
      relatedOperations: related.isEmpty ? null : _int(related['operations']),
      relatedDocuments: related.isEmpty ? null : _int(related['documents']),
    );
  }

  final String id;
  final String name;
  final String category;
  final String? manufacturer;
  final String? model;
  final String? serialNumber;
  final String? identifier;
  final String? location;
  final PortalStatus status;
  final String? installedOn;
  final String? warrantyUntil;
  final int? relatedOperations;
  final int? relatedDocuments;

  /// "Daikin · FTXS35" — fabricante e modelo, o que existir.
  String? get makeAndModel {
    final partes = [manufacturer, model].whereType<String>().toList();
    return partes.isEmpty ? null : partes.join(' · ');
  }
}

/// As quatro categorias que o servidor publica, na ordem dos filtros.
enum PortalDocumentCategory {
  service('service', 'Atendimentos'),
  pmoc('pmoc', 'PMOC'),
  quote('quote', 'Orçamentos'),
  receipt('receipt', 'Recibos');

  const PortalDocumentCategory(this.code, this.label);
  final String code;
  final String label;

  static PortalDocumentCategory of(String code) => values.firstWhere(
    (value) => value.code == code,
    orElse: () => PortalDocumentCategory.service,
  );
}

class PortalDocument {
  const PortalDocument({
    required this.id,
    required this.fileName,
    required this.title,
    required this.code,
    required this.category,
    required this.categoryLabel,
    required this.operationId,
    required this.issuedAt,
    required this.sizeBytes,
  });

  factory PortalDocument.fromJson(Map<String, dynamic> json) => PortalDocument(
    id: _str(json['id']),
    fileName: _str(json['fileName'], 'documento.pdf'),
    title: _str(json['title'], _str(json['source'])),
    code: _str(json['code']),
    category: PortalDocumentCategory.of(_str(json['category'])),
    categoryLabel: _str(json['categoryLabel'], _str(json['type'])),
    operationId: _strOrNull(json['operationId']),
    issuedAt: _date(json['issuedAt']),
    sizeBytes: _int(json['sizeBytes']),
  );

  final String id;
  final String fileName;
  final String title;
  final String code;
  final PortalDocumentCategory category;
  final String categoryLabel;
  final String? operationId;
  final DateTime? issuedAt;
  final int sizeBytes;
}

class PortalMedia {
  const PortalMedia({required this.available, this.url, this.updatedAt});

  factory PortalMedia.fromJson(Object? json) {
    final map = _map(json);
    return PortalMedia(
      available: map['available'] == true,
      url: _strOrNull(map['url']),
      updatedAt: _date(map['updatedAt']),
    );
  }

  static const none = PortalMedia(available: false);

  final bool available;
  final String? url;
  final DateTime? updatedAt;
}

class PortalProfile {
  const PortalProfile({required this.avatar, required this.signature});

  factory PortalProfile.fromJson(Map<String, dynamic> json) => PortalProfile(
    avatar: PortalMedia.fromJson(json['avatar']),
    signature: PortalMedia.fromJson(json['signature']),
  );

  static const empty = PortalProfile(
    avatar: PortalMedia.none,
    signature: PortalMedia.none,
  );

  final PortalMedia avatar;
  final PortalMedia signature;
}

/// O acesso do cliente como o owner vê — gestão pela ficha do cliente.
class CustomerAccessIdentity {
  const CustomerAccessIdentity({
    required this.id,
    required this.email,
    required this.displayName,
    required this.status,
    required this.mustChangePassword,
    required this.lastLoginAt,
  });

  factory CustomerAccessIdentity.fromJson(Map<String, dynamic> json) =>
      CustomerAccessIdentity(
        id: _str(json['id']),
        email: _str(json['email']),
        displayName: _str(json['displayName']),
        status: _str(json['status']),
        mustChangePassword: json['mustChangePassword'] == true,
        lastLoginAt: _date(json['lastLoginAt']),
      );

  final String id;
  final String email;
  final String displayName;

  /// `active`, `invited` ou `disabled`.
  final String status;
  final bool mustChangePassword;
  final DateTime? lastLoginAt;

  bool get isActive => status == 'active';
}

class CustomerAccess {
  const CustomerAccess({
    required this.domain,
    required this.suggestedLocalPart,
    required this.identity,
  });

  factory CustomerAccess.fromJson(Map<String, dynamic> json) => CustomerAccess(
    domain: _strOrNull(json['domain']),
    suggestedLocalPart: _str(json['suggestedLocalPart']),
    identity: json['identity'] is Map<String, dynamic>
        ? CustomerAccessIdentity.fromJson(
            json['identity'] as Map<String, dynamic>,
          )
        : null,
  );

  final String? domain;
  final String suggestedLocalPart;
  final CustomerAccessIdentity? identity;
}

/// Criar acesso ou gerar nova senha: a senha aparece uma vez.
class CustomerAccessCredentials {
  const CustomerAccessCredentials({
    required this.identity,
    required this.temporaryPassword,
  });

  factory CustomerAccessCredentials.fromJson(Map<String, dynamic> json) =>
      CustomerAccessCredentials(
        identity: CustomerAccessIdentity.fromJson(_map(json['identity'])),
        temporaryPassword: _str(json['temporaryPassword']),
      );

  final CustomerAccessIdentity identity;
  final String temporaryPassword;
}
