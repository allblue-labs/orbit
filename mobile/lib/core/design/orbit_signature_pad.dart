/// Área de assinatura.
///
/// ## Um primitivo, dois usos
///
/// O mesmo pad atende dois fluxos que **não** são a mesma coisa:
///
/// ```text
/// Assinatura do técnico   persistente · versionada · reutilizada
/// Assinatura do cliente   do atendimento · uma vez · nunca reutilizada
/// ```
///
/// A diferença mora em quem chama, não aqui. Este arquivo captura traço e
/// devolve PNG; ele não sabe o que vai ser feito com a imagem, e é por isso
/// que serve aos dois sem que um contamine o outro.
///
/// ## Nada é enviado enquanto se desenha
///
/// O traço vive em memória. Só a confirmação produz bytes. Gravar a cada
/// movimento criaria dezenas de versões de uma assinatura em andamento.
///
/// ## Retrato, e sem exigir virar o aparelho
///
/// Quem assina é o cliente, de pé, com o celular do técnico na mão. Pedir para
/// girar o aparelho antes de assinar é pedir uma coisa a mais no momento em
/// que a pessoa já está indo embora.
library;

import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';

import '../theme/orbit_theme.dart';

/// Densidade do PNG final.
///
/// Suficiente para o documento impresso, pequeno o bastante para a fila de
/// upload em rede de campo. Uma assinatura em resolução altíssima não fica
/// melhor no PDF — fica maior, e sobe mais devagar de dentro de um subsolo.
const double _escalaDeSaida = 2;

/// Margem em volta do traço recortado, em pixels da imagem final.
const double _margem = 16;

/// O mínimo para valer como assinatura.
///
/// Um toque acidental produz um ponto. Exigir extensão em algum eixo, ou
/// comprimento acumulado, separa "assinou" de "encostou". Não é biometria e
/// não julga a assinatura de ninguém: só distingue de um toque.
const double _extensaoMinima = 24;
const double _comprimentoMinimo = 60;

/// O punho que a tela usa para limpar, perguntar e exportar.
class OrbitSignatureController extends ChangeNotifier {
  final List<List<Offset>> _tracos = [];

  /// Só leitura — a tela desenha a partir daqui.
  List<List<Offset>> get tracos => _tracos;

  bool get temTraco => _temTracoValido(_tracos);

  void iniciar(Offset ponto) {
    _tracos.add(<Offset>[ponto]);
    notifyListeners();
  }

  void estender(Offset ponto) {
    if (_tracos.isEmpty) return;
    _tracos.last.add(ponto);
    notifyListeners();
  }

  void limpar() {
    if (_tracos.isEmpty) return;
    _tracos.clear();
    notifyListeners();
  }

  /// Desfaz o último traço.
  ///
  /// Existe porque é barato: a estrutura já é uma lista de traços, e remover o
  /// último é uma linha. Quem errou o último rabisco não precisa recomeçar.
  void desfazer() {
    if (_tracos.isEmpty) return;
    _tracos.removeLast();
    notifyListeners();
  }

  /// O PNG recortado, ou `null` quando não há traço que valha.
  Future<Uint8List?> exportar() => exportarAssinaturaPng(_tracos);
}

class OrbitSignaturePad extends StatefulWidget {
  const OrbitSignaturePad({
    super.key,
    required this.controller,
    this.hint = 'Assine neste espaço',
    this.height,
    this.enabled = true,
  });

  final OrbitSignatureController controller;
  final String hint;
  final double? height;
  final bool enabled;

  @override
  State<OrbitSignaturePad> createState() => _OrbitSignaturePadState();
}

class _OrbitSignaturePadState extends State<OrbitSignaturePad> {
  int? _activePointer;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final height =
        widget.height ??
        (MediaQuery.sizeOf(context).height * 0.28).clamp(200.0, 280.0);

