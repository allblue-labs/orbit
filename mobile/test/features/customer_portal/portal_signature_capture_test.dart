/// O cadastro da assinatura tem como ser confirmado.
///
/// O defeito: a linha com "Salvar assinatura" não era desenhada (botão de
/// largura infinita numa `Row`), e a pessoa desenhava sem ter onde confirmar.
library;

import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/design/orbit_signature_pad.dart';
import 'package:orbit_operator/core/theme/orbit_theme.dart';
import 'package:orbit_operator/features/customer_portal/presentation/portal_profile.dart';

void main() {
  for (final (largura, escala) in [(390.0, 1.0), (320.0, 1.5)]) {
    testWidgets(
      'desenhar libera "Salvar", e salvar devolve o PNG (${largura.toInt()}px ${escala}x)',
      (tester) async {
        tester.view.physicalSize = Size(largura, 760);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);

        Uint8List? devolvido;
        await tester.pumpWidget(
          MaterialApp(
            theme: OrbitTheme.light(),
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(textScaler: TextScaler.linear(escala)),
              child: child!,
            ),
            home: Builder(
              builder: (context) => Scaffold(
                body: Center(
                  child: TextButton(
                    onPressed: () async {
                      devolvido = await Navigator.of(context).push<Uint8List>(
                        MaterialPageRoute(
                          builder: (_) => const PortalSignatureCaptureScreen(),
                        ),
                      );
                    },
                    child: const Text('abrir'),
                  ),
                ),
              ),
            ),
          ),
        );
        await tester.tap(find.text('abrir'));
        await tester.pumpAndSettle();

        final salvar = find.byKey(const Key('portal.signature.save'));
        expect(salvar, findsOneWidget);
        /* Visível na tela, e não só montado. */
        expect(tester.getRect(salvar).bottom, lessThanOrEqualTo(760));
        expect(
          tester.widget<ButtonStyleButton>(salvar).onPressed,
          isNull,
          reason: 'sem traço, não há o que salvar',
        );

        final quadro = tester.getRect(find.byType(OrbitSignaturePad));
        final gesto = await tester.startGesture(
          quadro.centerLeft + const Offset(30, 0),
        );
        for (var passo = 1; passo <= 20; passo++) {
          await gesto.moveBy(
            Offset((quadro.width - 60) / 20, passo.isEven ? 12 : -12),
          );
        }
        await gesto.up();
        await tester.pump();

        expect(tester.widget<ButtonStyleButton>(salvar).onPressed, isNotNull);
        await tester.runAsync(() async {
          await tester.tap(salvar);
          await Future<void>.delayed(const Duration(milliseconds: 300));
        });
        await tester.pumpAndSettle();

        expect(devolvido, isNotNull);
        expect(devolvido!.sublist(1, 4), [0x50, 0x4e, 0x47]); // "PNG"
      },
    );
  }
}
