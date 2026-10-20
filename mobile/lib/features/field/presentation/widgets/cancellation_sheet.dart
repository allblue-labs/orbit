/// Pedir o cancelamento do atendimento.
///
/// ## Pedido, e não cancelamento
///
/// Quem está na porta relata; quem decide é o responsável. A folha inteira diz
/// isso — o título, o texto de apoio e o rótulo do botão —, porque a diferença
/// muda o que a pessoa espera que aconteça depois de tocar.
///
/// ## A justificativa é obrigatória e as fotos não
///
/// A frase é o que o responsável lê para decidir entre remarcar, trocar o
/// técnico ou cancelar. As fotos reforçam e faltam com frequência legítima —
/// chuva, pressa, bateria —, e exigi-las transformaria uma recusa justa em
/// impossível de registrar.
///
/// ## As fotos não esperam rede
///
/// Cada uma é persistida no aparelho e entra na fila de envio na hora da
/// captura, como qualquer evidência. O pedido viaja citando o `localMediaId`
/// delas — o id que existe desde a captura —, e o servidor costura as duas
/// coisas quando o upload chega. É o que faz a prova funcionar no subsolo de um
/// prédio, que é onde ela costuma ser tirada.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/contracts/mobile_evidence_contracts.dart';
import '../../../../core/errors/orbit_exception.dart';
import '../../../../core/presentation/field_registry.dart';
import '../../../../core/theme/orbit_theme.dart';
import '../../../evidence/application/evidence_providers.dart';
import '../../../evidence/data/evidence_intake.dart';
import '../../../evidence/data/media_capture.dart';
import '../../../sync/application/sync_providers.dart';
import '../../application/execution_controller.dart';

/// O mínimo para a justificativa dizer alguma coisa.
///
/// Dez, e não "não vazio": "x" passa em não-vazio e não ajuda ninguém a decidir.
/// É o mesmo piso do contrato no servidor — manter os dois iguais evita a recusa
/// que só aparece depois de digitar.
const _minimoDaJustificativa = 10;

/// Quantas fotos o pedido comporta. O mesmo teto do contrato.
const _maximoDeFotos = 10;

Future<bool> showCancellationSheet(
  BuildContext context, {
  required String operationId,
}) async {
  final enviado = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,

    /// Não fecha ao tocar fora: há texto digitado e fotos anexadas, e um toque
    /// acidental na borda apagaria os dois sem pergunta.
    isDismissible: false,
    enableDrag: false,
    builder: (context) => _CancellationSheet(operationId: operationId),
  );
  return enviado ?? false;
}

class _CancellationSheet extends ConsumerStatefulWidget {
  const _CancellationSheet({required this.operationId});

  final String operationId;

  @override
  ConsumerState<_CancellationSheet> createState() => _SheetState();
}

/// Uma foto já guardada no aparelho, esperando o pedido citá-la.
typedef _Anexo = ({String localMediaId, String filename});

class _SheetState extends ConsumerState<_CancellationSheet> {
  final _justificativa = TextEditingController();
  final _anexos = <_Anexo>[];
  bool _enviando = false;
  String? _problema;

  @override
  void initState() {
    super.initState();
    /* Reconstrói ao digitar: é o que habilita o botão quando a frase cresce. */
    _justificativa.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _justificativa.dispose();
    super.dispose();
  }

  bool get _podeEnviar =>
      !_enviando &&
      _justificativa.text.trim().length >= _minimoDaJustificativa;

  Future<void> _anexar(Future<CapturedFile?> Function() escolher) async {
    if (_anexos.length >= _maximoDeFotos) return;
    setState(() => _problema = null);

    final escopo = ref.read(commandScopeProvider);
    if (escopo == null) return;

    try {
      final arquivo = await escolher();
      if (arquivo == null || !mounted) return;

      final conferencia = checkEvidenceFile(arquivo.bytes);
      if (!conferencia.isValid) {
        setState(
          () => _problema =
              evidenceFileProblemLabels[conferencia.problem!.name],
        );
        return;
      }

      /// Persistir antes de qualquer rede: a partir daqui a foto sobrevive a
      /// fechar o aplicativo, mesmo que o pedido nem chegue a ser enviado.
      final media = await intakeEvidence(
        files: ref.read(mediaQueueProvider).files,
        bytes: arquivo.bytes,
        filename: arquivo.filename,
        mimeType: conferencia.mimeType!,
        scope: escopo,
        target: FieldEvidenceTargetRef(
          type: FieldEvidenceTarget.operation,
          id: widget.operationId,
        ),
        /* `DEFECT`: a categoria descreve o que a foto mostra, e o que ela mostra
           é o que impediu o atendimento. */
        category: EvidenceCategory.defect,
        source: arquivo.origin == CaptureOrigin.camera
            ? EvidenceSource.camera
            : EvidenceSource.gallery,
      );
      await ref.read(mediaUploadControllerProvider.notifier).enqueue(media);

      if (!mounted) return;
      setState(
        () => _anexos.add((
          localMediaId: media.localMediaId,
          filename: arquivo.filename,
        )),
      );
    } on CaptureException catch (error) {
      if (mounted) {
        setState(() => _problema = captureProblemLabels[error.problem.name]);
      }
    }
  }

