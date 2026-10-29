/// Contratos de identidade e sessão.
///
/// Espelham os DTOs reais do NestJS. Referências:
/// `identity/presentation/dto/identity.dto.ts`,
/// `identity/application/profile.service.ts`,
/// `identity/domain/identity.types.ts` (claims do access token),
/// `organizations/organization.repository.ts` (`organizationView`),
/// `subscription-plans/subscription-plan.service.ts` (`OrganizationEntitlements`).
///
/// Escrito à mão em vez de gerado: são poucas classes, estáveis, e evitar o
/// `build_runner` mantém o build previsível. As classes são imutáveis e a
/// desserialização é tolerante a campo ausente, porque o backend evolui.
library;

/// Papel global do administrador da plataforma.
const String platformAdminRole = 'PLATFORM_ADMIN';

/// Status de assinatura que liberam o produto (`SubscriptionPlanService`).
const Set<String> activeSubscriptionStatuses = {
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
};

/// Claims do access token — lidas sem verificar assinatura.
///
/// A verificação é do backend (`JwtAuthenticationGuard`). Aqui as claims
/// servem só para conhecer o escopo ativo e antecipar a expiração.
class AccessTokenClaims {
  const AccessTokenClaims({
    required this.userId,
    required this.sessionId,
    this.organizationId,
    this.businessUnitId,
    this.businessUnitIds = const [],
    this.roles = const [],
    this.permissions = const [],
    this.allowedSurfaces = const [],
    this.isOrganizationOwner = false,
    this.expiresAt,
  });

  factory AccessTokenClaims.fromJson(Map<String, dynamic> json) =>
      AccessTokenClaims(
        userId: json['sub'] as String? ?? '',
        sessionId: json['sid'] as String? ?? '',
        organizationId: json['organizationId'] as String?,
        businessUnitId: json['businessUnitId'] as String?,
        businessUnitIds: _stringList(json['businessUnitIds']),
        roles: _stringList(json['roles']),
        permissions: _stringList(json['permissions']),
        allowedSurfaces: _stringList(json['allowedSurfaces']),
        isOrganizationOwner: json['isOrganizationOwner'] as bool? ?? false,
        expiresAt: json['exp'] is num
            ? DateTime.fromMillisecondsSinceEpoch(
                (json['exp'] as num).toInt() * 1000,
              )
            : null,
      );

  final String userId;
  final String sessionId;
  final String? organizationId;
  final String? businessUnitId;
  final List<String> businessUnitIds;
  final List<String> roles;
  final List<String> permissions;
  final List<String> allowedSurfaces;
  final bool isOrganizationOwner;
  final DateTime? expiresAt;

  bool get isPlatformAdmin => roles.contains(platformAdminRole);
}

/// Acesso efetivo de `GET /identity/me/access`, resolvido no banco pelo servidor.
/// O token identifica a sessão; suas permissões podem anteceder uma alteração
/// do papel ou do acesso personalizado do membro.
class SessionAccess {
  const SessionAccess({
    this.isOwner = false,
    this.roles = const [],
    this.permissions = const [],
    this.surfaceAccess = const [],
    this.unitIds = const [],
  });

  factory SessionAccess.fromJson(Map<String, dynamic> json) => SessionAccess(
    isOwner: json['isOwner'] == true,
    roles: _stringList(json['roles']),
    permissions: _stringList(json['permissions']),
    surfaceAccess: _stringList(json['surfaceAccess']),
    unitIds: _stringList(json['unitIds']),
  );

  final bool isOwner;
  final List<String> roles;
  final List<String> permissions;
  final List<String> surfaceAccess;
  final List<String> unitIds;
}

/// Perfil de `GET /identity/me`.
class OrbitUser {
  const OrbitUser({
    required this.id,
    required this.email,
    required this.displayName,
    this.firstName,
    this.lastName,
    this.phone,
    this.avatarUrl,
    this.locale,
    this.timezone,
    this.status = 'ACTIVE',
    this.mfaEnabled = false,
    this.mustChangePassword = false,
  });

  /// [resolverUrl] traduz endereços que o servidor entrega.
  ///
  /// A foto vem como URL assinada apontando para onde o **servidor** acha que
  /// vive — `localhost`, em desenvolvimento. Sem traduzir, o aparelho tenta
  /// carregá-la de si mesmo e cai nas iniciais, em silêncio. Quem tem a base
  /// alcançável é o cliente HTTP, e é ele que passa a função.
  factory OrbitUser.fromJson(
    Map<String, dynamic> json, {
    Uri Function(Uri)? resolverUrl,
  }) => OrbitUser(
    id: json['id'] as String? ?? '',
    email: json['email'] as String? ?? '',
    displayName:
        json['displayName'] as String? ?? json['email'] as String? ?? '',
    firstName: json['firstName'] as String?,
    lastName: json['lastName'] as String?,
    phone: json['phone'] as String?,
    avatarUrl: _enderecoResolvido(json['avatarUrl'] as String?, resolverUrl),
    locale: json['locale'] as String?,
    timezone: json['timezone'] as String?,
    status: json['status'] as String? ?? 'ACTIVE',
    mfaEnabled: json['mfaEnabled'] as bool? ?? false,
    mustChangePassword: json['mustChangePassword'] as bool? ?? false,
  );

