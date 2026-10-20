/// Guards de interface.
///
/// Escondem o que o backend recusaria, para não oferecer ação impossível.
/// **Não substituem a validação do servidor** — o NestJS continua sendo a
/// autoridade sobre papéis, permissões, plano e capabilities.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/providers.dart';
import '../../features/authentication/domain/session.dart';

/// Renderiza [child] apenas quando a sessão satisfaz as exigências.
///
/// ```dart
/// PermissionGate(
///   permission: 'operations.status.update',
///   child: FilledButton(...),
/// )
/// ```
class PermissionGate extends ConsumerWidget {
  const PermissionGate({
    super.key,
    required this.child,
    this.permission,
    this.role,
    this.capability,
    this.requireActiveSubscription = false,
    this.fallback,
  });

  final Widget child;
  final String? permission;
  final String? role;

  /// Módulo do plano — a mesma chave usada em `@Capabilities(...)`.
  final String? capability;
  final bool requireActiveSubscription;

  /// Exibido quando a sessão não satisfaz as exigências. Padrão: nada.
  final Widget? fallback;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);
    return isAllowed(session) ? child : (fallback ?? const SizedBox.shrink());
  }

  bool isAllowed(OrbitSession? session) {
    if (session == null) return false;
    if (permission != null && !session.hasPermission(permission!)) return false;
    if (role != null && !session.hasRole(role!)) return false;
    if (capability != null && !session.hasCapability(capability!)) return false;
    if (requireActiveSubscription && !session.hasActiveSubscription) {
      return false;
    }
    return true;
  }
}

/// Versão utilitária para uso fora da árvore de widgets.
bool sessionAllows(
  OrbitSession? session, {
  String? permission,
  String? role,
  String? capability,
}) => PermissionGate(
  permission: permission,
  role: role,
  capability: capability,
  child: const SizedBox.shrink(),
).isAllowed(session);
