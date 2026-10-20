/// Evidências da operação.
///
/// Junta o que o backend já tem (anexos confirmados) com o que ainda está na
/// fila de envio. Para quem está em campo, os dois são "a evidência que
/// registrei" — a diferença é o estado de sincronização, e ela fica explícita.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/providers.dart';
import '../../../../core/contracts/operation_contracts.dart';
import '../../../../core/errors/orbit_exception.dart';
import '../../../../core/routing/guards.dart';
import '../../../../core/theme/orbit_theme.dart';
import '../../../../core/uploads/upload_task.dart';
import '../../../../core/widgets/section_states.dart';

/// Permissão exigida por `POST /operations/:id/attachments`.
const String _createAttachmentPermission = 'operations.attachments.create';

class EvidenceSection extends ConsumerWidget {
  const EvidenceSection({
    super.key,
    required this.operationId,
    required this.attachments,
  });

  final String operationId;
  final List<OperationAttachment> attachments;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final uploads = ref.watch(operationUploadsProvider(operationId));
    final pending = uploads.where((task) => task.isActive).toList();
    final failed = uploads
        .where((task) => task.status == UploadStatus.failed)
        .toList();

    return SectionBlock(
      title: 'Evidências',
      subtitle: pending.isEmpty
          ? '${attachments.length} enviada(s)'
          : '${attachments.length} enviada(s) · ${pending.length} na fila',
      trailing: PermissionGate(
        permission: _createAttachmentPermission,
        child: _CaptureMenu(operationId: operationId),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (attachments.isEmpty && uploads.isEmpty)
            const SectionEmpty(
              icon: Icons.photo_camera_outlined,
              message: 'Nenhuma evidência registrada nesta operação.',
            ),

          for (final task in pending)
            _PendingEvidenceTile(task: task, operationId: operationId),

          for (final task in failed)
            _FailedEvidenceTile(task: task, operationId: operationId),

          for (final attachment in attachments)
            _SentEvidenceTile(attachment: attachment),
        ],
      ),
    );
  }
}

/// Menu de captura: foto, galeria, vídeo e documento.
class _CaptureMenu extends ConsumerStatefulWidget {
  const _CaptureMenu({required this.operationId});

  final String operationId;

  @override
  ConsumerState<_CaptureMenu> createState() => _CaptureMenuState();
}

class _CaptureMenuState extends ConsumerState<_CaptureMenu> {
  bool _busy = false;

  Future<void> _capture(Future<UploadTask?> Function() action) async {
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final task = await action();
      if (!mounted) return;
      if (task != null) {
        messenger.showSnackBar(
          const SnackBar(content: Text('Evidência na fila de envio.')),
        );
      }
    } on Object catch (error) {
      if (!mounted) return;
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            OrbitException.publicCopyForAny(
              error,
              prefixo: 'Não foi possível registrar a evidência.',
            ),
          ),
        ),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final evidence = ref.read(evidenceRepositoryProvider);
    if (_busy) {
      return const SizedBox(
        width: 24,
        height: 24,
        child: CircularProgressIndicator(strokeWidth: 2.2),
      );
    }

    return PopupMenuButton<VoidCallback>(
      icon: const Icon(Icons.add_a_photo_outlined),
      tooltip: 'Registrar evidência',
      onSelected: (action) => action(),
      itemBuilder: (context) => [
        PopupMenuItem(
          value: () =>
              _capture(() => evidence.capturePhoto(widget.operationId)),
          child: const _MenuRow(icon: Icons.photo_camera, label: 'Tirar foto'),
        ),
        PopupMenuItem(
          value: () => _capture(() => evidence.pickPhoto(widget.operationId)),
          child: const _MenuRow(icon: Icons.photo_library, label: 'Da galeria'),
        ),
        PopupMenuItem(
          value: () => _capture(() => evidence.recordVideo(widget.operationId)),
          child: const _MenuRow(icon: Icons.videocam, label: 'Gravar vídeo'),
        ),
        PopupMenuItem(
          value: () =>
              _capture(() => evidence.pickDocument(widget.operationId)),
          child: const _MenuRow(
            icon: Icons.description_outlined,
            label: 'Documento',
          ),
        ),
      ],
    );
  }
}

