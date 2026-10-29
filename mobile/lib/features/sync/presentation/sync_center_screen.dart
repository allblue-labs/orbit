/// Sincronização.
///
/// A tela responde três perguntas, nessa ordem: o que ainda não foi enviado,
/// o que travou, e quando foi a última vez que deu certo. Nada de
/// `commandId`, versão ou chave de idempotência — isso é vocabulário do
/// protocolo, e quem abre esta tela quer saber se o trabalho da manhã chegou.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart'
    show uploadTasksProvider, uploadQueueProvider;
import '../../../core/contracts/mobile_offline_sync_contracts.dart';
import '../../../core/uploads/upload_task.dart';
import '../../../core/presentation/field_registry.dart';
import '../../../core/presentation/orbit_format.dart';
import '../../../core/design/orbit_primitives.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../../core/widgets/section_states.dart';
import '../../evidence/application/evidence_providers.dart';
import '../application/sync_controller.dart';
import '../application/sync_providers.dart';
import '../application/sync_notice_preferences.dart';
import '../data/command_journal.dart';
import 'widgets/pending_badge.dart';
import 'widgets/sync_notice_action.dart';

class SyncCenterScreen extends ConsumerStatefulWidget {
  const SyncCenterScreen({super.key});

  @override
  ConsumerState<SyncCenterScreen> createState() => _SyncCenterScreenState();
}

class _SyncCenterScreenState extends ConsumerState<SyncCenterScreen> {
  bool _showHidden = false;

  @override
  Widget build(BuildContext context) {
    final sync = ref.watch(syncControllerProvider);
    final commands = ref.watch(pendingCommandsProvider);
    final media = ref.watch(mediaUploadControllerProvider);

    return Scaffold(
      backgroundColor: context.orbit.background,
      appBar: AppBar(title: const Text('Sincronização')),
      body: RefreshIndicator(
        onRefresh: () async {
          await ref.read(syncControllerProvider.notifier).sync(manual: true);
          await ref
              .read(mediaUploadControllerProvider.notifier)
              .process(manual: true);
          await ref.read(uploadQueueProvider).process();
        },
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
            OrbitSpacing.gutter,
            OrbitSpacing.md,
            OrbitSpacing.gutter,
            OrbitSpacing.xl2,
          ),
          children: [
            _Status(state: sync),
            if (sync.needsRecovery || media.needsRecovery)
              const Padding(
                padding: EdgeInsets.only(top: OrbitSpacing.md),
                child: OrbitPanel(
                  tone: OrbitTone.warning,
                  child: Text(
                    'Alguns registros locais não puderam ser lidos. As informações originais foram preservadas neste aparelho para recuperação. Fale com o suporte antes de remover os dados do aplicativo.',
                  ),
                ),
              ),
            _NoticeVisibilityControls(
              showHidden: _showHidden,
              onToggle: () => setState(() => _showHidden = !_showHidden),
            ),
            const SizedBox(height: OrbitSpacing.lg),
            commands.when(
              loading: () => const SectionLoading(lines: 3),
              error: (error, _) => SectionError(error: error),
              data: (value) => _Queue(commands: value, showHidden: _showHidden),
            ),

            const SizedBox(height: OrbitSpacing.lg),

            /// Evidências têm seção própria: são outra fila, com outra
            /// política. Uma frase só ("3 itens pendentes") faria o técnico
            /// achar que enviar a foto resolveu o checklist.
            _MediaQueueSection(showHidden: _showHidden),
            _LegacyUploadsSection(showHidden: _showHidden),
          ],
        ),
      ),
    );
  }
}

