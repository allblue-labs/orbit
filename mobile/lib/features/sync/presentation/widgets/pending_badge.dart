/// O selo de "ainda não confirmado".
///
/// Existe para que estado local e estado do servidor nunca se pareçam. Um
/// checklist marcado sem rede é um fato do aparelho; só depois do recibo ele
/// vira um fato do sistema, e a interface não pode antecipar essa promessa.
library;

import 'package:flutter/material.dart';

import '../../../../core/theme/orbit_theme.dart';

class PendingBadge extends StatelessWidget {
  const PendingBadge({super.key, this.label = 'Aguardando sincronização'});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: label,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: OrbitColors.warning.withValues(alpha: 0.16),
          borderRadius: BorderRadius.circular(999),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.schedule_outlined,
              size: 13,
              color: OrbitColors.warning,
            ),
            const SizedBox(width: 4),

            /// `Flexible` porque a legenda cresce com a escala de texto e o
            /// selo costuma viver dentro de linhas já apertadas.
            Flexible(
              child: Text(
                label,
                style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: OrbitColors.warning,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// O aviso de conflito — uma intenção parada esperando decisão.
class BlockedBadge extends StatelessWidget {
  const BlockedBadge({super.key, required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: label,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: OrbitColors.danger.withValues(alpha: 0.16),
          borderRadius: BorderRadius.circular(999),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.error_outline,
              size: 13,
              color: OrbitColors.danger,
            ),
            const SizedBox(width: 4),
            Flexible(
              child: Text(
                label,
                style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: OrbitColors.danger,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