  Future<void> _enviar() async {
    if (!_podeEnviar) return;
    setState(() {
      _enviando = true;
      _problema = null;
    });
    try {
      await ref
          .read(fieldOperationRepositoryProvider)
          .requestCancellation(
            widget.operationId,
            reason: _justificativa.text.trim(),
            evidenceLocalIds: _anexos
                .map((anexo) => anexo.localMediaId)
                .toList(growable: false),
          );
      if (mounted) Navigator.of(context).pop(true);
    } on Object catch (error) {
      if (!mounted) return;
      setState(() {
        _enviando = false;
        _problema = OrbitException.publicCopyForAny(
          error,
          prefixo: 'Não foi possível enviar o pedido.',
        );
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final faltam =
        _minimoDaJustificativa - _justificativa.text.trim().length;

    return Padding(
      /// O teclado empurra o conteúdo em vez de cobrir o botão.
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
            Text(
              'Pedir o cancelamento',
              style: OrbitType.sectionTitle.copyWith(color: palette.ink),
            ),
            const SizedBox(height: 4),
            Text(
              'O responsável recebe o seu relato e decide: remarcar, trocar o '
              'técnico ou cancelar de fato. O atendimento continua de pé até lá.',
              style: OrbitType.body.copyWith(color: palette.inkMuted),
            ),
            const SizedBox(height: OrbitSpacing.md),

            TextField(
              controller: _justificativa,
              maxLines: 4,
              maxLength: 2000,
              autofocus: true,
              textCapitalization: TextCapitalization.sentences,
              enabled: !_enviando,
              decoration: InputDecoration(
                labelText: 'O que aconteceu',
                hintText: 'Ex.: ninguém no local às 09h; portaria sem '
                    'autorização de acesso.',
                /* O contador do campo já mostra o teto; aqui mostramos o piso,
                   que é o que impede o envio. */
                helperText: faltam > 0
                    ? 'Faltam $faltam caracteres para enviar'
                    : null,
              ),
            ),

            _Anexos(
              anexos: _anexos,
              habilitado: !_enviando && _anexos.length < _maximoDeFotos,
              onFoto: () => _anexar(
                ref.read(mediaCaptureSourceProvider).takePhoto,
              ),
              onGaleria: () => _anexar(
                ref.read(mediaCaptureSourceProvider).pickImage,
              ),
              onRemover: (indice) => setState(() => _anexos.removeAt(indice)),
            ),

            if (_problema case final String problema) ...[
              const SizedBox(height: OrbitSpacing.sm),
              Text(
                problema,
                style: OrbitType.caption.copyWith(color: palette.danger),
              ),
            ],

            const SizedBox(height: OrbitSpacing.md),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: _enviando
                        ? null
                        : () => Navigator.of(context).pop(false),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size(0, 48),
                    ),
                    child: const Text('Voltar'),
                  ),
                ),
                const SizedBox(width: OrbitSpacing.sm),
                Expanded(
                  child: FilledButton(
                    onPressed: _podeEnviar ? _enviar : null,
                    style: FilledButton.styleFrom(
                      minimumSize: const Size(0, 48),
                    ),
                    child: Text(_enviando ? 'Enviando…' : 'Enviar pedido'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// As fotos anexadas, se houver.
class _Anexos extends StatelessWidget {
  const _Anexos({
    required this.anexos,
    required this.habilitado,
    required this.onFoto,
    required this.onGaleria,
    required this.onRemover,
  });

  final List<_Anexo> anexos;
  final bool habilitado;
  final VoidCallback onFoto;
  final VoidCallback onGaleria;
  final ValueChanged<int> onRemover;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Fotos (opcional)',
          style: OrbitType.label.copyWith(color: palette.inkMuted),
        ),
        const SizedBox(height: OrbitSpacing.xs),

        for (final (indice, anexo) in anexos.indexed)
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Row(
              children: [
                Icon(
                  Icons.photo_outlined,
                  size: 16,
                  color: palette.inkSubtle,
                ),
                const SizedBox(width: OrbitSpacing.xs),
                Expanded(
                  child: Text(
                    anexo.filename,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: OrbitType.caption.copyWith(color: palette.inkMuted),
                  ),
                ),
                IconButton(
                  onPressed: () => onRemover(indice),
                  icon: const Icon(Icons.close, size: 16),
                  tooltip: 'Remover ${anexo.filename}',
                  visualDensity: VisualDensity.compact,
                ),
              ],
            ),
          ),

        Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: habilitado ? onFoto : null,
                icon: const Icon(Icons.photo_camera_outlined, size: 18),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size(0, 44),
                ),
                label: const Text('Câmera'),
              ),
            ),
            const SizedBox(width: OrbitSpacing.sm),
            Expanded(
              child: OutlinedButton.icon(
                onPressed: habilitado ? onGaleria : null,
                icon: const Icon(Icons.image_outlined, size: 18),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size(0, 44),
                ),
                label: const Text('Galeria'),
              ),
            ),
          ],
        ),
      ],
    );
  }
}
