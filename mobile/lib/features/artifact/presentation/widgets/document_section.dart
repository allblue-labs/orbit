/// O documento de um atendimento.
///
/// Etapa separada da execução, e a tela diz isso: um atendimento concluído
/// aparece como concluído, e o documento como o que ele for — ainda não
/// emitido, em processamento, disponível ou falho. Nunca "concluído e
/// assinado" sem fato que sustente.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/contracts/mobile_field_artifact_contracts.dart';
import '../../../../core/errors/orbit_exception.dart';
import '../../../../core/presentation/field_registry.dart';
import '../../../../core/presentation/orbit_format.dart';
import '../../../../core/theme/orbit_theme.dart';
import '../../../../core/widgets/section_states.dart';
import '../../../documents/application/document_sharing.dart';
import '../../../documents/application/documents_providers.dart';
import '../../application/artifact_controller.dart';
import '../../application/artifact_providers.dart';
import '../../data/document_name.dart';

class DocumentSection extends ConsumerStatefulWidget {
  const DocumentSection({
    super.key,
    required this.source,
    this.fileName,
    this.subject,
  });

  final ArtifactSourceRef source;

  /// O nome do arquivo que chega a quem recebe. Sem ele, um nome genérico — o
  /// documento continua abrindo, mas o cliente não sabe o que é antes de abrir.
  final String? fileName;

  /// O assunto da folha de compartilhamento, lido antes do anexo.
  final String? subject;

  @override
  ConsumerState<DocumentSection> createState() => _DocumentSectionState();
}

class _DocumentSectionState extends ConsumerState<DocumentSection> {
  bool _entregando = false;

  /// Baixa e abre a folha do sistema — e-mail, WhatsApp, o que o aparelho tiver.
  ///
  /// Não é o mesmo que "Baixar": ali o arquivo fica no aparelho, aqui ele **sai**
  /// dele. Em campo o segundo é o caso comum — o cliente pede a OS na hora.
  Future<void> _compartilhar() async {
    if (_entregando) return;
    setState(() => _entregando = true);
    final mensageiro = ScaffoldMessenger.maybeOf(context);
    final artifactId = ref.read(artifactControllerProvider(widget.source)).artifact?.id;

    /// Só o iPad usa a origem; é lá que a ausência lança exceção.
    final caixa = context.findRenderObject();
    final origem = caixa is RenderBox && caixa.hasSize
        ? caixa.localToGlobal(Offset.zero) & caixa.size
        : null;

    try {
      if (artifactId == null) return;
      await for (final estado in ref
          .read(documentSharingProvider)
          .share(
            artifactId: artifactId,
            fileName: widget.fileName ?? documentFileNameOf(const ['documento']),
            subject: widget.subject,
            origin: origem,
          )) {
        if (estado.phase != SharePhase.error) continue;
        mensageiro?.showSnackBar(
          SnackBar(
            content: Text(
              OrbitException.publicCopyForAny(
                estado.error,
                prefixo: 'Não foi possível preparar o documento.',
              ),
            ),
          ),
        );
        return;
      }
    } finally {
      if (mounted) setState(() => _entregando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final source = widget.source;
    final state = ref.watch(artifactControllerProvider(source));
    final controller = ref.read(artifactControllerProvider(source).notifier);

    return SectionBlock(
      title: 'Documento',
      child: state.loading
          ? const SectionLoading(lines: 2)
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _Status(state: state),

                if (state.blockedReasons.isNotEmpty) ...[
                  const SizedBox(height: OrbitSpacing.sm),
                  _Blockers(reasons: state.blockedReasons),
                ],

                if (state.error case final Object error) ...[
                  const SizedBox(height: OrbitSpacing.sm),
                  SectionError(error: error, onRetry: controller.refresh),
                ],

                const SizedBox(height: OrbitSpacing.md),
                _Actions(
                  state: state,
                  controller: controller,
                  onShare: _compartilhar,
                  sharing: _entregando,
                ),
              ],
            ),
    );
  }
}

class _Status extends StatelessWidget {
  const _Status({required this.state});

  final ArtifactState state;

  @override
  Widget build(BuildContext context) {
    final label = documentStatusLabels[state.status.name]!;
    final artifact = state.artifact;

    final (icon, color) = switch (state.status) {
      FieldArtifactStatus.ready => (
        Icons.picture_as_pdf_outlined,
        OrbitColors.success,
      ),
      FieldArtifactStatus.failed => (Icons.error_outline, OrbitColors.danger),
      FieldArtifactStatus.pending || FieldArtifactStatus.rendering => (
        Icons.hourglass_top_outlined,
        OrbitColors.brandBright,
      ),
      _ => (Icons.description_outlined, OrbitColors.textSecondary),
    };

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, size: 20, color: color),
            const SizedBox(width: OrbitSpacing.sm),
            Expanded(
              child: Text(
                label.label,
                style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                  color: OrbitColors.textPrimary,
                ),
              ),
            ),
            if (state.isTransient)
              const SizedBox(
                width: 14,
                height: 14,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
          ],
        ),
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text(
            label.description ?? '',
            style: const TextStyle(
              fontSize: 13,
              color: OrbitColors.textSecondary,
            ),
          ),
        ),

        /// Emitido em, não "congelado em": entre uma coisa e outra há uma
        /// fila, e os dois instantes são diferentes.
        if (artifact?.generatedAt case final at?)
          Padding(
            padding: const EdgeInsets.only(top: OrbitSpacing.sm),
            child: Text(
              'Emitido em ${OrbitFormat.dateHourOf(at)}',
              style: const TextStyle(
                fontSize: 12,
                color: OrbitColors.textSecondary,
              ),
            ),
          ),

        if (state.download.phase != DownloadPhase.idle)
          Padding(
            padding: const EdgeInsets.only(top: OrbitSpacing.sm),
            child: _DownloadStatus(download: state.download),
          ),
      ],
    );
  }
}

