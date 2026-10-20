/// Registrar uma evidência.
///
/// O fluxo é deliberadamente em dois tempos:
///
/// ```text
/// escolher  →  ver  →  confirmar  →  guardar  →  tentar enviar
/// ```
///
/// Enviar direto ao tocar o obturador parece mais rápido até a primeira foto
/// tremida ou do chão virar evidência de um atendimento — e evidência aceita
/// não se apaga do aparelho.
library;

import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/contracts/mobile_evidence_contracts.dart';
import '../../../core/presentation/field_registry.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../sync/application/sync_providers.dart';
import '../application/evidence_providers.dart';
import '../data/evidence_intake.dart';
import '../data/media_capture.dart';

Future<void> showCaptureSheet(
  BuildContext context,
  FieldEvidenceTargetRef target,
) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  builder: (context) => _CaptureSheet(target: target),
);

class _CaptureSheet extends ConsumerStatefulWidget {
  const _CaptureSheet({required this.target});

  final FieldEvidenceTargetRef target;

  @override
  ConsumerState<_CaptureSheet> createState() => _CaptureSheetState();
}

class _CaptureSheetState extends ConsumerState<_CaptureSheet> {
  /// O arquivo escolhido, ainda **não** registrado.
  ///
  /// Enquanto está aqui, nada foi gravado no diretório do app e nada foi
  /// enviado. Cancelar não deixa rastro.
  ({Uint8List bytes, String filename, EvidenceSource source})? _picked;

  EvidenceCategory _category = EvidenceCategory.general;
  String? _problem;
  bool _saving = false;

  Future<void> _choose(Future<CapturedFile?> Function() pick) async {
    setState(() => _problem = null);
    try {
      final file = await pick();
      if (file == null || !mounted) return;

      /// A checagem local roda na escolha, antes da confirmação: recusar aqui
      /// poupa a pessoa de confirmar algo que o servidor rejeitaria — e as
      /// duas checagens leem os mesmos primeiros bytes.
      final check = checkEvidenceFile(file.bytes);
      if (!check.isValid) {
        setState(() {
          _problem = evidenceFileProblemLabels[check.problem!.name];
          _picked = null;
        });
        return;
      }

      setState(
        () => _picked = (
          bytes: file.bytes,
          filename: file.filename,
          source: switch (file.origin) {
            CaptureOrigin.camera => EvidenceSource.camera,
            CaptureOrigin.gallery => EvidenceSource.gallery,
            CaptureOrigin.file => EvidenceSource.file,
          },
        ),
      );
    } on CaptureException catch (error) {
      if (mounted) {
        setState(() => _problem = captureProblemLabels[error.problem.name]);
      }
    }
  }

  Future<void> _confirm() async {
    final picked = _picked;
    final scope = ref.read(commandScopeProvider);
    if (picked == null || scope == null || _saving) return;

    setState(() => _saving = true);
    try {
      final check = checkEvidenceFile(picked.bytes);
      if (!check.isValid) return;

      /// Persistir vem antes de qualquer rede. Só depois disto a captura
      /// sobrevive a fechar o aplicativo.
      final media = await intakeEvidence(
        files: ref.read(mediaQueueProvider).files,
        bytes: picked.bytes,
        filename: picked.filename,
        mimeType: check.mimeType!,
        scope: scope,
        target: widget.target,
        category: _category,
        source: picked.source,
      );

      await ref.read(mediaUploadControllerProvider.notifier).enqueue(media);

      if (mounted) Navigator.of(context).pop();
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final picked = _picked;

    return Padding(
      padding: EdgeInsets.only(
        left: OrbitSpacing.md,
        right: OrbitSpacing.md,
        top: OrbitSpacing.md,
        bottom: MediaQuery.viewInsetsOf(context).bottom + OrbitSpacing.md,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Registrar evidência',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: OrbitSpacing.sm),

            if (_problem case final String message) ...[
              Text(
                message,
                style: const TextStyle(fontSize: 13, color: OrbitColors.danger),
              ),
              const SizedBox(height: OrbitSpacing.sm),
            ],

            if (picked == null) ...[
              /// A permissão é pedida aqui, quando a pessoa escolhe a origem —
              /// não na abertura do aplicativo.
              _SourceTile(
                icon: Icons.photo_camera_outlined,
                label: 'Tirar foto',
                onTap: () =>
                    _choose(ref.read(mediaCaptureSourceProvider).takePhoto),
              ),
              _SourceTile(
                icon: Icons.photo_library_outlined,
                label: 'Escolher da galeria',
                onTap: () =>
                    _choose(ref.read(mediaCaptureSourceProvider).pickImage),
              ),
              _SourceTile(
                icon: Icons.description_outlined,
                label: 'Anexar PDF',
                onTap: () =>
                    _choose(ref.read(mediaCaptureSourceProvider).pickDocument),
              ),
            ] else ...[
              /// A prévia do que está prestes a virar evidência.
              Container(
                constraints: const BoxConstraints(maxHeight: 240),
                decoration: BoxDecoration(
                  color: Colors.black12,
                  borderRadius: OrbitRadius.card,
                ),
                child: picked.filename.toLowerCase().endsWith('.pdf')
                    ? const Padding(
                        padding: EdgeInsets.all(OrbitSpacing.lg),
                        child: Icon(Icons.description_outlined, size: 48),
                      )
                    : Image.memory(
                        picked.bytes,
                        fit: BoxFit.contain,
                        semanticLabel: 'Prévia da evidência escolhida',

                        /// Bytes que passaram na checagem ainda podem não
                        /// decodificar. Dizer isso é melhor que uma caixa
                        /// vazia.
                        errorBuilder: (context, _, __) => const Padding(
                          padding: EdgeInsets.all(OrbitSpacing.md),
                          child: Text(
                            'Não foi possível exibir esta imagem.',
                            style: TextStyle(
                              fontSize: 13,
                              color: OrbitColors.danger,
                            ),
                          ),
                        ),
                      ),
              ),
              const SizedBox(height: OrbitSpacing.md),

              const Text(
                'Categoria',
                style: TextStyle(
                  fontSize: 12,
                  color: OrbitColors.textSecondary,
                ),
              ),
              const SizedBox(height: 4),
              Wrap(
                spacing: OrbitSpacing.sm,
                runSpacing: 4,
                children: [
                  for (final category in EvidenceCategory.values)
                    ChoiceChip(
                      label: Text(
                        evidenceCategoryLabel(evidenceCategoryWire(category)),
                      ),
                      selected: _category == category,
                      onSelected: (_) => setState(() => _category = category),
                    ),
                ],
              ),
              const SizedBox(height: OrbitSpacing.md),

              FilledButton(
                onPressed: _saving ? null : _confirm,
                style: FilledButton.styleFrom(minimumSize: const Size(0, 48)),
                child: Text(_saving ? 'Salvando…' : 'Confirmar evidência'),
              ),
              TextButton(
                /// Cancelar antes de confirmar não deixa arquivo para trás:
                /// nada foi gravado ainda.
                onPressed: _saving
                    ? null
                    : () => setState(() => _picked = null),
                child: const Text('Escolher outro arquivo'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _SourceTile extends StatelessWidget {
  const _SourceTile({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => ListTile(
    onTap: onTap,
    contentPadding: EdgeInsets.zero,
    leading: Icon(icon),
    title: Text(label, style: const TextStyle(fontSize: 15)),
    trailing: const Icon(Icons.chevron_right),
  );
}
