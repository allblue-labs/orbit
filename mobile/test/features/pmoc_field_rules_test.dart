/// Duas regras da tela de PMOC no campo.
///
/// ## Quem pode atender
///
/// A mesma do servidor: o técnico atribuído ao plano, ou o dono. Ela existe na
/// interface para não oferecer um botão que voltaria 403 — e é por isso que
/// precisa ser a mesma, e não parecida: uma regra mais generosa aqui promete o que
/// o backend recusa; uma mais estrita esconde trabalho de quem devia fazê-lo.
///
/// ## O vencimento não muda de dia
///
/// `dueOn` é data civil, decidida pelo servidor no fuso da unidade. Passá-la por
/// `DateTime` local a desloca em quem está a oeste de UTC — e o Brasil todo está.
/// O dia que vira "ontem" é a diferença entre "vence hoje" e "venceu".
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/contracts/pmoc_contracts.dart';
import 'package:orbit_operator/features/pmoc/application/pmoc_providers.dart';
import 'package:orbit_operator/features/pmoc/presentation/pmoc_labels.dart';

PmocPlanCycleView view(String? technicianId) => PmocPlanCycleView(
  plan: PmocPlanDetailContract.fromJson({
    'id': 'plan-1',
    'code': 'PMOC-1',
    'name': 'PMOC Matriz',
    'status': 'ACTIVE',
    'customer': {'id': 'cust-1', 'name': 'Clínica'},
    'technician': technicianId == null
        ? null
        : {'id': technicianId, 'displayName': 'Ana'},
    'coveredEquipment': 3,
    'currentExecution': {
      'id': 'cycle-1',
      'sequenceNumber': 7,
      'status': 'PENDING',
      'dueOn': '2026-10-31',
    },
  }),
  cycle: null,
  equipment: const [],
);

void main() {
  group('quem pode atender', () {
    test('o técnico atribuído ao plano', () {
      expect(
        view('user-1').canAttend(actorId: 'user-1', isOwner: false),
        isTrue,
      );
    });

    test('ninguém mais, mesmo com o aplicativo aberto', () {
      expect(
        view('user-1').canAttend(actorId: 'user-2', isOwner: false),
        isFalse,
      );
    });

    test('o dono atende sem atribuição', () {
      /// É ele que atende quando o escalado faltou; exigir reatribuição deixaria
      /// a operação parada.
      expect(view('user-1').canAttend(actorId: 'dono', isOwner: true), isTrue);
    });

    test('plano sem técnico não libera para qualquer um', () {
      /// `null` de um lado e `null` do outro não podem "casar": sem atribuição,
      /// só o dono.
      expect(view(null).canAttend(actorId: null, isOwner: false), isFalse);
      expect(view(null).canAttend(actorId: 'user-1', isOwner: false), isFalse);
      expect(view(null).canAttend(actorId: null, isOwner: true), isTrue);
    });
  });

  group('vencimento', () {
    test('mantém o dia que o servidor decidiu', () {
      expect(pmocDueLabel('2026-10-31'), '31/10/2026');

      /// Meia-noite UTC é o caso que a conversão local estragaria: em Recife
      /// (UTC-3) isso viraria dia 30.
      expect(pmocDueLabel('2026-10-31T00:00:00.000Z'), '31/10/2026');
    });

    test('ausência não vira data', () {
      expect(pmocDueLabel(null), '—');
      expect(pmocDueLabel(''), '—');
    });
  });

  group('bloqueios', () {
    test('viram frase em português', () {
      expect(
        pmocBlockedReasonLabel('TECHNICAL_RESPONSIBLE_MISSING'),
        contains('Responsável Técnico'),
      );
    });

    test('código desconhecido aparece como veio', () {
      /// Um texto genérico apagaria a única pista de quem for investigar — e o
      /// backend pode publicar um motivo novo antes desta tela conhecê-lo.
      expect(pmocBlockedReasonLabel('MOTIVO_NOVO'), 'MOTIVO_NOVO');
    });
  });

  _revisoes();

  group('situação do equipamento', () {
    test('o que ainda não começou se chama "a atender"', () {
      /// O servidor manda `NOT_STARTED`, que não é palavra de ninguém em campo.
      expect(pmocEquipmentStatus('NOT_STARTED').label, 'A atender');
      expect(pmocEquipmentStatus('COMPLETED').label, 'Concluído');
    });
  });
}

/// Qual revisão do documento se distribui.
///
/// A execução de artefato acumula revisões: reemitir abre outra, e a anterior
/// continua no registro. Só uma é a ativa, e só ela tem arquivo — entregar a
/// errada mandaria ao cliente um PDF que já foi substituído, ou um revogado, que
/// é o oposto do propósito da revogação.
void _revisoes() {
  PmocDocumentRevisionContract revisao({
    required String id,
    int revision = 1,
    String status = 'ISSUED',
    bool isActive = true,
    String? issuedAt = '2026-09-29T12:00:00.000Z',
  }) => PmocDocumentRevisionContract.fromJson({
    'id': id,
    'revision': revision,
    'status': status,
    'format': 'PDF',
    'isActive': isActive,
    'issuedAt': issuedAt,
  });

  group('revisão distribuível', () {
    test('é a ativa e emitida', () {
      final escolhida = distributableRevision([
        revisao(id: 'r1', revision: 1, isActive: false),
        revisao(id: 'r2', revision: 2),
      ]);

      expect(escolhida?.id, 'r2');
    });

    test('rascunho não conta, mesmo sendo a ativa', () {
      /// Revisão aberta sem arquivo é o estado dos primeiros segundos depois de
      /// emitir. Oferecer download aqui daria erro no lugar do documento.
      final escolhida = distributableRevision([
        revisao(id: 'r1', issuedAt: null),
      ]);

      expect(escolhida, isNull);
    });

    test('revogada não se distribui', () {
      final escolhida = distributableRevision([
        revisao(id: 'r1', status: 'REVOKED'),
      ]);

      expect(escolhida, isNull);
    });

    test('sem revisão nenhuma, nada a entregar', () {
      expect(distributableRevision(const []), isNull);
    });
  });
}
