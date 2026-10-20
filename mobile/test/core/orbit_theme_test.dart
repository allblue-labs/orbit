/// O tema.
///
/// O que se cobra aqui é o contrato visual declarado para esta rodada: claro,
/// branco dominante, azul reservado à ação, roxo reservado à inteligência, e
/// **sem modo escuro** — a arquitetura de tokens existe para que ele caiba
/// depois, não para que exista agora.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/theme/orbit_theme.dart';

void main() {
  final tema = OrbitTheme.light();
  final palette = tema.extension<OrbitPalette>()!;

  test('o tema publica a paleta como extensão', () {
    expect(palette, isNotNull);
    expect(tema.brightness, Brightness.light);
  });

  test('o cartão se destaca do fundo da página', () {
    /// Antes este teste exigia que os dois fossem branco. Era a regra que
    /// deixava a lista de Atendimentos parecer colada na barra de filtros: um
    /// cartão branco sobre uma página branca não é um cartão, é texto solto
    /// com uma sombra fraca por baixo.
    ///
    /// A superfície continua branca — é o objeto. O fundo é levemente frio,
    /// que é o que faz a camada existir.
    expect(palette.surface, const Color(0xFFFFFFFF));
    expect(palette.background, isNot(palette.surface));

    /// E a diferença tem de ser sutil: fundo escuro demais transforma cada
    /// cartão num recorte e cansa numa lista longa.
    final delta =
        (palette.surface.r - palette.background.r).abs() +
        (palette.surface.g - palette.background.g).abs() +
        (palette.surface.b - palette.background.b).abs();
    expect(delta, lessThan(0.1));
  });

  test('azul e roxo são papéis distintos, e nenhum é o fundo', () {
    expect(palette.accent, isNot(palette.intelligence));
    expect(palette.accent, isNot(palette.background));
    expect(palette.intelligence, isNot(palette.background));
  });

  test('os tons de estado são distinguíveis entre si', () {
    final tons = {
      palette.success,
      palette.warning,
      palette.danger,
      palette.accent,
      palette.intelligence,
    };
    expect(tons.length, 5);
  });

  test('texto sobre fundo tem contraste de leitura ao sol', () {
    /// Não é o número da WCAG por gosto de número: em campo a tela é lida em
    /// pé, ao sol, com a luminosidade que o aparelho decidir.
    expect(_contraste(palette.ink, palette.background), greaterThan(7.0));
    expect(palette.inkMuted.computeLuminance(), lessThan(0.45));
  });

  test('o acento sobre branco passa no mínimo de texto', () {
    expect(_contraste(palette.accent, palette.background), greaterThan(4.5));
  });

  test('a paleta interpola sem trocar de identidade', () {
    final meio = palette.lerp(palette, 0.5);
    expect(meio.accent, palette.accent);
  });

  test('small status labels retain readable contrast on soft surfaces', () {
    for (final pair in [
      (palette.success, palette.successSoft),
      (palette.warning, palette.warningSoft),
      (palette.danger, palette.dangerSoft),
    ]) {
      expect(_contraste(pair.$1, pair.$2), greaterThanOrEqualTo(4.5));
    }
  });

  test('o acesso pelo contexto devolve a paleta do tema', () {
    /// `OrbitColors` continua existindo como fachada semântica — é por ela
    /// que as telas antigas leem cor, e ela aponta para os mesmos tokens.
    expect(OrbitColors.brand, palette.accent);
    expect(OrbitColors.intelligence, palette.intelligence);
    expect(OrbitColors.textPrimary, palette.ink);
  });
}

double _contraste(Color a, Color b) {
  final la = a.computeLuminance();
  final lb = b.computeLuminance();
  final claro = la > lb ? la : lb;
  final escuro = la > lb ? lb : la;
  return (claro + 0.05) / (escuro + 0.05);
}
