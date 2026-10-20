/// Configurações do aplicativo.
///
/// ## O que mora aqui, e o que não
///
/// Aqui ficam as escolhas **sobre o aplicativo**: quais avisos chegar, onde
/// conferir o que não subiu, qual versão está instalada. O que é sobre a
/// pessoa — nome, foto, telefone — fica na folha de dados do Perfil, e o que
/// é sobre a empresa não se edita de um celular.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/design/orbit_settings_list.dart';
import '../../../core/errors/orbit_exception.dart';
import '../../../core/routing/orbit_router.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../../core/widgets/section_states.dart';
import '../../sync/application/sync_providers.dart';
import '../application/notification_settings_providers.dart';
import '../data/notification_preferences_repository.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final palette = context.orbit;
    final preferencias = ref.watch(notificationPreferencesProvider);
    final sync = ref.watch(syncControllerProvider);

    return Scaffold(
      backgroundColor: palette.background,
      appBar: AppBar(title: const Text('Configurações')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          OrbitSpacing.gutter,
          OrbitSpacing.md,
          OrbitSpacing.gutter,
          OrbitSpacing.xl2,
        ),
        children: [
          Text(
            'Escolha o que o Orbit avisa neste aparelho. Desligar um aviso '
            'não cancela o trabalho — ele continua na sua lista.',
            style: OrbitType.body.copyWith(color: palette.inkMuted),
          ),
          const SizedBox(height: OrbitSpacing.ml),

          preferencias.when(
            loading: () => const SectionLoading(lines: 3),
            error: (error, _) => SectionError(
              error: error,
              onRetry: () => ref.invalidate(notificationPreferencesProvider),
            ),
            data: (mapa) => OrbitSettingsGroup(
              title: 'Avisos',
              children: [
                for (final tipo in MobileNoticeKind.values)
                  _LinhaDeAviso(tipo: tipo, escolhas: mapa),
              ],
            ),
          ),
          const SizedBox(height: OrbitSpacing.lg),

          OrbitSettingsGroup(
            title: 'Este aparelho',
            children: [
              OrbitSettingsRow(
                icon: Icons.cloud_sync_outlined,
                label: 'Sincronização',
                description: 'O que não subiu deste aparelho',
                value: sync.hasWork
                    ? '${sync.pending + sync.conflicts + sync.rejected + sync.expired}'
                    : 'Em dia',
                onTap: () => context.push(OrbitRoutes.syncCenter),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Um interruptor de aviso.
///
/// O tipo que **não** aparece na resposta do servidor está ligado: o backend
/// só guarda o que foi mexido. Desenhar "desligado" para o que nunca foi
/// tocado faria a pessoa acreditar que não recebe o que recebe.
class _LinhaDeAviso extends ConsumerWidget {
  const _LinhaDeAviso({required this.tipo, required this.escolhas});

  final MobileNoticeKind tipo;
  final Map<String, NoticePreference> escolhas;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final codigo = mobileNoticeCodes[tipo]!;
    final (rotulo, descricao) = mobileNoticeLabels[tipo]!;
    final ligado = escolhas[codigo]?.enabled ?? true;
    final salvando = ref
        .watch(notificationSettingsControllerProvider)
        .isLoading;

    return OrbitSettingsRow(
      icon: switch (tipo) {
        MobileNoticeKind.workAssigned => Icons.assignment_ind_outlined,
        MobileNoticeKind.artifactAvailable => Icons.picture_as_pdf_outlined,
        MobileNoticeKind.syncAttention => Icons.sync_problem_outlined,
      },
      label: rotulo,
      description: descricao,
      trailing: Switch.adaptive(
        value: ligado,
        onChanged: salvando
            ? null
            : (valor) async {
                final ok = await ref
                    .read(notificationSettingsControllerProvider.notifier)
                    .toggle(type: codigo, enabled: valor);
                if (ok || !context.mounted) return;
                final erro = ref
                    .read(notificationSettingsControllerProvider)
                    .error;
                ScaffoldMessenger.maybeOf(context)?.showSnackBar(
                  SnackBar(
                    content: Text(
                      OrbitException.publicCopyForAny(
                        erro,
                        prefixo: 'Não foi possível salvar esta preferência.',
                      ),
                    ),
                  ),
                );
              },
      ),
    );
  }
}
