/// A geometria do recorte do avatar.
///
/// O que se protege: que o quadrado gravado seja o mesmo que a pessoa
/// enquadrou, e que ela não consiga enquadrar vazio.
library;

import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/media/media_type.dart';
import 'package:orbit_operator/features/profile/presentation/avatar_crop.dart';

const _lado = 300.0;

void main() {
  group('cobertura', () {
    test('a foto larga é escalada pela altura', () {
      /* 800x400 numa janela de 300: encostar pela largura deixaria 150px de
         altura vazios. Quem manda é o lado menor. */
      final escala = coberturaMinima(
        imagem: const Size(800, 400),
        lado: _lado,
      );

      expect(escala, 300 / 400);
    });

    test('a foto quadrada encosta nos dois eixos', () {
      expect(
        coberturaMinima(imagem: const Size(400, 400), lado: _lado),
        300 / 400,
      );
    });
  });

  group('folga', () {
    test('sem zoom, a foto quadrada não desliza', () {
      /* Ela cobre exatamente: qualquer deslocamento mostraria fundo. */
      expect(
        folgaMaxima(imagem: const Size(400, 400), lado: _lado, zoom: 1),
        Offset.zero,
      );
    });

    test('a foto larga desliza só na horizontal', () {
      final folga = folgaMaxima(
        imagem: const Size(800, 400),
        lado: _lado,
        zoom: 1,
      );

      expect(folga.dx, greaterThan(0));
      expect(folga.dy, 0);
    });

    test('o zoom cria folga nos dois eixos', () {
      final folga = folgaMaxima(
        imagem: const Size(400, 400),
        lado: _lado,
        zoom: 2,
      );

      expect(folga.dx, 150);
      expect(folga.dy, 150);
    });
  });

  group('limite do arrasto', () {
    test('não deixa arrastar para fora da foto', () {
      /*
       * A asserção que impede o avatar com tarja. Sem o limite, arrastar além
       * da borda gravaria fundo transparente num canto — e isso só apareceria
       * depois de salvo.
       */
      final contido = limitarDeslocamento(
        desejado: const Offset(9999, -9999),
        imagem: const Size(400, 400),
        lado: _lado,
        zoom: 2,
      );

      expect(contido, const Offset(150, -150));
    });
  });

  group('recorte gravado', () {
    test('sem zoom nem arrasto, pega o centro da foto larga', () {
      final recorte = recorteNaImagem(
        imagem: const Size(800, 400),
        lado: _lado,
        zoom: 1,
        deslocamento: Offset.zero,
      );

      /* O quadrado tem o lado menor da foto, centrado na largura. */
      expect(recorte.width, 400);
      expect(recorte.height, 400);
      expect(recorte.left, 200);
      expect(recorte.top, 0);
    });

    test('o zoom aperta o recorte', () {
      final recorte = recorteNaImagem(
        imagem: const Size(400, 400),
        lado: _lado,
        zoom: 2,
        deslocamento: Offset.zero,
      );

      expect(recorte.width, 200);
      expect(recorte.center, const Offset(200, 200));
    });

    test('arrastar para a direita mostra o que está à esquerda', () {
      /*
       * O sinal importa, e é o tipo de coisa que passa despercebida: a foto
       * desliza com o dedo, então empurrá-la para a direita traz à janela a
       * parte **esquerda** da imagem.
       */
      final recorte = recorteNaImagem(
        imagem: const Size(800, 400),
        lado: _lado,
        zoom: 1,
        deslocamento: const Offset(50, 0),
      );

      final centrado = recorteNaImagem(
        imagem: const Size(800, 400),
        lado: _lado,
        zoom: 1,
        deslocamento: Offset.zero,
      );

      expect(recorte.left, lessThan(centrado.left));
    });

    test('nunca sai dos limites da imagem', () {
      /* Origem fora dos limites faz `drawImageRect` desenhar borda
         transparente — a tarja, de novo, por outro caminho. */
      for (final zoom in [1.0, 1.5, 3.0]) {
        for (final arrasto in [
          const Offset(99999, 99999),
          const Offset(-99999, -99999),
        ]) {
          final recorte = recorteNaImagem(
            imagem: const Size(640, 480),
            lado: _lado,
            zoom: zoom,
            deslocamento: arrasto,
          );

          expect(recorte.left, greaterThanOrEqualTo(0));
          expect(recorte.top, greaterThanOrEqualTo(0));
          expect(recorte.right, lessThanOrEqualTo(640 + 0.001));
          expect(recorte.bottom, lessThanOrEqualTo(480 + 0.001));
        }
      }
    });
  });

/// O que o enquadramento entrega ao envio.
///
/// Este grupo é o elo que conserta o defeito antigo: o tipo era adivinhado pela
/// extensão do nome, o `ImagePicker` reencodava para JPEG, e o servidor — que
/// detecta o tipo nos bytes — recusava com `FILE_INVALID`. A foto subia para o
/// storage e nunca virava avatar.
///
/// Produzindo o PNG aqui, a declaração passa a ser verdadeira por construção.
/// Se esta saída deixar de ser PNG, o envio volta a mentir.
group('gravação do recorte', () {
  Future<Image> imagemDeTeste({int largura = 800, int altura = 400}) async {
    final recorder = PictureRecorder();
    Canvas(recorder).drawRect(
      Rect.fromLTWH(0, 0, largura.toDouble(), altura.toDouble()),
      Paint()..color = const Color(0xFF2563EB),
    );
    return recorder.endRecording().toImage(largura, altura);
  }

  test('sai PNG — é disso que a declaração de tipo depende', () async {
    final imagem = await imagemDeTeste();
    addTearDown(imagem.dispose);

    final bytes = await gravarRecorte(
      imagem: imagem,
      lado: _lado,
      zoom: 1,
      deslocamento: Offset.zero,
    );

    expect(bytes, isNotNull);
    expect(detectMimeType(bytes!), 'image/png');
  });

  test('sai quadrado, no lado combinado', () async {
    final imagem = await imagemDeTeste();
    addTearDown(imagem.dispose);

    final bytes = await gravarRecorte(
      imagem: imagem,
      lado: _lado,
      zoom: 1,
      deslocamento: Offset.zero,
    );

    final codec = await instantiateImageCodec(bytes!);
    final quadro = await codec.getNextFrame();
    addTearDown(quadro.image.dispose);

    expect(quadro.image.width, ladoDoAvatar);
    expect(quadro.image.height, ladoDoAvatar);
  });

  test('cabe no teto que o servidor aceita', () async {
    /* `AVATAR_MAX_BYTES` é 2 MB no servidor, e PNG de fotografia não comprime
       bem. A recusa por tamanho chegaria depois de a pessoa enquadrar. */
    final imagem = await imagemDeTeste(largura: 2000, altura: 1500);
    addTearDown(imagem.dispose);

    final bytes = await gravarRecorte(
      imagem: imagem,
      lado: _lado,
      zoom: 1,
      deslocamento: Offset.zero,
    );

    expect(bytes!.length, lessThan(2000000));
  });
});
}
