/// O primitivo de assinatura.
///
/// O que se cobra aqui é a fronteira que separa "assinou" de "encostou", e a
/// normalização do que sai — porque é ela que decide se a assinatura aparece
/// legível no documento ou minúscula no meio de um retângulo vazio.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/design/orbit_signature_pad.dart';

List<List<Offset>> traco(List<Offset> pontos) => [pontos];

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('o que vale como assinatura', () {
    test('pad vazio não vale', () {
      expect(assinaturaTemTraco(const []), isFalse);
    });

    test('um toque isolado não vale', () {
      expect(assinaturaTemTraco(traco(const [Offset(10, 10)])), isFalse);
    });

    test('dois pontos colados não valem', () {
      /// Um toque com tremor produz dois pontos a um pixel. Isso é o dedo
      /// encostando, não alguém assinando.
      expect(
        assinaturaTemTraco(traco(const [Offset(10, 10), Offset(11, 10)])),
        isFalse,
      );
    });

    test('um traço com extensão vale', () {
      expect(
        assinaturaTemTraco(traco(const [Offset(10, 10), Offset(60, 40)])),
        isTrue,
      );
    });

    test('rabisco curto mas comprido vale', () {
      /// Uma rubrica cabe num quadrado pequeno e ainda assim percorre muito
      /// caminho. Exigir só extensão recusaria assinatura legítima.
      final zigue = <Offset>[
        for (var i = 0; i < 20; i++)
          Offset(10 + (i.isEven ? 0 : 8), 10 + i.toDouble()),
      ];
      expect(assinaturaTemTraco(traco(zigue)), isTrue);
    });
  });

  group('exportação', () {
    test('pad vazio não produz imagem', () async {
      expect(await exportarAssinaturaPng(const []), isNull);
      expect(await exportarAssinaturaPng(traco(const [Offset(5, 5)])), isNull);
    });

    test('o traço vira um PNG de verdade', () async {
      final bytes = await exportarAssinaturaPng(
        traco(const [Offset(10, 10), Offset(120, 60), Offset(200, 20)]),
      );

      expect(bytes, isNotNull);

      /// Assinatura PNG nos primeiros oito bytes — é o que o servidor confere,
      /// e o que separa um arquivo de verdade de um blob com extensão certa.
      expect(bytes!.sublist(0, 8), const [137, 80, 78, 71, 13, 10, 26, 10]);
    });

    test('a imagem é recortada nos limites do traço', () async {
      /// Dois traços idênticos em posições distantes devem produzir imagens do
      /// mesmo tamanho: o recorte parte do traço, não da área do pad.
      final naEsquerda = await exportarAssinaturaPng(
        traco(const [Offset(0, 0), Offset(100, 50)]),
      );
      final naDireita = await exportarAssinaturaPng(
        traco(const [Offset(600, 300), Offset(700, 350)]),
      );

      expect(naEsquerda, isNotNull);
      expect(naDireita, isNotNull);

      final a = await decodeImageFromList(naEsquerda!);
      final b = await decodeImageFromList(naDireita!);
      expect(a.width, b.width);
      expect(a.height, b.height);
      a.dispose();
      b.dispose();
    });

    test('o arquivo é pequeno o bastante para a fila de campo', () async {
      final assinatura = <Offset>[
        for (var i = 0; i < 300; i++)
          Offset(i.toDouble(), 40 + 20 * (i % 7).toDouble()),
      ];
      final bytes = await exportarAssinaturaPng(traco(assinatura));

      /// Uma assinatura de 300 pontos não deve produzir megabytes: o teto do
      /// servidor é 2 MB, e a fila de upload roda em rede de subsolo.
      expect(bytes!.lengthInBytes, lessThan(200_000));
    });
  });

  group('o punho', () {
    test('limpar apaga o traço', () {
      final controller = OrbitSignatureController()
        ..iniciar(const Offset(10, 10))
        ..estender(const Offset(90, 60));

      expect(controller.temTraco, isTrue);
      controller.limpar();
      expect(controller.temTraco, isFalse);
    });

    test('desfazer remove só o último traço', () {
      final controller = OrbitSignatureController()
        ..iniciar(const Offset(10, 10))
        ..estender(const Offset(90, 60))
        ..iniciar(const Offset(200, 10))
        ..estender(const Offset(260, 60));

      expect(controller.tracos, hasLength(2));
      controller.desfazer();
      expect(controller.tracos, hasLength(1));
      expect(controller.temTraco, isTrue);
    });

    test('exportar um pad vazio devolve nulo', () async {
      expect(await OrbitSignatureController().exportar(), isNull);
    });
  });
}
