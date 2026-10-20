import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/contracts/mobile_evidence_contracts.dart';
import '../../../../core/theme/orbit_theme.dart';
import '../../application/evidence_providers.dart';

/// The parent mounts at most six previews; URLs never become persistent fields.
class EvidencePreview extends ConsumerWidget {
  const EvidencePreview({super.key, required this.evidence});
  final FieldEvidence evidence;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final image = ref.watch(evidenceThumbnailProvider(evidence));
    final p = context.orbit;
    Widget placeholder() =>
        Center(child: Icon(Icons.image_outlined, color: p.inkSubtle));
    return Semantics(
      label: evidence.filename,
      image: true,
      child: ClipRRect(
        borderRadius: OrbitRadius.field,
        child: AspectRatio(
          aspectRatio: 4 / 3,
          child: ColoredBox(
            color: p.surfaceMuted,
            child: image.when(
              loading: () => Center(
                child: SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: p.inkSubtle,
                  ),
                ),
              ),
              error: (_, __) => placeholder(),
              data: (bytes) => bytes == null
                  ? placeholder()
                  : Image.memory(
                      bytes,
                      fit: BoxFit.cover,
                      cacheWidth: 320,
                      errorBuilder: (_, __, ___) => placeholder(),
                    ),
            ),
          ),
        ),
      ),
    );
  }
}
