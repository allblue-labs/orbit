/// O que o aplicativo faz com um atendimento concluído.
///
/// ## Os defeitos
///
/// 1. Concluído chegava como "atrasado", "hoje" ou "próximo" — o servidor
///    classificava só pela data. O mesmo PMOC mudava de lista sem mudar de
///    estado.
/// 2. A aba "Concluídos" da home punha "quinta-feira, 20 de novembro" numa
///    coluna de 48 pixels feita para "09:30", e a linha inteira desmontava.
/// 3. PMOC concluído abria na tela genérica de operação, sem o relatório.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:orbit_operator/core/contracts/mobile_field_contracts.dart';
import 'package:orbit_operator/core/design/orbit_primitives.dart';
import 'package:orbit_operator/core/presentation/field_registry.dart';
import 'package:orbit_operator/core/presentation/orbit_format.dart';
import 'package:orbit_operator/core/time/orbit_timezone.dart';
import 'package:orbit_operator/features/field/presentation/widgets/work_item_row.dart';

MobileWorkItemContract _item({
  required String dueState,
  String? scheduledFor,
  String? completedAt,
}) => MobileWorkItemContract.fromJson({
  'id': 'SERVICE_OPERATION:op1',
  'kind': 'SERVICE_OPERATION',
  'sourceId': 'op1',
  'title': 'Preventiva',
  'businessUnit': {'id': 'bu', 'name': 'Matriz'},
  'timezone': 'America/Recife',
  'dueState': dueState,
  'scheduledFor': scheduledFor,
  'completedAt': completedAt,
  'operationalStatus': 'COMPLETED',
  'allowedActions': <String>['VIEW'],
  'navigationContext': {'kind': 'SERVICE_OPERATION', 'sourceId': 'op1'},
  'updatedAt': '2026-11-01T12:00:00.000Z',
})!;

void main() {
  setUpAll(() async => initializeDateFormatting('pt_BR'));

  final formato = OrbitDateTimeFormat(
    OrbitTimezone.resolve(const ['America/Recife']),
  );

  group('estado concluído', () {
    test('o servidor diz concluído, e o app lê concluído', () {
      final item = _item(
        dueState: 'COMPLETED',
        completedAt: '2026-11-20T15:00:00.000Z',
      );

      expect(item.dueState, MobileDueState.completed);
      expect(item.completedAt, DateTime.parse('2026-11-20T15:00:00.000Z'));
    });

    test('tem rótulo próprio — e não cai num padrão', () {
      expect(dueStateLabel(MobileDueState.completed), 'Concluído');
    });

    test('tem tom de sucesso, não o neutro dos programados', () {
      expect(dueToneOf(MobileDueState.completed), OrbitTone.success);
    });

    /// É o nome do filtro e o que a equipe diz: passou da data sem ser feito.
    test('o atrasado se chama "Não atendido"', () {
      expect(dueStateLabel(MobileDueState.overdue), 'Não atendido');
    });
  });

  group('coluna da esquerda', () {
    /// A coluna tem 48 pixels. "20/11" cabe onde cabe "09:30".
    test('concluído mostra o dia em que foi feito, curto', () {
      final item = _item(
        dueState: 'COMPLETED',
        scheduledFor: '2026-11-02T12:00:00.000Z',
        completedAt: '2026-11-20T15:00:00.000Z',
      );

      expect(scheduleColumn(item, format: formato), '20/11');
    });

    /// Quem procura o que fez lembra de quando fez, não de quando estava
    /// marcado.
    test('usa a data de conclusão, e não a agendada', () {
      final item = _item(
        dueState: 'COMPLETED',
        scheduledFor: '2026-11-02T12:00:00.000Z',
        completedAt: '2026-11-20T15:00:00.000Z',
      );

      expect(scheduleColumn(item, format: formato), isNot('02/11'));
    });

    test('o que falta continua mostrando a hora', () {
      final item = _item(
        dueState: 'DUE_TODAY',
        scheduledFor: '2026-11-20T12:30:00.000Z',
      );

      expect(scheduleColumn(item, format: formato), '09:30');
    });

    test('o dia curto cabe na coluna', () {
      expect(
        formato.dayShortOf(DateTime.parse('2026-11-20T15:00:00.000Z')).length,
        lessThanOrEqualTo(5),
      );
    });
  });

  group('endereço de PMOC no concluído', () {
    test('lê plano, ciclo e equipamento', () {
      final concluido = MobileCompletedWorkContract.fromJson({
        'id': 'op1',
        'code': 'PMOC-1',
        'title': 'PMOC',
        'kind': 'PMOC',
        'completedAt': '2026-11-20T15:00:00.000Z',
        'pmoc': {'planId': 'p1', 'cycleId': 'c1', 'assetId': 'a1'},
      });

      expect(concluido.pmoc?.planId, 'p1');
      expect(concluido.pmoc?.isComplete, isTrue);
    });

    test('atendimento comum não tem endereço de PMOC', () {
      final concluido = MobileCompletedWorkContract.fromJson({
        'id': 'op1',
        'code': 'OS-1',
        'title': 'Corretiva',
        'kind': 'SERVICE_OPERATION',
        'completedAt': '2026-11-20T15:00:00.000Z',
      });

      expect(concluido.pmoc, isNull);
    });

    /// A rota é escopada pelos três. Com um vazio, a tela só saberia dizer
    /// "não encontrado".
    test('endereço com campo vazio não é endereço', () {
      const endereco = PmocAddressContract(
        planId: 'p1',
        cycleId: '',
        assetId: 'a1',
      );

      expect(endereco.isComplete, isFalse);
    });
  });
}
