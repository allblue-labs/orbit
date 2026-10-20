/// Cada recusa do servidor tem a sua forma na tela.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/errors/orbit_exception.dart';
import 'package:orbit_operator/core/widgets/section_states.dart';

Widget _host(Widget child) => MaterialApp(
  home: Scaffold(body: SingleChildScrollView(child: child)),
);

OrbitException _http(int status, {String? code, String? requestId}) =>
    OrbitException(
      kind: OrbitErrorKind.http,
      status: status,
      publicMessage: 'mensagem do servidor',
      code: code ?? 'X',
      requestId: requestId,
    );

void main() {
  testWidgets('403 é ausência de acesso, sem convite a insistir', (
    tester,
  ) async {
    await tester.pumpWidget(
      _host(SectionError(error: _http(403), onRetry: () {})),
    );

    expect(
      find.text('Você não possui permissão para realizar esta ação.'),
      findsOneWidget,
    );

    /// Repetir daria o mesmo resultado; oferecer "tentar novamente" sugeriria
    /// que o problema é passageiro.
    expect(find.text('Tentar novamente'), findsNothing);
  });

  testWidgets('404 é ausência neutra, sem revelar o motivo', (tester) async {
    await tester.pumpWidget(_host(SectionError(error: _http(404))));

    expect(find.text('Este registro não está disponível.'), findsOneWidget);

    /// Distinguir "não existe" de "é de outra unidade" viraria um oráculo.
    expect(find.textContaining('unidade'), findsNothing);
    expect(find.textContaining('permissão'), findsNothing);
  });

  testWidgets('409 pede atualização, não repetição', (tester) async {
    await tester.pumpWidget(
      _host(SectionError(error: _http(409), onRetry: () {})),
    );

    expect(
      find.text('Os dados foram alterados. Atualize e tente novamente.'),
      findsOneWidget,
    );
    expect(find.text('Atualizar'), findsOneWidget);
    expect(find.text('Tentar novamente'), findsNothing);
  });

  testWidgets('erro inesperado mostra a referência da requisição', (
    tester,
  ) async {
    await tester.pumpWidget(
      _host(SectionError(error: _http(500, requestId: 'req-123'))),
    );

    /// Não é para o usuário entender — é para ele conseguir dizer ao suporte
    /// qual requisição falhou.
    expect(find.text('Referência: req-123'), findsOneWidget);
  });

  testWidgets('sem rede fala do aparelho, e não mostra referência', (
    tester,
  ) async {
    await tester.pumpWidget(
      _host(
        SectionError(
          error: const OrbitException(
            kind: OrbitErrorKind.network,
            publicMessage: 'Sem conexão. Verifique a internet e tente de novo.',
            code: 'NETWORK',
            requestId: 'req-999',
          ),
          onRetry: () {},
        ),
      ),
    );

    expect(find.byIcon(Icons.wifi_off_rounded), findsOneWidget);

    /// O usuário resolve sozinho; a referência seria ruído.
    expect(find.textContaining('Referência'), findsNothing);
    expect(find.text('Tentar novamente'), findsOneWidget);
  });
}
