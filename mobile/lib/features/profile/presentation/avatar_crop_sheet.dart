/// Enquadrar a foto antes de ela virar o avatar.
///
/// ## Por que existe
///
/// O avatar é um círculo pequeno. Uma foto de celular é um retângulo grande, e
/// até aqui o recorte era feito pelo servidor — ou seja, pelo centro, sem
/// ninguém olhar. Retrato em pé virava um close do pescoço, e não havia o que
/// fazer a respeito.
///
/// ## O PNG é produzido aqui, e isso conserta outra coisa
///
/// O envio declarava o tipo da imagem **pela extensão do nome**. O
/// `ImagePicker` com `imageQuality` reencoda para JPEG, então um arquivo
/// escolhido como `.png` chegava ao servidor como bytes JPEG declarados como
/// PNG — e `activate` compara o tipo detectado nos bytes com o declarado e
/// recusa com `FILE_INVALID`. A foto subia para o storage e nunca virava
/// avatar.
///
/// Gravando o recorte nós mesmos, em PNG, o tipo declarado passa a ser verdade
/// por construção.
///
/// ## 512 pixels
///
/// O avatar aparece pequeno, e PNG de fotografia não comprime bem: a 1024 um
/// retrato detalhado passa dos 2 MB que o servidor aceita, e a recusa chegaria
/// **depois** de a pessoa enquadrar.
library;

import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../../../core/design/orbit_primitives.dart';
import '../../../core/theme/orbit_theme.dart';
import 'avatar_crop.dart';

/// Abre o enquadramento e devolve o PNG recortado, ou `null` se desistir.
Future<Uint8List?> showAvatarCropSheet(
  BuildContext context, {
  required Uint8List bytes,
}) => showModalBottomSheet<Uint8List>(
  context: context,
  isScrollControlled: true,

  /// Não fecha ao tocar fora: a pessoa está ajustando com as duas mãos, e um
  /// toque na borda descartaria o enquadramento sem perguntar.
  isDismissible: false,
  enableDrag: false,
  builder: (context) => _AvatarCropSheet(bytes: bytes),
);

class _AvatarCropSheet extends StatefulWidget {
  const _AvatarCropSheet({required this.bytes});

  final Uint8List bytes;

  @override
  State<_AvatarCropSheet> createState() => _AvatarCropSheetState();
}

class _AvatarCropSheetState extends State<_AvatarCropSheet> {
  ui.Image? _imagem;
  String? _problema;
  bool _gravando = false;

  double _zoom = 1;
  Offset _deslocamento = Offset.zero;

  /// O zoom no início do gesto: `detalhes.scale` é relativo ao começo da
  /// pinça, não ao estado anterior. O arrasto usa `focalPointDelta`, que já é
  /// incremental e por isso não precisa de âncora.
  double _zoomInicial = 1;

  @override
  void initState() {
    super.initState();
    _decodificar();
  }

  @override
  void dispose() {
    _imagem?.dispose();
    super.dispose();
  }

  Future<void> _decodificar() async {
    try {
      final codec = await ui.instantiateImageCodec(widget.bytes);
      final quadro = await codec.getNextFrame();
      if (!mounted) {
        quadro.image.dispose();
        return;
      }
      setState(() => _imagem = quadro.image);
    } on Object {
      if (mounted) {
        setState(() => _problema = 'Não foi possível abrir esta imagem.');
      }
    }
  }

  Size get _tamanhoDaImagem => Size(
    (_imagem?.width ?? 1).toDouble(),
    (_imagem?.height ?? 1).toDouble(),
  );

