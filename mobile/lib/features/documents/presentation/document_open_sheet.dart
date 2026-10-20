/// A folha de um documento: o que é, e o que fazer com ele.
///
/// ## Duas ações, e a diferença entre elas
///
/// ```text
/// Compartilhar   baixa e entrega à folha do sistema  → WhatsApp, e-mail, Arquivos
/// Baixar         baixa e guarda neste aparelho       → fica disponível offline
/// ```
///
/// Compartilhar é a primária porque é o que se faz com um relatório: ele
/// existe para chegar ao cliente. Baixar serve a quem vai precisar do arquivo
/// onde não há sinal.
///
/// O arquivo é **temporário**: o documento é do servidor, e uma cópia
/// permanente no aparelho envelheceria sozinha e sobreviveria à revogação do
/// acesso de quem a baixou.
///
/// ## Nenhuma mensagem de erro é montada aqui
///
/// O texto de falha vem de [OrbitException.publicCopyForAny]. Interpolar o
/// objeto de erro publicaria `SocketException` — e, com ele, o endereço do
/// servidor — na tela de quem está numa casa de máquinas.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/contracts/mobile_field_contracts.dart';
import '../../../core/design/orbit_primitives.dart';
import '../../../core/errors/orbit_exception.dart';
import '../../../core/presentation/field_registry.dart';
import '../../../core/presentation/orbit_format.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../../core/widgets/section_states.dart';
import '../../artifact/application/artifact_providers.dart';
import '../../artifact/application/document_downloader.dart';
import '../../artifact/data/document_name.dart';
import '../application/document_sharing.dart';
import '../application/documents_providers.dart';
import 'documents_screen.dart' show documentStateBadge;

/// O nome do arquivo que chega ao destino.
///
/// Vem do rótulo e do cliente — nunca do `artifactId`, que é opaco. Quem
/// recebe o PDF no WhatsApp lê o nome antes de abrir, e
/// `a1f3c9e2-...pdf` não diz nada a ninguém.
String documentFileName(MobileRecentDocumentContract document) =>
    documentFileNameOf([
      document.label,
      if (document.customerName case final String cliente) cliente,
    ]);

