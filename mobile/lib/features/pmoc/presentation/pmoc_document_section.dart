/// O relatório emitido de uma execução de PMOC.
///
/// ## Por que não é a seção de documento do atendimento
///
/// A seção de campo (`DocumentSection`) trabalha com **artefato de campo**, que é
/// congelado pelo próprio aplicativo. O PMOC não tem um: o documento dele é uma
/// execução de artefato, montada pelo módulo de PMOC com o modelo premium — e o
/// fluxo de campo recusa preparar PMOC de propósito, para não existirem dois
/// documentos divergentes da mesma manutenção.
///
/// Então esta seção lê onde o arquivo mora: a revisão emitida da execução. O
/// transporte — baixar, conferir os bytes, gravar, compartilhar — é o mesmo do
/// resto do aplicativo, reaproveitado, e não uma segunda implementação.
///
/// ## A emissão é assíncrona
///
/// Pedir a emissão volta na hora; o PDF sai depois, num trabalho de segundo
/// plano. Por isso "ainda não há arquivo" é estado normal e não erro — e a tela
/// oferece conferir de novo em vez de afirmar que falhou.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/contracts/pmoc_contracts.dart';
import '../../../core/design/orbit_primitives.dart';
import '../../../core/errors/orbit_exception.dart';
import '../../../core/presentation/orbit_format.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../../core/widgets/section_states.dart';
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
      await for (final estado in ref
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
        error: (error, _) =>
            SectionError(error: error, onRetry: () => ref.invalidate(provider)),
        data: (items) {
          final revisao = distributableRevision(items);

          if (revisao == null) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'O relatório foi pedido e está sendo gerado. Isso costuma levar '
                  'alguns segundos.',
                  style: OrbitType.body.copyWith(color: palette.inkMuted),
                ),
                const SizedBox(height: OrbitSpacing.sm),
                OutlinedButton(
                  onPressed: () => ref.invalidate(provider),
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(0, 48),
                  ),
                  child: const Text('Conferir de novo'),
                ),
              ],
            );
          }

          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'Emitido em ${OrbitFormat.dateHourOf(revisao.issuedAt)}',
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
                onPressed: _entregando ? null : () => _compartilhar(revisao),
                style: FilledButton.styleFrom(minimumSize: const Size(0, 48)),
                icon: const Icon(Icons.ios_share, size: 18),

                /// "Abrir ou enviar", e não "compartilhar": em campo o uso mais
                /// comum é mostrar o PDF ao cliente ali mesmo — e a folha do
                /// sistema serve para os dois.
                label: Text(
                  _entregando ? 'Preparando…' : 'Abrir ou enviar o relatório',
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}
