import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/design/orbit_signature_pad.dart';
import 'package:orbit_operator/core/theme/orbit_theme.dart';

void main() {
  testWidgets('gesto iniciado no pad desenha sem mover o scroll pai', (
    tester,
  ) async {
    final scroll = ScrollController();
    final signature = OrbitSignatureController();
    addTearDown(scroll.dispose);
    addTearDown(signature.dispose);

    await tester.pumpWidget(_host(scroll: scroll, signature: signature));
    await tester.tap(find.byType(TextField));
    expect(FocusManager.instance.primaryFocus, isNotNull);

    final pad = find.byType(OrbitSignaturePad);
    final start = tester.getCenter(pad) - const Offset(60, 40);
    final gesture = await tester.startGesture(start);
    await gesture.moveBy(const Offset(35, 25));
    await gesture.moveBy(const Offset(40, 30));
    await gesture.up();
    await tester.pump();

    expect(signature.temTraco, isTrue);
    expect(scroll.offset, 0);
    expect(
      tester.widget<EditableText>(find.byType(EditableText)).focusNode.hasFocus,
      isFalse,
    );
  });

  testWidgets(
    'sair da área interrompe o traço e reentrar inicia outro sem conexão',
    (tester) async {
      final scroll = ScrollController();
      final signature = OrbitSignatureController();
      addTearDown(scroll.dispose);
      addTearDown(signature.dispose);
      await tester.pumpWidget(_host(scroll: scroll, signature: signature));
      final pad = tester.getRect(find.byType(OrbitSignaturePad));
      final gesture = await tester.startGesture(pad.center);
      await gesture.moveTo(pad.center + const Offset(40, 20));
      await gesture.moveTo(pad.topLeft - const Offset(0, 80));
      await gesture.moveTo(pad.topRight + const Offset(40, -100));
      await gesture.moveTo(pad.center - const Offset(40, 20));
      await gesture.moveTo(pad.center - const Offset(10, 10));
      await gesture.up();
      await tester.pump();
      expect(signature.tracos, hasLength(2));
      final bounds = Offset.zero & pad.size;
      expect(
        signature.tracos.expand((stroke) => stroke).every(bounds.contains),
        isTrue,
      );
      expect(scroll.offset, 0);
      expect(await tester.runAsync(signature.exportar), isNotNull);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('gesto fora do pad continua rolando a tela', (tester) async {
    final scroll = ScrollController();
    final signature = OrbitSignatureController();
    addTearDown(scroll.dispose);
    addTearDown(signature.dispose);

    await tester.pumpWidget(_host(scroll: scroll, signature: signature));
    await tester.drag(
      find.byKey(const Key('signature.outside-scroll-zone')),
      const Offset(0, -90),
    );
    await tester.pumpAndSettle();

    expect(scroll.offset, greaterThan(0));
    expect(signature.temTraco, isFalse);
  });

  testWidgets('altura responsiva permanece adequada no retrato', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final scroll = ScrollController();
    final signature = OrbitSignatureController();
    addTearDown(scroll.dispose);
    addTearDown(signature.dispose);

    await tester.pumpWidget(_host(scroll: scroll, signature: signature));
    final height = tester.getSize(find.byType(OrbitSignaturePad)).height;

    expect(height, inInclusiveRange(200, 280));
    expect(tester.takeException(), isNull);
  });
}

Widget _host({
  required ScrollController scroll,
  required OrbitSignatureController signature,
}) => MaterialApp(
  theme: OrbitTheme.light(),
  home: Scaffold(
    body: ListView(
      controller: scroll,
      padding: const EdgeInsets.all(16),
      children: [
        const SizedBox(
          key: Key('signature.outside-scroll-zone'),
          height: 110,
          child: TextField(),
        ),
        OrbitSignaturePad(controller: signature),
        const SizedBox(height: 700),
      ],
    ),
  ),
);