class _MenuRow extends StatelessWidget {
  const _MenuRow({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 18),
        const SizedBox(width: OrbitSpacing.sm),
        Text(label),
      ],
    );
  }
}

/// Evidência aguardando envio, enviando ou em nova tentativa.
class _PendingEvidenceTile extends ConsumerWidget {
  const _PendingEvidenceTile({required this.task, required this.operationId});

  final UploadTask task;
  final String operationId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final label = switch (task.status) {
      UploadStatus.uploading => 'Enviando… ${(task.progress * 100).round()}%',
      UploadStatus.retrying => 'Nova tentativa em instantes',
      _ => 'Na fila — aguardando conexão',
    };

    return Padding(
      padding: const EdgeInsets.only(bottom: OrbitSpacing.sm),
      child: Row(
        children: [
          _KindIcon(kind: task.kind, color: OrbitColors.warning),
          const SizedBox(width: OrbitSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  task.fileName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 13),
                ),
                const SizedBox(height: 2),
                Text(
                  label,
                  style: const TextStyle(
                    fontSize: 11,
                    color: OrbitColors.warning,
                  ),
                ),
                if (task.status == UploadStatus.uploading) ...[
                  const SizedBox(height: 4),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: LinearProgressIndicator(
                      value: task.progress,
                      minHeight: 4,
                      backgroundColor: OrbitColors.surface,
                    ),
                  ),
                ],
              ],
            ),
          ),
          IconButton(
            tooltip: 'Cancelar envio',
            icon: const Icon(Icons.close, size: 18),
            onPressed: () => ref.read(uploadQueueProvider).cancel(task.id),
          ),
        ],
      ),
    );
  }
}

/// Evidência cujo envio falhou de forma definitiva.
class _FailedEvidenceTile extends ConsumerWidget {
  const _FailedEvidenceTile({required this.task, required this.operationId});

  final UploadTask task;
  final String operationId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Padding(
      padding: const EdgeInsets.only(bottom: OrbitSpacing.sm),
      child: Row(
        children: [
          _KindIcon(kind: task.kind, color: OrbitColors.danger),
          const SizedBox(width: OrbitSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  task.fileName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 13),
                ),
                Text(
                  task.lastError ?? 'Falha no envio.',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 11,
                    color: OrbitColors.danger,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            tooltip: 'Tentar de novo',
            icon: const Icon(Icons.refresh, size: 18),
            onPressed: () => ref.read(uploadQueueProvider).retry(task.id),
          ),
          IconButton(
            tooltip: 'Descartar',
            icon: const Icon(Icons.delete_outline, size: 18),
            onPressed: () => ref.read(uploadQueueProvider).cancel(task.id),
          ),
        ],
      ),
    );
  }
}

/// Evidência já confirmada pelo backend.
class _SentEvidenceTile extends StatelessWidget {
  const _SentEvidenceTile({required this.attachment});

  final OperationAttachment attachment;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: OrbitSpacing.sm),
      child: Row(
        children: [
          _KindIcon(
            kind: evidenceKindFromMime(attachment.mimeType),
            color: OrbitColors.success,
          ),
          const SizedBox(width: OrbitSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  attachment.fileName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 13),
                ),
                Text(
                  _size(attachment.size),
                  style: const TextStyle(
                    fontSize: 11,
                    color: OrbitColors.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          const Icon(
            Icons.cloud_done_outlined,
            size: 18,
            color: OrbitColors.success,
          ),
        ],
      ),
    );
  }

  static String _size(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).round()} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }
}

class _KindIcon extends StatelessWidget {
  const _KindIcon({required this.kind, required this.color});

  final EvidenceKind kind;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final icon = switch (kind) {
      EvidenceKind.photo => Icons.photo_outlined,
      EvidenceKind.video => Icons.videocam_outlined,
      EvidenceKind.document => Icons.description_outlined,
    };
    return Container(
      width: 34,
      height: 34,
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: OrbitRadius.field,
      ),
      child: Icon(icon, size: 18, color: color),
    );
  }
}