class _NoticeVisibilityControls extends ConsumerWidget {
  const _NoticeVisibilityControls({
    required this.showHidden,
    required this.onToggle,
  });
  final bool showHidden;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final preferences = ref.watch(syncNoticePreferencesProvider);
    final keys = [
      ...?ref.watch(pendingCommandsProvider).valueOrNull?.map(commandNoticeKey),
      ...?ref.watch(allPendingMediaProvider).valueOrNull?.map(mediaNoticeKey),
      ...?(ref
          .watch(uploadTasksProvider)
          .valueOrNull
          ?.where((task) => task.isActive || task.status == UploadStatus.failed)
          .map(uploadNoticeKey)),
    ];
    final hidden = keys.where(preferences.hidden.contains).length;
    final dismissed = keys.any(preferences.dismissedBanners.contains);
    if (hidden == 0 && !dismissed) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: OrbitSpacing.md),
      child: OrbitPanel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Os avisos ocultos continuam registrados. Ocultar não cancela '
              'envios nem apaga arquivos.',
              style: OrbitType.caption.copyWith(color: context.orbit.inkMuted),
            ),
            if (hidden > 0)
              TextButton.icon(
                onPressed: onToggle,
                icon: Icon(
                  showHidden
                      ? Icons.visibility_off_outlined
                      : Icons.visibility_outlined,
                ),
                label: Text(
                  showHidden
                      ? 'Deixar de mostrar avisos ocultos'
                      : 'Mostrar avisos ocultos ($hidden)',
                ),
              ),
            if (dismissed)
              TextButton.icon(
                onPressed: () => saveNoticePreference(
                  context,
                  () => ref
                      .read(syncNoticePreferencesProvider.notifier)
                      .restoreBanners(),
                ),
                icon: const Icon(Icons.notifications_active_outlined),
                label: const Text('Reexibir avisos da barra'),
              ),
          ],
        ),
      ),
    );
  }
}

/// As evidências que ainda não viraram Evidence canônica.
class _MediaQueueSection extends ConsumerWidget {
  const _MediaQueueSection({required this.showHidden});
  final bool showHidden;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final media = ref.watch(allPendingMediaProvider);
    final hidden = ref.watch(syncNoticePreferencesProvider).hidden;

    /// Cartão, como o resto da tela. Solto sobre o fundo, este bloco era o
    /// único texto sem contenção — parecia rodapé, não seção.
    return _Secao(
      titulo: 'Evidências',
      child: media.when(
        loading: () => const SectionLoading(lines: 2),
        error: (error, _) => SectionError(error: error),
        data: (items) {
          if (items.isEmpty) {
            return Text(
              'Nenhuma evidência aguardando envio.',
              style: OrbitType.body.copyWith(color: context.orbit.inkMuted),
            );
          }
          final visible = items
              .where(
                (item) => showHidden || !hidden.contains(mediaNoticeKey(item)),
              )
              .toList();
          if (visible.isEmpty) {
            return const Text('Os avisos destas evidências estão ocultos.');
          }
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (final value in visible)
                _EvidenceNoticeTile(
                  filename: value.filename,
                  blocked: value.isBlocked,
                  label: evidenceStateLabels[value.state.name]!.label,
                  message: value.failureMessage,
                  noticeKey: mediaNoticeKey(value),
                ),
            ],
          );
        },
      ),
    );
  }
}

class _EvidenceNoticeTile extends StatelessWidget {
  const _EvidenceNoticeTile({
    required this.filename,
    required this.blocked,
    required this.label,
    required this.noticeKey,
    this.message,
  });
  final String filename;
  final bool blocked;
  final String label;
  final String noticeKey;
  final String? message;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: OrbitSpacing.sm),
    child: OrbitPanel(
      tone: blocked ? OrbitTone.warning : OrbitTone.neutral,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            filename,
            style: OrbitType.itemTitle.copyWith(color: context.orbit.ink),
          ),
          const SizedBox(height: OrbitSpacing.sm),
          if (blocked)
            BlockedBadge(label: label)
          else
            PendingBadge(label: label),
          if (message case final text? when text.isNotEmpty) ...[
            const SizedBox(height: OrbitSpacing.sm),
            Text(
              text,
              style: OrbitType.caption.copyWith(color: context.orbit.inkMuted),
            ),
          ],
          if (blocked) SyncNoticeAction(noticeKey: noticeKey),
        ],
      ),
    ),
  );
}

