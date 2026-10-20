/// Registro local, tipo real e hash — o que precede qualquer rede.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/contracts/mobile_evidence_contracts.dart';
import 'package:orbit_operator/core/media/media_type.dart';
import 'package:orbit_operator/core/presentation/field_registry.dart';
import 'package:orbit_operator/features/evidence/data/evidence_intake.dart';
import 'package:orbit_operator/features/evidence/data/local_media.dart';
import 'package:orbit_operator/features/evidence/data/media_store.dart';
import 'package:orbit_operator/features/sync/data/command_journal.dart'
    show CommandScope;
import 'package:orbit_operator/features/sync/data/journal_file.dart';

const scope = CommandScope(
  userId: 'u1',
  organizationId: 'org1',
  businessUnitId: 'bu1',
);

const target = FieldEvidenceTargetRef(
  type: FieldEvidenceTarget.operation,
  id: '0192f0c0-0000-7000-8000-0000000000aa',
);

/// PNG 1×1 real — bytes de verdade, para hash e tipo não serem inventados.
final png = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmM'
  'IQAAAABJRU5ErkJggg==',
);

MediaQueue queue({JournalFile? file, MemoryMediaFileStore? files}) =>
    MediaQueue(
      file: file ?? MemoryJournalFile(),
      files: files ?? MemoryMediaFileStore(),
    );

