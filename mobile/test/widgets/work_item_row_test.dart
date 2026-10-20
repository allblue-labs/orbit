/// A linha da fila em campo.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:orbit_operator/core/contracts/mobile_field_contracts.dart';
import 'package:orbit_operator/features/field/presentation/widgets/work_item_row.dart';

MobileWorkItemContract item({
  String id = 'SERVICE_OPERATION:1',
  String kind = 'SERVICE_OPERATION',
  String dueState = 'DUE_TODAY',
  String? customer = 'Cliente Teste',
  String? scheduledFor = '2026-09-01T12:00:00.000Z',
  Map<String, dynamic>? location,
  List<Map<String, dynamic>> equipment = const [],
  String? responsibleId,
  List<String> auxiliaryIds = const [],
}) => MobileWorkItemContract.fromJson({
  'id': id,
  'kind': kind,
  'sourceId': '1',
  'title': 'Atendimento',
  'businessUnit': {'id': 'bu', 'name': 'Matriz'},
  if (customer != null) 'customer': {'id': 'c1', 'name': customer},
  'location': location,
  'timezone': 'America/Recife',
  'scheduledFor': scheduledFor,
  'dueState': dueState,
  'operationalStatus': 'SCHEDULED',
  if (responsibleId != null)
    'responsibleFieldTechnician': {'id': responsibleId, 'name': 'Téc'},
  'auxiliaryTechnicians': [
    for (final id in auxiliaryIds) {'id': id, 'name': 'Aux'},
  ],
  'equipmentSummary': equipment,
  'allowedActions': <String>['VIEW'],
  'navigationContext': {'kind': kind, 'sourceId': '1'},
  'updatedAt': '2026-09-01T12:00:00.000Z',
})!;

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
  setUpAll(() async => initializeDateFormatting('pt_BR'));

  Object? layoutError;
  setUp(() {
    layoutError = null;
    FlutterError.onError = (details) => layoutError ??= details.exception;
  });
  tearDown(() => FlutterError.onError = FlutterError.presentError);

  testWidgets('mostra tipo, prazo, cliente e horário em português', (
    tester,
  ) async {
    await tester.pumpWidget(host(WorkItemRow(item: item(), onOpen: () {})));

    expect(find.text('Atendimento'), findsOneWidget);
    expect(find.text('Hoje'), findsOneWidget);
    expect(find.text('Cliente Teste'), findsOneWidget);

    /// Nenhum código de domínio na tela.
    expect(find.textContaining('SERVICE_OPERATION'), findsNothing);
    expect(find.textContaining('DUE_TODAY'), findsNothing);
  });

  testWidgets('PMOC e RVT ganham o nome do produto', (tester) async {
    await tester.pumpWidget(
      host(
        Column(
          children: [
            WorkItemRow(
              item: item(id: 'a', kind: 'PMOC'),
              onOpen: () {},
            ),
            WorkItemRow(
              item: item(id: 'b', kind: 'RVT'),
              onOpen: () {},
            ),
          ],
        ),
      ),
    );

    /// `textContaining` porque a natureza agora divide a linha de contexto
    /// com o resto — "Manutenção preventiva · Matriz". O que o teste cobra
    /// continua sendo o mesmo: o nome do produto aparece, a sigla não.
    expect(find.textContaining('Manutenção preventiva'), findsOneWidget);
    expect(find.textContaining('Visita técnica'), findsOneWidget);
    expect(find.textContaining('PMOC'), findsNothing);
    expect(find.textContaining('RVT'), findsNothing);
  });

  testWidgets('item sem data não inventa uma', (tester) async {
    final semData = item(dueState: 'UNSCHEDULED', scheduledFor: null);
    await tester.pumpWidget(host(WorkItemRow(item: semData, onOpen: () {})));

    /// A coluna da esquerda mostra o travessão — "Sem data" não cabe em 46
    /// pixels e viraria uma coluna de texto onde há uma coluna de números.
    expect(find.text('—'), findsOneWidget);

    /// Quem usa leitor de tela ouve a frase inteira, não o travessão.
    expect(semanticLabel(semData), contains('Sem data'));
  });

  testWidgets('a função de quem lê aparece quando ele está escalado', (
    tester,
  ) async {
    await tester.pumpWidget(
      host(
        Column(
          children: [
            WorkItemRow(
              item: item(id: 'a', responsibleId: 'eu'),
              currentUserId: 'eu',
              onOpen: () {},
            ),
            WorkItemRow(
              item: item(id: 'b', auxiliaryIds: const ['eu']),
              currentUserId: 'eu',
              onOpen: () {},
            ),
          ],
        ),
      ),
    );

    /// A função entra na linha de apoio, junto da natureza do trabalho —
    /// `textContaining` porque a linha é uma frase só, não três textos.
    expect(find.textContaining('Técnico em Campo'), findsOneWidget);
    expect(find.textContaining('Auxiliar'), findsOneWidget);

    /// Nada de "Equipe" genérico: os papéis são distintos no domínio.
    expect(find.textContaining('Equipe'), findsNothing);
  });

  testWidgets('abrir a linha chama a navegação', (tester) async {
    var opened = 0;
    await tester.pumpWidget(
      host(WorkItemRow(item: item(), onOpen: () => opened += 1)),
    );

    await tester.tap(find.byType(InkWell));
    await tester.pump();
    expect(opened, 1);
  });

  testWidgets('leitor de tela recebe um rótulo útil', (tester) async {
    await tester.pumpWidget(host(WorkItemRow(item: item(), onOpen: () {})));

    final label = semanticLabel(item());
    expect(label, contains('Atendimento'));
    expect(label, contains('Hoje'));
    expect(label, contains('Cliente Teste'));
  });

  for (final scale in [1.0, 1.3, 2.0]) {
    testWidgets('não estoura com texto em ${scale}x', (tester) async {
      await tester.pumpWidget(
        host(
          WorkItemRow(
            item: item(
              customer:
                  'Condomínio Empresarial Torre Norte — Central de Água '
                  'Gelada, Subsolo 2, Ala Leste',
              location: const {
                'label':
                    'Avenida Governador Agamenon Magalhães, 4775, '
                    'Sala 1802, Empresarial Isaac Newton, Recife',
              },
              equipment: const [
                {
                  'id': 'e1',
                  'name':
                      'Chiller Centrífugo de Alta Capacidade — Unidade '
                      'Condensadora Externa 03',
                  'type': 'CHILLER',
                  'status': 'ACTIVE',
                },
              ],
            ),
            onOpen: () {},
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
        WorkItemRow(item: item(), onOpen: () {}),
        width: 280,
        textScale: 1.5,
      ),
    );
    expect(layoutError, isNull);
  });
}
