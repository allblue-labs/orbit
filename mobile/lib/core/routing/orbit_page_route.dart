import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../design/orbit_motion.dart';

/// Todas as rotas usam a mesma entrada; o iOS mantém o gesto nativo de voltar.
class OrbitPageRoute extends GoRoute {
  OrbitPageRoute({
    required super.path,
    required Widget Function(BuildContext, GoRouterState) builder,
    super.parentNavigatorKey,
    super.redirect,
    super.routes,
  }) : super(
         pageBuilder: (context, state) => orbitPage(
           context,
           key: state.pageKey,
           child: builder(context, state),
         ),
       );
}

Page<void> orbitPage(
  BuildContext context, {
  required LocalKey key,
  required Widget child,
}) {
  if (OrbitMotion.reduced(context)) {
    return NoTransitionPage(key: key, child: child);
  }
  if (Theme.of(context).platform == TargetPlatform.iOS) {
    return CupertinoPage(key: key, child: child);
  }
  return CustomTransitionPage<void>(
    key: key,
    child: child,
    transitionDuration: OrbitMotion.duration,
    reverseTransitionDuration: const Duration(milliseconds: 200),
    transitionsBuilder: (context, animation, secondaryAnimation, child) {
      if (OrbitMotion.reduced(context)) return child;
      final curve = animation.drive(CurveTween(curve: Curves.easeOutCubic));
      return FadeTransition(
        opacity: curve,
        child: SlideTransition(
          position: Tween(
            begin: const Offset(0.035, 0),
            end: Offset.zero,
          ).animate(curve),
          child: child,
        ),
      );
    },
  );
}