void main() {
  group('tipo real do arquivo', () {
    test('reconhece os quatro formatos que o backend aceita', () {
      expect(detectMimeType(Uint8List.fromList(png)), 'image/png');
      expect(
        detectMimeType(Uint8List.fromList([0xff, 0xd8, 0xff, 0xe0, 0, 0])),
        'image/jpeg',
      );
      expect(
        detectMimeType(
          Uint8List.fromList([
            ...'RIFF'.codeUnits,
            0,
            0,
            0,
            0,
            ...'WEBP'.codeUnits,
          ]),
        ),
        'image/webp',
      );
      expect(
        detectMimeType(Uint8List.fromList(utf8.encode('%PDF-1.7 conteúdo'))),
        'application/pdf',
      );
    });

    test('um executável renomeado para .png não passa', () {
      /// A extensão mente; os primeiros bytes não. O servidor olha os mesmos
      /// bytes no `finalize`, então as duas checagens precisam concordar.
      final check = checkEvidenceFile(
        Uint8List.fromList([0x4d, 0x5a, 0x90, 0x00, 0x03]),
      );
      expect(check.isValid, isFalse);
      expect(check.problem, EvidenceFileProblem.unsupportedType);
    });

    test('GIF é imagem, mas não é aceita', () {
      final check = checkEvidenceFile(
        Uint8List.fromList(utf8.encode('GIF89a alguma coisa')),
      );
      expect(check.problem, EvidenceFileProblem.unsupportedType);
    });

    test('arquivo vazio é recusado antes de gastar rede', () {
      expect(
        checkEvidenceFile(Uint8List(0)).problem,
        EvidenceFileProblem.empty,
      );
    });
  });

  group('limites', () {
    test('imagem e documento têm tetos diferentes, como no backend', () {
      /// `mobile-evidence.config.ts`: 10 MB para imagem, 20 MB para PDF.
      expect(evidenceMaxBytesFor('image/jpeg'), 10000000);
      expect(evidenceMaxBytesFor('application/pdf'), 20000000);
    });

    test('imagem acima do teto é recusada localmente', () {
      final big = Uint8List.fromList([
        ...png,
        ...List.filled(evidenceImageMaxBytes, 0),
      ]);
      expect(checkEvidenceFile(big).problem, EvidenceFileProblem.tooLarge);
    });
  });

  group('identidade local', () {
    test('localMediaId não é o id da evidência', () {
      final id = newLocalMediaId();

      /// Prefixo próprio, e nada de UUIDv7: o `evidenceId` só o servidor
      /// gera, e confundir os dois faria o app inventar identidade canônica.
      expect(id, startsWith('lm-'));
      expect(RegExp(r'^[0-9a-f-]{36}$').hasMatch(id), isFalse);
    });

    test('duas capturas no mesmo instante têm identidades diferentes', () {
      expect(newLocalMediaId(), isNot(newLocalMediaId()));
    });

    test('a chave de idempotência deriva do localMediaId', () async {
      final media = await intakeEvidence(
        files: MemoryMediaFileStore(),
        bytes: Uint8List.fromList(png),
        filename: 'foto.png',
        mimeType: 'image/png',
        scope: scope,
        target: target,
        category: EvidenceCategory.before,
        source: EvidenceSource.camera,
      );

      /// Derivada e congelada: o servidor casa intenções pela chave **ou**
      /// pelo `localMediaId`, e regenerá-la a cada tentativa produziria
      /// `IDEMPOTENCY_MISMATCH`.
      expect(media.idempotencyKey, 'evidence:${media.localMediaId}');

      /// O DTO exige 8–160 caracteres de `[A-Za-z0-9._:-]`.
      expect(media.idempotencyKey.length, greaterThanOrEqualTo(8));
      expect(media.idempotencyKey.length, lessThanOrEqualTo(160));
      expect(
        RegExp(r'^[A-Za-z0-9._:-]+$').hasMatch(media.idempotencyKey),
        isTrue,
      );
    });
  });

  group('hash', () {
    test('corresponde aos bytes exatos que serão enviados', () async {
      final files = MemoryMediaFileStore();
      final media = await intakeEvidence(
        files: files,
        bytes: Uint8List.fromList(png),
        filename: 'foto.png',
        mimeType: 'image/png',
        scope: scope,
        target: target,
        category: EvidenceCategory.general,
        source: EvidenceSource.camera,
      );

      /// O hash é do arquivo gravado, não dos bytes de antes de alguma
      /// transformação: enviar um arquivo diferente do hash declarado faria o
      /// servidor recusar — com razão.
      final stored = await files.read(media.path);
      expect(media.sha256, sha256OfBytes(stored!));
      expect(media.sizeBytes, stored.length);
      expect(media.sha256, hasLength(64));
    });
  });

  group('persistência local', () {
    test('a captura sobrevive a um novo processo', () async {
      final file = MemoryJournalFile();
      final files = MemoryMediaFileStore();

      final media = await intakeEvidence(
        files: files,
        bytes: Uint8List.fromList(png),
        filename: 'foto.png',
        mimeType: 'image/png',
        scope: scope,
        target: target,
        category: EvidenceCategory.after,
        source: EvidenceSource.gallery,
      );
      await queue(file: file, files: files).enqueue(media);

      /// Outra instância, como quem reabre o app: só o arquivo em comum.
      final reopened = await queue(file: file, files: files).read();
      final restored = reopened.media.single;
      expect(restored.localMediaId, media.localMediaId);
      expect(restored.sha256, media.sha256);
      expect(restored.idempotencyKey, media.idempotencyKey);
      expect(await files.exists(restored.path), isTrue);
    });

    test('o que estava em voo volta para a fila ao reabrir', () async {
      final file = MemoryJournalFile();
      final files = MemoryMediaFileStore();
      final media = await intakeEvidence(
        files: files,
        bytes: Uint8List.fromList(png),
        filename: 'foto.png',
        mimeType: 'image/png',
        scope: scope,
        target: target,
        category: EvidenceCategory.general,
        source: EvidenceSource.camera,
      );
      final store = queue(file: file, files: files);
      await store.enqueue(media);
      await store.mark(
        media.localMediaId,
        (current) => current.copyWith(state: LocalMediaState.finalizing),
      );

      /// Os bytes podem ter chegado ao storage. Reabrir volta a pendente, e a
      /// idempotência resolve o resto — deixar preso em "finalizando" perderia
      /// a evidência para sempre.
      final reopened = await queue(file: file, files: files).read();
      expect(reopened.media.single.state, LocalMediaState.pending);
    });

    test('recusa sobrevive — precisa de uma pessoa', () async {
      final file = MemoryJournalFile();
      final files = MemoryMediaFileStore();
      final media = await intakeEvidence(
        files: files,
        bytes: Uint8List.fromList(png),
        filename: 'foto.png',
        mimeType: 'image/png',
        scope: scope,
        target: target,
        category: EvidenceCategory.general,
        source: EvidenceSource.camera,
      );
      final store = queue(file: file, files: files);
      await store.enqueue(media);
      await store.mark(
        media.localMediaId,
        (current) => current.copyWith(
          state: LocalMediaState.rejected,
          failureCode: 'EVIDENCE_LIMIT_REACHED',
        ),
      );

      final reopened = await queue(file: file, files: files).read();
      expect(reopened.media.single.state, LocalMediaState.rejected);

      /// O arquivo continua no aparelho: descartar o trabalho de alguém
      /// porque o servidor disse não é decisão da pessoa.
      expect(await files.exists(reopened.media.single.path), isTrue);
    });
  });

  group('arquivo órfão', () {
    test(
      'registro sem arquivo vira estado honesto, não laço de falha',
      () async {
        final files = MemoryMediaFileStore();
        final store = queue(files: files);
        final media = await intakeEvidence(
          files: files,
          bytes: Uint8List.fromList(png),
          filename: 'foto.png',
          mimeType: 'image/png',
          scope: scope,
          target: target,
          category: EvidenceCategory.general,
          source: EvidenceSource.camera,
        );
        await store.enqueue(media);

        /// O sistema limpou o arquivo por baixo.
        await files.delete(media.path);

        final snapshot = await store.detectOrphans();
        expect(snapshot.media.single.state, LocalMediaState.missing);
        expect(snapshot.media.single.failureCode, 'LOCAL_FILE_MISSING');
        expect(snapshot.media.single.isSendable, isFalse);
      },
    );
  });

  group('escopo', () {
    test('a mídia de um usuário não aparece para outro', () async {
      final files = MemoryMediaFileStore();
      final store = queue(files: files);
      await store.enqueue(
        await intakeEvidence(
          files: files,
          bytes: Uint8List.fromList(png),
          filename: 'foto.png',
          mimeType: 'image/png',
          scope: scope,
          target: target,
          category: EvidenceCategory.general,
          source: EvidenceSource.camera,
        ),
      );

      const outro = CommandScope(
        userId: 'u2',
        organizationId: 'org1',
        businessUnitId: 'bu1',
      );
      expect(await store.forScope(outro), isEmpty);
      expect(await store.forScope(scope), hasLength(1));
    });

    test('outra organização e outra unidade também não veem', () async {
      const outraOrg = CommandScope(
        userId: 'u1',
        organizationId: 'org2',
        businessUnitId: 'bu1',
      );
      const outraUnidade = CommandScope(
        userId: 'u1',
        organizationId: 'org1',
        businessUnitId: 'bu2',
      );
      expect(scope.matches(outraOrg), isFalse);
      expect(scope.matches(outraUnidade), isFalse);
    });
  });

  group('remoção', () {
    test('apaga registro e arquivo juntos', () async {
      final files = MemoryMediaFileStore();
      final store = queue(files: files);
      final media = await intakeEvidence(
        files: files,
        bytes: Uint8List.fromList(png),
        filename: 'foto.png',
        mimeType: 'image/png',
        scope: scope,
        target: target,
        category: EvidenceCategory.general,
        source: EvidenceSource.camera,
      );
      await store.enqueue(media);
      await store.remove(media.localMediaId);

      expect((await store.read()).media, isEmpty);
      expect(await files.exists(media.path), isFalse);
    });
  });

  group('vocabulário', () {
    test('confirmada é a única que fala pelo servidor', () {
      expect(evidenceStateLabels['confirmed']!.label, 'Confirmada');
      expect(evidenceStateLabels['pending']!.label, 'Aguardando envio');
      expect(evidenceStateLabels['finalizing']!.label, 'Finalizando');

      /// "Enviada" não aparece: 100% de PUT ainda não é evidência.
      final all = evidenceStateLabels.values.map((v) => v.label).join(' ');
      expect(all, isNot(contains('Enviada')));
    });

    test('código de recusa desconhecido não vira tela crua', () {
      expect(
        evidenceRejectionLabel(code: 'ALGO_NOVO_NO_SERVIDOR'),
        'Não foi possível enviar esta evidência.',
      );
      expect(
        evidenceRejectionLabel(code: 'EVIDENCE_LIMIT_REACHED'),
        contains('limite'),
      );
    });

    test('permissão negada de vez orienta as Configurações', () {
      expect(
        captureProblemLabels['permissionPermanentlyDenied'],
        contains('Configurações'),
      );
    });
  });

  group('contratos', () {
    test('a intenção distingue finalizada de expirada', () {
      final finalized = EvidenceUploadIntent.fromJson({
        'uploadId': 'up-1',
        'uploadUrl': null,
        'method': null,
        'requiredHeaders': const <String, Object?>{},
        'expiresAt': '2026-09-02T10:00:00.000Z',
        'maxSize': 10000000,
        'localMediaId': 'lm-1',
        'status': 'FINALIZED',
      });
      expect(finalized.isFinalized, isTrue);
      expect(finalized.uploadUrl, isNull);

      final expired = EvidenceUploadIntent.fromJson({
        'uploadId': 'up-2',
        'uploadUrl': 'https://storage.example/put',
        'method': 'PUT',
        'requiredHeaders': const {'Content-Type': 'image/png'},
        'expiresAt': '2020-01-01T00:00:00.000Z',
        'maxSize': 10000000,
        'localMediaId': 'lm-2',
        'status': 'PENDING_UPLOAD',
      });

      /// Vencida pelo relógio, mesmo com o status ainda dizendo pendente.
      expect(expired.isExpired, isTrue);
    });

    test('o tamanho da evidência chega como texto e vira número', () {
      final evidence = FieldEvidence.fromJson({
        'id': 'ev-1',
        'target': {'type': 'OPERATION', 'id': 'op-1'},
        'category': 'BEFORE',
        'filename': 'foto.png',
        'mimeType': 'image/png',
        'sizeBytes': '123456',
        'sha256': 'a' * 64,
        'capturedAt': null,
        'uploadedAt': '2026-09-01T10:00:00.000Z',
        'capturedBy': {'id': 'u1', 'name': 'Técnico'},
        'source': 'CAMERA',
        'localMediaId': 'lm-1',
        'previewAvailable': true,
        'downloadAvailable': true,
      });

      /// O backend serializa `BigInt` como texto; converter na borda evita
      /// que a apresentação lide com isso.
      expect(evidence.sizeBytes, 123456);
      expect(evidence.localMediaId, 'lm-1');
    });
  });
}
