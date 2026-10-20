/// Estado de sessão do aplicativo.
///
/// Fonte única de quem está autenticado, em qual organização e unidade, com
/// quais papéis, permissões e capabilities. Nenhuma tela consulta esses dados
/// por conta própria.
library;

import '../../../core/contracts/session_contracts.dart';

/// Perfil de uso do aplicativo.
///
/// Derivado das permissões devolvidas pelo backend, não de configuração local.
/// O backend continua sendo a autoridade: o perfil só decide o que a interface
/// oferece.
enum OrbitProfile { operator, owner }

/// Permissão que caracteriza gestão. Quem pode gerenciar operações vê a
/// experiência de Owner; os demais veem a de execução.
const String _managePermission = 'operations.manage';
const String _wildcardPermission = '*';

class OrbitSession {
  const OrbitSession({
    required this.user,
    required this.claims,
    this.organization,
    this.entitlements,
    this.productAccess,
    this.activeBusinessUnitId,
  });

  final OrbitUser user;
  final AccessTokenClaims claims;
  final Organization? organization;
  final Entitlements? entitlements;
  final ProductAccess? productAccess;

  /// Unidade escolhida pelo usuário; na ausência, a do token.
  final String? activeBusinessUnitId;

  String? get organizationId => claims.organizationId;

  String? get businessUnitId => activeBusinessUnitId ?? claims.businessUnitId;

  BusinessUnit? get businessUnit {
    final units = organization?.businessUnits ?? const <BusinessUnit>[];
    final id = businessUnitId;
    for (final unit in units) {
      if (unit.id == id) return unit;
    }
    return units.isEmpty ? null : units.first;
  }

  List<String> get roles => claims.roles;
  List<String> get permissions => claims.permissions;

  /// Módulos habilitados pelo plano — o mesmo conjunto que o backend valida
  /// em `@Capabilities(...)`.
  List<String> get capabilities =>
      entitlements?.capabilities ??
      organization?.plan?.capabilities ??
      const [];

  bool get isPlatformAdmin => claims.isPlatformAdmin;
  bool get isOwner => claims.isOrganizationOwner;

  bool get hasActiveSubscription =>
      entitlements?.isActive ??
      activeSubscriptionStatuses.contains(
        organization?.subscriptionStatus ?? '',
      );

  bool hasPermission(String permission) =>
      isOwner ||
      permissions.contains(_wildcardPermission) ||
      permissions.contains(permission);

  bool hasRole(String role) =>
      (isOwner && role != platformAdminRole) || roles.contains(role);

  bool hasCapability(String capability) => capabilities.contains(capability);

  bool canUseProductFeature(String capability, [String? feature]) =>
      productAccess?.hasCapability(capability) == true &&
      productAccess?.hasFeature(feature ?? capability) == true;

  OrbitProfile get profile => isOwner || hasPermission(_managePermission)
      ? OrbitProfile.owner
      : OrbitProfile.operator;

  OrbitSession copyWith({
    OrbitUser? user,
    Organization? organization,
    Entitlements? entitlements,
    ProductAccess? productAccess,
    String? activeBusinessUnitId,
  }) => OrbitSession(
    user: user ?? this.user,
    claims: claims,
    organization: organization ?? this.organization,
    entitlements: entitlements ?? this.entitlements,
    productAccess: productAccess ?? this.productAccess,
    activeBusinessUnitId: activeBusinessUnitId ?? this.activeBusinessUnitId,
  );
}

/// Estado de autenticação observado pela navegação.
sealed class AuthState {
  const AuthState();
}

/// Restaurando a sessão guardada — a splash fica visível.
class AuthRestoring extends AuthState {
  const AuthRestoring();
}

class AuthUnauthenticated extends AuthState {
  const AuthUnauthenticated({this.reason});

  /// Preenchido quando a sessão foi encerrada por expiração.
  final String? reason;
}

class AuthAuthenticated extends AuthState {
  const AuthAuthenticated(this.session);

  final OrbitSession session;
}
