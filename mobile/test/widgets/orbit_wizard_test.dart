/// O roteiro de etapas.
///
/// O que se cobra aqui é a fronteira: o roteiro navega e mostra progresso;
/// ele **não** decide nada de domínio, e mudar de etapa não envia comando.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/design/orbit_wizard.dart';
import 'package:orbit_operator/core/theme/orbit_theme.dart';

Widget host(
  List<OrbitWizardStep> steps, {
  double textScale = 1.0,
  double width = 390,
  Widget? footer,
}) => MediaQuery(
  data: MediaQueryData(
    textScaler: TextScaler.linear(textScale),
    size: Size(width, 800),
  ),
  child: MaterialApp(
    theme: OrbitTheme.light(),
    home: Scaffold(
      body: SingleChildScrollView(
        child: OrbitWizard(steps: steps, footer: footer),
      ),
    ),
  ),
);

OrbitWizardStep step(
  String title, {
  bool complete = false,
  String? lockedReason,
  String? hint,
}) => OrbitWizardStep(
  title: title,
  complete: complete,
  lockedReason: lockedReason,
  hint: hint,
  child: Text('conteúdo de $title'),
);

void main() {
  Object? layoutError;
  setUp(() {
    layoutError = null;
    FlutterError.onError = (details) => layoutError ??= details.exception;
  });
  tearDown(() => FlutterError.onError = FlutterError.presentError);

  testWidgets(
    'preserva o texto ao avançar e voltar sem montar etapas futuras',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: OrbitWizard(
                preserveStepState: true,
                steps: [
                  OrbitWizardStep(title: 'Serviço', child: TextField()),
                  step('Confirmação'),
                ],
              ),
            ),
          ),
        ),
      );
      expect(find.text('conteúdo de Confirmação'), findsNothing);
      await tester.enterText(find.byType(TextField), 'Troca do filtro');
      await tester.tap(find.text('Avançar · Confirmação'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Voltar'));
      await tester.pumpAndSettle();
      expect(find.text('Troca do filtro'), findsOneWidget);
    },
  );

  testWidgets('não avança quando o salvamento da etapa falha', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: OrbitWizard(
              onBeforeStepChanged: (_, _) async => false,
              steps: [step('Serviço'), step('Confirmação')],
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Avançar · Confirmação'));
    await tester.pumpAndSettle();
    expect(find.text('Etapa 1 de 2'), findsOneWidget);
  });

  testWidgets('diz onde a pessoa está', (tester) async {
    await tester.pumpWidget(host([step('Preparação'), step('Execução')]));

    expect(find.text('Etapa 1 de 2'), findsOneWidget);
    expect(find.text('conteúdo de Preparação'), findsOneWidget);
    expect(find.text('conteúdo de Execução'), findsNothing);
  });

  testWidgets('avançar e voltar são navegação', (tester) async {
    await tester.pumpWidget(
      host([step('Preparação'), step('Execução'), step('Evidências')]),
    );

    await tester.tap(find.text('Avançar · Execução'));
    await tester.pumpAndSettle();
    expect(find.text('Etapa 2 de 3'), findsOneWidget);

    await tester.tap(find.text('Voltar'));
    await tester.pumpAndSettle();
    expect(find.text('Etapa 1 de 3'), findsOneWidget);
  });

  testWidgets('a primeira etapa não oferece voltar; a última, avançar', (
    tester,
  ) async {
    await tester.pumpWidget(host([step('Preparação'), step('Execução')]));

    expect(find.text('Voltar'), findsNothing);

    await tester.tap(find.text('Avançar · Execução'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Avançar'), findsNothing);
    expect(find.text('Voltar'), findsOneWidget);
  });

  /// O defeito que este grupo existe para impedir.
  ///
  /// O roteiro pulava etapas travadas, e em campo isso acontecia por omissão: sem
  /// checklist previsto, sem execução aberta ainda. Quem executava via "Etapa 1 de 6"
  /// virar "Etapa 3 de 6" e nunca soube o que havia na 2.
  group('nenhuma etapa é pulada', () {
    testWidgets('avançar vai para a vizinha, mesmo travada', (tester) async {
      await tester.pumpWidget(
        host([
          step('Preparação'),
          step('Execução', lockedReason: 'Abra o atendimento primeiro.'),
          step('Evidências'),
        ]),
      );

      /// O rótulo nomeia a vizinha — não "a próxima alcançável".
      await tester.tap(find.text('Avançar · Execução'));
      await tester.pumpAndSettle();
      expect(find.text('Etapa 2 de 3'), findsOneWidget);
    });

    testWidgets('a etapa travada mostra o motivo no lugar do conteúdo', (
      tester,
    ) async {
      await tester.pumpWidget(
        host([
          step('Preparação'),
          step('Execução', lockedReason: 'Abra o atendimento primeiro.'),
        ]),
      );

      await tester.tap(find.text('Avançar · Execução'));
      await tester.pumpAndSettle();

      expect(find.text('Abra o atendimento primeiro.'), findsOneWidget);

      /// O conteúdo é interativo; travar é trocá-lo, não só avisar por cima.
      expect(find.text('conteúdo de Execução'), findsNothing);
    });

    testWidgets('o trilho leva a uma etapa travada', (tester) async {
      await tester.pumpWidget(
        host([
          step('Preparação'),
          step('Execução', lockedReason: 'Abra o atendimento primeiro.'),
        ]),
      );

      /// Tocar na etapa travada é a única forma de descobrir o motivo — antes o
      /// toque era ignorado, e o motivo não existia em lugar nenhum.
      await tester.tap(find.text('Execução'));
      await tester.pumpAndSettle();
      expect(find.text('Etapa 2 de 2'), findsOneWidget);
      expect(find.text('Abra o atendimento primeiro.'), findsOneWidget);
    });

    testWidgets('voltar também não salta', (tester) async {
      await tester.pumpWidget(
        host([
          step('Preparação'),
          step('Execução', lockedReason: 'Abra o atendimento primeiro.'),
          step('Evidências'),
        ]),
      );

      await tester.tap(find.text('Evidências'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Voltar'));
      await tester.pumpAndSettle();
      expect(find.text('Etapa 2 de 3'), findsOneWidget);
    });
  });

  testWidgets('o trilho leva direto a uma etapa alcançável', (tester) async {
    await tester.pumpWidget(
      host([step('Preparação'), step('Execução'), step('Evidências')]),
    );

    await tester.tap(find.text('Evidências'));
    await tester.pumpAndSettle();
    expect(find.text('Etapa 3 de 3'), findsOneWidget);
  });

  testWidgets('o rodapé acompanha a etapa', (tester) async {
    await tester.pumpWidget(
      host([
        step('Preparação'),
        step('Finalização'),
      ], footer: const Text('ação do domínio')),
    );

    expect(find.text('ação do domínio'), findsOneWidget);
  });

  testWidgets('a dica da etapa aparece quando existe', (tester) async {
    await tester.pumpWidget(
      host([step('Preparação', hint: 'Confira antes de começar.')]),
    );

    expect(find.text('Confira antes de começar.'), findsOneWidget);
  });

  testWidgets('leitor de tela recebe a posição e o estado da etapa', (
    tester,
  ) async {
    await tester.pumpWidget(
      host([step('Preparação', complete: true), step('Execução')]),
    );

    expect(
      find.bySemanticsLabel('Preparação, etapa 1 de 2, concluída'),
      findsOneWidget,
    );
  });

  for (final (largura, escala) in [(320.0, 1.0), (375.0, 1.3), (430.0, 2.0)]) {
    testWidgets('cabe em ${largura.toInt()}px com texto ${escala}x', (
      tester,
    ) async {
      await tester.pumpWidget(
        host(
          [
            step('Preparação'),
            step('Execução'),
            step('Evidências'),
            step('Materiais'),
            step('Confirmação'),
            step('Finalização'),
          ],
          width: largura,
          textScale: escala,
        ),
      );
      await tester.pumpAndSettle();
      expect(layoutError, isNull);
    });
  }

  /// **Um** controle para frente por etapa.
  ///
  /// A queixa era "vários botões de retorno e avançar num só lugar": a ação do
  /// domínio vinha num botão próprio ao lado do avanço, e a tela mostrava dois
  /// botões grandes dizendo coisas diferentes sem nada indicando a ordem.
  group('o avanço carrega a ação da etapa', () {
    testWidgets('a etapa com ação não mostra um segundo botão', (tester) async {
      await tester.pumpWidget(
        host([
          OrbitWizardStep(
            title: 'Preparação',
            child: const Text('conteúdo'),
            forward: OrbitWizardForward(
              label: 'Iniciar atendimento',
              onPressed: () async {},
            ),
          ),
          step('Execução'),
        ]),
      );

      expect(find.text('Iniciar atendimento'), findsOneWidget);

      /* O rótulo de navegação dá lugar ao da ação — não convive com ele. */
      expect(find.textContaining('Avançar'), findsNothing);
    });

    testWidgets('executa a ação e segue, num toque só', (tester) async {
      var chamou = 0;
      await tester.pumpWidget(
        host([
          OrbitWizardStep(
            title: 'Preparação',
            child: const Text('conteúdo'),
            forward: OrbitWizardForward(
              label: 'Iniciar atendimento',
              advanceOnSuccess: true,
              onPressed: () async => chamou++,
            ),
          ),
          step('Execução'),
        ]),
      );

      await tester.tap(find.text('Iniciar atendimento'));
      await tester.pumpAndSettle();

      expect(chamou, 1);
      /* Começar e seguir são o mesmo gesto para quem está em campo. */
      expect(find.text('Etapa 2 de 2'), findsOneWidget);
    });

    testWidgets('sem avançar quando a etapa não pede', (tester) async {
      await tester.pumpWidget(
        host([
          OrbitWizardStep(
            title: 'Preparação',
            child: const Text('conteúdo'),
            forward: OrbitWizardForward(
              label: 'Registrar',
              onPressed: () async {},
            ),
          ),
          step('Execução'),
        ]),
      );

      await tester.tap(find.text('Registrar'));
      await tester.pumpAndSettle();

      expect(find.text('Etapa 1 de 2'), findsOneWidget);
    });

    testWidgets('em voo, o controle não aceita outro toque', (tester) async {
      var chamou = 0;
      await tester.pumpWidget(
        host([
          OrbitWizardStep(
            title: 'Preparação',
            child: const Text('conteúdo'),
            forward: OrbitWizardForward(
              label: 'Iniciar atendimento',
              pending: true,
              onPressed: () async => chamou++,
            ),
          ),
          step('Execução'),
        ]),
      );

      /* Dois toques num comando que grava seriam dois comandos.
         `pump`, e não `pumpAndSettle`: o indicador de progresso gira para
         sempre, e esperar a animação parar nunca retornaria. */
      await tester.tap(find.byType(FilledButton));
      await tester.pump();
      expect(chamou, 0);
    });

    testWidgets('a última etapa sem ação não mostra avanço', (tester) async {
      await tester.pumpWidget(host([step('Preparação'), step('Fim')]));

      await tester.tap(find.text('Avançar · Fim'));
      await tester.pumpAndSettle();

      /* Nem navegação nem ação: um botão morto é pior que nenhum. */
      expect(find.byType(FilledButton), findsNothing);
      expect(find.text('Voltar'), findsOneWidget);
    });

    testWidgets('a última etapa com ação mostra a ação', (tester) async {
      await tester.pumpWidget(
        host([
          step('Preparação'),
          OrbitWizardStep(
            title: 'Finalização',
            child: const Text('conteúdo'),
            forward: OrbitWizardForward(
              label: 'Concluir atendimento',
              onPressed: () async {},
            ),
          ),
        ]),
      );

      await tester.tap(find.text('Avançar · Finalização'));
      await tester.pumpAndSettle();

      expect(find.text('Concluir atendimento'), findsOneWidget);
    });
  });
}
