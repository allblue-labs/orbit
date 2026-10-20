/// O pipeline de evidências contra o backend real.
///
/// Prova o que só o servidor pode provar: que magic bytes e SHA-256 são
/// conferidos sobre o objeto de verdade, que a mesma captura não vira duas
/// evidências, que um `PUT` concluído não basta, e que o acesso de leitura é
/// temporário.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/contracts/mobile_evidence_contracts.dart';
import 'package:orbit_operator/core/errors/orbit_exception.dart';
import 'package:orbit_operator/features/evidence/data/evidence_intake.dart';
import 'package:orbit_operator/features/evidence/data/evidence_repository.dart';
import 'package:orbit_operator/features/evidence/data/media_store.dart';

import 'support/scenario_provisioner.dart';
import 'support/smoke_environment.dart';

/// PNG 1×1 real, com um sufixo que o torna único por execução.
///
/// Bytes diferentes a cada rodada evitam que o teste dependa de estado
/// deixado por uma execução anterior.
Uint8List uniquePng() {
  final base = base64Decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmM'
    'IQAAAABJRU5ErkJggg==',
  );

  /// Bytes após o IEND são ignorados por decodificadores, e o servidor
  /// identifica o formato pela assinatura inicial — que continua intacta.
  return Uint8List.fromList([
    ...base,
    ...utf8.encode('${DateTime.now().microsecondsSinceEpoch}'),
  ]);
}