class _LegacyUploadsSection extends ConsumerWidget {
  const _LegacyUploadsSection({required this.showHidden});
  final bool showHidden;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tasks =
        (ref.watch(uploadTasksProvider).valueOrNull ?? const <UploadTask>[])
            .where(
              (task) => task.isActive || task.status == UploadStatus.failed,
            )
            .toList();
    if (tasks.isEmpty) return const SizedBox.shrink();
    final hidden = ref.watch(syncNoticePreferencesProvider).hidden;
    final visible = tasks
        .where((task) => showHidden || !hidden.contains(uploadNoticeKey(task)))
        .toList();
    return Padding(
      padding: const EdgeInsets.only(top: OrbitSpacing.lg),
      child: _Secao(
        titulo: 'Outros envios de evidências',
        child: visible.isEmpty
            ? const Text('Os avisos destes envios estão ocultos.')
            : Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final task in visible)
                    _EvidenceNoticeTile(
                      filename: task.fileName,
                      blocked: task.status == UploadStatus.failed,
                      label: switch (task.status) {
                        UploadStatus.failed => 'Falha no envio',
                        UploadStatus.uploading => 'Enviando',
                        UploadStatus.retrying => 'Aguardando nova tentativa',
                        _ => 'Aguardando envio',
                      },
                      message: task.lastError,
                      noticeKey: uploadNoticeKey(task),
                    ),
                ],
              ),
      ),
    );
  }
}

/// Um bloco com título em versalete e conteúdo num cartão.
class _Secao extends StatelessWidget {
  const _Secao({required this.titulo, required this.child});

  final String titulo;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.only(
            left: OrbitSpacing.xs,
            bottom: OrbitSpacing.sm,
          ),
          child: Text(
            titulo.toUpperCase(),
            style: OrbitType.eyebrow.copyWith(color: palette.inkSubtle),
          ),
        ),
        DecoratedBox(
          decoration: BoxDecoration(
            color: palette.surface,
            borderRadius: OrbitRadius.card,
            boxShadow: OrbitShadow.card,
          ),
          child: Padding(
            padding: const EdgeInsets.all(OrbitSpacing.md),
            child: child,
          ),
        ),
      ],
    );
  }
}

class _Status extends ConsumerWidget {
  const _Status({required this.state});

  final SyncState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final palette = context.orbit;

    /// A cor diz o que fazer antes de a frase ser lida: vermelho pede
    /// alguém, âmbar pede paciência, verde não pede nada.
    final (cor, icone, frase) = state.needsAttention
        ? (
            palette.danger,
            Icons.error_outline_rounded,
            'Algumas ações precisam da sua atenção antes de serem enviadas.',
          )
        : state.pending > 0
        ? (
            palette.warning,
            Icons.cloud_queue_rounded,
            state.pending == 1
                ? '1 ação aguardando envio.'
                : '${state.pending} ações aguardando envio.',
          )
        : (
            palette.success,
            Icons.cloud_done_outlined,
            'Nenhuma ação pendente neste aparelho.',
          );

