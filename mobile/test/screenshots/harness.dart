/// Renderiza telas reais em PNG, com fonte de verdade.
///
/// ## Por que existe
///
/// Golden padrão do `flutter_test` desenha texto como bloco: serve para provar
/// que um pixel não mudou, não para julgar se a tela está bonita. Este harness
/// carrega Inter/Space Grotesk empacotadas e devolve uma captura que se pode olhar.
library;

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show FontLoader;
import 'package:flutter_test/flutter_test.dart';

/// Carrega as fontes que o aplicativo empacota, pelos nomes que ele declara.
///
/// Ler de `assets/fonts` em vez de embutir uma lista aqui é o que faz o
/// harness continuar certo quando alguém trocar um peso: a captura passa a
/// mostrar a fonte que o aparelho vai mostrar.
Future<void> carregarFontes() async {
  const familias = {
    'Inter': ['Inter-400', 'Inter-500', 'Inter-600', 'Inter-700'],
    'SpaceGrotesk': [
      'SpaceGrotesk-500',
      'SpaceGrotesk-600',
      'SpaceGrotesk-700',
    ],
  };

  for (final MapEntry(key: familia, value: arquivos) in familias.entries) {
    final loader = FontLoader(familia);
    var achou = false;
    for (final nome in arquivos) {
      final f = File('assets/fonts/$nome.ttf');
      if (!f.existsSync()) continue;
      achou = true;
      loader.addFont(Future.value(f.readAsBytesSync().buffer.asByteData()));
    }
    if (achou) await loader.load();
  }

  /// Os ícones do Material vêm do artefato do SDK, não do bundle de teste.
  const iconesDoSdk =
      '/usr/local/share/flutter/bin/cache/artifacts/material_fonts/'
      'MaterialIcons-Regular.otf';
  final arquivoDeIcones = File(iconesDoSdk);
  if (arquivoDeIcones.existsSync()) {
    final icones = FontLoader('MaterialIcons')
      ..addFont(
        Future.value(arquivoDeIcones.readAsBytesSync().buffer.asByteData()),
      );
    await icones.load();
  }
}

/// Tamanho de um iPhone 15 em pixels lógicos.
const tamanhoTelefone = Size(390, 852);
double captureWidth = 390;
double captureScale = 1;

/// Prepara o `tester` para uma captura de tela inteira.
void prepararTela(WidgetTester tester, {Size? tamanho}) {
  final size = tamanho ?? Size(captureWidth, 852);
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
}
