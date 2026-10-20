/// A caixa de avisos.
///
/// A home mostra os mais recentes num carrossel; aqui está a lista inteira,
/// com o que **não** foi lido em cima.
///
/// ## O agrupamento é de apresentação, não de ordem
///
/// O servidor manda por data. A tela separa em dois blocos — não lidos e
/// anteriores — e dentro de cada bloco a ordem recebida é preservada. Sem
/// isso, um aviso de hoje não lido some no meio de trinta lidos de ontem, que
/// é como se perde o aviso que importava.
///
/// Tocar num aviso o marca como lido e leva ao que ele é sobre. É o gesto que
/// a pessoa já fez; pedir um segundo toque para confirmar leitura seria
/// burocracia, e ler sem poder ir até lá transforma a caixa num mural.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/contracts/notification_contracts.dart';
import '../../../core/design/orbit_primitives.dart';
import '../../../core/errors/orbit_exception.dart';
import '../../../core/presentation/orbit_format.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../../core/widgets/section_states.dart';
import '../application/notification_providers.dart';
import '../domain/deep_link.dart';

class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final avisos = ref.watch(notificationsProvider);
    final dados = avisos.valueOrNull?.value;
    final naoLidos = dados?.unread ?? 0;

    return Scaffold(
      backgroundColor: context.orbit.background,
      appBar: AppBar(
        title: const Text('Avisos'),
        actions: [
          if (naoLidos > 0)
            TextButton(
              onPressed: () => _marcarTudo(context, ref),
              child: const Text('Marcar lidos'),
            ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(notificationsProvider),
        child: switch ((dados, avisos.hasError)) {
          (final OrbitNotificationPage pagina, _) when pagina.data.isNotEmpty =>
            _Lista(pagina: pagina),
          (final OrbitNotificationPage _, _) => ListView(
            padding: const EdgeInsets.all(OrbitSpacing.gutter),
            children: const [
              SizedBox(height: OrbitSpacing.xl),
              OrbitEmptyState(
                icon: Icons.notifications_none_rounded,
                title: 'Nenhum aviso',
                description: 'Avisos sobre o seu trabalho aparecem aqui.',
              ),
            ],
          ),
          (_, true) => ListView(
            padding: const EdgeInsets.all(OrbitSpacing.gutter),
            children: [
              SectionError(
                error: avisos.error!,
                onRetry: () => ref.invalidate(notificationsProvider),
              ),
            ],
          ),
          _ => const Padding(
            padding: EdgeInsets.all(OrbitSpacing.gutter),
            child: SectionLoading(lines: 6),
          ),
        },
      ),
    );
  }

  Future<void> _marcarTudo(BuildContext context, WidgetRef ref) async {
    final mensageiro = ScaffoldMessenger.maybeOf(context);
    try {
      await ref.read(notificationRepositoryProvider).markAllRead();
      ref.invalidate(notificationsProvider);
    } on Object catch (error) {
      /// A frase é a do aplicativo; o objeto de erro nunca vira texto.
      mensageiro?.showSnackBar(
        SnackBar(
          content: Text(
            OrbitException.publicCopyForAny(
              error,
              prefixo: 'Não foi possível marcar os avisos como lidos.',
            ),
          ),
        ),
      );
    }
  }
}

class _Lista extends StatelessWidget {
  const _Lista({required this.pagina});

  final OrbitNotificationPage pagina;

  @override
  Widget build(BuildContext context) {
    final novos = pagina.data.where((aviso) => aviso.isUnread).toList();
    final antigos = pagina.data.where((aviso) => !aviso.isUnread).toList();

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        OrbitSpacing.gutter,
        OrbitSpacing.md,
        OrbitSpacing.gutter,
        OrbitSpacing.xl,
      ),
      children: [
        if (novos.isNotEmpty) ...[
          _Titulo(
            novos.length == 1 ? '1 não lido' : '${novos.length} não lidos',
          ),
          _Grupo(avisos: novos),
        ],
        if (antigos.isNotEmpty) ...[
          if (novos.isNotEmpty) const SizedBox(height: OrbitSpacing.lg),
          const _Titulo('Anteriores'),
          _Grupo(avisos: antigos),
        ],
      ],
    );
  }
}

class _Titulo extends StatelessWidget {
  const _Titulo(this.texto);

  final String texto;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(
      left: OrbitSpacing.xs,
      bottom: OrbitSpacing.sm,
    ),
    child: Text(
      texto.toUpperCase(),
      style: OrbitType.eyebrow.copyWith(color: context.orbit.inkSubtle),
    ),
  );
}

class _Grupo extends StatelessWidget {
  const _Grupo({required this.avisos});

  final List<OrbitNotification> avisos;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: palette.surface,
        borderRadius: OrbitRadius.card,
        boxShadow: OrbitShadow.card,
      ),
      child: ClipRRect(
        borderRadius: OrbitRadius.card,
        child: Column(
          children: [
            for (final (indice, aviso) in avisos.indexed) ...[
              if (indice > 0) const OrbitRowDivider(),
              _AvisoRow(aviso: aviso),
            ],
          ],
        ),
      ),
    );
  }
}

class _AvisoRow extends ConsumerWidget {
  const _AvisoRow({required this.aviso});

  final OrbitNotification aviso;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final palette = context.orbit;

    return Material(
      /// O não lido tem fundo levemente tingido, além do ponto.
      ///
      /// Um ponto de 8 pixels é a única diferença que existia entre lido e
      /// não lido, e ele fica na ponta direita da linha — do outro lado de
      /// onde os olhos começam a ler.
      color: aviso.isUnread ? palette.accentSoft : palette.surface,
      child: InkWell(
        onTap: () => _abrir(context, ref),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: OrbitSpacing.md,
            vertical: OrbitSpacing.ms,
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.only(top: 5),
                child: Container(
                  width: 8,
                  height: 8,
                  decoration: BoxDecoration(
                    color: aviso.isUnread ? palette.accent : Colors.transparent,
                    shape: BoxShape.circle,
                  ),
                ),
              ),
              const SizedBox(width: OrbitSpacing.ms),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      aviso.title,
                      style: OrbitType.itemTitle.copyWith(
                        color: palette.ink,
                        fontWeight: aviso.isUnread
                            ? FontWeight.w700
                            : FontWeight.w600,
                      ),
                    ),
                    if (aviso.body case final String corpo
                        when corpo.isNotEmpty) ...[
                      const SizedBox(height: 3),
                      Text(
                        corpo,
                        style: OrbitType.caption.copyWith(
                          color: palette.inkMuted,
                        ),
                      ),
                    ],
                    const SizedBox(height: 6),
                    Text(
                      OrbitFormat.dateHourOf(aviso.createdAt),
                      style: OrbitType.caption.copyWith(
                        color: palette.inkSubtle,
                      ),
                    ),
                  ],
                ),
              ),
              if (routeForNotificationPayload(aviso.payload) != null) ...[
                const SizedBox(width: OrbitSpacing.sm),
                Icon(
                  Icons.chevron_right_rounded,
                  size: 20,
                  color: palette.inkSubtle,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _abrir(BuildContext context, WidgetRef ref) async {
    final destino = routeForNotificationPayload(aviso.payload);
    if (aviso.isUnread) {
      await ref.read(notificationRepositoryProvider).markRead(aviso.id);
      ref.invalidate(notificationsProvider);
    }
    if (destino == null || !context.mounted) return;
    context.push(destino);
  }
}
