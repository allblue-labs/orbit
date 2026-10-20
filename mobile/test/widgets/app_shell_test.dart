/// A barra de navegação — a arquitetura de informação do aplicativo.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/routing/app_shell.dart';
import 'package:orbit_operator/core/design/orbit_operational.dart';
import 'package:orbit_operator/core/routing/orbit_router.dart';
import 'package:orbit_operator/core/theme/orbit_theme.dart';

Widget host(String location, {double textScale = 1.0, double width = 390}) =>
    ProviderScope(
      child: MaterialApp(
        theme: OrbitTheme.light(),
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: TextScaler.linear(textScale)),
          child: child!,
        ),
        home: AppShell(location: location, child: const SizedBox.shrink()),
      ),
    );

/// A posição de uma aba, pela rota.
///
/// O número escrito à mão era o que quebrava a cada aba nova: o perfil
/// estava fixado na casa 3 e virou a 4 no dia em que Documentos entrou. O
/// teste passa a checar a **regra** — o prefixo mais específico vence —, não
/// a ordem em que as abas foram declaradas.
int aba(String rota) =>
    orbitShellDestinations.indexWhere((destino) => destino.route == rota);

void main() {
  Object? layoutError;
  setUp(() {
    layoutError = null;
    FlutterError.onError = (details) => layoutError ??= details.exception;
  });
  tearDown(() => FlutterError.onError = FlutterError.presentError);

  testWidgets('cinco destinos, com o rótulo visível', (tester) async {
    /// Documentos voltou para a barra. Era acesso rápido da tela inicial, e
    /// um destino que exige voltar ao início não é destino — "cadê a OS de
    /// ontem?" é pergunta de todo dia.
    ///
    /// Agenda continua fora: compromisso se olha uma vez pela manhã,
    /// documento se procura a qualquer hora, e só um dos dois cabia.
    ///
    /// Cinco abas em 320 pixels dão 64 cada, o que obriga a abreviar — daí
    /// "Atend." e "Docs". Os testes de layout abaixo são o que garante que a
    /// conta fecha até 2.0× de texto.
    await tester.pumpWidget(host(OrbitRoutes.home));

    for (final (rotulo, curto) in [
      ('Início', 'Início'),
      ('Atendimentos', 'Atend.'),
      ('Clientes', 'Clientes'),
      ('Documentos', 'Docs'),
      ('Perfil', 'Perfil'),
    ]) {
      /// O nome inteiro fica no tooltip e na semântica; o curto, na tela.
      /// Um leitor de tela que anunciasse "Atend." seria pior que o ícone
      /// sozinho.
      expect(find.byTooltip(rotulo), findsOneWidget, reason: rotulo);
      expect(find.text(curto), findsOneWidget, reason: rotulo);
    }

    /// "Trabalho" descrevia a estrutura de dados, não a coisa.
    expect(find.text('Trabalho'), findsNothing);

    /// Abreviação escrita à mão, não reticência: "Atendim…" é um corte.
    expect(find.text('Atendimentos'), findsNothing);
    expect(find.text('Documentos'), findsNothing);
  });

  testWidgets('clientes é destino próprio', (tester) async {
    await tester.pumpWidget(host(OrbitRoutes.customers));

    final barra = tester.widget<OrbitBottomNav>(find.byType(OrbitBottomNav));
    expect(barra.selected, aba(OrbitRoutes.customers));
  });

  testWidgets('documentos é destino próprio', (tester) async {
    await tester.pumpWidget(host(OrbitRoutes.documents));

    final barra = tester.widget<OrbitBottomNav>(find.byType(OrbitBottomNav));
    expect(barra.selected, aba(OrbitRoutes.documents));
    expect(barra.selected, isNonNegative);
  });

  testWidgets('a aba mais específica vence o prefixo', (tester) async {
    /// `/perfil/sincronizacao` começa com `/perfil`. Uma varredura ingênua
    /// acertaria por acaso enquanto os prefixos não colidissem.
    await tester.pumpWidget(host(OrbitRoutes.syncCenter));

    final barra = tester.widget<OrbitBottomNav>(find.byType(OrbitBottomNav));
    expect(barra.selected, aba(OrbitRoutes.profile));
  });

  testWidgets('rota fora das abas não deixa a barra sem seleção', (
    tester,
  ) async {
    await tester.pumpWidget(host('/rota-que-nao-existe'));

    final barra = tester.widget<OrbitBottomNav>(find.byType(OrbitBottomNav));
    expect(barra.selected, 0);
  });

  for (final (largura, escala) in [
    for (final width in [320.0, 375.0, 390.0, 430.0])
      for (final scale in [1.0, 1.3, 1.5, 2.0]) (width, scale),
  ]) {
    testWidgets('cabe em ${largura.toInt()}px com texto ${escala}x', (
      tester,
    ) async {
      tester.view.physicalSize = Size(largura, 852);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final semantics = tester.ensureSemantics();
      await tester.pumpWidget(
        host(OrbitRoutes.home, width: largura, textScale: escala),
      );
      await tester.pumpAndSettle();
      expect(layoutError, isNull);
      // 52px target + 8px padding + 1px divider; independent of text scale.
      /// A barra cresceu ao ganhar o rótulo sob o ícone. O número é medido,
      /// não escolhido: o que importa é caber sem estourar nas escalas de
      /// texto testadas acima.
      expect(tester.getSize(find.byType(OrbitBottomNav)).height, 65);
      for (final label in [
        'Início',
        'Atendimentos',
        'Clientes',
        'Documentos',
        'Perfil',
      ]) {
        final target = find.byTooltip(label);
        expect(tester.getSize(target).width, greaterThanOrEqualTo(48));
        expect(tester.getSize(target).height, greaterThanOrEqualTo(48));
        expect(
          tester.getSemantics(find.bySemanticsLabel(label)),
          matchesSemantics(
            label: label,
            isButton: true,
            hasSelectedState: true,
            isSelected: label == 'Início',
            hasTapAction: true,
          ),
        );
      }
      semantics.dispose();
    });
  }
}
