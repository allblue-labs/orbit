/// Contratos do módulo Operations.
///
/// Espelham `operation.repository.ts` (`operationInclude`), `operation.dto.ts`
/// e `checklist.repository.ts`. O backend devolve payloads do Prisma sem
/// exportar tipos, então as classes abaixo reproduzem o `include`/`select`.
library;

/// Página de resultados (`PaginationHelper.result`).
class Paginated<T> {
  const Paginated({
    required this.data,
    required this.page,
    required this.limit,
    required this.total,
    required this.totalPages,
    required this.hasNextPage,
    required this.hasPreviousPage,
  });

  factory Paginated.fromJson(
    Map<String, dynamic> json,
    T Function(Map<String, dynamic>) parse,
  ) {
    final meta = json['meta'] as Map<String, dynamic>? ?? const {};
    return Paginated<T>(
      data: (json['data'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(parse)
          .toList(growable: false),
      page: (meta['page'] as num?)?.toInt() ?? 1,
      limit: (meta['limit'] as num?)?.toInt() ?? 20,
      total: (meta['total'] as num?)?.toInt() ?? 0,
      totalPages: (meta['totalPages'] as num?)?.toInt() ?? 1,
      hasNextPage: meta['hasNextPage'] as bool? ?? false,
      hasPreviousPage: meta['hasPreviousPage'] as bool? ?? false,
    );
  }

  /// Página vazia, para quando o backend recusa o acesso e a seção some.
  const Paginated.empty()
    : data = const [],
      page = 1,
      limit = 0,
      total = 0,
      totalPages = 1,
      hasNextPage = false,
      hasPreviousPage = false;

  final List<T> data;
  final int page;
  final int limit;
  final int total;
  final int totalPages;
  final bool hasNextPage;
  final bool hasPreviousPage;

  bool get isEmpty => data.isEmpty;
}

/// Literais de `contracts/literals` no backend.
abstract final class OperationStatus {
  static const open = 'OPEN';
  static const scheduled = 'SCHEDULED';
  static const inProgress = 'IN_PROGRESS';
  static const paused = 'PAUSED';
  static const completed = 'COMPLETED';
  static const cancelled = 'CANCELLED';

  static const all = [
    open,
    scheduled,
    inProgress,
    paused,
    completed,
    cancelled,
  ];

  static const labels = <String, String>{
    open: 'Aberta',
    scheduled: 'Agendada',
    inProgress: 'Em execução',
    paused: 'Pausada',
    completed: 'Concluída',
    cancelled: 'Cancelada',
  };

  static String label(String status) => labels[status] ?? status;
}

abstract final class OperationKind {
  static const labels = <String, String>{
    'INSTALLATION': 'Instalação',
    'MAINTENANCE': 'Manutenção',
    'INSPECTION': 'Inspeção',
    'DELIVERY': 'Entrega',
    'OTHER': 'Outra',
  };

  static String label(String kind) => labels[kind] ?? kind;
}

abstract final class OperationPriority {
  static const labels = <String, String>{
    'LOW': 'Baixa',
    'NORMAL': 'Normal',
    'HIGH': 'Alta',
    'URGENT': 'Urgente',
    'CRITICAL': 'Crítica',
  };

  static String label(String priority) => labels[priority] ?? priority;
}

class NamedRef {
  const NamedRef({required this.id, required this.name, this.detail});

  final String id;
  final String name;
  final String? detail;
}

class OperationAssignee {
  const OperationAssignee({
    required this.userId,
    required this.displayName,
    this.avatarUrl,
    this.assignedAt,
  });

  factory OperationAssignee.fromJson(Map<String, dynamic> json) {
    final user = json['user'] as Map<String, dynamic>? ?? const {};
    return OperationAssignee(
      userId: json['userId'] as String? ?? user['id'] as String? ?? '',
      displayName: user['displayName'] as String? ?? '',
      avatarUrl: user['avatarUrl'] as String?,
      assignedAt: DateTime.tryParse(json['assignedAt'] as String? ?? ''),
    );
  }

  final String userId;
  final String displayName;
  final String? avatarUrl;
  final DateTime? assignedAt;
}

class OperationAttachment {
  const OperationAttachment({
    required this.id,
    required this.fileName,
    required this.mimeType,
    required this.size,
    this.createdAt,
  });

  factory OperationAttachment.fromJson(Map<String, dynamic> json) =>
      OperationAttachment(
        id: json['id'] as String? ?? '',
        fileName: json['fileName'] as String? ?? '',
        mimeType: json['mimeType'] as String? ?? '',
        size: (json['size'] as num?)?.toInt() ?? 0,
        createdAt: DateTime.tryParse(json['createdAt'] as String? ?? ''),
      );

  final String id;
  final String fileName;
  final String mimeType;
  final int size;
  final DateTime? createdAt;
}

class OperationChecklistSummary {
  const OperationChecklistSummary({
    required this.id,
    required this.status,
    required this.progress,
    this.templateName,
    this.updatedAt,
  });

  factory OperationChecklistSummary.fromJson(Map<String, dynamic> json) {
    final template = json['template'] as Map<String, dynamic>?;
    return OperationChecklistSummary(
      id: json['id'] as String? ?? '',
      status: json['status'] as String? ?? '',
      progress: (json['progress'] as num?)?.toInt() ?? 0,
      templateName: template?['name'] as String?,
      updatedAt: DateTime.tryParse(json['updatedAt'] as String? ?? ''),
    );
  }

  final String id;
  final String status;
  final int progress;
  final String? templateName;
  final DateTime? updatedAt;
}

/// Evento de `GET /operations/:id/history` e da timeline.
class OperationHistoryEntry {
  const OperationHistoryEntry({
    required this.id,
    required this.action,
    this.fromStatus,
    this.toStatus,
    this.actorName,
    this.createdAt,
  });

  factory OperationHistoryEntry.fromJson(Map<String, dynamic> json) {
    final user = json['user'] as Map<String, dynamic>?;
    return OperationHistoryEntry(
      id: json['id'] as String? ?? '',
      action: json['action'] as String? ?? '',
      fromStatus: json['fromStatus'] as String?,
      toStatus: json['toStatus'] as String?,
      actorName: user?['displayName'] as String?,
      createdAt: DateTime.tryParse(json['createdAt'] as String? ?? ''),
    );
  }

  final String id;
  final String action;
  final String? fromStatus;
  final String? toStatus;
  final String? actorName;
  final DateTime? createdAt;

  static const _labels = <String, String>{
    'CREATED': 'Operação criada',
    'UPDATED': 'Operação atualizada',
    'STATUS_CHANGED': 'Status alterado',
    'USER_ASSIGNED': 'Técnico atribuído',
    'USER_UNASSIGNED': 'Técnico removido',
    'ATTACHMENT_ADDED': 'Anexo adicionado',
    'ATTACHMENT_REMOVED': 'Anexo removido',
    'CHECKLIST_STARTED': 'Checklist iniciado',
    'CHECKLIST_COMPLETED': 'Checklist concluído',
    'CHECKLIST_CANCELLED': 'Checklist cancelado',
    'DELETED': 'Operação removida',
  };

  String get label {
    final base = _labels[action] ?? action;
    if (action != 'STATUS_CHANGED') return base;
    final from = fromStatus == null ? null : OperationStatus.label(fromStatus!);
    final to = toStatus == null ? null : OperationStatus.label(toStatus!);
    if (from != null && to != null) return '$base: $from → $to';
    return to == null ? base : '$base: $to';
  }
}

/// `GET /operations/:id/timeline` → `{ events, attachments }`.
class OperationTimeline {
  const OperationTimeline({required this.events, required this.attachments});

  factory OperationTimeline.fromJson(Map<String, dynamic> json) =>
      OperationTimeline(
        events: (json['events'] as List<dynamic>? ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(OperationHistoryEntry.fromJson)
            .toList(growable: false),
        attachments: (json['attachments'] as List<dynamic>? ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(OperationAttachment.fromJson)
            .toList(growable: false),
      );

  final List<OperationHistoryEntry> events;
  final List<OperationAttachment> attachments;
}

/// Operação completa (`operationInclude`).
class Operation {
  const Operation({
    required this.id,
    required this.code,
    required this.title,
    required this.status,
    required this.kind,
    required this.priority,
    this.description,
    this.scheduledStart,
    this.scheduledEnd,
    this.startedAt,
    this.completedAt,
    this.businessUnit,
    this.customer,
    this.asset,
    this.assignees = const [],
    this.attachments = const [],
    this.checklists = const [],
    this.location,
    this.data,
    this.updatedAt,
  });

  /// O primeiro equipamento de `assets`, como referência nomeada.
  ///
  /// Fora de `fromJson` porque o detalhe do atendimento também precisa dele.
  static NamedRef? firstAsset(Object? assets) {
    if (assets is! List) return null;
    for (final item in assets) {
      if (item is! Map<String, dynamic>) continue;
      return NamedRef(
        id: item['id'] as String? ?? '',
        name: item['name'] as String? ?? '',
        detail: item['identifier'] as String?,
      );
    }
    return null;
  }

  factory Operation.fromJson(Map<String, dynamic> json) {
    NamedRef? ref(String key, String nameKey, {String? detailKey}) {
      final value = json[key];
      if (value is! Map<String, dynamic>) return null;
      return NamedRef(
        id: value['id'] as String? ?? '',
        name:
            value[nameKey] as String? ??
            value['legalName'] as String? ??
            value['name'] as String? ??
            '',
        detail: detailKey == null ? null : value[detailKey] as String?,
      );
    }

    return Operation(
      id: json['id'] as String? ?? '',
      code: json['code'] as String? ?? '',
      title: json['title'] as String? ?? '',
      status: json['status'] as String? ?? OperationStatus.open,
      kind: json['kind'] as String? ?? '',
      priority: json['priority'] as String? ?? 'NORMAL',
      description: json['description'] as String?,
      scheduledStart: DateTime.tryParse(
        json['scheduledStart'] as String? ?? '',
      ),
      scheduledEnd: DateTime.tryParse(json['scheduledEnd'] as String? ?? ''),
      startedAt: DateTime.tryParse(json['startedAt'] as String? ?? ''),
      completedAt: DateTime.tryParse(json['completedAt'] as String? ?? ''),
      businessUnit: ref('businessUnit', 'tradeName'),
      customer: ref('customer', 'tradeName'),

      /// O primeiro equipamento do atendimento.
      ///
      /// O contrato publicava `asset`, um só, e passou a publicar `assets`,
      /// uma lista — o técnico vai ao endereço e atende os aparelhos que estão
      /// lá. O cartão do atendimento tem espaço para um nome; a lista inteira
      /// aparece no detalhe, que lê `assets` direto.
      ///
      /// Sem este ajuste o nome do equipamento simplesmente sumiria da tela:
      /// `ref` devolve `null` para uma chave que não existe, sem erro nenhum.
      asset: firstAsset(json['assets']),
      assignees: (json['users'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(OperationAssignee.fromJson)
          .toList(growable: false),
      attachments: (json['attachments'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(OperationAttachment.fromJson)
          .toList(growable: false),
      checklists: (json['checklistExecutions'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(OperationChecklistSummary.fromJson)
          .toList(growable: false),
      location: json['location'] as Map<String, dynamic>?,
      data: json['data'] as Map<String, dynamic>?,
      updatedAt: DateTime.tryParse(json['updatedAt'] as String? ?? ''),
    );
  }

  final String id;
  final String code;
  final String title;
  final String status;
  final String kind;
  final String priority;
  final String? description;
  final DateTime? scheduledStart;
  final DateTime? scheduledEnd;
  final DateTime? startedAt;
  final DateTime? completedAt;
  final NamedRef? businessUnit;
  final NamedRef? customer;
  final NamedRef? asset;
  final List<OperationAssignee> assignees;
  final List<OperationAttachment> attachments;
  final List<OperationChecklistSummary> checklists;
  final Map<String, dynamic>? location;
  final Map<String, dynamic>? data;
  final DateTime? updatedAt;

  bool get isOpen =>
      status != OperationStatus.completed &&
      status != OperationStatus.cancelled;
}

/// Execução de IA (`GET /ai-executions?operationId=`).
///
/// `output` é JSON livre: o formato depende do agente e do `purpose`, e o
/// backend não publica esquema. A leitura é tolerante — o que for reconhecido
/// vira seção, o resto fica disponível como texto.
class AiExecution {
  const AiExecution({
    required this.id,
    required this.purpose,
    required this.status,
    this.model,
    this.output,
    this.hasError = false,
    this.createdAt,
    this.completedAt,
  });

  factory AiExecution.fromJson(Map<String, dynamic> json) => AiExecution(
    id: json['id'] as String? ?? '',
    purpose: json['purpose'] as String? ?? '',
    status: json['status'] as String? ?? '',
    model: json['model'] as String?,
    output: json['output'] is Map<String, dynamic>
        ? json['output'] as Map<String, dynamic>
        : null,
    hasError: json['error'] != null,
    createdAt: DateTime.tryParse(json['createdAt'] as String? ?? ''),
    completedAt: DateTime.tryParse(json['completedAt'] as String? ?? ''),
  );

  final String id;
  final String purpose;
  final String status;
  final String? model;
  final Map<String, dynamic>? output;
  final bool hasError;
  final DateTime? createdAt;
  final DateTime? completedAt;

  String? get summary => _readString('summary');

  List<String> get inconsistencies => _readList('inconsistencies');
  List<String> get risks => _readList('risks');
  List<String> get alerts => _readList('alerts');
  List<String> get recommendations => _readList('recommendations');
  List<String> get insights => _readList('insights');

  /// `true` quando alguma seção conhecida foi reconhecida na saída.
  bool get hasReadableOutput =>
      summary != null ||
      inconsistencies.isNotEmpty ||
      risks.isNotEmpty ||
      alerts.isNotEmpty ||
      recommendations.isNotEmpty ||
      insights.isNotEmpty;

  String? _readString(String key) {
    final value = output?[key];
    return value is String && value.trim().isNotEmpty ? value : null;
  }

  List<String> _readList(String key) {
    final value = output?[key];
    if (value is! List) return const [];
    return value.whereType<String>().toList(growable: false);
  }
}

/// Filtros aceitos por `OperationQueryDto`.
///
/// Só existem aqui os parâmetros que o backend realmente aceita — não há
/// ordenação, por exemplo.
class OperationQuery {
  const OperationQuery({
    this.search,
    this.status,
    this.kind,
    this.priority,
    this.assignedUserId,
    this.businessUnitId,
    this.customerId,
    this.assetId,
    this.scheduledFrom,
    this.scheduledTo,
    this.page = 1,
    this.limit = 20,
  });

  final String? search;
  final String? status;
  final String? kind;
  final String? priority;
  final String? assignedUserId;
  final String? businessUnitId;
  final String? customerId;
  final String? assetId;
  final DateTime? scheduledFrom;
  final DateTime? scheduledTo;
  final int page;
  final int limit;

  OperationQuery copyWith({
    String? search,
    String? status,
    String? kind,
    String? priority,
    String? assignedUserId,
    int? page,
    bool clearSearch = false,
    bool clearStatus = false,
    bool clearKind = false,
    bool clearPriority = false,
  }) => OperationQuery(
    search: clearSearch ? null : (search ?? this.search),
    status: clearStatus ? null : (status ?? this.status),
    kind: clearKind ? null : (kind ?? this.kind),
    priority: clearPriority ? null : (priority ?? this.priority),
    assignedUserId: assignedUserId ?? this.assignedUserId,
    businessUnitId: businessUnitId,
    customerId: customerId,
    assetId: assetId,
    scheduledFrom: scheduledFrom,
    scheduledTo: scheduledTo,
    page: page ?? this.page,
    limit: limit,
  );

  Map<String, dynamic> toQueryParameters() => {
    'search': search,
    'status': status,
    'kind': kind,
    'priority': priority,
    'assignedUserId': assignedUserId,
    'businessUnitId': businessUnitId,
    'customerId': customerId,
    'assetId': assetId,
    'scheduledFrom': scheduledFrom?.toUtc().toIso8601String(),
    'scheduledTo': scheduledTo?.toUtc().toIso8601String(),
    'page': page,
    'limit': limit,
  };

  /// Chave estável para cache de leitura.
  String get cacheKey {
    final entries =
        toQueryParameters().entries
            .where((entry) => entry.value != null)
            .map((entry) => '${entry.key}=${entry.value}')
            .toList()
          ..sort();
    return 'operations?${entries.join('&')}';
  }

  bool get hasFilters =>
      search != null || status != null || kind != null || priority != null;
}
