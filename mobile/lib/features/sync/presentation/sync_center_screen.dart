/// Sincronização.
///
/// A tela responde três perguntas, nessa ordem: o que ainda não foi enviado,
/// o que travou, e quando foi a última vez que deu certo. Nada de
/// `commandId`, versão ou chave de idempotência — isso é vocabulário do
/// protocolo, e quem abre esta tela quer saber se o trabalho da manhã chegou.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/contracts/mobile_offline_sync_contracts.dart';
import '../../../core/presentation/field_registry.dart';
import '../../../core/presentation/orbit_format.dart';
import '../../../core/design/orbit_primitives.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../../core/widgets/section_states.dart';
import '../../evidence/application/evidence_providers.dart';
import '../application/sync_controller.dart';
import '../application/sync_providers.dart';
import '../data/command_journal.dart';
import 'widgets/pending_badge.dart';

class SyncCenterScreen extends ConsumerWidget {
  const SyncCenterScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sync = ref.watch(syncControllerProvider);
    final commands = ref.watch(pendingCommandsProvider);

    return Scaffold(
      backgroundColor: context.orbit.background,
      appBar: AppBar(title: const Text('Sincronização')),
      body: RefreshIndicator(
        onRefresh: () async {
          await ref.read(syncControllerProvider.notifier).sync(manual: true);
          await ref
              .read(mediaUploadControllerProvider.notifier)
              .process(manual: true);
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
            const SizedBox(height: OrbitSpacing.lg),
            commands.when(
              loading: () => const SectionLoading(lines: 3),
              error: (error, _) => SectionError(error: error),
              data: (value) => _Queue(commands: value),
            ),

            const SizedBox(height: OrbitSpacing.lg),

            /// Evidências têm seção própria: são outra fila, com outra
            /// política. Uma frase só ("3 itens pendentes") faria o técnico
            /// achar que enviar a foto resolveu o checklist.
            const _MediaQueueSection(),
          ],
        ),
      ),
    );
  }
}

/// As evidências que ainda não viraram Evidence canônica.
class _MediaQueueSection extends ConsumerWidget {
  const _MediaQueueSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final media = ref.watch(allPendingMediaProvider);

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
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (final value in items)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Wrap(
                    spacing: OrbitSpacing.sm,
                    runSpacing: 4,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Text(
                        value.filename,
                        style: OrbitType.body.copyWith(
                          color: context.orbit.ink,
                        ),
                      ),
                      if (value.isBlocked)
                        BlockedBadge(
                          label: evidenceStateLabels[value.state.name]!.label,
                        )
                      else
                        PendingBadge(
                          label: evidenceStateLabels[value.state.name]!.label,
                        ),
                    ],
                  ),
                ),
            ],
          );
        },
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
                        syncPhaseLabels[state.phase.name] ?? 'Sincronização',
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
                          '${OrbitFormat.dateHourOf(at)}',
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

class _Queue extends StatelessWidget {
  const _Queue({required this.commands});

  final List<PendingCommand> commands;

  @override
  Widget build(BuildContext context) {
    if (commands.isEmpty) {
      return const OrbitEmptyState(
        icon: Icons.cloud_done_outlined,
        title: 'Nada na fila',
        description: 'Tudo o que você registrou já chegou ao servidor.',
      );
    }

    /// O que travou vem primeiro: é o que precisa de alguém.
    final ordered = [
      ...commands.where((value) => value.isBlocking),
      ...commands.where((value) => !value.isBlocking),
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
                  : 'Registrado em ${OrbitFormat.dateHourOf(command.enqueuedAt)}. '
                        'Será enviado quando houver conexão.',
              style: OrbitType.caption.copyWith(color: context.orbit.inkMuted),
            ),

            /// Descartar só aparece para o que o servidor **não** aplicou.
            /// Uma intenção ainda pendente pode estar em voo neste instante.
            if (blocked) ...[
              const SizedBox(height: OrbitSpacing.sm),
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: () => _confirmDiscard(context, ref),
                  icon: const Icon(Icons.delete_outline, size: 18),
                  label: const Text('Descartar esta ação'),
                ),
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
