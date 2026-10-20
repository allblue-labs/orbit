/// O journal de comandos: o que precisa sobreviver.
library;

import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/contracts/mobile_offline_sync_contracts.dart';
import 'package:orbit_operator/features/sync/data/command_journal.dart';
import 'package:orbit_operator/features/sync/data/journal_file.dart';

const scope = CommandScope(
  userId: 'u1',
  organizationId: 'org1',
  businessUnitId: 'bu1',
);

OfflineCommandEnvelope envelope({
  String id = '0192f0c0-0000-7000-8000-000000000001',
  OfflineCommandType type = OfflineCommandType.operationChecklistUpdate,
  String version = '2026-09-01T10:00:00.000Z',
  Map<String, Object?> payload = const {'checklistId': 'c1', 'answers': {}},
  DateTime? occurredAt,
}) => OfflineCommandEnvelope(
  commandId: id,
  idempotencyKey: id,
  commandType: type,
  aggregateId: '0192f0c0-0000-7000-8000-0000000000aa',
  expectedVersion: version,
  occurredAt: occurredAt ?? DateTime.utc(2026, 9, 1, 10, 30),
  payload: payload,
  deviceInstanceId: 'device-1',
);

PendingCommand pending(OfflineCommandEnvelope value) => PendingCommand(
  envelope: value,
  scope: scope,
  state: PendingCommandState.pending,
  enqueuedAt: DateTime.utc(2026, 9, 1, 10, 30),
);

OfflineCommandResult result(
  OfflineCommandStatus status, {
  OfflineConflictCode? conflict,
  String? errorCode,
  bool retryable = false,
}) => OfflineCommandResult(
  commandId: '0192f0c0-0000-7000-8000-000000000001',
  commandType: 'OPERATION_CHECKLIST_UPDATE',
  status: status,
  serverVersion: null,
  authoritativeResourceRef: null,
  conflict: conflict == null
      ? null
      : OfflineCommandConflict(
          code: conflict,
          message: 'mudou',
          refreshRequired: true,
        ),
  error: errorCode == null
      ? null
      : OfflineCommandError(
          code: errorCode,
          message: 'falhou',
          retryable: retryable,
        ),
);

