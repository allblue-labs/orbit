import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/design/orbit_primitives.dart';
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
