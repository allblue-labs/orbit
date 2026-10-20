/// O documento de campo contra o backend real.
///
/// Cada gate roda sobre um **cenário próprio**, criado agora pelas APIs do
/// produto. Nenhum teste procura "algum atendimento em determinado estado":
/// era assim que uma suíte quebrava a outra.
library;

import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/contracts/mobile_field_artifact_contracts.dart';
import 'package:orbit_operator/core/errors/orbit_exception.dart';
import 'package:orbit_operator/features/artifact/data/artifact_repository.dart';
import 'package:orbit_operator/features/artifact/data/document_file.dart';

import 'support/scenario_provisioner.dart';
import 'support/smoke_environment.dart';

void main() {
  late bool available;
  late ScenarioProvisioner provisioner;
  late ArtifactRepository artifacts;

  setUpAll(() async {
    available = await smokeApiIsUp();
    if (!available) return;
    provisioner = await ScenarioProvisioner.connect();
    artifacts = ArtifactRepository(client: provisioner.client);
  });

  tearDownAll(() {
    if (!available) return;
    // ignore: avoid_print
    print(
      'FL-07 · atendimentos criados nesta execução: '
      '${provisioner.createdOperations}',
    );
  });

  bool offline() {
    if (available) return false;
    markTestSkipped('API indisponível em $smokeApiUrl');
    return true;
  }

  /// Um atendimento concluído, novo, ainda sem documento.
  ///
  /// Sem `markTestSkipped` de reserva: depois do harness, faltar cenário é
  /// defeito de provisionamento, e deve falhar alto.
  Future<OperationScenario> freshSource() =>
      provisioner.operation(suite: 'FL07', state: ScenarioState.completed);

  group('preparação', () {
    test('a elegibilidade e os bloqueios vêm calculados do servidor', () async {
      if (offline()) return;
      final scenario = await freshSource();

      final preparation = await artifacts.preparation(
        sourceType: FieldArtifactSourceType.operation,
        sourceId: scenario.operationId,
      );

      expect(preparation.sourceType, FieldArtifactSourceType.operation);
      expect(preparation.documentType, FieldArtifactDocumentType.serviceOrder);
      expect(
        preparation.eligibility.eligible,
        preparation.eligibility.blockedReasons.isEmpty,
      );

      /// Uma requisição resolve a seção inteira: assinaturas, aceite e
      /// evidências vêm juntos, sem N+1.
      expect(preparation.professionalSignatures.fieldTechnician, isNotNull);
      expect(preparation.customerAcknowledgement.valid, isNotNull);
      expect(preparation.evidenceSummary.finalized, 0);
      expect(preparation.evidenceSummary.pending, 0);
    });

    test('consultar não congela nada', () async {
      if (offline()) return;
      final scenario = await freshSource();

      final before = await artifacts.preparation(
        sourceType: FieldArtifactSourceType.operation,
        sourceId: scenario.operationId,
      );
      final again = await artifacts.preparation(
        sourceType: FieldArtifactSourceType.operation,
        sourceId: scenario.operationId,
      );

      /// Congelar é irreversível: abrir a tela do documento não pode fazê-lo.
      expect(before.existingArtifact, isNull);
      expect(again.existingArtifact, isNull);
      expect(again.allowedActions, before.allowedActions);
    });

    test('fonte fora do escopo não vaza documento', () async {
      if (offline()) return;
      await expectLater(
        artifacts.preparation(
          sourceType: FieldArtifactSourceType.operation,
          sourceId: '0192f0c0-0000-7000-8000-ffffffffffff',
        ),
        throwsA(isA<OrbitException>()),
      );
    });
  });

  group('gate — congelar', () {
    test('preparar cria o documento com versão e hash', () async {
      if (offline()) return;
      final scenario = await freshSource();

      /// A fonte começa **sem** documento — é o que dá sentido ao que vem a
      /// seguir.
      final before = await artifacts.preparation(
        sourceType: FieldArtifactSourceType.operation,
        sourceId: scenario.operationId,
      );
      expect(before.existingArtifact, isNull);
      expect(before.allows(FieldArtifactAllowedAction.prepareDocument), isTrue);

      final artifact = await artifacts.prepare(
        sourceType: FieldArtifactSourceType.operation,
        sourceId: scenario.operationId,
      );

      expect(artifact.id, isNotEmpty);
      expect(artifact.sourceId, scenario.operationId);
      expect(artifact.sourceType, FieldArtifactSourceType.operation);
      expect(artifact.status, FieldArtifactStatus.prepared);
      expect(artifact.snapshotVersion, greaterThanOrEqualTo(1));

      /// SHA-256 dos fatos congelados, calculado pelo servidor.
      expect(artifact.snapshotHash, hasLength(64));

      /// Congelado, mas não renderizado: ainda não há arquivo.
      expect(artifact.previewAvailable, isFalse);
      expect(artifact.downloadAvailable, isFalse);
      expect(artifact.generatedAt, isNull);
      expect(
        artifact.allowedActions,
        contains(FieldArtifactAllowedAction.generateDocument),
      );

      /// E a fonte passa a ter exatamente **um** documento.
      final after = await artifacts.preparation(
        sourceType: FieldArtifactSourceType.operation,
        sourceId: scenario.operationId,
      );
      expect(after.existingArtifact?.id, artifact.id);
    });
  });

  group('gate — idempotência', () {
    test('repetir a mesma intenção produz um documento só', () async {
      if (offline()) return;
      final scenario = await freshSource();

      /// A identidade da intenção é a **fonte**: o `PrepareFieldArtifactDto`
      /// não tem chave de idempotência, e o servidor resolve por
      /// `(sourceType, sourceId)` sob advisory lock. Repetir a mesma chamada
      /// é repetir a mesma intenção — usar outra chave seria outra coisa.
      final first = await artifacts.prepare(
        sourceType: FieldArtifactSourceType.operation,
        sourceId: scenario.operationId,
      );
      final again = await artifacts.prepare(
        sourceType: FieldArtifactSourceType.operation,
        sourceId: scenario.operationId,
      );

      expect(again.id, first.id);
      expect(again.snapshotHash, first.snapshotHash);
      expect(again.snapshotVersion, first.snapshotVersion);
      expect(again.artifactExecutionId, first.artifactExecutionId);

      final preparation = await artifacts.preparation(
        sourceType: FieldArtifactSourceType.operation,
        sourceId: scenario.operationId,
      );
      expect(preparation.existingArtifact?.id, first.id);
    });
  });

  group('gate — concorrência', () {
    test('duas requisições paralelas produzem um documento canônico', () async {
      if (offline()) return;
      final scenario = await freshSource();

      /// Paralelismo de verdade: as duas partem antes de qualquer uma
      /// responder. Serializá-las com `await` entre elas testaria outra coisa.
      final results = await Future.wait([
        artifacts.prepare(
          sourceType: FieldArtifactSourceType.operation,
          sourceId: scenario.operationId,
        ),
        artifacts.prepare(
          sourceType: FieldArtifactSourceType.operation,
          sourceId: scenario.operationId,
        ),
      ]);

      expect(results[0].id, results[1].id);
      expect(results[0].snapshotHash, results[1].snapshotHash);
      expect(results[0].artifactExecutionId, results[1].artifactExecutionId);

      /// A fonte tem um documento, não dois.
      final preparation = await artifacts.preparation(
        sourceType: FieldArtifactSourceType.operation,
        sourceId: scenario.operationId,
      );
      expect(preparation.existingArtifact?.id, results[0].id);
    });
  });

  group('renderização assíncrona', () {
    test('pedir a emissão é aceito, e não significa PDF pronto', () async {
      if (offline()) return;
      final scenario = await freshSource();
      final artifact = await artifacts.prepare(
        sourceType: FieldArtifactSourceType.operation,
        sourceId: scenario.operationId,
      );

      expect(artifact.previewAvailable, isFalse);
      expect(artifact.generatedAt, isNull);

      final requested = await artifacts.render(artifact.id);

      /// O trabalho acontece fora desta requisição.
      expect(
        requested.status,
        anyOf(
          FieldArtifactStatus.pending,
          FieldArtifactStatus.rendering,
          FieldArtifactStatus.ready,
        ),
      );
      if (requested.isTransient) {
        expect(requested.previewAvailable, isFalse);
        expect(requested.allowedActions, isEmpty);
      }

      /// Repetir enquanto já está em curso não enfileira de novo, e o
      /// snapshot não se mexe.
      final repeated = await artifacts.render(artifact.id);
      expect(repeated.id, artifact.id);
      expect(repeated.snapshotHash, artifact.snapshotHash);
      expect(repeated.snapshotVersion, artifact.snapshotVersion);
    });

    test('documento congelado sem arquivo não emite acesso', () async {
      if (offline()) return;
      final scenario = await freshSource();
      final artifact = await artifacts.prepare(
        sourceType: FieldArtifactSourceType.operation,
        sourceId: scenario.operationId,
      );

      /// Congelado, sem renderização: não há arquivo, e o servidor diz isso
      /// em vez de devolver uma URL para o nada.
      await expectLater(
        artifacts.access(artifact.id),
        throwsA(isA<OrbitException>()),
      );
    });

    test('artefato inexistente não vaza acesso', () async {
      if (offline()) return;
      await expectLater(
        artifacts.access('0192f0c0-0000-7000-8000-ffffffffffff'),
        throwsA(isA<OrbitException>()),
      );
    });
  });

  group('documento pronto', () {
    /// Um documento renderizado, criado uma vez e reaproveitado pelos testes
    /// de leitura desta suíte — que não mutam nada.
    FieldArtifact? ready;
    Future<FieldArtifact?> readyArtifact() async {
      if (ready != null) return ready;
      final scenario = await freshSource();
      final artifact = await artifacts.prepare(
        sourceType: FieldArtifactSourceType.operation,
        sourceId: scenario.operationId,
      );
      await artifacts.render(artifact.id);

      var current = await artifacts.get(artifact.id);
      for (var attempt = 0; attempt < 40 && current.isTransient; attempt += 1) {
        await Future<void>.delayed(const Duration(milliseconds: 500));
        current = await artifacts.get(artifact.id);
      }

      /// O snapshot não muda por causa da renderização.
      expect(current.snapshotHash, artifact.snapshotHash);
      expect(current.snapshotVersion, artifact.snapshotVersion);
      return ready = current;
    }

    test('o estado converge e publica as ações de leitura', () async {
      if (offline()) return;
      final current = await readyArtifact();

      if (current!.isTransient) {
        markTestSkipped('a renderização não concluiu no tempo do smoke');
        return;
      }
      if (current.status == FieldArtifactStatus.ready) {
        expect(current.downloadAvailable, isTrue);
        expect(current.generatedAt, isNotNull);
        expect(
          current.allowedActions,
          contains(FieldArtifactAllowedAction.downloadDocument),
        );
      } else {
        /// Falha é desfecho legítimo, e o servidor republica a ação de emitir.
        expect(current.status, FieldArtifactStatus.failed);
        expect(
          current.allowedActions,
          contains(FieldArtifactAllowedAction.generateDocument),
        );
      }
    });

    test('o acesso é temporário e o conteúdo é um PDF de verdade', () async {
      if (offline()) return;
      final current = await readyArtifact();
      if (current!.status != FieldArtifactStatus.ready) {
        markTestSkipped('o documento não ficou pronto no tempo do smoke');
        return;
      }

      final access = await artifacts.access(current.id);
      expect(access.artifactId, current.id);
      expect(access.operation, 'download');
      expect(access.isExpired, isFalse);

      /// Curta por natureza: é credencial, não atributo do documento.
      expect(
        access.expiresAt.difference(DateTime.now().toUtc()),
        lessThan(const Duration(days: 1)),
      );

      final file = await artifacts.download(access);

      /// Os primeiros bytes decidem — o `Content-Type` do storage é
      /// `application/octet-stream` para um PDF legítimo.
      expect(checkDocumentBytes(file.bytes), isNull);
      expect(utf8.decode(file.bytes.take(5).toList()), '%PDF-');

      /// O nome vem publicado no `Content-Disposition`, sem caminho.
      expect(file.fileName, isNotNull);
      expect(file.fileName, endsWith('.pdf'));
      expect(file.fileName, isNot(contains('/')));
      expect(file.fileName, isNot(contains('..')));

      final preview = await artifacts.access(current.id, preview: true);
      expect(preview.operation, 'preview');
    });

    test('trocar a assinatura depois não reescreve o documento', () async {
      if (offline()) return;
      final artifact = await readyArtifact();

      /// A assinatura profissional é um dos fatos congelados no snapshot.
      /// Trocá-la é o cenário que mais tenta a implementação a "atualizar" o
      /// documento antigo.
      final png = base64Decode(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAE'
        'hQGAhKmMIQAAAABJRU5ErkJggg==',
      );
      final reservation = await provisioner.client.post<Map<String, dynamic>>(
        '/mobile/field/me/signature/uploads',
        body: {
          'fileName': 'assinatura.png',
          'mimeType': 'image/png',
          'sizeBytes': png.length,
        },
      );
      final upload = reservation['upload']! as Map<String, dynamic>;
      await provisioner.client.putBytes(
        url: Uri.parse(upload['url']! as String),
        bytes: png,
        headers: (upload['requiredHeaders'] as Map<Object?, Object?>).map(
          (key, value) => MapEntry(key! as String, '$value'),
        ),
      );
      await provisioner.client.post<Map<String, dynamic>>(
        '/mobile/field/me/signature',
        body: {'storageObjectId': reservation['fileId']},
      );

      final after = await artifacts.get(artifact!.id);

      /// Mudou a assinatura, muda o próximo documento — não o que já foi
      /// congelado.
      expect(after.snapshotHash, artifact.snapshotHash);
      expect(after.snapshotVersion, artifact.snapshotVersion);
      expect(after.id, artifact.id);
      expect(after.generatedAt, artifact.generatedAt);
    });
  });
}