void main() {
  group('o envelope é congelado', () {
    test('sobrevive à ida e volta sem perder campo', () {
      final original = envelope();
      final restored = OfflineCommandEnvelope.fromJson(
        jsonDecode(jsonEncode(original.toJson())) as Map<String, Object?>,
      );

      /// Tudo isto entra no hash que o servidor compara com a chave de
      /// idempotência. Um campo que se perca na serialização vira
      /// `IDEMPOTENCY_MISMATCH` no replay.
      expect(restored.commandId, original.commandId);
      expect(restored.idempotencyKey, original.idempotencyKey);
      expect(restored.commandType, original.commandType);
      expect(restored.aggregateType, 'OPERATION');
      expect(restored.aggregateId, original.aggregateId);
      expect(restored.expectedVersion, original.expectedVersion);
      expect(restored.occurredAt, original.occurredAt);
      expect(restored.payload, original.payload);
      expect(restored.deviceInstanceId, 'device-1');
    });

    test('o wire usa exatamente os nomes do DTO', () {
      final json = envelope().toJson();
      expect(json['commandType'], 'OPERATION_CHECKLIST_UPDATE');
      expect(json['aggregateType'], 'OPERATION');
      expect(json['occurredAt'], '2026-09-01T10:30:00.000Z');

      /// O backend valida com `forbidNonWhitelisted`: um campo a mais faz a
      /// leva inteira ser recusada.
      expect(json.keys.toSet(), {
        'commandId',
        'idempotencyKey',
        'commandType',
        'aggregateType',
        'aggregateId',
        'expectedVersion',
        'occurredAt',
        'payload',
        'deviceInstanceId',
      });
    });

    test('a versão observada não é a versão de agora', () async {
      final journal = CommandJournal(file: MemoryJournalFile());
      await journal.enqueue(pending(envelope(version: 'versao-A')));

      /// Reler o journal depois de o servidor ter avançado para B não pode
      /// reescrever o envelope: mesma chave com outro conteúdo é outra
      /// intenção se passando pela primeira.
      final snapshot = await journal.read();
      expect(snapshot.commands.single.envelope.expectedVersion, 'versao-A');
    });
  });

  group('persistência', () {
    test('a fila sobrevive a um novo processo', () async {
      final file = MemoryJournalFile();
      await CommandJournal(file: file).enqueue(pending(envelope()));

      /// Outra instância, como quem reabre o app: só o arquivo em comum.
      final reopened = await CommandJournal(file: file).read();
      expect(reopened.commands, hasLength(1));
      expect(
        reopened.commands.single.envelope.commandId,
        '0192f0c0-0000-7000-8000-000000000001',
      );
    });

    test('o que estava em voo volta para a fila ao reabrir', () async {
      final file = MemoryJournalFile();
      final journal = CommandJournal(file: file);
      await journal.enqueue(pending(envelope()));
      await journal.mark(
        '0192f0c0-0000-7000-8000-000000000001',
        (current) => current.copyWith(state: PendingCommandState.syncing),
      );

      /// Pode ter chegado ao servidor ou não. Reenviar com o mesmo
      /// `commandId` é seguro; deixar preso em "sincronizando" perderia o
      /// comando para sempre.
      final reopened = await CommandJournal(file: file).read();
      expect(reopened.commands.single.state, PendingCommandState.pending);
    });

    test('conflito e recusa sobrevivem — precisam de uma pessoa', () async {
      final file = MemoryJournalFile();
      final journal = CommandJournal(file: file);
      await journal.enqueue(pending(envelope()));
      await journal.mark(
        '0192f0c0-0000-7000-8000-000000000001',
        (current) => current.copyWith(
          state: PendingCommandState.conflict,
          receipt: result(
            OfflineCommandStatus.conflict,
            conflict: OfflineConflictCode.assignmentChanged,
          ),
        ),
      );

      final reopened = await CommandJournal(file: file).read();
      expect(reopened.commands.single.state, PendingCommandState.conflict);
      expect(
        reopened.commands.single.receipt?.conflict?.code,
        OfflineConflictCode.assignmentChanged,
      );
    });

    test('journal ilegível não trava o app nem apaga em silêncio', () async {
      final file = MemoryJournalFile();
      await file.write('{isto não é json');
      final journal = CommandJournal(file: file);
      expect((await journal.read()).commands, isEmpty);
    });
  });

  group('recibo e saída da fila', () {
    test('acontecem na mesma gravação', () async {
      final file = MemoryJournalFile();
      final journal = CommandJournal(file: file);
      await journal.enqueue(pending(envelope()));
      await journal.resolve(
        commandId: '0192f0c0-0000-7000-8000-000000000001',
        scope: scope,
        result: result(OfflineCommandStatus.applied),
        at: DateTime.utc(2026, 9, 1, 11),
      );

      /// Um crash entre gravar o recibo e tirar da fila reenviaria a intenção
      /// como nova. São a mesma escrita justamente por isso.
      final reopened = await CommandJournal(file: file).read();
      expect(reopened.commands, isEmpty);
      expect(
        reopened.receipts.single.result.status,
        OfflineCommandStatus.applied,
      );
    });

    test('já aplicado é sucesso reconciliado, não erro', () async {
      final journal = CommandJournal(file: MemoryJournalFile());
      await journal.enqueue(pending(envelope()));
      final snapshot = await journal.resolve(
        commandId: '0192f0c0-0000-7000-8000-000000000001',
        scope: scope,
        result: result(OfflineCommandStatus.alreadyApplied),
        at: DateTime.utc(2026, 9, 1, 11),
      );
      expect(snapshot.commands, isEmpty);
    });
  });

  group('escopo', () {
    test('a fila de um usuário não é a de outro', () async {
      final journal = CommandJournal(file: MemoryJournalFile());
      await journal.enqueue(pending(envelope()));

      const outro = CommandScope(
        userId: 'u2',
        organizationId: 'org1',
        businessUnitId: 'bu1',
      );
      final snapshot = await journal.read();
      expect(
        snapshot.commands.where((c) => c.scope.matches(outro)),
        isEmpty,
        reason: 'enviar sob o token de outra pessoa trocaria o autor',
      );
    });

    test('mesma pessoa, outra organização, outra fila', () {
      const outraOrg = CommandScope(
        userId: 'u1',
        organizationId: 'org2',
        businessUnitId: 'bu1',
      );
      expect(scope.matches(outraOrg), isFalse);
    });

    test('mesma pessoa, outra unidade, outra fila', () {
      const outraUnidade = CommandScope(
        userId: 'u1',
        organizationId: 'org1',
        businessUnitId: 'bu2',
      );
      expect(scope.matches(outraUnidade), isFalse);
    });
  });

  group('retenção', () {
    test('comando velho demais é marcado, não apagado', () async {
      final journal = CommandJournal(file: MemoryJournalFile());
      final now = DateTime.utc(2026, 9, 1);
      await journal.enqueue(
        pending(envelope(occurredAt: now.subtract(const Duration(days: 91)))),
      );

      /// Sumir com ele seria apagar trabalho sem contar a ninguém. O servidor
      /// recusaria de todo jeito; a diferença é a pessoa ficar sabendo.
      final snapshot = await journal.cleanup(now);
      expect(snapshot.commands.single.state, PendingCommandState.expired);
    });

    test('comando dentro da janela continua pendente', () async {
      final journal = CommandJournal(file: MemoryJournalFile());
      final now = DateTime.utc(2026, 9, 1);
      await journal.enqueue(
        pending(envelope(occurredAt: now.subtract(const Duration(days: 89)))),
      );
      final snapshot = await journal.cleanup(now);
      expect(snapshot.commands.single.state, PendingCommandState.pending);
    });

    test('recibo além da retenção sai', () async {
      final journal = CommandJournal(file: MemoryJournalFile());
      final now = DateTime.utc(2026, 9, 1);
      await journal.enqueue(pending(envelope()));
      await journal.resolve(
        commandId: '0192f0c0-0000-7000-8000-000000000001',
        scope: scope,
        result: result(OfflineCommandStatus.applied),
        at: now.subtract(const Duration(days: 121)),
      );
      expect((await journal.cleanup(now)).receipts, isEmpty);
    });

    test('a janela local é a do servidor', () {
      /// `mobile-sync-retention.ts`: 90 dias de replay, 120 de recibo.
      /// Guardar mais do que o servidor aceita produziria fila que só falha.
      expect(replayWindow, const Duration(days: 90));
      expect(receiptRetention, const Duration(days: 120));
    });
  });

  group('descarte', () {
    test('remove a intenção parada', () async {
      final journal = CommandJournal(file: MemoryJournalFile());
      await journal.enqueue(pending(envelope()));
      final snapshot = await journal.discard(
        '0192f0c0-0000-7000-8000-000000000001',
      );
      expect(snapshot.commands, isEmpty);

      /// Descarte não é recibo: nada foi aplicado, então nada a registrar.
      expect(snapshot.receipts, isEmpty);
    });
  });

  group('gravações concorrentes', () {
    test('nenhuma intenção se perde', () async {
      final journal = CommandJournal(file: MemoryJournalFile());

      /// Dois toques quase simultâneos. Sem serialização, a última gravação
      /// venceria e a outra sumiria — e a que some é trabalho de alguém.
      await Future.wait([
        journal.enqueue(
          pending(envelope(id: '0192f0c0-0000-7000-8000-000000000001')),
        ),
        journal.enqueue(
          pending(envelope(id: '0192f0c0-0000-7000-8000-000000000002')),
        ),
        journal.enqueue(
          pending(envelope(id: '0192f0c0-0000-7000-8000-000000000003')),
        ),
      ]);

      expect((await journal.read()).commands, hasLength(3));
    });
  });
}
