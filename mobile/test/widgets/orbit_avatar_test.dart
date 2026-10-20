/// O que o avatar desenha.
///
/// A foto do perfil chega por **bytes**, não por endereço: o endereço é
/// assinado e vale cinco minutos, e um guardado na sessão devolve 403 depois
/// disso — a foto some sozinha e a tela cai nas iniciais sem dizer nada.
library;

import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/design/orbit_operational.dart';
import 'package:orbit_operator/core/theme/orbit_theme.dart';

/// Um PNG 1x1 de verdade: `Image.memory` decodifica, e é isso que se cobra.
final _png = Uint8List.fromList(const [
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, //
  0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, //
  0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 250, 207, 0, 0, 2, //
  7, 1, 2, 154, 28, 49, 113, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
]);

Widget _host(Widget child) =>
    MaterialApp(theme: OrbitTheme.light(), home: Scaffold(body: child));

void main() {
  testWidgets('com bytes, desenha a imagem', (tester) async {
    await tester.pumpWidget(
      _host(OrbitAvatar(initials: 'DS', bytes: _png)),
    );
    await tester.pump();

    expect(find.byType(Image), findsOneWidget);
    /* A inicial some: ela é o substituto, não um rótulo sobreposto. */
    expect(find.text('DS'), findsNothing);
  });

  testWidgets('sem bytes e sem endereço, mostra a inicial', (tester) async {
    await tester.pumpWidget(_host(const OrbitAvatar(initials: 'DS')));

    expect(find.text('DS'), findsOneWidget);
    expect(find.byType(Image), findsNothing);
  });

  testWidgets('os bytes vencem o endereço', (tester) async {
    /*
     * Quem já tem a imagem em mãos não depende de prazo nenhum. Preferir o
     * endereço aqui reintroduziria a foto que some em cinco minutos.
     */
    await tester.pumpWidget(
      _host(
        OrbitAvatar(
          initials: 'DS',
          bytes: _png,
          url: 'https://exemplo.com/outra.png',
        ),
      ),
    );
    await tester.pump();

    final imagem = tester.widget<Image>(find.byType(Image));
    expect(imagem.image, isA<MemoryImage>());
  });
}