/// Baixa o documento e abre a folha de compartilhamento do sistema.
///
/// Devolve quando a folha foi aberta (ou a preparação falhou) — não quando o
/// cliente recebeu: para onde o arquivo vai depois é assunto do sistema, e o
/// aplicativo não fica sabendo.
Future<void> compartilharDocumento(
  BuildContext context,
  WidgetRef ref,
  MobileRecentDocumentContract document,
) async {
  final sharing = ref.read(documentSharingProvider);
  final mensageiro = ScaffoldMessenger.maybeOf(context);

  await for (final estado in sharing.share(
    artifactId: document.artifactId,
    fileName: documentFileName(document),
    origin: _origemDaFolha(context),
    subject: [
      document.label,
      if (document.customerName case final String cliente) cliente,
    ].join(' · '),
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
}

/// De onde a folha do sistema sai, em coordenadas de tela.
///
/// Só o iPad usa — e é lá que a ausência quebra. Devolve `null` quando o
/// widget já saiu da árvore, que é o que [SharePlus] espera nesse caso.
Rect? _origemDaFolha(BuildContext context) {
  final caixa = context.findRenderObject();
  if (caixa is! RenderBox || !caixa.hasSize) return null;
  return caixa.localToGlobal(Offset.zero) & caixa.size;
}

Future<void> showDocumentOpenSheet(
  BuildContext context,
  MobileRecentDocumentContract document,
) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  showDragHandle: true,
  backgroundColor: context.orbit.surface,
  builder: (_) => DocumentOpenSheet(document: document),
);

class DocumentOpenSheet extends ConsumerStatefulWidget {
  const DocumentOpenSheet({super.key, required this.document});

  final MobileRecentDocumentContract document;

  @override
  ConsumerState<DocumentOpenSheet> createState() => _DocumentOpenSheetState();
}

class _DocumentOpenSheetState extends ConsumerState<DocumentOpenSheet> {
  DownloadState _download = const DownloadState();
  bool _compartilhando = false;

  Future<void> _baixar() async {
    if (_download.isBusy) return;
    final downloader = DocumentDownloader(
      repository: ref.read(artifactRepositoryProvider),
      files: ref.read(documentFileStoreProvider),
    );
    final stream = downloader.fetch(
      artifactId: widget.document.artifactId,
      fileName: documentFileName(widget.document),

      /// Visualização, não download: é o que a lista oferece, e o servidor
      /// distingue as duas na assinatura da URL.
      preview: true,
    );
    await for (final etapa in stream) {
      if (!mounted) return;
      setState(() => _download = etapa);
    }
  }

  Future<void> _compartilhar() async {
    if (_compartilhando) return;
    setState(() => _compartilhando = true);
    try {
      await compartilharDocumento(context, ref, widget.document);
    } finally {
      if (mounted) setState(() => _compartilhando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final documento = widget.document;
    final rotuloDoDownload = documentDownloadLabels[_download.phase.name];

    /// Acima de 1.3× nada divide linha com nada: o selo desce para baixo do
    /// título, e o par rótulo–valor deixa de ser duas colunas. Lado a lado,
    /// "Shopping Recife" quebrava em "Shoppi/ng Recife".
    final empilhado = MediaQuery.textScalerOf(context).scale(1) > 1.3;

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
            Builder(
              builder: (context) {
                final identificacao = Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      documento.customerName ?? documento.label,
                      style: OrbitType.sectionTitle.copyWith(
                        color: palette.ink,
                        fontSize: 19,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      documento.label,
                      style: OrbitType.caption.copyWith(
                        color: palette.inkMuted,
                      ),
                    ),
                  ],
                );
                if (empilhado) {
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      identificacao,
                      const SizedBox(height: OrbitSpacing.sm),
                      Align(
                        alignment: Alignment.centerLeft,
                        child: documentStateBadge(documento),
                      ),
                    ],
                  );
                }
                return Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(child: identificacao),
                    const SizedBox(width: OrbitSpacing.sm),
                    documentStateBadge(documento),
                  ],
                );
              },
            ),
            const SizedBox(height: OrbitSpacing.ml),

            /// O conteúdo rola; a ação não.
            ///
            /// Em 320 px com texto 2.0× a folha inteira passava 169 pixels
            /// da tela, e o que ficava de fora era justamente os dois
            /// botões — quem ampliou o texto abria a folha e não tinha como
            /// compartilhar nada.
            Flexible(
              child: SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    OrbitCard(
                      padding: const EdgeInsets.symmetric(
                        horizontal: OrbitSpacing.ml,
                        vertical: OrbitSpacing.sm,
                      ),
                      child: Column(
                        /// Sem `stretch`, cada par ocupa só a largura do seu
                        /// conteúdo e a coluna centraliza os mais curtos —
                        /// "Emitido em" aparecia no meio enquanto "Cliente"
                        /// e "Arquivo" ficavam na margem.
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          if (documento.customerName case final String cliente)
                            _Dado(rotulo: 'Cliente', valor: cliente),
                          _Dado(
                            rotulo: 'Emitido em',
                            valor: OrbitFormat.dateHourOf(documento.createdAt),
                          ),

                          /// O nome do arquivo é o que o cliente vê chegar no
                          /// WhatsApp antes de abrir qualquer coisa. Mostrá-lo aqui
                          /// evita a surpresa de mandar algo chamado "documento.pdf".
                          _Dado(
                            rotulo: 'Arquivo',
                            valor: documentFileName(documento),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: OrbitSpacing.ml),

                    /// O andamento do download, quando há um.
                    if (_download.phase == DownloadPhase.availableLocally)
                      OrbitPanel(
                        tone: OrbitTone.info,
                        child: Row(
                          children: [
                            Icon(
                              Icons.check_circle_outline,
                              size: 18,
                              color: palette.success,
                            ),
                            const SizedBox(width: OrbitSpacing.sm),
                            Expanded(
                              child: Text(
                                'Documento salvo neste aparelho.',
                                style: OrbitType.body.copyWith(
                                  color: palette.ink,
                                ),
                              ),
                            ),
                          ],
                        ),
                      )
                    else if (_download.phase == DownloadPhase.error)
                      SectionError(error: _download.error!, onRetry: _baixar)
                    else if (rotuloDoDownload != null)
                      Semantics(
                        liveRegion: true,
                        child: Row(
                          children: [
                            const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            ),
                            const SizedBox(width: OrbitSpacing.sm),
                            Expanded(
                              child: Text(
                                rotuloDoDownload,
                                style: OrbitType.body.copyWith(
                                  color: palette.inkMuted,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),

                    if (rotuloDoDownload != null ||
                        _download.phase == DownloadPhase.error)
                      const SizedBox(height: OrbitSpacing.md),
                  ],
                ),
              ),
            ),
            const SizedBox(height: OrbitSpacing.ml),

            /// Um documento em preparo não oferece ação. Oferecer e recusar é
            /// pior do que não oferecer.
            if (!documento.isAvailable)
              OrbitPanel(
                tone: documento.hasFailed
                    ? OrbitTone.danger
                    : OrbitTone.warning,
                child: Text(
                  documento.hasFailed
                      ? 'Este documento não pôde ser gerado. Refaça a emissão '
                            'pelo atendimento que o originou.'
                      : 'Este documento ainda está sendo preparado. '
                            'Atualize a lista em alguns instantes.',
                  style: OrbitType.body.copyWith(color: palette.ink),
                ),
              )
            else ...[
              FilledButton.icon(
                onPressed: _compartilhando ? null : _compartilhar,
                icon: _compartilhando
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(Icons.ios_share_rounded, size: 18),
                label: Text(
                  _compartilhando ? 'Preparando…' : 'Compartilhar documento',
                ),
                style: FilledButton.styleFrom(minimumSize: const Size(0, 50)),
              ),
              const SizedBox(height: OrbitSpacing.sm),
              OutlinedButton.icon(
                onPressed:
                    _download.isBusy ||
                        _download.phase == DownloadPhase.availableLocally
                    ? null
                    : _baixar,
                icon: const Icon(Icons.download_outlined, size: 18),
                label: const Text('Baixar neste aparelho'),
                style: OutlinedButton.styleFrom(minimumSize: const Size(0, 50)),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Um par rótulo–valor. O rótulo à esquerda, apagado; o valor à direita.
class _Dado extends StatelessWidget {
  const _Dado({required this.rotulo, required this.valor});

  final String rotulo;
  final String valor;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final estiloRotulo = OrbitType.caption.copyWith(color: palette.inkSubtle);
    final estiloValor = OrbitType.body.copyWith(color: palette.ink);

    /// Com o texto ampliado, o rótulo sai de cima do valor em vez de dividir
    /// a linha com ele: a coluna fixa de 104 pixels deixava o valor com um
    /// terço da largura, e um nome de arquivo quebrava a cada três letras.
    if (MediaQuery.textScalerOf(context).scale(1) > 1.3) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: OrbitSpacing.sm),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(rotulo, style: estiloRotulo),
            const SizedBox(height: 2),
            Text(valor, style: estiloValor),
          ],
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: OrbitSpacing.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 104, child: Text(rotulo, style: estiloRotulo)),
          Expanded(
            child: Text(valor, style: estiloValor, textAlign: TextAlign.right),
          ),
        ],
      ),
    );
  }
}
