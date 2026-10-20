/// Escolher a unidade ativa.
///
/// A troca muda o `businessUnitId` que o aplicativo envia nas consultas. O
/// **escopo do token continua sendo do servidor**: escolher outra unidade
/// aqui não dá acesso a nada que a sessão já não tivesse.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/design/orbit_settings_list.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../authentication/domain/session.dart';

Future<void> showUnitSheet(
  BuildContext context,
  WidgetRef ref,
  OrbitSession session,
) => showModalBottomSheet<void>(
  context: context,
  showDragHandle: true,
  backgroundColor: context.orbit.surface,
  builder: (_) => _FolhaDeUnidades(session: session),
);

class _FolhaDeUnidades extends ConsumerWidget {
  const _FolhaDeUnidades({required this.session});

  final OrbitSession session;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final palette = context.orbit;
    final unidades = session.organization?.businessUnits ?? const [];

    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          OrbitSpacing.ml,
          0,
          OrbitSpacing.ml,
          OrbitSpacing.ml,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Organização ativa',
              style: OrbitType.sectionTitle.copyWith(color: palette.ink),
            ),
            const SizedBox(height: 2),
            Text(
              'Filtra as consultas do aplicativo',
              style: OrbitType.caption.copyWith(color: palette.inkMuted),
            ),
            const SizedBox(height: OrbitSpacing.ml),
            Flexible(
              child: SingleChildScrollView(
                child: OrbitSettingsGroup(
                  children: [
                    for (final unidade in unidades)
                      OrbitSettingsRow(
                        icon: unidade.id == session.businessUnitId
                            ? Icons.radio_button_checked
                            : Icons.radio_button_unchecked,
                        iconColor: unidade.id == session.businessUnitId
                            ? palette.accent
                            : palette.inkSubtle,
                        label: unidade.name,
                        description: unidade.city,
                        trailing: const SizedBox.shrink(),
                        onTap: () {
                          ref
                              .read(authControllerProvider.notifier)
                              .selectBusinessUnit(unidade.id);
                          Navigator.of(context).pop();
                        },
                      ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
