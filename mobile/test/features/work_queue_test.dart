/// A fila preserva o que o servidor decidiu.
///
/// Nenhum destes testes verifica a **regra** de prioridade — ela é do backend.
/// O que se prova é que o Flutter não a reescreve: a ordem recebida é a ordem
/// exibida, e páginas repetidas não viram itens repetidos.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/contracts/mobile_field_contracts.dart';
import 'package:orbit_operator/features/field/application/field_providers.dart';
import 'package:orbit_operator/features/field/data/field_repository.dart';

MobileWorkItemContract _item(String id, MobileDueState due) =>
    MobileWorkItemContract.fromJson({
      'id': id,
      'kind': 'SERVICE_OPERATION',
      'sourceId': id,
      'title': 'Item $id',
      'businessUnit': {'id': 'bu', 'name': 'Matriz'},
      'timezone': 'America/Recife',
      'dueState': switch (due) {
        MobileDueState.inProgress => 'IN_PROGRESS',
        MobileDueState.overdue => 'OVERDUE',
        MobileDueState.dueToday => 'DUE_TODAY',
        MobileDueState.upcoming => 'UPCOMING',
        MobileDueState.unscheduled => 'UNSCHEDULED',
      },
      'operationalStatus': 'SCHEDULED',
      'allowedActions': <String>['VIEW'],
      'navigationContext': {'kind': 'SERVICE_OPERATION', 'sourceId': id},
      'updatedAt': '2026-09-01T12:00:00.000Z',
    })!;

