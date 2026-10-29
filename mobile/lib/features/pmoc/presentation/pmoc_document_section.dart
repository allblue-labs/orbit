/// Acompanha a emissão do PMOC e disponibiliza o PDF para baixar e compartilhar.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/contracts/pmoc_contracts.dart';
import '../../../core/design/orbit_primitives.dart';
import '../../../core/errors/orbit_exception.dart';
import '../../../core/presentation/orbit_format.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../../core/widgets/section_states.dart';
import '../../artifact/application/artifact_controller.dart'
    show renderPollInterval, renderPollLimit;
import '../../artifact/application/artifact_providers.dart';
import '../../artifact/application/document_downloader.dart';
import '../../documents/application/document_sharing.dart';
import '../../documents/application/documents_providers.dart';
import '../application/pmoc_providers.dart';

class PmocDocumentSection extends ConsumerStatefulWidget {
  const PmocDocumentSection({
    super.key,
    required this.artifactExecutionId,
    required this.fileName,
    required this.subject,
  });

  /// A execução de artefato criada pela emissão — onde as revisões moram.
  final String artifactExecutionId;

  /// Nome do arquivo que chega ao cliente, quando o servidor não publica um.
  final String fileName;

  /// O assunto da folha de compartilhamento — o que o cliente lê antes de abrir.
  final String subject;

  @override
  ConsumerState<PmocDocumentSection> createState() =>
      _PmocDocumentSectionState();
}

class _PmocDocumentSectionState extends ConsumerState<PmocDocumentSection> {
  bool _entregando = false;
  DownloadState _download = const DownloadState();
  Timer? _poll;
  int _attempts = 0;
  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  @override
  void didUpdateWidget(PmocDocumentSection oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.artifactExecutionId != widget.artifactExecutionId) {
      _poll?.cancel();
      _poll = null;
      _attempts = 0;
      _download = const DownloadState();
    }
  }

  void _schedulePoll() {
    if (_poll != null || _attempts >= renderPollLimit) return;
    final id = widget.artifactExecutionId;
    _poll = Timer(renderPollInterval(_attempts++), () {
      _poll = null;
      if (mounted && id == widget.artifactExecutionId) {
        ref.invalidate(pmocDocumentRevisionsProvider(id));
      }
    });
  }

  Future<void> _baixar(PmocDocumentRevisionContract revision) async {
    if (_download.isBusy || _entregando) return;
    final id = widget.artifactExecutionId;
    final repository = ref.read(pmocRepositoryProvider);
    final downloader = DocumentDownloader(
      repository: ref.read(artifactRepositoryProvider),
      files: ref.read(documentFileStoreProvider),
    );
    await for (final state in downloader.fetchWith(
      access: () => repository.documentAccess(revision.id),
      fileName: widget.fileName,
    )) {
      if (!mounted || id != widget.artifactExecutionId) return;
      setState(() => _download = state);
    }
  }

  Future<void> _compartilhar(PmocDocumentRevisionContract revisao) async {
    if (_entregando) return;
    setState(() => _entregando = true);
    final mensageiro = ScaffoldMessenger.maybeOf(context);

    /// De onde a folha do sistema sai. Só o iPad usa — e é lá que a ausência
    /// lança exceção.
    final caixa = context.findRenderObject();
    final origem = caixa is RenderBox && caixa.hasSize
        ? caixa.localToGlobal(Offset.zero) & caixa.size
        : null;

    try {
      final repositorio = ref.read(pmocRepositoryProvider);
      await for (final estado
          in ref
              .read(documentSharingProvider)
              .shareWith(
                /// A URL assinada é pedida na hora da entrega e usada na hora: ela
                /// expira, e guardá-la entregaria um link morto.
                access: () => repositorio.documentAccess(revisao.id),
                fileName: widget.fileName,
                subject: widget.subject,
                origin: origem,
              )) {
        if (estado.phase != SharePhase.error) continue;
        mensageiro?.showSnackBar(
          SnackBar(
            content: Text(
              OrbitException.publicCopyForAny(
                estado.error,
                prefixo: 'Não foi possível preparar o relatório.',
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
    final palette = context.orbit;
    final provider = pmocDocumentRevisionsProvider(widget.artifactExecutionId);
    final revisoes = ref.watch(provider);

    return SectionBlock(
      title: 'Relatório de execução',
      child: revisoes.when(
        loading: () => const SectionLoading(lines: 2),
        error: (error, _) {
          _schedulePoll();
          return SectionError(
            error: error,
            onRetry: () => ref.invalidate(provider),
          );
        },
        data: (items) {
          final revisao = distributableRevision(items);

          if (revisao == null) {
            _schedulePoll();
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'O relatório foi pedido e está sendo gerado. Isso costuma levar '
                  'alguns segundos.',
                  style: OrbitType.body.copyWith(color: palette.inkMuted),
                ),
                const SizedBox(height: OrbitSpacing.sm),
                const LinearProgressIndicator(),
              ],
            );
          }

          _poll?.cancel();
          _poll = null;
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'Emitido em ${OrbitFormat.of(context).dateHourOf(revisao.issuedAt)}',
                      style: OrbitType.body.copyWith(color: palette.ink),
                    ),
                  ),
                  OrbitStatusBadge(
                    label: 'Revisão ${revisao.revision}',
                    tone: OrbitTone.success,
                  ),
                ],
              ),
              const SizedBox(height: OrbitSpacing.sm),
              FilledButton.icon(
                onPressed: _entregando || _download.isBusy
                    ? null
                    : () => _compartilhar(revisao),
                style: FilledButton.styleFrom(minimumSize: const Size(0, 48)),
                icon: const Icon(Icons.ios_share, size: 18),

                label: Text(
                  _entregando ? 'Preparando…' : 'Compartilhar relatório',
                ),
              ),
              const SizedBox(height: OrbitSpacing.sm),
              OutlinedButton.icon(
                onPressed: _download.isBusy || _entregando
                    ? null
                    : () => _baixar(revisao),
                icon: const Icon(Icons.download_outlined),
                label: Text(
                  _download.isBusy ? 'Baixando…' : 'Baixar relatório',
                ),
              ),
              if (_download.phase == DownloadPhase.availableLocally)
                const Text('Relatório baixado neste aparelho.'),
              if (_download.phase == DownloadPhase.error)
                SectionError(
                  error: _download.error!,
                  onRetry: () => _baixar(revisao),
                ),
            ],
          );
        },
      ),
    );
  }
}
