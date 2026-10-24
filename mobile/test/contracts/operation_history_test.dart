import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/contracts/operation_contracts.dart';

OperationHistoryEntry event(String action, {Object? details}) =>
    OperationHistoryEntry.fromJson({
      'id': 'event-1',
      'action': action,
      'details': details,
      'createdAt': '2026-10-24T12:00:00Z',
      'user': {'displayName': 'Ana'},
    });

void main() {
  test('documento preparado tem título e explicação sem IDs nem hashes', () {
    final entry = event(
      'FIELD_DOCUMENT_PREPARED',
      details: {'artifactId': 'internal-id', 'snapshotHash': 'private-hash'},
    );
    expect(entry.label, 'Documento do atendimento preparado');
    expect(
      entry.explanation,
      'Os dados do atendimento foram reunidos para preparar o documento.',
    );
    expect(entry.actorName, 'Ana');
    expect(entry.createdAt, DateTime.utc(2026, 10, 24, 12));
  });

  for (final pair in {
    'FIELD_OPERATION_STARTED': 'Atendimento iniciado',
    'FIELD_OPERATION_COMPLETED': 'Atendimento concluído',
    'FIELD_EVIDENCE_ADDED': 'Evidência do atendimento adicionada',
    'FIELD_NOTE_ADDED': 'Observação do atendimento registrada',
    'FIELD_MATERIAL_REGISTERED': 'Uso de material registrado',
    'RESPONSIBLE_FIELD_TECHNICIAN_REPLACED': 'Técnico responsável alterado',
    'ASSIGNMENT_AUTHORIZATION_REVOKED': 'Autorização do atendimento retirada',
    'CHECKLIST_UPDATED': 'Checklist atualizado',
  }.entries) {
    test('traduz ${pair.key}', () {
      expect(event(pair.key).label, pair.value);
    });
  }

  test('eventos futuros recebem texto neutro sem o código técnico', () {
    expect(
      event('INTERNAL_FUTURE_EVENT').label,
      'Atualização registrada na operação',
    );
    expect(event('').label, 'Atualização registrada na operação');
  });

  test('mudanças de situação usam somente situações conhecidas', () {
    final known = OperationHistoryEntry.fromJson({
      'action': 'STATUS_CHANGED',
      'fromStatus': 'SCHEDULED',
      'toStatus': 'IN_PROGRESS',
    });
    expect(known.label, 'Situação alterada de agendada para em execução');
    final unknown = OperationHistoryEntry.fromJson({
      'action': 'STATUS_CHANGED',
      'fromStatus': 'INTERNAL_STATUS',
      'toStatus': 'UNKNOWN_STATUS',
    });
    expect(unknown.label, 'Situação da operação alterada');
  });

  test('checklist distingue atualização e conclusão com progresso legível', () {
    final update = event(
      'FIELD_CHECKLIST_UPDATED',
      details: {'completed': false, 'progress': 62.5},
    );
    expect(update.label, 'Checklist atualizado em campo');
    expect(update.explanation, '62,5% do checklist preenchido.');
    final complete = event(
      'FIELD_CHECKLIST_UPDATED',
      details: {'completed': true, 'progress': 100},
    );
    expect(complete.label, 'Checklist concluído em campo');
    expect(complete.explanation, '100% do checklist preenchido.');
  });

  test('detalhes inválidos ou ausentes não viram texto técnico', () {
    for (final details in [
      null,
      [],
      'raw-payload',
      {'progress': '50'},
      {'progress': 101},
      {'progress': double.nan},
    ]) {
      final entry = event('FIELD_CHECKLIST_UPDATED', details: details);
      expect(entry.label, 'Checklist atualizado em campo');
      expect(entry.explanation, isNull);
    }
  });

  test('confirmação sem assinatura não é apresentada como assinatura', () {
    expect(
      event(
        'CUSTOMER_ACKNOWLEDGEMENT_CAPTURED',
        details: {'hasSignature': false},
      ).label,
      'Confirmação do cliente registrada',
    );
    expect(
      event(
        'CUSTOMER_ACKNOWLEDGEMENT_CAPTURED',
        details: {'hasSignature': true},
      ).label,
      'Assinatura do cliente registrada',
    );
  });
}
