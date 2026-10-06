/// A geometria do recorte do avatar.
///
/// Separada da tela porque é a parte que pode estar **errada**: o resto é
/// gesto e pintura. Aqui mora a conversão entre o que a pessoa vê — uma janela
/// quadrada com a foto deslizando atrás — e o retângulo da imagem original que
/// será gravado.
///
/// ## O modelo
///
/// A janela é um quadrado de lado `lado`. A foto entra em **cobertura**: a
/// menor escala que não deixa borda vazia em nenhum eixo. `zoom` multiplica
/// isso, e nunca é menor que 1 — abaixo disso sobraria fundo, e um avatar com
/// tarja branca de um lado é o tipo de resultado que ninguém escolhe de
/// propósito.
///
/// `deslocamento` é a translação do centro da foto em relação ao centro da
/// janela, em pixels de tela. Ele é limitado para que a janela nunca saia da
/// foto — é o que impede arrastar até o vazio.
library;

import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui';

/// A escala em que a foto cobre a janela sem deixar borda.
double coberturaMinima({required Size imagem, required double lado}) {
  if (imagem.width <= 0 || imagem.height <= 0) return 1;
  return math.max(lado / imagem.width, lado / imagem.height);
}

/// O quanto a foto pode deslizar, em cada eixo, sem descobrir a janela.
///
/// Zero quando a foto cobre a janela exatamente naquele eixo: não há folga, e
/// qualquer deslocamento mostraria vazio.
Offset folgaMaxima({
  required Size imagem,
  required double lado,
  required double zoom,
}) {
  final escala = coberturaMinima(imagem: imagem, lado: lado) * zoom;
  return Offset(
    math.max(0, (imagem.width * escala - lado) / 2),
    math.max(0, (imagem.height * escala - lado) / 2),
  );
}

/// O deslocamento pedido, contido dentro da folga.
Offset limitarDeslocamento({
  required Offset desejado,
  required Size imagem,
  required double lado,
  required double zoom,
}) {
  final folga = folgaMaxima(imagem: imagem, lado: lado, zoom: zoom);
  return Offset(
    desejado.dx.clamp(-folga.dx, folga.dx).toDouble(),
    desejado.dy.clamp(-folga.dy, folga.dy).toDouble(),
  );
}

/// O retângulo da **imagem original** que a janela está mostrando.
///
/// É o que vai para o `drawImageRect` na hora de gravar: o destino é o quadrado
/// de saída, e a origem é isto. Calcular na tela e gravar outra coisa produziria
/// um avatar diferente do que a pessoa enquadrou.
Rect recorteNaImagem({
  required Size imagem,
  required double lado,
  required double zoom,
  required Offset deslocamento,
}) {
  final escala = coberturaMinima(imagem: imagem, lado: lado) * zoom;
  if (escala <= 0) return Rect.fromLTWH(0, 0, imagem.width, imagem.height);

  final contido = limitarDeslocamento(
    desejado: deslocamento,
    imagem: imagem,
    lado: lado,
    zoom: zoom,
  );

  final ladoNaImagem = lado / escala;
  final esquerda = imagem.width / 2 - (lado / 2 + contido.dx) / escala;
  final topo = imagem.height / 2 - (lado / 2 + contido.dy) / escala;

  /// O `clamp` final absorve o arredondamento de ponto flutuante. Sem ele, um
  /// recorte pode sair um milésimo fora da imagem — e `drawImageRect` com
  /// origem fora dos limites desenha borda transparente.
  final x = esquerda
      .clamp(0.0, math.max(0.0, imagem.width - ladoNaImagem))
      .toDouble();
  final y = topo
      .clamp(0.0, math.max(0.0, imagem.height - ladoNaImagem))
      .toDouble();

  return Rect.fromLTWH(
    x,
    y,
    math.min(ladoNaImagem, imagem.width),
    math.min(ladoNaImagem, imagem.height),
  );
}

/// O lado do PNG gravado.
///
/// 512 porque o avatar é exibido pequeno e o arquivo precisa caber nos 2 MB que
/// o servidor aceita. PNG de fotografia não comprime bem: a 1024 um retrato
/// detalhado passa de 2 MB e a confirmação falharia **depois** de a pessoa ter
/// enquadrado — o pior momento para descobrir um limite.
const ladoDoAvatar = 512;


/// Grava o enquadramento como PNG.
///
/// ## Por que PNG, e por que aqui
///
/// Porque o tipo declarado ao servidor precisa ser verdade. Antes ele era
/// adivinhado pela extensão do nome do arquivo escolhido, e o `ImagePicker`
/// com `imageQuality` reencoda para JPEG — um `.png` chegava como bytes JPEG
/// declarados como PNG, e `activate` recusa com `FILE_INVALID` por comparar o
/// tipo detectado nos bytes com o declarado.
///
/// Produzindo a imagem aqui, o formato deixa de ser palpite.
///
/// A origem é [recorteNaImagem] — a **mesma** conta que a tela usa para
/// desenhar. Recalcular de outro jeito gravaria um avatar diferente do que a
/// pessoa enquadrou.
Future<Uint8List?> gravarRecorte({
  required Image imagem,
  required double lado,
  required double zoom,
  required Offset deslocamento,
}) async {
  final origem = recorteNaImagem(
    imagem: Size(imagem.width.toDouble(), imagem.height.toDouble()),
    lado: lado,
    zoom: zoom,
    deslocamento: deslocamento,
  );

  final recorder = PictureRecorder();
  Canvas(recorder).drawImageRect(
    imagem,
    origem,
    Rect.fromLTWH(0, 0, ladoDoAvatar.toDouble(), ladoDoAvatar.toDouble()),
    Paint()..filterQuality = FilterQuality.high,
  );

  final desenhada = await recorder.endRecording().toImage(
    ladoDoAvatar,
    ladoDoAvatar,
  );
  final dados = await desenhada.toByteData(format: ImageByteFormat.png);
  desenhada.dispose();
  return dados?.buffer.asUint8List();
}