    return Semantics(
      label: widget.hint,

      /// `image` porque o que existe aqui é um desenho, não texto. O leitor de
      /// tela anuncia a área e a instrução; a alternativa para quem não
      /// consegue desenhar é oferecida fora do pad, por quem o usa.
      image: true,
      child: ListenableBuilder(
        listenable: widget.controller,
        builder: (context, _) => SizedBox(
          height: height,
          child: RawGestureDetector(
            behavior: HitTestBehavior.opaque,
            gestures: <Type, GestureRecognizerFactory>{
              /// Claims the pointer immediately. The parent Scrollable never
              /// receives a drag that started inside the signing canvas.
              EagerGestureRecognizer:
                  GestureRecognizerFactoryWithHandlers<EagerGestureRecognizer>(
                    EagerGestureRecognizer.new,
                    (_) {},
                  ),
            },
            child: Listener(
              onPointerDown: widget.enabled
                  ? (event) {
                      if (_activePointer != null) return;
                      FocusManager.instance.primaryFocus?.unfocus();
                      _activePointer = event.pointer;
                      widget.controller.iniciar(_local(context, event));
                    }
                  : null,
              onPointerMove: widget.enabled
                  ? (event) {
                      if (_activePointer != event.pointer) return;
                      widget.controller.estender(_local(context, event));
                    }
                  : null,
              onPointerUp: (event) {
                if (_activePointer == event.pointer) _activePointer = null;
              },
              onPointerCancel: (event) {
                if (_activePointer == event.pointer) _activePointer = null;
              },
              child: DecoratedBox(
                decoration: BoxDecoration(
                  /// Branco e borda discreta: a assinatura vai para um documento
                  /// de fundo branco, e uma área colorida faria o traço parecer
                  /// uma coisa na tela e outra no PDF.
                  color: Colors.white,
                  border: Border.all(color: palette.border),
                  borderRadius: OrbitRadius.card,
                ),
                child: Stack(
                  children: [
                    if (!widget.controller.temTraco)
                      Center(
                        child: Text(
                          widget.hint,
                          style: OrbitType.body.copyWith(
                            color: palette.inkDisabled,
                          ),
                        ),
                      ),
                    Positioned.fill(
                      child: CustomPaint(
                        painter: _AssinaturaPainter(widget.controller.tracos),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Offset _local(BuildContext context, PointerEvent evento) {
    final box = context.findRenderObject() as RenderBox?;
    return box?.globalToLocal(evento.position) ?? evento.localPosition;
  }
}

class _AssinaturaPainter extends CustomPainter {
  const _AssinaturaPainter(this.tracos);

  final List<List<Offset>> tracos;

  @override
  void paint(Canvas canvas, Size size) {
    final tinta = Paint()
      ..color = const Color(0xFF111827)
      ..strokeWidth = 2.4
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..style = PaintingStyle.stroke;

    for (final traco in tracos) {
      if (traco.isEmpty) continue;

      /// Um ponto isolado não desenha nada com `drawPath`; o ponto desenha.
      if (traco.length == 1) {
        canvas.drawCircle(traco.first, 1.2, tinta..style = PaintingStyle.fill);
        tinta.style = PaintingStyle.stroke;
        continue;
      }
      final caminho = Path()..moveTo(traco.first.dx, traco.first.dy);
      for (final ponto in traco.skip(1)) {
        caminho.lineTo(ponto.dx, ponto.dy);
      }
      canvas.drawPath(caminho, tinta);
    }
  }

  @override
  bool shouldRepaint(_AssinaturaPainter antigo) => true;
}

/// Houve traço, ou só um encostão?
bool _temTracoValido(List<List<Offset>> tracos) {
  final pontos = tracos.expand((traco) => traco).toList();
  if (pontos.length < 2) return false;

  final xs = pontos.map((p) => p.dx);
  final ys = pontos.map((p) => p.dy);
  final largura = xs.reduce(math.max) - xs.reduce(math.min);
  final altura = ys.reduce(math.max) - ys.reduce(math.min);

  var comprimento = 0.0;
  for (final traco in tracos) {
    for (var i = 1; i < traco.length; i++) {
      comprimento += (traco[i] - traco[i - 1]).distance;
    }
  }

  return comprimento >= _comprimentoMinimo ||
      largura >= _extensaoMinima ||
      altura >= _extensaoMinima;
}

/// Exposto para teste e para quem precisa perguntar sem instanciar o punho.
bool assinaturaTemTraco(List<List<Offset>> tracos) => _temTracoValido(tracos);

/// Os traços viram PNG recortado nos próprios limites.
///
/// Recortar importa: sem isso a assinatura vira um retângulo com muito espaço
/// vazio, e no documento ela aparece minúscula no meio do vazio. O fundo é
/// transparente — o documento tem o próprio fundo, e um retângulo branco colado
/// sobre ele apareceria como um retângulo branco.
Future<Uint8List?> exportarAssinaturaPng(List<List<Offset>> tracos) async {
  if (!_temTracoValido(tracos)) return null;

  final pontos = tracos.expand((traco) => traco).toList();
  final minX = pontos.map((p) => p.dx).reduce(math.min);
  final maxX = pontos.map((p) => p.dx).reduce(math.max);
  final minY = pontos.map((p) => p.dy).reduce(math.min);
  final maxY = pontos.map((p) => p.dy).reduce(math.max);

  final largura = ((maxX - minX) * _escalaDeSaida + _margem * 2).ceil().clamp(
    1,
    4000,
  );
  final altura = ((maxY - minY) * _escalaDeSaida + _margem * 2).ceil().clamp(
    1,
    4000,
  );

  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder);
  final tinta = Paint()
    ..color = const Color(0xFF111827)
    ..strokeWidth = 2.4 * _escalaDeSaida
    ..strokeCap = StrokeCap.round
    ..strokeJoin = StrokeJoin.round
    ..style = PaintingStyle.stroke;

  Offset projetar(Offset ponto) => Offset(
    (ponto.dx - minX) * _escalaDeSaida + _margem,
    (ponto.dy - minY) * _escalaDeSaida + _margem,
  );

  for (final traco in tracos) {
    if (traco.isEmpty) continue;
    final inicio = projetar(traco.first);
    if (traco.length == 1) {
      canvas.drawCircle(
        inicio,
        1.2 * _escalaDeSaida,
        tinta..style = PaintingStyle.fill,
      );
      tinta.style = PaintingStyle.stroke;
      continue;
    }
    final caminho = Path()..moveTo(inicio.dx, inicio.dy);
    for (final ponto in traco.skip(1)) {
      final alvo = projetar(ponto);
      caminho.lineTo(alvo.dx, alvo.dy);
    }
    canvas.drawPath(caminho, tinta);
  }

  final imagem = await recorder.endRecording().toImage(largura, altura);
  final bytes = await imagem.toByteData(format: ui.ImageByteFormat.png);
  imagem.dispose();
  return bytes?.buffer.asUint8List();
}
