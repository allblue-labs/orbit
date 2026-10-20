/// Concorrência, idempotência e autoridade na execução de campo.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/contracts/field_operation_contracts.dart';
import 'package:orbit_operator/features/field/application/execution_controller.dart';

void main() {
  group('identificador de comando', () {
    test('é um UUIDv7 válido, como o backend exige', () {
      final id = newCommandId();
      expect(
        id,
        matches(
          RegExp(
            r'^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
          ),
        ),
      );
    });

    test('dois toques no mesmo instante geram chaves diferentes', () {
      /// Carimbo de tempo sozinho colidiria — e separar duas intenções feitas
      /// no mesmo milissegundo é justamente o trabalho da chave.
      final ids = List.generate(200, (_) => newCommandId()).toSet();
      expect(ids.length, 200);
    });
  });

  group('estado da execução', () {
    FieldOperationExecutionPreparationContract preparation({
      List<String> actions = const ['START'],
      String? primary = 'START',
      bool eligible = true,
      List<String> blockers = const [],
    }) => FieldOperationExecutionPreparationContract.fromJson({
      'operation': {
        'id': 'op-1',
        'code': 'OS-1',
        'title': 'Atendimento',
        'status': 'SCHEDULED',
        'priority': 'NORMAL',
      },
      'equipment': <Map<String, dynamic>>[],
      'auxiliaryTechnicians': <Map<String, dynamic>>[],
      'checklist': <Map<String, dynamic>>[],
      'materialPolicy': {'enabled': true},
      'allowedTransitions': <String>['IN_PROGRESS'],
      'allowedActions': actions,
      'primaryAction': primary,
      'version': '2026-09-01T12:00:00.000Z',
      'executionEligibility': {'eligible': eligible, 'blockers': blockers},
    });

    test('só permite o que o servidor publicou', () {
      final state = ExecutionState(
        phase: ExecutionPhase.ready,
        preparation: preparation(actions: const ['START', 'ADD_NOTE']),
      );

      expect(state.allows(FieldOperationAllowedAction.start), isTrue);
      expect(state.allows(FieldOperationAllowedAction.addNote), isTrue);

      /// Concluir não foi publicado — e o app não o deduz de status algum.
      expect(state.allows(FieldOperationAllowedAction.complete), isFalse);
    });

    test('sem preparação carregada nada é permitido', () {
      const state = ExecutionState(phase: ExecutionPhase.loading);
      expect(state.allowedActions, isEmpty);
      expect(state.allows(FieldOperationAllowedAction.start), isFalse);
    });

    test('ação desconhecida não entra na lista', () {
      final state = ExecutionState(
        phase: ExecutionPhase.ready,
        preparation: preparation(
          actions: const ['START', 'TELETRANSPORTAR'],
          primary: 'TELETRANSPORTAR',
        ),
      );

      expect(state.allowedActions, [FieldOperationAllowedAction.start]);

      /// Principal desconhecida vira ausência de botão, não botão sem nome.
      expect(state.preparation!.primaryAction, isNull);
    });

    test('bloqueios chegam do servidor e não são recalculados', () {
      final state = ExecutionState(
        phase: ExecutionPhase.ready,
        preparation: preparation(
          actions: const [],
          primary: null,
          eligible: false,
          blockers: const ['OPERATION_NOT_ASSIGNED'],
        ),
      );

      expect(state.preparation!.eligible, isFalse);
      expect(state.preparation!.blockers, ['OPERATION_NOT_ASSIGNED']);

      /// Sem ação publicada, nenhuma ação — o bloqueio não é inferido daqui.
      expect(state.allowedActions, isEmpty);
    });
  });

  group('envelope do comando', () {
    test('carrega versão, chave e instante', () {
      final command = FieldOperationCommandContract(
        commandId: '01920000-0000-7000-8000-000000000001',
        idempotencyKey: '01920000-0000-7000-8000-000000000001',
        expectedVersion: '2026-09-01T12:00:00.000Z',
        occurredAt: DateTime.utc(2026, 9, 1, 12, 30),
      );

      final json = command.toJson();
      expect(json['commandId'], command.commandId);
      expect(json['idempotencyKey'], command.idempotencyKey);

      /// A versão que o usuário viu ao decidir — é ela que impede sobrescrever
      /// o que outra pessoa mudou nesse meio-tempo.
      expect(json['expectedVersion'], '2026-09-01T12:00:00.000Z');
      expect(json['occurredAt'], '2026-09-01T12:30:00.000Z');
    });
  });

  group('checklist', () {
    test('as respostas partem do que o servidor devolveu', () {
      final checklist = FieldOperationChecklistContract.fromJson({
        'id': 'cl-1',
        'name': 'Preventiva',
        'status': 'IN_PROGRESS',
        'progress': 50,
        'version': 'v1',
        'items': [
          {
            'id': 'i1',
            'label': 'Filtro limpo',
            'required': true,
            'answer': true,
          },
          {'id': 'i2', 'label': 'Dreno', 'required': false, 'answer': null},
        ],
      });

      /// Só o que tem resposta entra no mapa — reenviar o resto como `null`
      /// apagaria respostas que a tela não está mostrando.
      expect(checklist.answers, {'i1': true});
      expect(checklist.items.first.isAnswered, isTrue);
      expect(checklist.items.last.isAnswered, isFalse);
    });

    test('obrigatoriedade é apresentação, não autorização', () {
      final checklist = FieldOperationChecklistContract.fromJson({
        'id': 'cl-1',
        'name': 'Preventiva',
        'status': 'PENDING',
        'progress': 0,
        'version': 'v1',
        'items': [
          {'id': 'i1', 'label': 'Obrigatório', 'required': true},
        ],
      });

      expect(checklist.items.single.required, isTrue);

      /// Nada aqui diz se pode concluir: isso é `allowedActions`.
      expect(checklist.items.single.isAnswered, isFalse);
    });
  });

  group('resultado do comando', () {
    test('o servidor avisa quando foi reexecução da mesma intenção', () {
      final result = FieldOperationCommandResultContract.fromJson({
        'operationId': 'op-1',
        'status': 'IN_PROGRESS',
        'version': '2026-09-01T13:00:00.000Z',
        'allowedActions': <String>['COMPLETE', 'ADD_NOTE'],
        'idempotentReplay': true,
        'startedBy': {'id': 'u1', 'name': 'Téc'},
        'startedAt': '2026-09-01T12:55:00.000Z',
      });

      expect(result.idempotentReplay, isTrue);
      expect(result.version, '2026-09-01T13:00:00.000Z');

      /// Quem executou é histórico e vem nomeado.
      expect(result.startedBy?.name, 'Téc');
      expect(result.completedBy, isNull);
    });
  });

  group('material', () {
    test('quantidade e saldo chegam como texto, sem passar por double', () {
      final result = FieldOperationMaterialResultContract.fromJson({
        'movementId': 'mv-1',
        'operationId': 'op-1',
        'catalogItemId': 'item-1',
        'quantity': '2.500',
        'balanceAfter': '97.500',
        'idempotentReplay': false,
      });

      /// Decimal exato: o saldo é do Inventory e não deve ser reinterpretado.
      expect(result.quantity, '2.500');
      expect(result.balanceAfter, '97.500');
    });
  });

  group('linha do tempo', () {
    test('preserva a ordem publicada e a frase do servidor', () {
      final page = FieldOperationTimelinePageContract.fromJson({
        'data': [
          {
            'id': 'a',
            'type': 'FIELD_OPERATION_STARTED',
            'message': 'Atendimento iniciado',
            'occurredAt': '2026-09-01T12:00:00.000Z',
          },
          {
            'id': 'b',
            'type': 'FIELD_OPERATION_NOTE_ADDED',
            'message': 'Observação registrada',
            'occurredAt': '2026-09-01T12:10:00.000Z',
          },
        ],
        'meta': {'limit': 20, 'hasNextPage': false, 'nextCursor': null},
      });

      expect(page.data.map((entry) => entry.id).toList(), ['a', 'b']);
      expect(page.data.first.message, 'Atendimento iniciado');
      expect(page.hasNextPage, isFalse);
    });
  });
}
