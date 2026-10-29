import 'package:flutter/material.dart';

abstract final class OrbitMotion {
  static const duration = Duration(milliseconds: 260);
  static bool reduced(BuildContext context) =>
      MediaQuery.disableAnimationsOf(context) ||
      MediaQuery.accessibleNavigationOf(context);
}

/// Entrada curta; preserva o estado dos formulários nas etapas já visitadas.
class OrbitReveal extends StatefulWidget {
  const OrbitReveal({super.key, required this.child, this.active = true});
  final Widget child;
  final bool active;
  @override
  State<OrbitReveal> createState() => _OrbitRevealState();
}

class _OrbitRevealState extends State<OrbitReveal>
    with SingleTickerProviderStateMixin {
  late final _animation = AnimationController(
    vsync: this,
    duration: OrbitMotion.duration,
  );
  late final _curve = CurvedAnimation(
    parent: _animation,
    curve: Curves.easeOutCubic,
  );
  bool _initialized = false;
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (OrbitMotion.reduced(context)) {
      _animation.value = 1;
    } else if (!_initialized && widget.active) {
      _animation.forward();
    }
    _initialized = true;
  }

  @override
  void didUpdateWidget(OrbitReveal oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.active && !oldWidget.active) {
      if (OrbitMotion.reduced(context)) {
        _animation.value = 1;
      } else {
        _animation.forward(from: 0);
      }
    }
  }

  @override
  void dispose() {
    _curve.dispose();
    _animation.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => FadeTransition(
    opacity: _curve,
    child: SlideTransition(
      position: Tween(
        begin: const Offset(0, 0.025),
        end: Offset.zero,
      ).animate(_curve),
      child: widget.child,
    ),
  );
}
