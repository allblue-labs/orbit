/// A tela de aceite, lida por outra pessoa.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:orbit_operator/core/contracts/mobile_signature_contracts.dart';
import 'package:orbit_operator/core/presentation/field_registry.dart';
import 'package:orbit_operator/features/signature/presentation/attendance_review.dart';
import 'package:orbit_operator/core/theme/orbit_theme.dart';
import 'package:orbit_operator/core/widgets/section_states.dart';

CustomerAcknowledgementPreparation preparation({
  String summary = 'Manutenção preventiva realizada no equipamento.',
  Map<String, Object?>? existing,
}) => CustomerAcknowledgementPreparation.fromJson({
  'executionType': 'OPERATION',
  'executionId': 'op-1',
  'customer': {'id': 'c1', 'name': 'Condomínio Central'},
  'equipment': [
    {'id': 'e1', 'code': 'TAG-1', 'name': 'Split Cassete'},
  ],
  'serviceSummary': summary,
  'performedAt': '2026-09-01T12:00:00.000Z',
  'signerPolicy': {'signatureRequired': false, 'signatureOptional': true},
  'existingAcknowledgement': existing,
  'contentVersion': '2026-09-01T12:00:00.000Z',
  'contentHash': 'a' * 64,
});

Widget host(Widget child, {double textScale = 1.0, double width = 360}) =>
    MediaQuery(
      data: MediaQueryData(
        textScaler: TextScaler.linear(textScale),
        size: Size(width, 720),
      ),
      child: MaterialApp(
        theme: OrbitTheme.light(),
        home: Scaffold(
          body: SizedBox(
            width: width,
            child: SingleChildScrollView(child: child),
          ),
        ),
      ),
    );

/// Reproduz o cartão de resumo tal como a tela o monta, para provar o
/// conteúdo sem levantar o Riverpod inteiro.
Widget summaryCard(CustomerAcknowledgementPreparation value) =>
    AttendanceReview(preparation: value);

void main() {
  setUpAll(() async => initializeDateFormatting('pt_BR'));

  Object? layoutError;
  setUp(() {
    layoutError = null;
    FlutterError.onError = (details) => layoutError ??= details.exception;
  });
  tearDown(() => FlutterError.onError = FlutterError.presentError);

  testWidgets('o cliente vê o resumo do servidor, e nada interno', (
    tester,
  ) async {
    await tester.pumpWidget(host(summaryCard(preparation())));

    expect(
      find.text('Manutenção preventiva realizada no equipamento.'),
      findsOneWidget,
    );
    expect(find.text('Condomínio Central'), findsOneWidget);
    expect(find.text('Split Cassete'), findsOneWidget);
    expect(find.text('TAG-1'), findsOneWidget);

    /// Nada de identificadores, hash ou vocabulário técnico na tela que o
    /// cliente lê.
    final body = tester
        .widgetList<Text>(find.byType(Text))
        .map((widget) => widget.data ?? '')
        .join(' ');
    expect(body, isNot(contains('op-1')));
    expect(body, isNot(contains('aaaa')));
    expect(body, isNot(contains('contentHash')));
    expect(body, isNot(contains('OPERATION')));
  });

  testWidgets('confirmação separa o conteúdo completo com ícones de execução', (
    tester,
  ) async {
    const summary =
        'Manutenção preventiva.\nChecklist: Visita\n• Limpar filtro: Realizado\n• Verificar dreno: Não realizado\nServiço realizado: Filtro limpo.\nMateriais utilizados:\n• Filtro: 1 UN\nEvidências registradas: 1\n• Foto após limpeza';
    await tester.pumpWidget(host(summaryCard(preparation(summary: summary))));
    for (final line in summary.split('\n')) {
      expect(find.text(line), findsOneWidget);
    }
    expect(find.byIcon(Icons.check_circle_outline), findsOneWidget);
    expect(find.byIcon(Icons.remove_circle_outline), findsOneWidget);
    expect(find.byIcon(Icons.inventory_2_outlined), findsOneWidget);
    expect(find.byIcon(Icons.photo_library_outlined), findsOneWidget);
    expect(layoutError, isNull);
  });

  testWidgets('resumo longo rola em vez de estourar', (tester) async {
    await tester.pumpWidget(
      host(
        summaryCard(
          preparation(
            summary: List.filled(
              40,
              'Substituição de filtros, limpeza de serpentina e verificação '
              'de pressão do compressor.',
            ).join(' '),
          ),
        ),
      ),
    );
    expect(layoutError, isNull);
  });

  for (final scale in [1.0, 1.3, 2.0]) {
    testWidgets('não estoura com texto em ${scale}x', (tester) async {
      await tester.pumpWidget(
        host(summaryCard(preparation()), textScale: scale),
      );
      expect(layoutError, isNull);
    });
  }

  testWidgets('tela estreita continua íntegra', (tester) async {
    await tester.pumpWidget(
      host(summaryCard(preparation()), width: 280, textScale: 1.5),
    );
    expect(layoutError, isNull);
  });

  testWidgets('nome de signatário longo não quebra o cartão', (tester) async {
    await tester.pumpWidget(
      host(
        SectionBlock(
          title: 'Ciência já registrada',
          child: const Text(
            'Maria Aparecida do Nascimento Silva Santos Oliveira Junqueira',
          ),
        ),
        textScale: 1.3,
      ),
    );
    expect(layoutError, isNull);
  });

  group('vocabulário na tela', () {
    test('os três conceitos têm nomes distintos', () {
      /// Assinatura profissional, aceite e documento não podem virar um só
      /// card chamado "Assinaturas".
      expect(signatureStatusLabels['available']!.label, contains('Assinatura'));
      expect(acknowledgementLabels['accepted']!.label, 'Ciência registrada');
      expect(
        acknowledgementLabels['pending']!.description,
        contains('ciência'),
      );
    });
  });
}
