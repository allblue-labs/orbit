/// Preview efêmero da assinatura profissional ativa.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/orbit_theme.dart';
import '../../../../core/widgets/section_states.dart';
import '../../application/signature_providers.dart';

class ProfessionalSignaturePreview extends ConsumerWidget {
  const ProfessionalSignaturePreview({super.key, this.height = 112});

  final double height;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final preview = ref.watch(signaturePreviewProvider);
    return preview.when(
      loading: () => SizedBox(
        key: const Key('signature.preview.loading'),
        height: height,
        child: const Center(child: CircularProgressIndicator.adaptive()),
      ),
      error: (error, _) => SizedBox(
        key: const Key('signature.preview.error'),
        child: SectionError(
          error: error,
          onRetry: () {
            ref.invalidate(signatureStatusProvider);
            ref.invalidate(signaturePreviewProvider);
          },
        ),
      ),
      data: (bytes) {
        if (bytes == null) {
          return const SectionEmpty(
            key: Key('signature.preview.empty'),
            icon: Icons.draw_outlined,
            message: 'A imagem da assinatura ainda não está disponível.',
          );
        }
        return Semantics(
          image: true,
          label: 'Prévia da sua assinatura profissional',
          child: Container(
            key: const Key('signature.preview.image'),
            height: height,
            width: double.infinity,
            padding: const EdgeInsets.all(OrbitSpacing.sm),
            decoration: BoxDecoration(
              color: Colors.white,
              border: Border.all(color: context.orbit.border),
              borderRadius: OrbitRadius.card,
            ),
            child: Image.memory(
              bytes,
              fit: BoxFit.contain,
              gaplessPlayback: true,
              filterQuality: FilterQuality.medium,
            ),
          ),
        );
      },
    );
  }
}
