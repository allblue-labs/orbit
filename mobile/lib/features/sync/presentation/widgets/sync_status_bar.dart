/// A faixa de sincronização de **comandos**.
///
/// Deliberadamente separada do indicador de evidências: são duas filas com
/// políticas diferentes, e juntá-las numa frase só ("3 itens pendentes") faria
/// o profissional achar que enviar a foto resolveu o checklist.
///
/// Só aparece quando há o que dizer. Uma barra permanente vira paisagem.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/routing/orbit_router.dart';
import '../../../../core/theme/orbit_theme.dart';
import '../../../evidence/application/evidence_providers.dart';
import '../../application/sync_controller.dart';
import '../../application/sync_providers.dart';

class SyncStatusBar extends ConsumerWidget {
  const SyncStatusBar({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(syncControllerProvider);
    final media = ref.watch(mediaUploadControllerProvider);
    if (!state.hasWork &&
        !state.isSyncing &&
        !media.hasWork &&
        !media.isUploading) {
      return const SizedBox.shrink();
    }

    /// Contagens **separadas**: uma ação de checklist e uma foto não são a
    /// mesma pendência, e somá-las faria enviar a foto parecer resolver o
    /// checklist.
    final mediaSuffix = media.hasWork
        ? ' · ${media.pending + media.blocked} evidência(s)'
        : '';

    final (icon, color, label) = switch (state) {
      _ when state.needsAttention || media.blocked > 0 => (
        Icons.error_outline,
        OrbitColors.danger,
        '${state.conflicts + state.rejected + state.expired} ação(ões) '
            'precisam da sua atenção$mediaSuffix',
      ),
      _ when media.isUploading => (
        Icons.cloud_upload_outlined,
        OrbitColors.brandBright,
        media.progress == null
            ? 'Enviando evidências…'
            : 'Enviando evidências… ${(media.progress! * 100).round()}%',
      ),
      _ when state.isSyncing => (
        Icons.sync,
        OrbitColors.brandBright,
        'Sincronizando ações registradas…',
      ),
      _ when state.phase == SyncPhase.offline => (
        Icons.cloud_off_outlined,
        OrbitColors.warning,
        '${state.pending} ação(ões) salvas no aparelho, aguardando '
            'conexão$mediaSuffix',
      ),
      _ => (
        Icons.cloud_queue,
        OrbitColors.warning,
        '${state.pending} ação(ões) aguardando envio$mediaSuffix',
      ),
    };

    return Material(
      color: color.withValues(alpha: 0.14),
      child: InkWell(
        onTap: () => context.push(OrbitRoutes.syncCenter),
        child: SafeArea(
          top: false,
          bottom: false,
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: OrbitSpacing.md,
              vertical: OrbitSpacing.sm,
            ),
            child: Row(
              children: [
                Icon(icon, size: 16, color: color),
                const SizedBox(width: OrbitSpacing.sm),

                /// `Expanded` porque a frase cresce com a escala de texto e a
                /// faixa não pode empurrar o ícone para fora.
                Expanded(
                  child: Text(
                    label,
                    style: TextStyle(fontSize: 12, color: color),
                  ),
                ),
                Icon(Icons.chevron_right, size: 16, color: color),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
