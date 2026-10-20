/// O layout aguenta o mundo real: telas estreitas, texto ampliado e nomes
/// longos.
///
/// Em campo o aparelho é do técnico, com as configurações dele — inclusive
/// fonte grande. Um `RenderFlex overflow` ali não é detalhe estético: some com
/// o botão que ele precisa tocar.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/errors/orbit_exception.dart';
import 'package:orbit_operator/core/widgets/section_states.dart';

/// Nome longo de verdade — do tipo que existe em cadastro de cliente.
const _longName =
    'Condomínio Empresarial Torre Norte — Central de Água Gelada, '
    'Subsolo 2, Sala de Máquinas Ala Leste';

Widget _host(Widget child, {double textScale = 1.0, double width = 320}) =>
    MediaQuery(
      data: MediaQueryData(
        textScaler: TextScaler.linear(textScale),
        size: Size(width, 640),
      ),
      child: MaterialApp(
        home: Scaffold(
          body: SizedBox(
            width: width,
            child: SingleChildScrollView(child: child),
          ),
        ),
      ),
    );

void main() {
  /// Erro de layout vira falha do teste; sem isto o overflow só pinta a tela
  /// de amarelo e o teste passa.
  Object? layoutError;
  setUp(() {
    layoutError = null;
    FlutterError.onError = (details) => layoutError ??= details.exception;
  });
  tearDown(() => FlutterError.onError = FlutterError.presentError);

  for (final scale in [1.0, 1.3, 2.0]) {
    testWidgets('estado vazio não estoura com texto em ${scale}x', (
      tester,
    ) async {
      await tester.pumpWidget(
        _host(
          const SectionEmpty(
            icon: Icons.event_busy,
            message: 'Nenhum atendimento para hoje.',
          ),
          textScale: scale,
        ),
      );
      expect(layoutError, isNull);
    });

    testWidgets('estado de erro não estoura com texto em ${scale}x', (
      tester,
    ) async {
      await tester.pumpWidget(
        _host(
          SectionError(
            error: const OrbitException(
              kind: OrbitErrorKind.http,
              status: 500,
              publicMessage:
                  'Não foi possível concluir a solicitação no momento. '
                  'Tente novamente em instantes.',
              code: 'INTERNAL_SERVER_ERROR',
              requestId: '01a05d0e-c482-7d54-9e70-eaee9d32ae8e',
            ),
            onRetry: () {},
          ),
          textScale: scale,
        ),
      );
      expect(layoutError, isNull);
    });
  }

  testWidgets('nome longo de cliente não quebra o cartão', (tester) async {
    await tester.pumpWidget(
      _host(
        const SectionBlock(title: _longName, child: Text(_longName)),
        textScale: 1.3,
      ),
    );
    expect(layoutError, isNull);
  });

  testWidgets('tela estreita continua íntegra', (tester) async {
    await tester.pumpWidget(
      _host(
        const SectionEmpty(
          icon: Icons.inbox_outlined,
          message: 'Nenhum atendimento para hoje.',
        ),
        width: 280,
        textScale: 1.5,
      ),
    );
    expect(layoutError, isNull);
  });
}
