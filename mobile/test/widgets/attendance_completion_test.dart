import 'package:flutter/material.dart';
import 'package:dio/dio.dart';
import '../support/scripted_adapter.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:orbit_operator/core/design/orbit_wizard.dart';
import 'package:orbit_operator/core/errors/orbit_exception.dart';
import 'package:orbit_operator/features/field/presentation/widgets/attendance_wizard.dart';
import 'package:orbit_operator/features/field/presentation/widgets/attendance_result.dart';
import 'package:orbit_operator/features/signature/presentation/customer_acknowledgement_screen.dart';
import 'customer_signature_test.dart' as fixture;

class RetryConfirmation extends fixture.Backend {
  bool firstPush = true;
  @override
  Future<ResponseBody> call(RequestOptions options) async {
    if (firstPush && options.path.endsWith('/sync/push')) {
      firstPush = false;
      final commands = (options.data as Map)['commands'] as List;
      return jsonResponse({
        'success': true,
        'data': {
          'results': [
            for (final command in commands)
              {
                'commandId': command['commandId'],
                'commandType': command['commandType'],
                'status': 'RETRYABLE_ERROR',
                'serverVersion': null,
                'error': {
                  'code': 'TEMPORARY',
                  'message': 'Tente novamente.',
                  'retryable': true,
                },
              },
          ],
          'serverTime': DateTime.now().toUtc().toIso8601String(),
          'nextRecommendedAction': 'NONE',
        },
      });
    }
    return super.call(options);
  }
}

void main() {
  setUpAll(() async => initializeDateFormatting('pt_BR'));
  for (final failsFirst in [false, true]) {
    testWidgets(
      failsFirst
          ? 'repete apenas a conclusão quando o aceite já foi salvo'
          : 'confirmar o cliente conclui e abre o resultado sem outro botão de concluir',
      (tester) async {
        final backend = fixture.Backend();
        var completed = false;
        var attempts = 0;
        final screen = StatefulBuilder(
          builder: (context, setState) => Scaffold(
            body: SingleChildScrollView(
              child: AttendanceWizard(
                operationId: 'op-1',
                confirmationStep: 0,
                completed: completed,
                onComplete: () async {
                  expect(backend.acknowledgements, hasLength(1));
                  attempts++;
                  if (failsFirst && attempts == 1) {
                    throw const OrbitException(
                      kind: OrbitErrorKind.http,
                      publicMessage: 'A conclusão falhou. Tente novamente.',
                      code: 'TEST',
                    );
                  }
                  setState(() => completed = true);
                  return true;
                },
                steps: const [
                  OrbitWizardStep(
                    title: 'Confirmação',
                    child: CustomerAcknowledgementScreen(
                      operationId: 'op-1',
                      embedded: true,
                    ),
                  ),
                  OrbitWizardStep(
                    title: 'Conclusão',
                    child: Text('Resumo técnico do atendimento'),
                  ),
                ],
              ),
            ),
          ),
        );
        await tester.pumpWidget(
          fixture.cenario(backend, screenOverride: screen).widget,
        );
        await tester.pumpAndSettle();
        expect(find.textContaining('Avançar'), findsNothing);
        await tester.enterText(find.byType(TextField), 'Cliente Local');
        await fixture.tocarEm(tester, 'Confirmar atendimento');
        if (failsFirst) {
          expect(
            find.text('A conclusão falhou. Tente novamente.'),
            findsOneWidget,
          );
          expect(find.byIcon(Icons.check_circle_rounded), findsNothing);
          await fixture.tocarEm(tester, 'Tentar novamente');
        }
        expect(attempts, failsFirst ? 2 : 1);
        expect(backend.acknowledgements, hasLength(1));
        expect(find.text('ATENDIMENTO CONCLUÍDO'), findsOneWidget);
        expect(find.text('Resumo técnico do atendimento'), findsOneWidget);
        expect(find.text('Concluir atendimento'), findsNothing);
        expect(find.text('Voltar'), findsNothing);
        expect(find.text('Atualizar'), findsNothing);
      },
    );
  }
  testWidgets(
    'conclui automaticamente quando o aceite pendente é sincronizado',
    (tester) async {
      final backend = RetryConfirmation();
      var completed = false;
      var finishes = 0;
      final screen = StatefulBuilder(
        builder: (context, setState) => Scaffold(
          body: SingleChildScrollView(
            child: AttendanceWizard(
              operationId: 'op-1',
              confirmationStep: 0,
              completed: completed,
              onComplete: () async {
                finishes++;
                setState(() => completed = true);
                return true;
              },
              steps: const [
                OrbitWizardStep(
                  title: 'Confirmação',
                  child: CustomerAcknowledgementScreen(
                    operationId: 'op-1',
                    embedded: true,
                  ),
                ),
                OrbitWizardStep(
                  title: 'Conclusão',
                  child: Text('Resumo técnico'),
                ),
              ],
            ),
          ),
        ),
      );
      final scenario = fixture.cenario(backend, screenOverride: screen);
      await tester.pumpWidget(scenario.widget);
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'Cliente Local');
      await fixture.tocarEm(tester, 'Confirmar atendimento');
      for (var i = 0; i < 30; i++) {
        await tester.pump(const Duration(milliseconds: 50));
      }
      expect(finishes, 0);
      expect(find.text('CIÊNCIA SALVA NESTE APARELHO'), findsOneWidget);
      expect(find.text('ATENDIMENTO CONCLUÍDO'), findsNothing);
      var synced = false;
      final syncing = scenario.sync
          .sync(manual: true)
          .then((_) => synced = true);
      for (var i = 0; i < 30; i++) {
        await tester.pump(const Duration(milliseconds: 50));
      }
      expect(synced, isTrue);
      await syncing;
      await tester.pumpAndSettle();
      expect(finishes, 1);
      expect(backend.acknowledgements, hasLength(1));
      expect(find.text('ATENDIMENTO CONCLUÍDO'), findsOneWidget);
    },
  );

  testWidgets('aguardando sincronização não é apresentado como concluído', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: AttendanceResult(
            completed: false,
            finishing: false,
            child: Text('Resumo técnico'),
          ),
        ),
      ),
    );
    expect(find.byIcon(Icons.check_circle_rounded), findsNothing);
    expect(find.textContaining('aguardando sincronização'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
  });
}
