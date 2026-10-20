/// Splash.
///
/// Visível enquanto a sessão guardada é restaurada. Traz o símbolo da marca
/// sobre o azul profundo — a mesma identidade do ícone do aplicativo.
library;

import 'package:flutter/material.dart';

import '../../../core/theme/orbit_theme.dart';
import '../../../core/widgets/orbit_brand.dart';

class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: OrbitBackground(
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const OrbitWordmark(symbolSize: 64),
              const SizedBox(height: OrbitSpacing.lg),
              SizedBox(
                width: 26,
                height: 26,
                child: CircularProgressIndicator(
                  strokeWidth: 2.2,
                  valueColor: AlwaysStoppedAnimation(
                    OrbitColors.brand.withValues(alpha: 0.8),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
