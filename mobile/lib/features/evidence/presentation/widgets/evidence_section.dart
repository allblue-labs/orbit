/// Evidências de um atendimento.
///
/// Duas listas, e a separação é o ponto: **confirmadas** são o que o servidor
/// aceitou; **aguardando envio** é o que existe só neste aparelho. Somar as
/// duas produziria uma contagem que o servidor não reconhece — e é justamente
/// a contagem que decide se o limite foi atingido.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/contracts/mobile_evidence_contracts.dart';
import '../../../../core/presentation/field_registry.dart';
import '../../../../core/presentation/orbit_format.dart';
import '../../../../core/theme/orbit_theme.dart';
import '../../../../core/widgets/section_states.dart';
import '../../../sync/presentation/widgets/pending_badge.dart';
import '../../application/evidence_providers.dart';
import '../../data/local_media.dart';
import '../capture_sheet.dart';
import 'evidence_preview.dart';

class EvidenceSection extends ConsumerWidget {
  const EvidenceSection({
    super.key,
    required this.target,
    required this.canCapture,
  });

  final FieldEvidenceTargetRef target;

  /// Só quando o servidor publica `ADD_EVIDENCE`. A interface não decide quem
  /// pode anexar — ela mostra o que foi autorizado.
  final bool canCapture;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final confirmed = ref.watch(evidenceListProvider(target));
    final pending =
        ref.watch(pendingMediaProvider(target)).valueOrNull ??
        const <LocalMedia>[];

    return SectionBlock(
      title: 'Evidências',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          confirmed.when(
            loading: () => const SectionLoading(lines: 2),
            error: (error, _) => SectionError(
              error: error,
              onRetry: () => ref.invalidate(evidenceListProvider(target)),
            ),
            data: (items) => _Counts(
              confirmed: items.length,
              pending: pending.where((value) => value.isSendable).length,
              blocked: pending.where((value) => value.isBlocked).length,
            ),
          ),

          const SizedBox(height: OrbitSpacing.sm),

          ...confirmed.maybeWhen(
            data: (items) => [
              LayoutBuilder(
                builder: (context, constraints) {
                  final columns =
                      MediaQuery.textScalerOf(context).scale(1) > 1.3 ? 1 : 2;
                  return Wrap(
                    spacing: 8,
                    runSpacing: 12,
                    children: [
                      for (final evidence in items.take(6))
                        SizedBox(
                          width:
                              (constraints.maxWidth - 8 * (columns - 1)) /
                              columns,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              if (evidence.previewAvailable &&
                                  evidence.mimeType.startsWith('image/')) ...[
                                EvidencePreview(evidence: evidence),
                                const SizedBox(height: 8),
                              ],
                              _ConfirmedTile(evidence: evidence),
                            ],
                          ),
                        ),
                    ],
                  );
                },
              ),
              for (final evidence in items.skip(6))
                _ConfirmedTile(evidence: evidence),
            ],
            orElse: () => const <Widget>[],
          ),

          for (final media in pending) _PendingTile(media: media),

          if (confirmed.valueOrNull?.isEmpty == true && pending.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: OrbitSpacing.sm),
              child: Text(
                'Nenhuma evidência registrada neste atendimento.',
                style: TextStyle(
                  fontSize: 13,
                  color: OrbitColors.textSecondary,
                ),
              ),
            ),

          if (canCapture) ...[
            const SizedBox(height: OrbitSpacing.sm),
            OutlinedButton.icon(
              onPressed: () => showCaptureSheet(context, target),
              icon: const Icon(Icons.add_a_photo_outlined),
              style: OutlinedButton.styleFrom(minimumSize: const Size(0, 48)),
              label: const Text('Registrar evidência'),
            ),
          ],
        ],
      ),
    );
  }
}

/// A contagem, com as duas naturezas separadas.
///
/// "4 confirmadas · 2 aguardando envio" é honesto; "6" seria uma afirmação que
/// o servidor não fez.
class _Counts extends StatelessWidget {
  const _Counts({
    required this.confirmed,
    required this.pending,
    required this.blocked,
  });

  final int confirmed;
  final int pending;
  final int blocked;

  @override
  Widget build(BuildContext context) {
    final parts = [
      '$confirmed confirmada${confirmed == 1 ? '' : 's'}',
      if (pending > 0) '$pending aguardando envio',
      if (blocked > 0) '$blocked com problema',
    ];

    return Text(
      parts.join(' · '),
      style: const TextStyle(fontSize: 12, color: OrbitColors.textSecondary),
    );
  }
}

/// Uma evidência que o servidor aceitou.
class _ConfirmedTile extends ConsumerWidget {
  const _ConfirmedTile({required this.evidence});

  final FieldEvidence evidence;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Padding(
      padding: const EdgeInsets.only(bottom: OrbitSpacing.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            evidence.mimeType == 'application/pdf'
                ? Icons.description_outlined
                : Icons.photo_outlined,
            size: 20,
            color: OrbitColors.success,
          ),
          const SizedBox(width: OrbitSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                /// O nome do arquivo, não a chave do objeto no storage.
                Text(
                  evidence.filename,
                  style: const TextStyle(fontSize: 14),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                Text(
                  '${evidenceCategoryLabel(evidenceCategoryWire(evidence.category))}'
                  ' · ${OrbitFormat.dateHourOf(evidence.uploadedAt)}',
                  style: const TextStyle(
                    fontSize: 12,
                    color: OrbitColors.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          const Icon(
            Icons.check_circle_outline,
            size: 16,
            color: OrbitColors.success,
          ),
        ],
      ),
    );
  }
}

/// Uma captura que ainda não é evidência.
class _PendingTile extends ConsumerWidget {
  const _PendingTile({required this.media});

  final LocalMedia media;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final label = evidenceStateLabels[media.state.name]!;

    return Padding(
      padding: const EdgeInsets.only(bottom: OrbitSpacing.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          /// `Wrap` porque nome de arquivo e selo não cabem lado a lado com
          /// escala de texto grande — e quebrar é melhor que estourar.
          Wrap(
            spacing: OrbitSpacing.sm,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(media.filename, style: const TextStyle(fontSize: 14)),
              if (media.isBlocked)
                BlockedBadge(label: label.label)
              else
                PendingBadge(label: label.label),
            ],
          ),

          if (media.isBlocked)
            Text(
              evidenceRejectionLabel(
                code: media.failureCode,
                message: media.failureMessage,
              ),
              style: const TextStyle(
                fontSize: 12,
                color: OrbitColors.textSecondary,
              ),
            )
          else
            Text(
              label.description ?? '',
              style: const TextStyle(
                fontSize: 12,
                color: OrbitColors.textSecondary,
              ),
            ),

          /// Descartar só o que o servidor não aceitou. O arquivo é a única
          /// cópia do que a pessoa registrou — apagá-lo por conta seria perder
          /// trabalho dela.
          if (media.isBlocked)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: () => _confirmDiscard(context, ref),
                child: const Text('Descartar'),
              ),
            ),
        ],
      ),
    );
  }

  Future<void> _confirmDiscard(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Descartar esta evidência?'),
        content: const Text(
          'O arquivo será removido deste aparelho e não foi registrado no '
          'atendimento. Se ainda for necessário, registre novamente.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Manter'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Descartar'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await ref
        .read(mediaUploadControllerProvider.notifier)
        .discard(media.localMediaId);
  }
}
