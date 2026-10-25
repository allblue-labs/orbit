import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/design/orbit_screen_header.dart';
import 'package:orbit_operator/core/theme/orbit_theme.dart';
import 'package:orbit_operator/features/field/application/field_providers.dart';
import 'package:orbit_operator/features/field/data/field_repository.dart';
import 'package:orbit_operator/features/field/presentation/widgets/work_queue_filters.dart';

void main() {
  for (final scale in [1.0, 1.5]) {
    testWidgets(
      'último filtro permanece acessível após rolar e selecionar ($scale×)',
      (tester) async {
        tester.view.physicalSize = const Size(320, 900);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        final container = ProviderContainer();
        addTearDown(container.dispose);

        await tester.pumpWidget(
          UncontrolledProviderScope(
            container: container,
            child: MaterialApp(
              theme: OrbitTheme.light(),
              builder: (context, child) => MediaQuery(
                data: MediaQuery.of(
                  context,
                ).copyWith(textScaler: TextScaler.linear(scale)),
                child: child!,
              ),
              home: Scaffold(
                body: Consumer(
                  builder: (_, ref, _) => Column(
                    children: [
                      WorkQueueFilterBar(
                        filter: ref.watch(workQueueFilterProvider),
                        resultCount: 0,
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        final strip = find.byType(OrbitChipStrip);
        final scrollable = find.descendant(
          of: strip,
          matching: find.byType(Scrollable),
        );
        final initial = tester.state<ScrollableState>(scrollable);
        expect(initial.position.maxScrollExtent, greaterThan(0));

        for (var swipe = 0; swipe < 2; swipe++) {
          await tester.drag(strip, const Offset(-800, 0));
          await tester.pumpAndSettle();
        }

        final afterDrag = tester.state<ScrollableState>(scrollable);
        expect(
          afterDrag,
          same(initial),
          reason: 'Chegar ao fim não deve recriar a lista.',
        );
        expect(
          afterDrag.position.pixels,
          closeTo(afterDrag.position.maxScrollExtent, 1),
        );
        final last = find.text('Próximos');
        expect(last.hitTestable(), findsOneWidget);
        await tester.tap(last);
        await tester.pumpAndSettle();
        expect(
          container.read(workQueueFilterProvider).view,
          WorkQueueView.upcoming,
        );
        expect(tester.state<ScrollableState>(scrollable), same(initial));
        expect(last.hitTestable(), findsOneWidget);
        await tester.drag(strip, const Offset(800, 0));
        await tester.pumpAndSettle();
        expect(find.text('Tudo').hitTestable(), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );
  }
}