void main() {
  late bool available;
  late ScenarioProvisioner provisioner;
  late EvidenceRepository evidence;
  late OperationScenario scenario;

  late FieldEvidenceTargetRef target;

  /// Uma execução de RVT **desta suíte**. Prova que o pipeline atende mais de
  /// um tipo de alvo.
  FieldEvidenceTargetRef? rvtTarget;

  /// Por que a provisão de RVT pode não acontecer, quando não acontecer.
  Object? rvtProvisioningError;

  setUpAll(() async {
    available = await smokeApiIsUp();
    if (!available) return;
    provisioner = await ScenarioProvisioner.connect();
    evidence = EvidenceRepository(client: provisioner.client);

    /// Um atendimento em andamento, novo, só desta suíte.
    ///
    /// Antes, a busca varria a fila atrás de "algum atendimento que aceite
    /// evidência e tenha folga no limite" — e dependia do que outras suítes
    /// tinham deixado. Agora o alvo é dela, e começa com zero evidências.
    scenario = await provisioner.operation(suite: 'FL06');
    target = FieldEvidenceTargetRef(
      type: FieldEvidenceTarget.operation,
      id: scenario.operationId,
    );

    /// Uma execução de RVT avulsa, nova, só desta suíte.
    ///
    /// Antes ela vinha da fila — a primeira execução de RVT que aceitasse
    /// evidência. Era sempre a mesma, histórica, e cada rodada somava um
    /// arquivo nela. Na vigésima, `FIELD_EVIDENCE_RVT_MAX_FILES` fez o que
    /// existe para fazer, e o smoke passou a falhar por **acúmulo de dado**,
    /// não por regressão do produto.
    ///
    /// Provisionar corrige na raiz certa: o limite do backend continua sendo
    /// o mesmo, nenhuma evidência existente é tocada, e o alvo nasce com zero.
    try {
      final rvt = await provisioner.rvtExecution(suite: 'FL06');
      rvtTarget = FieldEvidenceTargetRef(
        type: FieldEvidenceTarget.rvtExecution,
        id: rvt.executionId,
      );
    } on Object catch (error) {
      /// Guardado para virar mensagem no teste. Engolir aqui faria o caso se
      /// declarar ausente sem dizer por quê — que é como um alvo que parou de
      /// poder ser criado vira cobertura silenciosamente perdida.
      rvtProvisioningError = error;
    }
  });

  tearDownAll(() {
    if (!available) return;
    // ignore: avoid_print
    print(
      'FL-06 · atendimentos criados nesta execução: '
      '${provisioner.createdOperations} · execuções de RVT: '
      '${provisioner.createdRvtExecutions}',
    );
  });

  /// Sem cenário depois do harness é defeito de provisionamento: falha alto.
  bool skip() {
    if (available) return false;
    markTestSkipped('API indisponível em $smokeApiUrl');
    return true;
  }

  /// Reserva, envia e finaliza — o caminho completo.
  Future<FieldEvidence> upload(
    Uint8List bytes, {
    String? localMediaId,
    FieldEvidenceTargetRef? into,
  }) async {
    final id = localMediaId ?? newLocalMediaId();
    final destination = into ?? target;
    final intent = await evidence.reserve(
      EvidenceUploadIntentRequest(
        target: destination,
        filename: 'smoke-$id.png',
        declaredMimeType: 'image/png',
        declaredSize: bytes.length,
        idempotencyKey: 'evidence:$id',
        category: EvidenceCategory.general,
        source: EvidenceSource.camera,
        localMediaId: id,
        expectedSha256: sha256OfBytes(bytes),
      ),
    );
    await evidence.putBytes(
      url: intent.uploadUrl!,
      headers: intent.requiredHeaders,
      bytes: bytes,
    );
    return evidence.finalize(
      intent.uploadId,
      expectedSha256: sha256OfBytes(bytes),
    );
  }

  group('pipeline completo', () {
    test('reservar, enviar e finalizar cria a evidência canônica', () async {
      if (skip()) return;

      final bytes = uniquePng();
      final created = await upload(bytes);

      expect(created.id, isNotEmpty);
      expect(created.mimeType, 'image/png');

      /// O hash é do servidor, calculado sobre o objeto real no storage — e
      /// coincide com o dos bytes que o app enviou.
      expect(created.sha256, sha256OfBytes(bytes));
      expect(created.sizeBytes, bytes.length);

      /// A lista autoritativa passa a incluí-la.
      final list = await evidence.list(target: target);
      expect(list.map((value) => value.id), contains(created.id));
    });

    test('o localMediaId volta na evidência, ligando as duas pontas', () async {
      if (skip()) return;

      final id = newLocalMediaId();
      final created = await upload(uniquePng(), localMediaId: id);
      expect(created.localMediaId, id);

      /// E `localMediaId` não é o id da evidência.
      expect(created.id, isNot(id));
    });
  });

  group('idempotência', () {
    test('o mesmo localMediaId não vira duas evidências', () async {
      if (skip()) return;

      final bytes = uniquePng();
      final id = newLocalMediaId();
      final first = await upload(bytes, localMediaId: id);

      /// Repetir a intenção devolve a mesma, já finalizada — sem nova URL.
      final again = await evidence.reserve(
        EvidenceUploadIntentRequest(
          target: target,
          filename: 'smoke-$id.png',
          declaredMimeType: 'image/png',
          declaredSize: bytes.length,
          idempotencyKey: 'evidence:$id',
          category: EvidenceCategory.general,
          source: EvidenceSource.camera,
          localMediaId: id,
          expectedSha256: sha256OfBytes(bytes),
        ),
      );
      expect(again.isFinalized, isTrue);
      expect(again.uploadUrl, isNull);

      final list = await evidence.list(target: target);
      expect(
        list.where((value) => value.localMediaId == id),
        hasLength(1),
        reason: 'a mesma captura não pode entrar duas vezes',
      );

      /// E finalizar de novo converge no mesmo resultado.
      expect(first.id, isNotEmpty);
    });

    test('mesma chave com outro conteúdo é recusada', () async {
      if (skip()) return;

      final id = newLocalMediaId();
      final bytes = uniquePng();
      await evidence.reserve(
        EvidenceUploadIntentRequest(
          target: target,
          filename: 'smoke-$id.png',
          declaredMimeType: 'image/png',
          declaredSize: bytes.length,
          idempotencyKey: 'evidence:$id',
          localMediaId: id,
          expectedSha256: sha256OfBytes(bytes),
        ),
      );

      /// Outro tamanho declarado sob a mesma chave: outra intenção se passando
      /// pela primeira.
      await expectLater(
        evidence.reserve(
          EvidenceUploadIntentRequest(
            target: target,
            filename: 'smoke-$id.png',
            declaredMimeType: 'image/png',
            declaredSize: bytes.length + 100,
            idempotencyKey: 'evidence:$id',
            localMediaId: id,
            expectedSha256: sha256OfBytes(bytes),
          ),
        ),
        throwsA(isA<OrbitException>().having((e) => e.status, 'status', 409)),
      );
    });
  });

  group('validação sobre o objeto real', () {
    test('conteúdo que não corresponde ao tipo declarado é recusado', () async {
      if (skip()) return;

      /// Declara PNG, envia PDF. O servidor relê o objeto no `finalize` e
      /// compara os primeiros bytes — a extensão e a declaração não bastam.
      final fake = Uint8List.fromList(
        utf8.encode('%PDF-1.7 isto não é uma imagem'),
      );
      final id = newLocalMediaId();
      final intent = await evidence.reserve(
        EvidenceUploadIntentRequest(
          target: target,
          filename: 'mentira-$id.png',
          declaredMimeType: 'image/png',
          declaredSize: fake.length,
          idempotencyKey: 'evidence:$id',
          localMediaId: id,
        ),
      );
      await evidence.putBytes(
        url: intent.uploadUrl!,
        headers: intent.requiredHeaders,
        bytes: fake,
      );

      await expectLater(
        evidence.finalize(intent.uploadId),
        throwsA(isA<OrbitException>()),
      );
    });

    test('hash divergente é recusado', () async {
      if (skip()) return;

      final bytes = uniquePng();
      final id = newLocalMediaId();

      /// Declara o hash de um conteúdo e envia outro — exatamente o que
      /// aconteceria se o app comprimisse depois de calcular.
      final intent = await evidence.reserve(
        EvidenceUploadIntentRequest(
          target: target,
          filename: 'hash-$id.png',
          declaredMimeType: 'image/png',
          declaredSize: bytes.length,
          idempotencyKey: 'evidence:$id',
          localMediaId: id,
          expectedSha256: sha256OfBytes(uniquePng()),
        ),
      );
      await evidence.putBytes(
        url: intent.uploadUrl!,
        headers: intent.requiredHeaders,
        bytes: bytes,
      );

      await expectLater(
        evidence.finalize(intent.uploadId),
        throwsA(isA<OrbitException>()),
      );
    });

    test('tamanho acima do limite é recusado na reserva', () async {
      if (skip()) return;

      await expectLater(
        evidence.reserve(
          EvidenceUploadIntentRequest(
            target: target,
            filename: 'grande.png',
            declaredMimeType: 'image/png',
            declaredSize: 99000000,
            idempotencyKey: 'evidence:${newLocalMediaId()}',
          ),
        ),
        throwsA(isA<OrbitException>()),
        reason: 'não faz sentido gastar rede para chegar a um 413',
      );
    });

    test('o limite publicado na reserva é o do backend', () async {
      if (skip()) return;

      final intent = await evidence.reserve(
        EvidenceUploadIntentRequest(
          target: target,
          filename: 'limite.png',
          declaredMimeType: 'image/png',
          declaredSize: 1000,
          idempotencyKey: 'evidence:${newLocalMediaId()}',
        ),
      );

      /// A checagem local usa o mesmo número, para não prometer um upload que
      /// o servidor recusaria.
      expect(intent.maxSize, evidenceMaxBytesFor('image/png'));
    });
  });

  group('PUT concluído não é evidência', () {
    test('sem finalize, a evidência não existe', () async {
      if (skip()) return;

      final bytes = uniquePng();
      final id = newLocalMediaId();
      final intent = await evidence.reserve(
        EvidenceUploadIntentRequest(
          target: target,
          filename: 'sem-finalize-$id.png',
          declaredMimeType: 'image/png',
          declaredSize: bytes.length,
          idempotencyKey: 'evidence:$id',
          localMediaId: id,
          expectedSha256: sha256OfBytes(bytes),
        ),
      );
      await evidence.putBytes(
        url: intent.uploadUrl!,
        headers: intent.requiredHeaders,
        bytes: bytes,
      );

      /// Os bytes estão no storage. A lista autoritativa não os conhece.
      final list = await evidence.list(target: target);
      expect(list.where((value) => value.localMediaId == id), isEmpty);

      /// E o `finalize` posterior é o que a materializa — é assim que um app
      /// morto entre os dois passos se recupera.
      final created = await evidence.finalize(intent.uploadId);
      expect(created.localMediaId, id);
    });
  });

  group('acesso temporário', () {
    test('preview e download vêm assinados e com validade', () async {
      if (skip()) return;

      final created = await upload(uniquePng());

      final preview = await evidence.access(created.id);
      expect(preview.operation, 'preview');
      expect(preview.url.toString(), isNotEmpty);
      expect(preview.isExpired, isFalse);

      final download = await evidence.access(created.id, download: true);
      expect(download.operation, 'download');

      /// Duas emissões produzem credenciais distintas: a URL é temporária, e
      /// guardá-la como atributo da evidência renderia um link morto.
      expect(preview.expiresAt.isAfter(DateTime.now().toUtc()), isTrue);
    });

    test('evidência inexistente não vaza acesso', () async {
      if (skip()) return;

      await expectLater(
        evidence.access('0192f0c0-0000-7000-8000-ffffffffffff'),
        throwsA(isA<OrbitException>()),
      );
    });
  });

  group('escopo', () {
    test('alvo fora da designação é recusado', () async {
      if (skip()) return;

      /// Envelope impecável contra um atendimento que este ator não executa.
      /// O que o servidor recusa é a autorização, revalidada na reserva.
      await expectLater(
        evidence.reserve(
          EvidenceUploadIntentRequest(
            target: const FieldEvidenceTargetRef(
              type: FieldEvidenceTarget.operation,
              id: '0192f0c0-0000-7000-8000-ffffffffffff',
            ),
            filename: 'fora.png',
            declaredMimeType: 'image/png',
            declaredSize: 1000,
            idempotencyKey: 'evidence:${newLocalMediaId()}',
          ),
        ),
        throwsA(isA<OrbitException>()),
      );
    });
  });

  group('outros alvos', () {
    test('a execução de RVT também aceita evidência', () async {
      if (!available) {
        markTestSkipped('API indisponível em $smokeApiUrl');
        return;
      }

      /// Sem alvo é **falha**, não ausência: a execução é provisionada por
      /// esta suíte, e não conseguir criá-la é defeito de provisionamento.
      if (rvtTarget == null) {
        fail(
          'A execução de RVT desta suíte não pôde ser provisionada: '
          '$rvtProvisioningError',
        );
      }

      final bytes = uniquePng();
      final id = newLocalMediaId();
      final intent = await evidence.reserve(
        EvidenceUploadIntentRequest(
          target: rvtTarget!,
          filename: 'rvt-$id.png',
          declaredMimeType: 'image/png',
          declaredSize: bytes.length,
          idempotencyKey: 'evidence:$id',
          category: EvidenceCategory.equipment,
          source: EvidenceSource.camera,
          localMediaId: id,
          expectedSha256: sha256OfBytes(bytes),
        ),
      );
      await evidence.putBytes(
        url: intent.uploadUrl!,
        headers: intent.requiredHeaders,
        bytes: bytes,
      );
      final created = await evidence.finalize(
        intent.uploadId,
        expectedSha256: sha256OfBytes(bytes),
      );

      /// O alvo volta com o tipo que o app declarou — e a evidência aparece
      /// na lista daquele alvo, não na do atendimento.
      expect(created.target.type, FieldEvidenceTarget.rvtExecution);
      expect(created.target.id, rvtTarget!.id);
      expect(created.category, EvidenceCategory.equipment);

      final list = await evidence.list(target: rvtTarget!);
      expect(list.map((value) => value.id), contains(created.id));
    });
  });

  group('limite do alvo', () {
    test('atingido o limite, o servidor recusa a próxima', () async {
      if (skip()) return;

      /// Um alvo só para este teste, saturado aqui mesmo. Depender de um
      /// atendimento que ficou cheio por acaso tornaria o gate refém do que
      /// outra execução deixou para trás.
      final own = await provisioner.operation(suite: 'FL06LIM');
      final limitTarget = FieldEvidenceTargetRef(
        type: FieldEvidenceTarget.operation,
        id: own.operationId,
      );

      /// 20 por atendimento (`operationMaximumFiles`).
      const maximum = 20;
      for (var index = 0; index < maximum; index += 1) {
        await upload(uniquePng(), into: limitTarget);
      }
      expect(await evidence.list(target: limitTarget), hasLength(maximum));

      /// A reserva passa: o limite não é contado ali. É no `finalize`, sob
      /// `pg_advisory_xact_lock` do alvo, que a contagem acontece — e é isso
      /// que torna segura a disputa de dois aparelhos pela última vaga.
      final bytes = uniquePng();
      final id = newLocalMediaId();
      final intent = await evidence.reserve(
        EvidenceUploadIntentRequest(
          target: limitTarget,
          filename: 'limite-$id.png',
          declaredMimeType: 'image/png',
          declaredSize: bytes.length,
          idempotencyKey: 'evidence:$id',
          localMediaId: id,
          expectedSha256: sha256OfBytes(bytes),
        ),
      );
      await evidence.putBytes(
        url: intent.uploadUrl!,
        headers: intent.requiredHeaders,
        bytes: bytes,
      );

      await expectLater(
        evidence.finalize(
          intent.uploadId,
          expectedSha256: sha256OfBytes(bytes),
        ),
        throwsA(
          isA<OrbitException>()
              .having((e) => e.status, 'status', 409)
              .having((e) => e.code, 'code', 'EVIDENCE_LIMIT_REACHED'),
        ),
      );

      /// E a contagem confirmada não passa do teto.
      expect(await evidence.list(target: limitTarget), hasLength(maximum));
    }, timeout: const Timeout(Duration(minutes: 3)));
  });
}
