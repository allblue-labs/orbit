/// Ciclo de execução contra o backend real.
///
/// Prova o que só o servidor pode provar: que abrir a preparação não muda
/// nada, que os comandos semânticos funcionam, que a versão antiga é recusada
/// com 409, e que repetir a mesma intenção não produz um segundo efeito.
///
/// O cenário é montado **pelas APIs do produto** — nenhuma escrita direta no
/// banco. Sem API no ar, cada teste é pulado com motivo.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/contracts/field_operation_contracts.dart';
import 'package:orbit_operator/core/errors/orbit_exception.dart';
import 'package:orbit_operator/features/field/application/execution_controller.dart';
import 'package:orbit_operator/features/field/data/field_operation_repository.dart';

import 'support/scenario_provisioner.dart';
import 'support/smoke_environment.dart';

/// O envelope de um comando, com a versão que o servidor publicou.
FieldOperationCommandContract _command(String version, {String? commandId}) {
  final id = commandId ?? newCommandId();
  return FieldOperationCommandContract(
    commandId: id,
    idempotencyKey: id,
    expectedVersion: version,
    occurredAt: DateTime.now().toUtc(),
  );
}

void main() {
  late bool available;
  late ScenarioProvisioner provisioner;
  late FieldOperationRepository repository;

  setUpAll(() async {
    available = await smokeApiIsUp();
    if (!available) return;
    provisioner = await ScenarioProvisioner.connect();
    repository = FieldOperationRepository(client: provisioner.client);
  });

  tearDownAll(() {
    if (!available) return;
    // ignore: avoid_print
    print(
      'FL-03 · atendimentos criados nesta execução: '
      '${provisioner.createdOperations}',
    );
  });

  bool offline() {
    if (available) return false;
    markTestSkipped('API indisponível em $smokeApiUrl');
    return true;
  }

  /// Um atendimento em andamento, novo, só desta suíte.
  ///
  /// Antes, esta linha procurava "algum atendimento na fila" — e por isso a
  /// suíte parava de rodar quando outra concluía o que ela usava.
  Future<OperationScenario> scenario() => provisioner.operation(suite: 'FL03');

  test('abrir a preparação não altera o atendimento', () async {
    if (offline()) return;
    final operationId = (await scenario()).operationId;

    final before = await repository.preparation(operationId);

    /// Ler duas vezes: se a leitura mexesse no domínio, a versão mudaria.
    final after = await repository.preparation(operationId);

    expect(after.version, before.version);
    expect(after.operation.status, before.operation.status);
    expect(after.operation.startedAt, before.operation.startedAt);
  });

  test('a preparação publica versão, ações e elegibilidade', () async {
    if (offline()) return;
    final operationId = (await scenario()).operationId;

    final preparation = await repository.preparation(operationId);

    /// A versão é o token de concorrência — sem ela nenhum comando sai.
    expect(preparation.version, isNotEmpty);
    expect(preparation.operation.id, operationId);

    /// Elegibilidade e bloqueios são decisão do servidor.
    expect(preparation.blockers, isA<List<String>>());
  });

  test('versão desatualizada é recusada com conflito', () async {
    if (offline()) return;
    final operationId = (await scenario()).operationId;

    final preparation = await repository.preparation(operationId);
    final action = preparation.primaryAction;
    if (action != FieldOperationAllowedAction.start &&
        action != FieldOperationAllowedAction.resume &&
        action != FieldOperationAllowedAction.complete) {
      markTestSkipped('atendimento sem comando de estado disponível');
      return;
    }

    /// Uma versão que certamente não é a atual.
    const stale = '1999-01-01T00:00:00.000Z';
    try {
      if (action == FieldOperationAllowedAction.complete) {
        await repository.complete(operationId, _command(stale));
      } else {
        await repository.start(operationId, _command(stale));
      }
      fail('esperava conflito de versão');
    } on OrbitException catch (error) {
      /// O servidor recusa em vez de sobrescrever o que outro mudou.
      expect(error.isConflict, isTrue, reason: error.toString());
    }
  });

  test('repetir a mesma intenção não produz um segundo efeito', () async {
    if (offline()) return;
    final operationId = (await scenario()).operationId;

    var preparation = await repository.preparation(operationId);
    if (!preparation.allowedActions.contains(
      FieldOperationAllowedAction.addNote,
    )) {
      markTestSkipped('atendimento não aceita observação agora');
      return;
    }

    /// Conta as observações da linha do tempo **inteira**.
    ///
    /// Duas armadilhas evitadas aqui:
    ///
    /// - contar numa página fixa só funciona enquanto a linha do tempo couber
    ///   nela; passando disso, cada entrada nova empurra a mais antiga para
    ///   fora e o total não se mexe;
    /// - procurar pelo texto da nota não funciona: `message` é uma frase
    ///   redigida pelo servidor ("Observação registrada"), não o conteúdo que
    ///   o técnico escreveu.
    Future<int> noteCount() async {
      var found = 0;
      String? cursor;
      for (var page = 0; page < 50; page += 1) {
        final result = await repository.timeline(
          operationId,
          limit: 50,
          cursor: cursor,
        );
        found += result.data
            .where((entry) => entry.type.contains('NOTE'))
            .length;
        if (!result.hasNextPage || result.nextCursor == null) break;
        cursor = result.nextCursor;
      }
      return found;
    }

    final before = await noteCount();

    /// A mesma intenção, enviada duas vezes — como um toque duplo ou um
    /// reenvio depois de timeout.
    ///
    /// O envelope é **idêntico** nas duas: o backend associa o payload à
    /// chave e recusa se só a chave coincidir. É a mesma intenção, tomada no
    /// mesmo momento, sobre o mesmo estado.
    final envelope = _command(preparation.version);
    const note = 'Observação idempotente do smoke';

    await repository.addNote(operationId, envelope, note: note);
    await repository.addNote(operationId, envelope, note: note);

    /// Um único efeito.
    expect(await noteCount(), before + 1);
  });
}
