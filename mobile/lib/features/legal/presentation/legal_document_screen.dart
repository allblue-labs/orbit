import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/design/orbit_primitives.dart';
import '../../../core/design/orbit_settings_list.dart';
import '../../../core/presentation/orbit_format.dart';
import '../../../core/routing/orbit_router.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../../core/time/civil_time.dart';
import '../../../core/widgets/section_states.dart';
import '../data/legal_repository.dart';

class LegalLinks extends StatelessWidget {
  const LegalLinks({super.key});
  @override
  Widget build(BuildContext context) => Wrap(
    alignment: WrapAlignment.center,
    children: [
      TextButton(
        onPressed: () => context.push(OrbitRoutes.privacy),
        child: const Text('Política de Privacidade'),
      ),
      TextButton(
        onPressed: () => context.push(OrbitRoutes.terms),
        child: const Text('Termos de Uso'),
      ),
    ],
  );
}

/// "Termos e privacidade" — o mesmo bloco das configurações da web.
///
/// Mesmos títulos, mesmas descrições, e o mesmo texto: as telas abertas daqui
/// leem `/legal/documents/:slug`, a mesma fonte da página `/legal/:slug` da web.
/// As lojas exigem que os termos estejam ao alcance dentro do app, e não só no
/// login — por isso este bloco vive no perfil da equipe e no do cliente.
class LegalDocumentsGroup extends ConsumerWidget {
  const LegalDocumentsGroup({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final palette = context.orbit;
    final versao = ref
        .watch(legalDocumentProvider(LegalDocumentKind.terms))
        .valueOrNull
        ?.version;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        OrbitSettingsGroup(
          title: 'Termos e privacidade',
          children: [
            OrbitSettingsRow(
              key: const Key('legal.terms'),
              icon: Icons.description_outlined,
              label: 'Termos de Uso',
              description:
                  'Planos, pagamentos, cancelamento e responsabilidades.',
              onTap: () => context.push(OrbitRoutes.terms),
            ),
            OrbitSettingsRow(
              key: const Key('legal.privacy'),
              icon: Icons.privacy_tip_outlined,
              label: 'Política de Privacidade',
              description:
                  'Tratamento de dados, conservação, exclusão e seus direitos.',
              onTap: () => context.push(OrbitRoutes.privacy),
            ),
          ],
        ),
        Padding(
          padding: const EdgeInsets.only(
            left: OrbitSpacing.xs,
            top: OrbitSpacing.sm,
          ),
          child: Text(
            versao == null
                ? 'Consulte os documentos do Orbit e guarde uma cópia.'
                : 'Consulte os documentos do Orbit e guarde uma cópia. Versão $versao.',
            style: OrbitType.caption.copyWith(color: palette.inkMuted),
          ),
        ),
      ],
    );
  }
}

class LegalDocumentScreen extends ConsumerWidget {
  const LegalDocumentScreen({super.key, required this.kind});
  final LegalDocumentKind kind;

  @override
  Widget build(BuildContext context, WidgetRef ref) => Scaffold(
    backgroundColor: context.orbit.background,
    appBar: AppBar(title: Text(kind.title)),
    body: ref
        .watch(legalDocumentProvider(kind))
        .when(
          loading: () => const Padding(
            padding: EdgeInsets.all(OrbitSpacing.gutter),
            child: SectionLoading(lines: 8),
          ),
          error: (error, _) => ListView(
            padding: const EdgeInsets.all(OrbitSpacing.gutter),
            children: [
              SectionError(
                error: error,
                onRetry: () => ref.invalidate(legalDocumentProvider(kind)),
              ),
            ],
          ),
          data: (document) {
            final palette = context.orbit;
            final effectiveAt = CivilDate.tryParse(document.effectiveAt);
            return SelectionArea(
              child: ListView(
                padding: const EdgeInsets.all(OrbitSpacing.gutter),
                children: [
                  OrbitPanel(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(
                          kind == LegalDocumentKind.privacy
                              ? Icons.privacy_tip_outlined
                              : Icons.description_outlined,
                          color: palette.accent,
                        ),
                        const SizedBox(height: OrbitSpacing.md),
                        Semantics(
                          header: true,
                          child: Text(
                            document.title,
                            style: OrbitType.sectionTitle.copyWith(
                              color: palette.ink,
                            ),
                          ),
                        ),
                        const SizedBox(height: OrbitSpacing.sm),
                        Text(
                          'Versão ${document.version}${effectiveAt == null ? '' : ' · Vigência: ${OrbitFormat.shortDate(effectiveAt)}'}',
                          style: OrbitType.caption.copyWith(
                            color: palette.inkMuted,
                          ),
                        ),
                        const SizedBox(height: OrbitSpacing.md),
                        Text(
                          [
                            document.provider['name'],
                            if (document.provider['document'] != null)
                              'CNPJ ${document.provider['document']}',
                            document.provider['location'],
                            document.provider['privacyEmail'],
                          ].whereType<String>().join('\n'),
                          style: OrbitType.body.copyWith(
                            color: palette.inkMuted,
                            height: 1.6,
                          ),
                        ),
                      ],
                    ),
                  ),
                  for (final section in document.sections) ...[
                    const SizedBox(height: OrbitSpacing.lg),
                    Semantics(
                      header: true,
                      child: Text(
                        section.title,
                        style: OrbitType.itemTitle.copyWith(color: palette.ink),
                      ),
                    ),
                    for (final paragraph in section.paragraphs) ...[
                      const SizedBox(height: OrbitSpacing.sm),
                      Text(
                        paragraph,
                        style: OrbitType.body.copyWith(
                          color: palette.inkMuted,
                          height: 1.65,
                        ),
                      ),
                    ],
                  ],
                  const SizedBox(height: OrbitSpacing.xl2),
                ],
              ),
            );
          },
        ),
  );
}
