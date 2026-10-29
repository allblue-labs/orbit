/// Indicador de sincronização.
///
/// Responde a uma pergunta que quem está em campo faz o tempo todo: "o que eu
/// registrei já subiu?". Fica visível no shell, acima da barra de navegação,
/// e só aparece quando há algo a dizer.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/providers.dart';
import '../../features/sync/application/sync_notice_preferences.dart';
import '../../features/sync/presentation/widgets/sync_notice_action.dart';
import '../routing/orbit_router.dart';
import '../theme/orbit_theme.dart';
import '../uploads/upload_task.dart';

class SyncIndicator extends ConsumerWidget {
  const SyncIndicator({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final notices = ref.watch(syncNoticePreferencesProvider);
    final tasks = (ref.watch(uploadTasksProvider).valueOrNull ?? const [])
        .where((task) => notices.showsInBanner(uploadNoticeKey(task)))
        .toList();

    final uploading = tasks
        .where((task) => task.status == UploadStatus.uploading)
        .toList();
    final waiting = tasks
        .where(
          (task) =>
              task.status == UploadStatus.pending ||
              task.status == UploadStatus.retrying,
        )
        .length;
    final failed = tasks
        .where((task) => task.status == UploadStatus.failed)
        .length;

    if (uploading.isEmpty && waiting == 0 && failed == 0) {
      return const SizedBox.shrink();
    }

    final (icon, color, label) = switch ((uploading.isNotEmpty, failed > 0)) {
      (true, _) => (
        Icons.cloud_upload_outlined,
        OrbitColors.brandBright,
        'Enviando evidência… ${(uploading.first.progress * 100).round()}%',
      ),
      (false, true) => (
        Icons.error_outline,
        OrbitColors.danger,
        '${failed == 1 ? "1 envio" : "$failed envios"} com falha — toque para revisar',
      ),
      _ => (
        Icons.cloud_queue,
        OrbitColors.warning,
        '${waiting == 1 ? "1 evidência" : "$waiting evidências"} aguardando conexão',
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
                Expanded(
                  child: Text(
                    label,
                    style: TextStyle(fontSize: 12, color: color),
                  ),
                ),
                if (uploading.isNotEmpty)
                  SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      value: uploading.first.progress > 0
                          ? uploading.first.progress
                          : null,
                      valueColor: AlwaysStoppedAnimation(color),
                    ),
                  ),
                IconButton(
                  tooltip: 'Ocultar aviso de envio',
                  icon: Icon(Icons.close, size: 18, color: color),
                  onPressed: () => saveNoticePreference(
                    context,
                    () => ref
                        .read(syncNoticePreferencesProvider.notifier)
                        .dismissBanner(
                          tasks
                              .where(
                                (task) =>
                                    task.isActive ||
                                    task.status == UploadStatus.failed,
                              )
                              .map(uploadNoticeKey),
                        ),
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
