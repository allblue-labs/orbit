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
import '../../application/sync_notice_preferences.dart';
import '../../application/sync_providers.dart';
import 'sync_notice_action.dart';

class SyncStatusBar extends ConsumerWidget {
  const SyncStatusBar({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(syncControllerProvider);
    final media = ref.watch(mediaUploadControllerProvider);
    final notices = ref.watch(syncNoticePreferencesProvider);
    final commands = ref.watch(pendingCommandsProvider).valueOrNull;
    final captures = ref.watch(allPendingMediaProvider).valueOrNull;
    if (commands == null || captures == null) {
      return const SizedBox.shrink();
    }
    final visibleCommands = commands
        .where((value) => notices.showsInBanner(commandNoticeKey(value)))
        .toList();
    final visibleMedia = captures
        .where((value) => notices.showsInBanner(mediaNoticeKey(value)))
        .toList();
    if (visibleCommands.isEmpty && visibleMedia.isEmpty) {
      return const SizedBox.shrink();
    }
    final blocked = visibleCommands.where((value) => value.isBlocking).length;
    final blockedMedia = visibleMedia.where((value) => value.isBlocked).length;
    final pending = visibleCommands.length - blocked;
    final noticeKeys = [
      ...visibleCommands.map(commandNoticeKey),
      ...visibleMedia.map(mediaNoticeKey),
    ];

    /// Contagens **separadas**: uma ação de checklist e uma foto não são a
    /// mesma pendência, e somá-las faria enviar a foto parecer resolver o
    /// checklist.
    final mediaLabel = visibleMedia.length == 1
        ? '1 evidência'
        : '${visibleMedia.length} evidências';
    final mediaSuffix = visibleMedia.isNotEmpty ? ' · $mediaLabel' : '';
    final pendingLabel = pending == 1 ? '1 ação' : '$pending ações';
    final attention = [
      if (blocked > 0) blocked == 1 ? '1 ação' : '$blocked ações',
      if (blockedMedia > 0)
        blockedMedia == 1 ? '1 evidência' : '$blockedMedia evidências',
    ].join(' e ');
    final attentionVerb = blocked + blockedMedia == 1 ? 'precisa' : 'precisam';

    final (icon, color, label) = switch (state) {
      _ when blocked > 0 || blockedMedia > 0 => (
        Icons.error_outline,
        OrbitColors.danger,
        '$attention $attentionVerb da sua atenção',
      ),
      _ when media.isUploading && visibleMedia.isNotEmpty => (
        Icons.cloud_upload_outlined,
        OrbitColors.brandBright,
        media.progress == null
            ? 'Enviando evidências…'
            : 'Enviando evidências… ${(media.progress! * 100).round()}%',
      ),
      _ when state.isSyncing && visibleCommands.isNotEmpty => (
        Icons.sync,
        OrbitColors.brandBright,
        'Sincronizando ações registradas…',
      ),
      _ when state.phase == SyncPhase.offline => (
        Icons.cloud_off_outlined,
        OrbitColors.warning,
        pending > 0
            ? '$pendingLabel ${pending == 1 ? "salva" : "salvas"} no aparelho, aguardando conexão$mediaSuffix'
            : '$mediaLabel aguardando conexão',
      ),
      _ => (
        Icons.cloud_queue,
        OrbitColors.warning,
        pending > 0
            ? '$pendingLabel aguardando envio$mediaSuffix'
            : '$mediaLabel aguardando envio',
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
                IconButton(
                  tooltip: 'Ocultar aviso da barra',
                  icon: Icon(Icons.close, size: 18, color: color),
                  onPressed: () => saveNoticePreference(
                    context,
                    () => ref
                        .read(syncNoticePreferencesProvider.notifier)
                        .dismissBanner(noticeKeys),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