  final String id;
  final String email;
  final String displayName;
  final String? firstName;
  final String? lastName;
  final String? phone;
  final String? avatarUrl;
  final String? locale;
  final String? timezone;
  final String status;
  final bool mfaEnabled;

  /// A senha atual é provisória e precisa ser trocada antes de trabalhar.
  ///
  /// Verdadeiro quando o dono da organização cadastrou a pessoa e entregou uma
  /// senha temporária. Enquanto for verdadeiro o roteador prende o aplicativo
  /// na troca: o dono não deve continuar sabendo a senha do técnico, e é a
  /// troca que encerra isso.
  final bool mustChangePassword;

  String get initials {
    final parts = displayName.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts.first.isEmpty) return '?';
    if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
    return (parts.first.substring(0, 1) + parts.last.substring(0, 1))
        .toUpperCase();
  }
}

/// Unidade de negócio, aninhada em `GET /organizations/current`.
class BusinessUnit {
  const BusinessUnit({
    required this.id,
    required this.legalName,
    this.tradeName,
    this.isPrimary = false,
    this.city,
    this.stateCode,
    this.timezone,
  });

  factory BusinessUnit.fromJson(Map<String, dynamic> json) => BusinessUnit(
    id: json['id'] as String? ?? '',
    legalName: json['legalName'] as String? ?? '',
    tradeName: json['tradeName'] as String?,
    isPrimary: json['isPrimary'] as bool? ?? false,
    city: json['city'] as String?,
    stateCode: json['stateCode'] as String?,
    timezone: json['timezone'] as String?,
  );

  final String id;
  final String legalName;
  final String? tradeName;
  final bool isPrimary;
  final String? city;
  final String? stateCode;
  final String? timezone;

  String get name => tradeName ?? legalName;
}

/// Plano contratado.
class OrbitPlan {
  const OrbitPlan({
    required this.key,
    required this.name,
    this.capabilities = const [],
  });

  factory OrbitPlan.fromJson(Map<String, dynamic> json) => OrbitPlan(
    key: json['key'] as String? ?? '',
    name: json['name'] as String? ?? '',
    capabilities: _stringList(json['capabilities']),
  );

  final String key;
  final String name;
  final List<String> capabilities;
}

/// Organização ativa (`GET /organizations/current`).
class Organization {
  const Organization({
    required this.id,
    required this.displayName,
    required this.subscriptionStatus,
    this.segment = '',
    this.plan,
    this.businessUnits = const [],
  });

  factory Organization.fromJson(Map<String, dynamic> json) => Organization(
    id: json['id'] as String? ?? '',
    displayName: json['displayName'] as String? ?? '',
    subscriptionStatus: json['subscriptionStatus'] as String? ?? '',
    segment: json['primarySegment'] as String? ?? '',
    plan: json['plan'] is Map<String, dynamic>
        ? OrbitPlan.fromJson(json['plan'] as Map<String, dynamic>)
        : null,
    businessUnits: (json['businessUnits'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(BusinessUnit.fromJson)
        .toList(growable: false),
  );

  final String id;
  final String displayName;
  final String subscriptionStatus;
  final String segment;
  final OrbitPlan? plan;
  final List<BusinessUnit> businessUnits;
}

/// Direitos do plano (`GET /organizations/current/subscription`).
///
/// `capabilities` é o que o backend valida em `@Capabilities(...)` — no app é
/// a fonte de "módulos habilitados".
class Entitlements {
  const Entitlements({
    required this.planKey,
    required this.subscriptionStatus,
    this.capabilities = const [],
  });

  factory Entitlements.fromJson(Map<String, dynamic> json) => Entitlements(
    planKey: json['planKey'] as String? ?? '',
    subscriptionStatus: json['subscriptionStatus'] as String? ?? '',
    capabilities: _stringList(json['capabilities']),
  );

  final String planKey;
  final String subscriptionStatus;
  final List<String> capabilities;

  bool get isActive => activeSubscriptionStatuses.contains(subscriptionStatus);
}

/// Canonical product entitlement + implementation availability.
class ProductAccess {
  const ProductAccess({
    this.capabilities = const [],
    this.featureAvailability = const {},
  });

  factory ProductAccess.fromJson(Map<String, dynamic> json) => ProductAccess(
    capabilities: _stringList(json['capabilities']),
    featureAvailability:
        (json['featureAvailability'] as Map<String, dynamic>? ?? const {}).map(
          (key, value) => MapEntry(key, value == true),
        ),
  );

  final List<String> capabilities;
  final Map<String, bool> featureAvailability;

  bool hasCapability(String code) => capabilities.contains(code);
  bool hasFeature(String code) => featureAvailability[code] == true;
}

List<String> _stringList(Object? value) => value is List
    ? value.whereType<String>().toList(growable: false)
    : const <String>[];

/// O endereço da foto, traduzido quando há tradutor.
///
/// Devolve `null` para o que não é URL utilizável: string vazia ou texto que
/// não parseia. Um endereço quebrado viraria um `Image.network` que falha, e a
/// tela já tem as iniciais para esse caso.
String? _enderecoResolvido(String? bruto, Uri Function(Uri)? resolverUrl) {
  final texto = bruto?.trim();
  if (texto == null || texto.isEmpty) return null;
  final uri = Uri.tryParse(texto);
  if (uri == null) return null;
  return (resolverUrl?.call(uri) ?? uri).toString();
}
