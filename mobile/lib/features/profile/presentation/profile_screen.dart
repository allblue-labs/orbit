/// Perfil — quem está usando o aplicativo, e o que ele controla.
///
/// ## A única tela que não é sobre o trabalho
///
/// Todas as outras respondem "o que eu faço agora". Esta responde "quem eu
/// sou aqui e como mexo nisto". Por isso ela é a que mais se parece com o
/// sistema operacional e menos com o resto do produto: quem abre procura um
/// caminho ou um interruptor, e reconhece a forma antes de ler o rótulo.
///
/// ## A ordem
///
/// ```text
/// identidade      quem é, com a foto no centro
/// atalhos         assinatura e configurações — o que se abre com frequência
/// pendências      o que está preso neste aparelho
/// listas          conta, avisos, organização
/// sair            por último, e em vermelho
/// ```
///
/// Contexto de organização e unidade desceu para o fim: é informação de
/// conferência, não de ação, e ocupava o topo porque era o que existia.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/providers.dart';
import '../../../core/design/orbit_settings_list.dart';
import '../../../core/routing/orbit_router.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../authentication/domain/session.dart';
import '../../notifications/application/notification_providers.dart';
import '../../signature/application/signature_providers.dart';
import '../../sync/application/sync_controller.dart';
import '../../sync/application/sync_providers.dart';
import 'edit_profile_sheet.dart';
import 'my_avatar.dart';
import 'unit_sheet.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);
    if (session == null) return const SizedBox.shrink();

    final palette = context.orbit;
    final sync = ref.watch(syncControllerProvider);
    final signature = ref.watch(signatureStatusProvider);
    final units = session.organization?.businessUnits ?? const [];

    return Scaffold(
      backgroundColor: palette.background,
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          OrbitSpacing.gutter,
          OrbitSpacing.sm,
          OrbitSpacing.gutter,
          OrbitSpacing.xl2,
        ),
        children: [
          SafeArea(bottom: false, child: _Identidade(session: session)),
          const SizedBox(height: OrbitSpacing.lg),

          /// Os dois atalhos.
          ///
          /// Assinatura mora aqui — e não escondida dentro de um atendimento —
          /// porque ela pertence à pessoa, e quem precisa cadastrá-la costuma
          /// descobrir isso longe do campo.
          ///
          /// Lado a lado em tela normal; um sobre o outro com o texto
          /// ampliado, onde meia largura de 320 pixels transformava
          /// "Assinatura" em "Assin…" e quebrava "Cadastrada" no meio.
          _Atalhos(
            lado: MediaQuery.textScalerOf(context).scale(1) <= 1.3,
            children: [
              _Atalho(
                key: const Key('profile.signature.action'),
                icon: Icons.draw_outlined,
                rotulo: 'Assinatura',

                /// A falha da leitura vira "Não verificado", e não um traço:
                /// um traço passa por "não tem", e a pessoa iria cadastrar
                /// uma assinatura que já existe. O erro de verdade, com nova
                /// tentativa, está a um toque daqui — na tela da assinatura,
                /// que faz a própria leitura.
                detalhe: signature.when(
                  data: (status) =>
                      status.signatureAvailable ? 'Cadastrada' : 'Pendente',
                  loading: () => 'Verificando…',
                  error: (_, __) => 'Não verificado',
                ),
                alerta: signature.maybeWhen(
                  data: (status) => !status.signatureAvailable,
                  orElse: () => false,
                ),
                onTap: () => context.push(OrbitRoutes.mySignature),
              ),
              _Atalho(
                key: const Key('profile.settings.action'),
                icon: Icons.tune_rounded,
                rotulo: 'Configurações',
                detalhe: 'Notificações e app',
                onTap: () => context.push(OrbitRoutes.settings),
              ),
            ],
          ),
          const SizedBox(height: OrbitSpacing.lg),

          _AcoesPendentes(sync: sync),
          const SizedBox(height: OrbitSpacing.lg),

          OrbitSettingsGroup(
            title: 'Conta',
            children: [
              OrbitSettingsRow(
                key: const Key('profile.edit'),
                icon: Icons.badge_outlined,
                label: 'Meus dados',
                description: 'Nome, telefone e foto',
                onTap: () => showEditProfileSheet(context),
              ),
              OrbitSettingsRow(
                key: const Key('profile.unit'),
                icon: Icons.apartment_outlined,
                label: 'Organização ativa',
                value: session.businessUnit?.name ?? '—',

                /// Com uma unidade só não há o que escolher, e uma seta que
                /// abre uma lista de um item é uma promessa vazia.
                onTap: units.length > 1
                    ? () => showUnitSheet(context, ref, session)
                    : null,
              ),
            ],
          ),
          const SizedBox(height: OrbitSpacing.lg),

          OrbitSettingsGroup(
            title: 'Avisos',
            children: [
              OrbitSettingsRow(
                key: const Key('profile.notifications'),
                icon: Icons.notifications_none_rounded,
                label: 'Meus avisos',
                description: 'O que o Orbit me mandou',
                trailing: _ContadorDeAvisos(),
                onTap: () => context.push(OrbitRoutes.notifications),
              ),
            ],
          ),
          const SizedBox(height: OrbitSpacing.lg),

          OrbitSettingsGroup(
            title: 'Organização',
            children: [
              OrbitSettingsRow(
                icon: Icons.business_outlined,
                label: 'Empresa',
                value: session.organization?.displayName ?? '—',
              ),
              OrbitSettingsRow(
                icon: Icons.shield_outlined,
                label: 'Perfil no app',
                value: session.profile == OrbitProfile.owner
                    ? 'Gestão'
                    : 'Operação',
              ),
            ],
          ),
          const SizedBox(height: OrbitSpacing.lg),

          OrbitSettingsGroup(
            children: [
              OrbitSettingsRow(
                key: const Key('profile.logout'),
                icon: Icons.logout_rounded,
                label: 'Sair da conta',
                tone: palette.danger,
                onTap: () => logout(context, ref),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/* ------------------------------------------------------------------ */
/* Identidade                                                          */
/* ------------------------------------------------------------------ */

/// A foto no centro, o nome embaixo.
///
/// Centralizado porque esta é a única tela cujo assunto é a pessoa. Em todas
/// as outras o avatar é um canto; aqui ele é o tema.
class _Identidade extends StatelessWidget {
  const _Identidade({required this.session});

  final OrbitSession session;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;

    return Column(
      children: [
        Semantics(
          button: true,
          label: 'Alterar foto de perfil',
          excludeSemantics: true,
          child: InkWell(
            onTap: () => showEditProfileSheet(context),
            customBorder: const CircleBorder(),
            child: Stack(
              children: [
                MyAvatar(initials: session.user.initials, size: 88),

                /// O selo da câmera diz que a foto é tocável. Sem ele, um
                /// avatar é decoração — ninguém tenta tocar numa.
                Positioned(
                  right: 0,
                  bottom: 0,
                  child: Container(
                    width: 28,
                    height: 28,
                    decoration: BoxDecoration(
                      color: palette.accent,
                      shape: BoxShape.circle,
                      border: Border.all(color: palette.background, width: 2),
                    ),
                    child: const Icon(
                      Icons.photo_camera_rounded,
                      size: 14,
                      color: Colors.white,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: OrbitSpacing.ms),
        Text(
          session.user.displayName,
          style: OrbitType.screenTitle.copyWith(
            color: palette.ink,
            fontSize: 21,
          ),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 2),
        Text(
          session.user.email,
          style: OrbitType.caption.copyWith(color: palette.inkMuted),
          textAlign: TextAlign.center,
        ),
      ],
    );
  }
}

/* ------------------------------------------------------------------ */
/* Atalhos                                                             */
/* ------------------------------------------------------------------ */

/// Os dois atalhos, lado a lado ou um sobre o outro.
///
/// O `Expanded` fica aqui dentro, e não em quem chama: `Expanded` é filho
/// legítimo de `Row`, e ilegal dentro de `Column` com altura livre. Deixar a
/// decisão no chamador convidaria a um erro que só aparece na escala grande.
class _Atalhos extends StatelessWidget {
  const _Atalhos({required this.lado, required this.children});

  /// Lado a lado quando cabe; empilhados quando o texto está ampliado.
  final bool lado;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    if (lado) {
      return IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (final (posicao, filho) in children.indexed) ...[
              if (posicao > 0) const SizedBox(width: OrbitSpacing.ms),
              Expanded(child: filho),
            ],
          ],
        ),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final (posicao, filho) in children.indexed) ...[
          if (posicao > 0) const SizedBox(height: OrbitSpacing.ms),
          filho,
        ],
      ],
    );
  }
}

/// Um dos dois botões arredondados.
class _Atalho extends StatelessWidget {
  const _Atalho({
    super.key,
    required this.icon,
    required this.rotulo,
    required this.detalhe,
    required this.onTap,
    this.alerta = false,
  });

  final IconData icon;
  final String rotulo;
  final String detalhe;
  final VoidCallback onTap;

  /// Pinta o detalhe de âmbar. Para "assinatura pendente", que é a coisa
  /// que trava uma assinatura de cliente no meio do campo.
  final bool alerta;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return Semantics(
      button: true,
      label: '$rotulo, $detalhe',
      excludeSemantics: true,

      /// A sombra vai na caixa **preenchida**, por fora do `Material`.
      ///
      /// Quando ela morava numa `BoxDecoration` sem cor, por dentro, era
      /// pintada por cima do branco e o cartão inteiro saía cinza — dava
      /// para ver na captura ao lado dos grupos de ajustes, que são brancos.
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: palette.surface,
          borderRadius: OrbitRadius.card,
          boxShadow: OrbitShadow.card,
        ),
        child: Material(
          color: Colors.transparent,
          borderRadius: OrbitRadius.card,
          child: InkWell(
            onTap: onTap,
            borderRadius: OrbitRadius.card,
            child: Padding(
              padding: const EdgeInsets.all(OrbitSpacing.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 36,
                    height: 36,
                    decoration: BoxDecoration(
                      color: palette.accentSoft,
                      borderRadius: OrbitRadius.pill,
                    ),
                    child: Icon(icon, size: 19, color: palette.accentStrong),
                  ),
                  const SizedBox(height: OrbitSpacing.sm),
                  Text(
                    rotulo,
                    style: OrbitType.itemTitle.copyWith(color: palette.ink),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 2),
                  Text(
                    detalhe,
                    style: OrbitType.caption.copyWith(
                      color: alerta ? palette.warning : palette.inkSubtle,
                      fontWeight: alerta ? FontWeight.w600 : FontWeight.w400,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/* ------------------------------------------------------------------ */
/* Ações pendentes                                                     */
/* ------------------------------------------------------------------ */

/// O que ainda não chegou ao servidor.
///
/// Tem cartão próprio, e não uma linha na lista, porque é a única coisa
/// nesta tela que pode estar **errada agora**. Quem termina um atendimento
/// no subsolo de um prédio precisa de um lugar para conferir se o trabalho
/// subiu — e precisa vê-lo sem procurar.
class _AcoesPendentes extends StatelessWidget {
  const _AcoesPendentes({required this.sync});

  final SyncState sync;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final total = sync.pending + sync.conflicts + sync.rejected + sync.expired;
    final atencao = sync.needsAttention;
    final pendente = sync.pending > 0;

    final (cor, icone, titulo, descricao) = atencao
        ? (
            palette.danger,
            Icons.error_outline_rounded,
            'Ações pendentes',
            'Algo precisa da sua atenção',
          )
        : pendente
        ? (
            palette.warning,
            Icons.cloud_queue_rounded,
            'Ações pendentes',
            '$total ${total == 1 ? "ação" : "ações"} neste aparelho',
          )
        : (
            palette.success,
            Icons.cloud_done_outlined,
            'Ações pendentes',
            'Tudo sincronizado',
          );

    return DecoratedBox(
      decoration: BoxDecoration(
        color: palette.surface,
        borderRadius: OrbitRadius.card,
        boxShadow: OrbitShadow.card,
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: OrbitRadius.card,
        child: InkWell(
          onTap: () => context.push(OrbitRoutes.syncCenter),
          borderRadius: OrbitRadius.card,
          child: Padding(
            padding: const EdgeInsets.all(OrbitSpacing.md),
            child: Row(
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
                        titulo,
                        style: OrbitType.itemTitle.copyWith(color: palette.ink),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        descricao,
                        style: OrbitType.caption.copyWith(
                          color: atencao ? cor : palette.inkMuted,
                        ),
                      ),
                    ],
                  ),
                ),
                Icon(
                  Icons.chevron_right_rounded,
                  size: 20,
                  color: palette.inkSubtle,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// O número do sino, na linha de avisos.
class _ContadorDeAvisos extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final palette = context.orbit;
    final avisos = ref.watch(notificationsProvider);
    final naoLidos = avisos.maybeWhen(
      data: (pagina) => pagina.value.unread,
      orElse: () => 0,
    );

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (naoLidos > 0)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
            decoration: BoxDecoration(
              color: palette.danger,
              borderRadius: OrbitRadius.pill,
            ),
            child: Text(
              naoLidos > 99 ? '99+' : '$naoLidos',
              style: OrbitType.numeric.copyWith(
                fontSize: 12,
                color: Colors.white,
              ),
            ),
          ),
        const SizedBox(width: OrbitSpacing.xs),
        Icon(Icons.chevron_right_rounded, size: 20, color: palette.inkSubtle),
      ],
    );
  }
}

/* ------------------------------------------------------------------ */
/* Sair                                                                */
/* ------------------------------------------------------------------ */

/// Sair da conta, sem levar o trabalho de ninguém junto.
///
/// Duas decisões distintas:
///
/// - **A projeção do servidor é apagada.** O próprio pacote de campo vem
///   marcado `purgeOnLogout: true`, e ele carrega nome de cliente, endereço e
///   histórico. Isso não fica num aparelho depois que a pessoa sai dele.
/// - **A fila de comandos permanece.** Apagá-la seria destruir o registro de um
///   trabalho que aconteceu de verdade só porque alguém tocou "Sair" antes de
///   pegar sinal. Ela fica presa ao escopo de quem a criou, então o próximo a
///   entrar não a vê nem a envia.
Future<void> logout(BuildContext context, WidgetRef ref) async {
  final sync = ref.read(syncControllerProvider);
  if (sync.hasWork) {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Sair com ações não sincronizadas?'),
        content: Text(
          '${sync.pending + sync.conflicts + sync.rejected + sync.expired} '
          'ação(ões) ainda não chegaram ao servidor. Elas ficam guardadas '
          'neste aparelho e serão enviadas quando você entrar de novo com '
          'esta mesma conta.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Continuar conectado'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Sair mesmo assim'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
  }

  // Authentication owns device revocation and session data cleanup for every
  // exit path, including the mandatory password-change screen.
  await ref.read(authControllerProvider.notifier).logout();
}