  /// Grava o que está enquadrado.
  ///
  /// O destino é o quadrado de saída e a origem é [recorteNaImagem] — a mesma
  /// conta que a tela usou para desenhar. Recalcular de outro jeito aqui
  /// produziria um avatar diferente do que a pessoa viu.
  Future<void> _confirmar(double lado) async {
    final imagem = _imagem;
    if (imagem == null || _gravando) return;
    setState(() => _gravando = true);

    try {
      final dados = await gravarRecorte(
        imagem: imagem,
        lado: lado,
        zoom: _zoom,
        deslocamento: _deslocamento,
      );

      if (!mounted) return;
      if (dados == null) {
        setState(() {
          _gravando = false;
          _problema = 'Não foi possível preparar a imagem.';
        });
        return;
      }
      Navigator.of(context).pop(dados);
    } on Object {
      if (mounted) {
        setState(() {
          _gravando = false;
          _problema = 'Não foi possível preparar a imagem.';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final largura = MediaQuery.sizeOf(context).width;

    /// A janela ocupa a largura disponível, com um teto para não virar um
    /// quadrado gigante em tablet.
    final lado = (largura - OrbitSpacing.md * 2).clamp(200.0, 360.0);

    return Padding(
      padding: const EdgeInsets.all(OrbitSpacing.md),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Enquadre sua foto',
            style: OrbitType.sectionTitle.copyWith(color: palette.ink),
          ),
          const SizedBox(height: 4),
          Text(
            'Arraste para posicionar e use dois dedos para aproximar.',
            style: OrbitType.body.copyWith(color: palette.inkMuted),
          ),
          const SizedBox(height: OrbitSpacing.md),

          if (_problema case final String problema)
            OrbitEmptyState(
              icon: Icons.broken_image_outlined,
              title: 'Imagem não aceita',
              description: problema,
            )
          else if (_imagem == null)
            SizedBox(
              height: lado,
              child: const Center(child: CircularProgressIndicator()),
            )
          else
            Center(
              child: _Janela(
                imagem: _imagem!,
                lado: lado,
                zoom: _zoom,
                deslocamento: _deslocamento,
                onInicio: () => _zoomInicial = _zoom,
                onAtualizar: (detalhes) {
                  setState(() {
                    _zoom = (_zoomInicial * detalhes.scale)
                        .clamp(1.0, 5.0)
                        .toDouble();
                    _deslocamento = limitarDeslocamento(
                      desejado: _deslocamento + detalhes.focalPointDelta,
                      imagem: _tamanhoDaImagem,
                      lado: lado,
                      zoom: _zoom,
                    );
                  });
                },
              ),
            ),

          const SizedBox(height: OrbitSpacing.md),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: _gravando
                      ? null
                      : () => Navigator.of(context).pop(),
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(0, 48),
                  ),
                  child: const Text('Cancelar'),
                ),
              ),
              const SizedBox(width: OrbitSpacing.sm),
              Expanded(
                child: FilledButton(
                  onPressed: _imagem == null || _gravando
                      ? null
                      : () => _confirmar(lado),
                  style: FilledButton.styleFrom(
                    minimumSize: const Size(0, 48),
                  ),
                  child: Text(_gravando ? 'Preparando…' : 'Usar esta foto'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// A janela redonda com a foto deslizando atrás.
///
/// Redonda porque é assim que o avatar aparece: um recorte quadrado mostrado
/// num círculo esconde os cantos, e enquadrar num quadrado para depois ver um
/// círculo é enquadrar às cegas. O arquivo gravado continua quadrado — quem
/// arredonda é quem exibe.
class _Janela extends StatelessWidget {
  const _Janela({
    required this.imagem,
    required this.lado,
    required this.zoom,
    required this.deslocamento,
    required this.onInicio,
    required this.onAtualizar,
  });

  final ui.Image imagem;
  final double lado;
  final double zoom;
  final Offset deslocamento;
  final VoidCallback onInicio;
  final ValueChanged<ScaleUpdateDetails> onAtualizar;

  @override
  Widget build(BuildContext context) => GestureDetector(
    onScaleStart: (_) => onInicio(),
    onScaleUpdate: onAtualizar,
    child: ClipOval(
      child: SizedBox(
        width: lado,
        height: lado,
        child: CustomPaint(
          painter: _PinturaDoRecorte(
            imagem: imagem,
            lado: lado,
            zoom: zoom,
            deslocamento: deslocamento,
          ),
        ),
      ),
    ),
  );
}

class _PinturaDoRecorte extends CustomPainter {
  const _PinturaDoRecorte({
    required this.imagem,
    required this.lado,
    required this.zoom,
    required this.deslocamento,
  });

  final ui.Image imagem;
  final double lado;
  final double zoom;
  final Offset deslocamento;

  @override
  void paint(Canvas canvas, Size size) {
    final origem = recorteNaImagem(
      imagem: Size(imagem.width.toDouble(), imagem.height.toDouble()),
      lado: lado,
      zoom: zoom,
      deslocamento: deslocamento,
    );

    /// A mesma conta da gravação. É o que garante que o que se vê é o que sai.
    canvas.drawImageRect(
      imagem,
      origem,
      Offset.zero & size,
      Paint()..filterQuality = FilterQuality.medium,
    );
  }

  @override
  bool shouldRepaint(_PinturaDoRecorte anterior) =>
      anterior.imagem != imagem ||
      anterior.lado != lado ||
      anterior.zoom != zoom ||
      anterior.deslocamento != deslocamento;
}
