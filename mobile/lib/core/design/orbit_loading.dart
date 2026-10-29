import 'package:flutter/material.dart';
import '../theme/orbit_theme.dart';
import 'orbit_motion.dart';

/// Um único ticker por seção, suspenso fora da tela e com movimento reduzido.
class OrbitSkeleton extends StatefulWidget {
  const OrbitSkeleton({super.key, this.lines = 3});
  final int lines;
  @override
  State<OrbitSkeleton> createState() => _OrbitSkeletonState();
}

class _OrbitSkeletonState extends State<OrbitSkeleton>
    with SingleTickerProviderStateMixin {
  late final _animation = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1400),
  );
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (OrbitMotion.reduced(context) || !TickerMode.valuesOf(context).enabled) {
      _animation.stop();
    } else if (!_animation.isAnimating) {
      _animation.repeat();
    }
  }

  @override
  void dispose() {
    _animation.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final reduced = OrbitMotion.reduced(context);
    final bars = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: List.generate(
        widget.lines,
        (index) => Padding(
          padding: const EdgeInsets.only(bottom: OrbitSpacing.sm),
          child: FractionallySizedBox(
            alignment: Alignment.centerLeft,
            widthFactor: index == 0
                ? 0.62
                : index == widget.lines - 1
                ? 0.82
                : 1,
            child: Container(
              height: index == 0 ? 18 : 14,
              decoration: BoxDecoration(
                color: palette.surfaceSunken,
                borderRadius: BorderRadius.circular(8),
              ),
            ),
          ),
        ),
      ),
    );
    return Semantics(
      label: 'Carregando conteúdo',
      liveRegion: true,
      child: ExcludeSemantics(
        child: RepaintBoundary(
          child: reduced
              ? bars
              : AnimatedBuilder(
                  animation: _animation,
                  child: bars,
                  builder: (context, child) => ShaderMask(
                    blendMode: BlendMode.srcATop,
                    shaderCallback: (bounds) => LinearGradient(
                      begin: Alignment(-3 + _animation.value * 6, -0.2),
                      end: Alignment(-1 + _animation.value * 6, 0.2),
                      colors: [
                        palette.surfaceSunken,
                        palette.surface,
                        palette.surfaceSunken,
                      ],
                      stops: const [0.15, 0.5, 0.85],
                    ).createShader(bounds),
                    child: child,
                  ),
                ),
        ),
      ),
    );
  }
}

class OrbitLoadingState extends StatelessWidget {
  const OrbitLoadingState({
    super.key,
    required this.title,
    required this.message,
  });
  final String title;
  final String message;
  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(OrbitSpacing.xl),
        child: Semantics(
          liveRegion: true,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: palette.accentSoft,
                  shape: BoxShape.circle,
                ),
                child: SizedBox(
                  width: 36,
                  height: 36,
                  child: CircularProgressIndicator(
                    strokeWidth: 3,
                    value: OrbitMotion.reduced(context) ? 0.7 : null,
                  ),
                ),
              ),
              const SizedBox(height: OrbitSpacing.lg),
              Text(
                title,
                textAlign: TextAlign.center,
                style: OrbitType.sectionTitle.copyWith(color: palette.ink),
              ),
              const SizedBox(height: OrbitSpacing.sm),
              Text(
                message,
                textAlign: TextAlign.center,
                style: OrbitType.body.copyWith(color: palette.inkMuted),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Mantém o formulário montado enquanto o comando está sendo enviado.
class OrbitBusyOverlay extends StatelessWidget {
  const OrbitBusyOverlay({
    super.key,
    required this.busy,
    required this.title,
    required this.message,
    required this.child,
  });
  final bool busy;
  final String title;
  final String message;
  final Widget child;
  @override
  Widget build(BuildContext context) => Stack(
    children: [
      AbsorbPointer(
        absorbing: busy,
        child: ExcludeSemantics(excluding: busy, child: child),
      ),
      if (busy)
        Positioned.fill(
          child: ColoredBox(
            color: context.orbit.background.withValues(alpha: 0.96),
            child: OrbitLoadingState(title: title, message: message),
          ),
        ),
    ],
  );
}
