import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:orbit_operator/core/design/orbit_loading.dart';
import 'package:orbit_operator/core/design/orbit_motion.dart';
import 'package:orbit_operator/core/routing/orbit_page_route.dart';
import 'package:orbit_operator/core/theme/orbit_theme.dart';
import 'package:orbit_operator/core/widgets/section_states.dart';

Widget host(Widget child, {bool reduced = false, bool tickers = true}) =>
    MaterialApp(
      theme: OrbitTheme.light(),
      home: MediaQuery(
        data: MediaQueryData(disableAnimations: reduced),
        child: TickerMode(
          enabled: tickers,
          child: Scaffold(body: child),
        ),
      ),
    );

void main() {
  testWidgets(
    'skeleton anuncia carregamento, anima e suspende quando fora da tela',
    (tester) async {
      await tester.pumpWidget(host(const SectionLoading()));
      expect(find.bySemanticsLabel('Carregando conteúdo'), findsOneWidget);
      await tester.pump(const Duration(milliseconds: 100));
      expect(tester.binding.hasScheduledFrame, isTrue);
      await tester.pumpWidget(host(const SectionLoading(), tickers: false));
      await tester.pumpAndSettle();
      expect(tester.binding.hasScheduledFrame, isFalse);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets(
    'movimento reduzido mantém o skeleton visível sem animação contínua',
    (tester) async {
      await tester.pumpWidget(host(const SectionLoading(), reduced: true));
      await tester.pumpAndSettle();
      expect(find.bySemanticsLabel('Carregando conteúdo'), findsOneWidget);
      expect(tester.binding.hasScheduledFrame, isFalse);
    },
  );

  testWidgets(
    'overlay bloqueia comandos duplicados e preserva o formulário ao terminar',
    (tester) async {
      var busy = false;
      var writes = 0;
      late StateSetter update;
      await tester.pumpWidget(
        host(
          StatefulBuilder(
            builder: (context, setState) {
              update = setState;
              return OrbitBusyOverlay(
                busy: busy,
                title: 'Abrindo atendimento',
                message: 'Salvando os dados.',
                child: Column(
                  children: [
                    const TextField(key: ValueKey('customer')),
                    FilledButton(
                      onPressed: () => writes++,
                      child: const Text('Criar'),
                    ),
                  ],
                ),
              );
            },
          ),
        ),
      );
      await tester.enterText(find.byType(TextField), 'Cliente em campo');
      update(() => busy = true);
      await tester.pump();
      expect(find.text('Abrindo atendimento'), findsOneWidget);
      await tester.tap(find.text('Criar'), warnIfMissed: false);
      expect(writes, 0);
      update(() => busy = false);
      await tester.pumpAndSettle();
      expect(find.text('Cliente em campo'), findsOneWidget);
      await tester.tap(find.text('Criar'));
      expect(writes, 1);
    },
  );

  testWidgets('troca de rota anima e permite retornar ao destino anterior', (
    tester,
  ) async {
    final router = GoRouter(
      initialLocation: '/one',
      routes: [
        ShellRoute(
          builder: (context, state, child) => Scaffold(body: child),
          routes: [
            OrbitPageRoute(
              path: '/one',
              builder: (_, _) => const Text('Primeira tela'),
            ),
            OrbitPageRoute(
              path: '/two',
              builder: (_, _) => const Text('Segunda tela'),
            ),
          ],
        ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(
      MaterialApp.router(
        theme: OrbitTheme.light().copyWith(platform: TargetPlatform.android),
        routerConfig: router,
      ),
    );
    await tester.pumpAndSettle();
    router.go('/two');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(
      tester
          .widgetList<FadeTransition>(find.byType(FadeTransition))
          .any((fade) => fade.opacity.value > 0 && fade.opacity.value < 1),
      isTrue,
    );
    await tester.pumpAndSettle();
    expect(find.text('Segunda tela'), findsOneWidget);
    router.go('/one');
    await tester.pumpAndSettle();
    expect(find.text('Primeira tela'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets(
    'iOS preserva a página nativa e movimento reduzido desliga a transição',
    (tester) async {
      late Page<void> page;
      Widget build(bool reduced) => MaterialApp(
        theme: ThemeData(platform: TargetPlatform.iOS),
        home: MediaQuery(
          data: MediaQueryData(disableAnimations: reduced),
          child: Builder(
            builder: (context) {
              page = orbitPage(
                context,
                key: const ValueKey('route'),
                child: const Text('Destino'),
              );
              return const SizedBox.shrink();
            },
          ),
        ),
      );
      await tester.pumpWidget(build(false));
      expect(page, isA<CupertinoPage<void>>());
      await tester.pumpWidget(build(true));
      expect(page, isA<NoTransitionPage<void>>());
    },
  );

  testWidgets('retornar à etapa anima sem perder o texto digitado', (
    tester,
  ) async {
    var active = true;
    late StateSetter update;
    await tester.pumpWidget(
      host(
        StatefulBuilder(
          builder: (context, setState) {
            update = setState;
            return Offstage(
              offstage: !active,
              child: TickerMode(
                enabled: active,
                child: OrbitReveal(active: active, child: const TextField()),
              ),
            );
          },
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'Observação do atendimento');
    update(() => active = false);
    await tester.pumpAndSettle();
    update(() => active = true);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 80));
    expect(
      tester
          .widget<FadeTransition>(find.byType(FadeTransition).last)
          .opacity
          .value,
      lessThan(1),
    );
    await tester.pumpAndSettle();
    expect(find.text('Observação do atendimento'), findsOneWidget);
  });
}
