/// Marca do Orbit.
///
/// O símbolo é o arquivo oficial extraído da logomarca; a tipografia
/// acompanha o Design System. Nenhum desenho novo — o app só posiciona o
/// símbolo entregue.
library;

import 'package:flutter/material.dart';

import '../theme/orbit_theme.dart';

/// Caminho único do símbolo. Trocar o arquivo aqui atualiza todo o app.
const String orbitSymbolAsset = 'assets/brand/orbit-symbol.png';

class OrbitSymbol extends StatelessWidget {
  const OrbitSymbol({super.key, this.size = 72});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      orbitSymbolAsset,
      width: size,
      height: size,
      filterQuality: FilterQuality.medium,
      semanticLabel: 'Orbit',
    );
  }
}

/// Símbolo + nome, usado na autenticação e no perfil.
class OrbitWordmark extends StatelessWidget {
  const OrbitWordmark({
    super.key,
    this.symbolSize = 64,
    this.showTagline = true,
  });

  final double symbolSize;
  final bool showTagline;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        OrbitSymbol(size: symbolSize),
        const SizedBox(height: OrbitSpacing.sm),

        /// O nome, em tinta.
        ///
        /// Antes era um gradiente azul–roxo aplicado por `ShaderMask`. Sobre
        /// branco, gradiente em texto perde contraste nas pontas e nada
        /// acrescenta: a marca aparece no símbolo, e a palavra só precisa ser
        /// legível.
        const Text(
          'Orbit',
          style: TextStyle(
            fontSize: 30,
            fontWeight: FontWeight.w700,
            letterSpacing: -0.5,
            color: OrbitColors.textPrimary,
          ),
        ),
        if (showTagline) ...[
          const SizedBox(height: OrbitSpacing.xs),
          Text(
            'OPERATIONS ERP',
            style: TextStyle(
              fontSize: 11,
              letterSpacing: 3,
              color: OrbitColors.textSecondary.withValues(alpha: 0.9),
            ),
          ),
        ],
      ],
    );
  }
}

/// Fundo da marca.
///
/// Antes era um azul profundo com brilho azul–roxo. No tema claro o fundo é
/// branco com um halo azul discreto no canto — presença de marca sem uma
/// parede de cor atrás do conteúdo.
class OrbitBackground extends StatelessWidget {
  const OrbitBackground({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(color: context.orbit.background, child: child);
  }
}
