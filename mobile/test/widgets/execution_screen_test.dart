/// A tela de execução mostra o que o servidor permitiu — nada além.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/contracts/field_operation_contracts.dart';
import 'package:orbit_operator/core/presentation/field_registry.dart';
import 'package:orbit_operator/features/field/presentation/widgets/execution_checklist.dart';

FieldOperationChecklistContract checklist({
  List<Map<String, dynamic>>? items,
}) => FieldOperationChecklistContract.fromJson({
  'id': 'cl-1',
  'name': 'Preventiva',
  'status': 'IN_PROGRESS',
  'progress': 50,
  'version': 'v1',
  'items':
      items ??
      [
        {
          'id': 'i1',
          'label': 'Filtro limpo',
          'type': 'BOOLEAN',
          'required': true,
          'answer': true,
        },
        {
          'id': 'i2',
          'label': 'Dreno desobstruído',
          'type': 'BOOLEAN',
          'required': false,
        },
      ],
});

Widget host(Widget child, {double textScale = 1.0, double width = 360}) =>
    MediaQuery(
      data: MediaQueryData(
        textScaler: TextScaler.linear(textScale),
        size: Size(width, 720),
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
  Object? layoutError;
  setUp(() {
    layoutError = null;
    FlutterError.onError = (details) => layoutError ??= details.exception;
  });
  tearDown(() => FlutterError.onError = FlutterError.presentError);

  group('checklist', () {
    testWidgets('mostra itens, obrigatoriedade e contagem', (tester) async {
      await tester.pumpWidget(
        host(
          ExecutionChecklist(
            checklists: [checklist()],
            enabled: true,
            onAnswer: (_, _, _) {},
          ),
        ),
      );

      expect(find.text('Filtro limpo *'), findsOneWidget);
      expect(find.text('Dreno desobstruído'), findsOneWidget);

      /// Contagem é leitura, não autorização.
      expect(find.text('1 de 2 itens'), findsOneWidget);
    });

    testWidgets('responder um item envia o id do backend, não o rótulo', (
      tester,
    ) async {
      String? checklistId;
      String? itemId;
      Object? answer;

      await tester.pumpWidget(
        host(
          ExecutionChecklist(
            checklists: [checklist()],
            enabled: true,
            onAnswer: (c, i, a) {
              checklistId = c;
              itemId = i;
              answer = a;
            },
          ),
        ),
      );

      await tester.tap(find.text('Dreno desobstruído'));
      await tester.pump();

      expect(checklistId, 'cl-1');

      /// Identidade é o ID: dois itens podem ter o mesmo rótulo, e a ordem
      /// pode mudar.
      expect(itemId, 'i2');
      expect(answer, isTrue);
    });

    testWidgets('sem permissão publicada, o checklist não aceita toque', (
      tester,
    ) async {
      var called = 0;
      await tester.pumpWidget(
        host(
          ExecutionChecklist(
            checklists: [checklist()],
            enabled: false,
            onAnswer: (_, _, _) => called += 1,
          ),
        ),
      );

      await tester.tap(find.text('Dreno desobstruído'));
      await tester.pump();
      expect(called, 0);
    });

    testWidgets('o leitor de tela anuncia o item e a obrigatoriedade', (
      tester,
    ) async {
      await tester.pumpWidget(
        host(
          ExecutionChecklist(
            checklists: [checklist()],
            enabled: true,
            onAnswer: (_, _, _) {},
          ),
        ),
      );

      expect(
        find.bySemanticsLabel('Filtro limpo, obrigatório'),
        findsOneWidget,
      );
    });

    for (final scale in [1.0, 1.3, 2.0]) {
      testWidgets('não estoura com texto em ${scale}x', (tester) async {
        await tester.pumpWidget(
          host(
            ExecutionChecklist(
              checklists: [
                checklist(
                  items: const [
                    {
                      'id': 'i1',
                      'label':
                          'Verificar pressão de sucção e descarga do '
                          'compressor scroll da unidade condensadora externa',
                      'type': 'BOOLEAN',
                      'required': true,
                    },
                  ],
                ),
              ],
              enabled: true,
              onAnswer: (_, _, _) {},
            ),
            textScale: scale,
          ),
        );
        expect(layoutError, isNull);
      });
    }

    testWidgets('tela estreita continua íntegra', (tester) async {
      await tester.pumpWidget(
        host(
          ExecutionChecklist(
            checklists: [checklist()],
            enabled: true,
            onAnswer: (_, _, _) {},
          ),
          width: 280,
          textScale: 1.5,
        ),
      );
      expect(layoutError, isNull);
    });
  });

  group('vocabulário', () {
    test('as ações têm nome de produto, sem código cru', () {
      for (final code in [
        'START',
        'RESUME',
        'COMPLETE',
        'UPDATE_CHECKLIST',
        'ADD_NOTE',
        'REGISTER_MATERIAL',
      ]) {
        final label = executionActionLabel(code);
        expect(label, isNotNull, reason: code);
        expect(label!.label, isNot(contains('_')));
        expect(label.label, isNot(matches(RegExp(r'^[A-Z_]+$'))));
      }
    });

    test('concluir não promete documento, assinatura nem aceite', () {
      /// Conclusão de atendimento e finalização documental são coisas
      /// distintas — e prometer a segunda aqui seria mentir.
      final complete = executionActionLabel('COMPLETE')!;
      expect(complete.label, 'Concluir atendimento');
      expect(complete.description, contains('em separado'));
      expect(complete.description, isNot(contains('assinatura')));
      expect(complete.description, isNot(contains('aceite')));
    });

    test('impedimentos viram frase, e o desconhecido não vaza código', () {
      expect(
        executionBlockerLabel('OPERATION_NOT_ASSIGNED'),
        'Você não está escalado para este atendimento.',
      );
      final unknown = executionBlockerLabel('ALGO_NOVO');
      expect(unknown, isNot(contains('ALGO_NOVO')));
      expect(unknown, 'Execução indisponível no momento.');
    });
  });
}