    return DecoratedBox(
      decoration: BoxDecoration(
        color: palette.surface,
        borderRadius: OrbitRadius.card,
        boxShadow: OrbitShadow.card,
      ),
      child: Padding(
        padding: const EdgeInsets.all(OrbitSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 42,
                  height: 42,
                  decoration: BoxDecoration(
                    color: cor.withValues(alpha: 0.12),
                    borderRadius: OrbitRadius.field,
                  ),
                  child: Icon(icone, size: 21, color: cor),
                ),
                const SizedBox(width: OrbitSpacing.ms),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        state.needsRecovery
                            ? 'Recuperação necessária'
                            : syncPhaseLabels[state.phase.name] ??
                                  'Sincronização',
                        style: OrbitType.itemTitle.copyWith(color: palette.ink),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        frase,
                        style: OrbitType.caption.copyWith(
                          color: state.needsAttention ? cor : palette.inkMuted,
                        ),
                      ),
                      if (state.lastSyncedAt case final at?) ...[
                        const SizedBox(height: 6),
                        Text(
                          'Última sincronização em '
                          '${OrbitFormat.of(context).dateHourOf(at)}',
                          style: OrbitType.caption.copyWith(
                            color: palette.inkSubtle,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: OrbitSpacing.md),
            FilledButton.icon(
              onPressed: state.isSyncing
                  ? null
                  : () => ref
                        .read(syncControllerProvider.notifier)
                        .sync(manual: true),
              icon: state.isSyncing
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.sync, size: 18),
              style: FilledButton.styleFrom(minimumSize: const Size(0, 48)),
              label: Text(
                state.isSyncing ? 'Sincronizando…' : 'Sincronizar agora',
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Queue extends ConsumerWidget {
  const _Queue({required this.commands, required this.showHidden});

  final List<PendingCommand> commands;
  final bool showHidden;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (commands.isEmpty) {
      return const OrbitEmptyState(
        icon: Icons.cloud_done_outlined,
        title: 'Nada na fila',
        description: 'Tudo o que você registrou já chegou ao servidor.',
      );
    }

    final hidden = ref.watch(syncNoticePreferencesProvider).hidden;
    final visible = commands
        .where(
          (command) =>
              showHidden || !hidden.contains(commandNoticeKey(command)),
        )
        .toList();
    if (visible.isEmpty) {
      return const Text('Os avisos destas ações estão ocultos.');
    }

    /// O que travou vem primeiro: é o que precisa de alguém.
    final ordered = [
      ...visible.where((value) => value.isBlocking),
      ...visible.where((value) => !value.isBlocking),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.only(
            left: OrbitSpacing.xs,
            bottom: OrbitSpacing.sm,
          ),
          child: Text(
            'NA FILA',
            style: OrbitType.eyebrow.copyWith(color: context.orbit.inkSubtle),
          ),
        ),
        for (final command in ordered) _CommandTile(command: command),
      ],
    );
  }
}

class _CommandTile extends ConsumerWidget {
  const _CommandTile({required this.command});

  final PendingCommand command;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final blocked = command.isBlocking;
    final title = pendingCommandLabel(
      offlineCommandTypeWire(command.envelope.commandType),
    );

    /// Caixa, e aqui ela se justifica: um comando pendente reúne natureza,
    /// motivo do bloqueio e ação de descarte — coisas de naturezas diferentes
    /// que só fazem sentido lidas juntas.
    return Padding(
      padding: const EdgeInsets.only(bottom: OrbitSpacing.sm),
      child: OrbitPanel(
        tone: blocked ? OrbitTone.danger : OrbitTone.neutral,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  blocked ? Icons.error_outline : Icons.schedule_outlined,
                  size: 18,
                  color: blocked ? context.orbit.danger : context.orbit.warning,
                ),
                const SizedBox(width: OrbitSpacing.sm),
                Expanded(
                  child: Text(
                    title,
                    style: OrbitType.itemTitle.copyWith(
                      color: context.orbit.ink,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              blocked
                  ? syncBlockedLabel(
                      conflictCode: switch (command.receipt?.conflict?.code) {
                        final code? => offlineConflictCodeWire(code),
                        null => null,
                      },
                      errorCode: command.receipt?.error?.code,
                    )
                  : 'Registrado em ${OrbitFormat.of(context).dateHourOf(command.enqueuedAt)}. '
                        'Será enviado quando houver conexão.',
              style: OrbitType.caption.copyWith(color: context.orbit.inkMuted),
            ),

            /// Descartar só aparece para o que o servidor **não** aplicou.
            /// Uma intenção ainda pendente pode estar em voo neste instante.
            if (blocked) ...[
              const SizedBox(height: OrbitSpacing.sm),
              Wrap(
                spacing: OrbitSpacing.sm,
                children: [
                  SyncNoticeAction(noticeKey: commandNoticeKey(command)),
                  TextButton.icon(
                    onPressed: () => _confirmDiscard(context, ref),
                    icon: const Icon(Icons.delete_outline, size: 18),
                    label: const Text('Descartar esta ação'),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Future<void> _confirmDiscard(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Descartar esta ação?'),
        content: const Text(
          'A ação não foi aplicada no servidor e será removida deste '
          'aparelho. Se ainda for necessária, registre-a de novo.',
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
        .read(syncControllerProvider.notifier)
        .discard(command.envelope.commandId);
  }
}