void main() {
  group('junção de páginas', () {
    test('preserva a ordem recebida, sem reordenar', () {
      /// De propósito fora de qualquer ordem "lógica": se o app tentasse
      /// ranquear, esta lista mudaria.
      final first = [
        _item('c', MobileDueState.upcoming),
        _item('a', MobileDueState.overdue),
        _item('b', MobileDueState.inProgress),
      ];
      final second = [_item('d', MobileDueState.dueToday)];

      final merged = mergeWorkItems(first, second);

      expect(merged.map((item) => item.id).toList(), ['c', 'a', 'b', 'd']);
    });

    test('repetir a mesma página não duplica item', () {
      /// O cursor aponta para o último item entregue e a ordenação é
      /// determinística: reenviar o mesmo cursor devolve a mesma página. Isso
      /// precisa ser operação sem efeito.
      final page = [
        _item('a', MobileDueState.overdue),
        _item('b', MobileDueState.dueToday),
      ];

      final once = mergeWorkItems(const [], page);
      final twice = mergeWorkItems(once, page);

      expect(twice.length, 2);
      expect(twice.map((item) => item.id).toList(), ['a', 'b']);
    });

    test('a identidade é o ID canônico, não o nome do cliente', () {
      /// O mesmo cliente tem vários atendimentos no mesmo dia — deduplicar por
      /// nome apagaria trabalho real.
      final sameCustomer = [
        MobileWorkItemContract.fromJson({
          'id': 'SERVICE_OPERATION:1',
          'kind': 'SERVICE_OPERATION',
          'sourceId': '1',
          'title': 'Manhã',
          'businessUnit': {'id': 'bu', 'name': 'Matriz'},
          'customer': {'id': 'c1', 'name': 'Cliente Único'},
          'timezone': 'America/Recife',
          'dueState': 'DUE_TODAY',
          'operationalStatus': 'SCHEDULED',
          'allowedActions': <String>[],
          'navigationContext': {'kind': 'SERVICE_OPERATION', 'sourceId': '1'},
          'updatedAt': '2026-09-01T12:00:00.000Z',
        })!,
        MobileWorkItemContract.fromJson({
          'id': 'SERVICE_OPERATION:2',
          'kind': 'SERVICE_OPERATION',
          'sourceId': '2',
          'title': 'Tarde',
          'businessUnit': {'id': 'bu', 'name': 'Matriz'},
          'customer': {'id': 'c1', 'name': 'Cliente Único'},
          'timezone': 'America/Recife',
          'dueState': 'DUE_TODAY',
          'operationalStatus': 'SCHEDULED',
          'allowedActions': <String>[],
          'navigationContext': {'kind': 'SERVICE_OPERATION', 'sourceId': '2'},
          'updatedAt': '2026-09-01T12:00:00.000Z',
        })!,
      ];

      expect(mergeWorkItems(const [], sameCustomer).length, 2);
    });
  });

  group('desserialização', () {
    test('lê o item completo sem reconstruir identidade', () {
      final item = MobileWorkItemContract.fromJson({
        'id': 'PMOC:ciclo-1:equip-1',
        'kind': 'PMOC',
        'sourceId': 'ciclo-1',
        'schedulingId': 'evento-9',
        'title': 'Preventiva',
        'businessUnit': {'id': 'bu', 'name': 'Matriz'},
        'customer': {
          'id': 'c1',
          'name': 'Cliente',
          'contact': {'name': 'Ana', 'phone': '81999999999'},
        },
        'timezone': 'America/Recife',
        'scheduledFor': '2026-09-01T12:00:00.000Z',
        'dueState': 'OVERDUE',
        'operationalStatus': 'PENDING',
        'responsibleFieldTechnician': {'id': 'u1', 'name': 'Téc'},
        'auxiliaryTechnicians': [
          {'id': 'u2', 'name': 'Aux'},
        ],
        'equipmentSummary': [
          {'id': 'e1', 'name': 'Split', 'type': 'AC', 'status': 'ACTIVE'},
        ],
        'allowedActions': <String>['VIEW', 'START'],
        'primaryAction': 'START',
        'navigationContext': {
          'kind': 'PMOC',
          'sourceId': 'ciclo-1',
          'cycleId': 'ciclo-1',
          'equipmentId': 'equip-1',
        },
        'updatedAt': '2026-09-01T12:00:00.000Z',
      });

      expect(item, isNotNull);

      /// O ID vem inteiro do servidor — nada é remontado a partir das partes.
      expect(item!.id, 'PMOC:ciclo-1:equip-1');
      expect(item.kind, MobileWorkItemKind.pmoc);
      expect(item.dueState, MobileDueState.overdue);
      expect(item.primaryAction, MobileFieldAction.start);
      expect(item.navigationContext.cycleId, 'ciclo-1');
      expect(item.auxiliaryTechnicians.single.name, 'Aux');
      expect(item.customer?.contact?.phone, '81999999999');
    });

    test('ação desconhecida some da lista em vez de virar botão', () {
      final item = MobileWorkItemContract.fromJson({
        'id': 'x',
        'kind': 'RVT',
        'sourceId': 'x',
        'title': 'Visita',
        'businessUnit': {'id': 'bu', 'name': 'Matriz'},
        'timezone': 'America/Recife',
        'dueState': 'UPCOMING',
        'operationalStatus': 'SCHEDULED',
        'allowedActions': <String>['VIEW', 'TELEPORTAR'],
        'primaryAction': 'TELEPORTAR',
        'navigationContext': {'kind': 'RVT', 'sourceId': 'x'},
        'updatedAt': '2026-09-01T12:00:00.000Z',
      })!;

      expect(item.allowedActions, [MobileFieldAction.view]);

      /// Ação principal desconhecida vira ausência, não botão sem nome.
      expect(item.primaryAction, isNull);
    });

    test('item de tipo desconhecido é descartado, não quebra a lista', () {
      final item = MobileWorkItemContract.fromJson({
        'id': 'y',
        'kind': 'ALGO_NOVO',
        'sourceId': 'y',
        'title': 'Futuro',
        'businessUnit': {'id': 'bu', 'name': 'Matriz'},
        'timezone': 'America/Recife',
        'dueState': 'UPCOMING',
        'operationalStatus': 'SCHEDULED',
        'allowedActions': <String>[],
        'navigationContext': {'kind': 'ALGO_NOVO', 'sourceId': 'y'},
        'updatedAt': '2026-09-01T12:00:00.000Z',
      });

      expect(item, isNull);
    });

    test('a página lê contagem e cursor do meta do servidor', () {
      final page = MobileWorkQueuePageContract.fromJson({
        'data': [
          {
            'id': 'a',
            'kind': 'SERVICE_OPERATION',
            'sourceId': 'a',
            'title': 'A',
            'businessUnit': {'id': 'bu', 'name': 'Matriz'},
            'timezone': 'America/Recife',
            'dueState': 'DUE_TODAY',
            'operationalStatus': 'SCHEDULED',
            'allowedActions': <String>[],
            'navigationContext': {'kind': 'SERVICE_OPERATION', 'sourceId': 'a'},
            'updatedAt': '2026-09-01T12:00:00.000Z',
          },
        ],
        'meta': {'limit': 20, 'nextCursor': 'abc', 'hasNextPage': true},
      });

      expect(page.data.single.id, 'a');
      expect(page.nextCursor, 'abc');
      expect(page.hasNextPage, isTrue);
      expect(page.limit, 20);
    });
  });

  group('dashboard', () {
    test('as contagens vêm do servidor, não da soma das listas', () {
      /// Listas e contadores divergem de propósito neste JSON: o dashboard traz
      /// prévias, e a contagem é do total. Somar o que está em mãos daria
      /// outro número.
      final dashboard = MobileFieldDashboardContract.fromJson({
        'next': null,
        'counters': {'today': 12, 'overdue': 3, 'inProgress': 1, 'upcoming': 7},
        'today': <Map<String, dynamic>>[],
        'overdue': <Map<String, dynamic>>[],
        'inProgress': <Map<String, dynamic>>[],
        'capabilities': {'canScanEquipment': true, 'canCreateAdHocRvt': false},
      });

      expect(dashboard.counters.today, 12);
      expect(dashboard.today, isEmpty);
      expect(dashboard.canScanEquipment, isTrue);
    });
  });

  group('recortes da tela de Atendimentos', () {
    test('a contagem de filtros ativos ignora o recorte de prazo', () {
      /// O recorte de prazo tem abas próprias e está sempre visível. Contá-lo
      /// faria o botão nascer com "1" e nunca zerar — um contador que nunca
      /// zera não informa nada.
      const semFiltro = WorkQueueFilter(view: WorkQueueView.overdue);
      expect(semFiltro.activeCount, 0);

      const comTipo = WorkQueueFilter(kind: MobileWorkItemKind.pmoc);
      expect(comTipo.activeCount, 1);
    });

    test('período conta como um recorte só, mesmo com as duas pontas', () {
      final so = WorkQueueFilter(from: DateTime(2026, 9, 1));
      final ambos = WorkQueueFilter(
        from: DateTime(2026, 9, 1),
        to: DateTime(2026, 9, 30),
      );
      expect(so.activeCount, 1);
      expect(ambos.activeCount, 1);
    });

    test('limpar um recorte não derruba os outros', () {
      final cheio = WorkQueueFilter(
        view: WorkQueueView.today,
        kind: MobileWorkItemKind.rvt,
        customerId: 'c1',
        customerName: 'Shopping Recife',
        from: DateTime(2026, 9, 1),
        to: DateTime(2026, 9, 30),
      );
      expect(cheio.activeCount, 3);

      final semCliente = cheio.copyWith(clearCustomer: true);
      expect(semCliente.customerId, isNull);
      expect(semCliente.customerName, isNull);
      expect(semCliente.kind, MobileWorkItemKind.rvt);
      expect(semCliente.from, isNotNull);

      /// O recorte de prazo sobrevive a tudo: ele é a aba, não um filtro.
      expect(semCliente.view, WorkQueueView.today);
      expect(semCliente.activeCount, 2);
    });

    test('dois filtros iguais são o mesmo, para o provider não recarregar', () {
      /// `WorkQueueFilter` é chave de recarga. Se a igualdade ignorasse um
      /// campo, mudar aquele campo não recarregaria a lista.
      final a = WorkQueueFilter(customerId: 'c1', from: DateTime(2026, 9, 1));
      final b = WorkQueueFilter(customerId: 'c1', from: DateTime(2026, 9, 1));
      final c = WorkQueueFilter(customerId: 'c2', from: DateTime(2026, 9, 1));
      expect(a, b);
      expect(a == c, isFalse);
    });
  });
}