/// O que este aparelho conseguiu fazer com o arquivo.
///
/// Separado do estado do documento: o PDF pode estar pronto no servidor e o
/// download ter falhado aqui, e dizer "documento indisponível" nesse caso
/// seria culpar o servidor por um problema de rede local.
class _DownloadStatus extends StatelessWidget {
  const _DownloadStatus({required this.download});

  final DownloadState download;

  @override
  Widget build(BuildContext context) {
    final label = documentDownloadLabels[download.phase.name];
    if (label == null) return const SizedBox.shrink();

    final failed = download.phase == DownloadPhase.error;
    return Semantics(
      liveRegion: true,
      child: Row(
        children: [
          Icon(
            failed
                ? Icons.error_outline
                : download.phase == DownloadPhase.availableLocally
                ? Icons.check_circle_outline
                : Icons.downloading_outlined,
            size: 14,
            color: failed ? OrbitColors.danger : OrbitColors.textSecondary,
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                fontSize: 12,
                color: failed ? OrbitColors.danger : OrbitColors.textSecondary,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// O que falta, em português.
class _Blockers extends StatelessWidget {
  const _Blockers({required this.reasons});

  final List<FieldArtifactBlockedReason> reasons;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(OrbitSpacing.sm),
    decoration: BoxDecoration(
      color: OrbitColors.warning.withValues(alpha: 0.12),
      borderRadius: OrbitRadius.card,
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final reason in reasons)
          Padding(
            padding: const EdgeInsets.only(bottom: 2),
            child: Text(
              documentBlockedLabel(reason.name),
              style: const TextStyle(fontSize: 12, color: OrbitColors.warning),
            ),
          ),
      ],
    ),
  );
}

/// As ações que o servidor publicou — e só elas.
class _Actions extends StatelessWidget {
  const _Actions({
    required this.state,
    required this.controller,
    required this.onShare,
    required this.sharing,
  });

  final ArtifactState state;
  final ArtifactController controller;
  final VoidCallback onShare;
  final bool sharing;

  @override
  Widget build(BuildContext context) {
    final busy = state.mutating;

    /// Congelar e renderizar viraram **um** botão.
    ///
    /// São dois pedidos ao servidor e continuam sendo; para quem está em campo são
    /// uma decisão só. Com os dois expostos, o técnico congelava, achava que tinha
    /// acabado, e o atendimento ficava parado em "pronto para emitir" — o cliente
    /// sem documento e ninguém sabendo por quê.
    final podeEmitir =
        state.allows(FieldArtifactAllowedAction.prepareDocument) ||
        state.allows(FieldArtifactAllowedAction.generateDocument);

    return Wrap(
      spacing: OrbitSpacing.sm,
      runSpacing: OrbitSpacing.sm,
      children: [
        if (podeEmitir)
          _Action(
            label: documentActionLabels[
                state.status == FieldArtifactStatus.failed
                    ? 'retryDocument'
                    : 'issueDocument']!,
            icon: Icons.description_outlined,
            busy: busy,
            primary: true,
            onPressed: controller.issue,
          ),

        /// Compartilhar vem antes de baixar, e é ação de destaque quando o
        /// documento existe: em campo o caso comum é o cliente pedir a OS na hora,
        /// e o que resolve isso é a folha do sistema — não um arquivo guardado no
        /// aparelho do técnico.
        if (state.allows(FieldArtifactAllowedAction.downloadDocument))
          _Action(
            label: sharing
                ? 'Preparando…'
                : documentActionLabels['shareDocument']!,
            icon: Icons.ios_share,
            busy: sharing,
            primary: true,
            onPressed: onShare,
          ),

        if (state.allows(FieldArtifactAllowedAction.viewDocument))
          _Action(
            label: documentActionLabels['viewDocument']!,
            icon: Icons.visibility_outlined,
            busy: state.download.isBusy,
            onPressed: () => controller.download(preview: true),
          ),

        if (state.allows(FieldArtifactAllowedAction.downloadDocument))
          _Action(
            label: documentActionLabels['downloadDocument']!,
            icon: Icons.download_outlined,
            busy: state.download.isBusy,
            onPressed: controller.download,
          ),

        /// Atualizar existe sempre: sem notificação de conclusão, é assim que
        /// a pessoa descobre que o documento ficou pronto.
        _Action(
          label: 'Atualizar',
          icon: Icons.refresh,
          busy: busy,
          onPressed: controller.refresh,
        ),
      ],
    );
  }
}

class _Action extends StatelessWidget {
  const _Action({
    required this.label,
    required this.icon,
    required this.busy,
    required this.onPressed,
    this.primary = false,
  });

  final String label;
  final IconData icon;
  final bool busy;
  final VoidCallback onPressed;
  final bool primary;

  @override
  Widget build(BuildContext context) {
    final child = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 18),
        const SizedBox(width: 6),

        /// `Flexible` porque com escala de texto grande o rótulo precisa
        /// quebrar em vez de estourar o botão.
        Flexible(child: Text(label)),
      ],
    );

    return Semantics(
      button: true,
      enabled: !busy,
      label: label,
      child: primary
          ? FilledButton(
              onPressed: busy ? null : onPressed,
              style: FilledButton.styleFrom(minimumSize: const Size(0, 48)),
              child: child,
            )
          : OutlinedButton(
              onPressed: busy ? null : onPressed,
              style: OutlinedButton.styleFrom(minimumSize: const Size(0, 48)),
              child: child,
            ),
    );
  }
}
