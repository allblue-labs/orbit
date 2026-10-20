/// O pipeline de upload contra um backend scriptado.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/contracts/mobile_evidence_contracts.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/features/evidence/application/media_upload_controller.dart';
import 'package:orbit_operator/features/evidence/data/evidence_intake.dart';
import 'package:orbit_operator/features/evidence/data/evidence_repository.dart';
import 'package:orbit_operator/features/evidence/data/local_media.dart';
import 'package:orbit_operator/features/evidence/data/media_store.dart';
import 'package:orbit_operator/features/sync/data/command_journal.dart'
    show CommandScope;
import 'package:orbit_operator/features/sync/data/journal_file.dart';

import '../support/fakes.dart';
import '../support/scripted_adapter.dart';

const scope = CommandScope(
  userId: 'u1',
  organizationId: 'org1',
  businessUnitId: 'bu1',
);

const target = FieldEvidenceTargetRef(
  type: FieldEvidenceTarget.operation,
  id: '0192f0c0-0000-7000-8000-0000000000aa',
);

final png = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmM'
  'IQAAAABJRU5ErkJggg==',
);

Map<String, Object?> intentBody({
  String uploadId = 'up-1',
  String status = 'PENDING_UPLOAD',
  String? url = 'https://storage.example/put/up-1?sig=abc',
  String expiresAt = '2099-01-01T00:00:00.000Z',
}) => {
  'uploadId': uploadId,
  'uploadUrl': url,
  'method': url == null ? null : 'PUT',
  'requiredHeaders': const {'Content-Type': 'image/png'},
  'expiresAt': expiresAt,
  'maxSize': 10000000,
  'localMediaId': 'lm-x',
  'status': status,
};

Map<String, Object?> evidenceBody({String id = 'ev-1'}) => {
  'id': id,
  'target': {'type': 'OPERATION', 'id': target.id},
  'category': 'GENERAL',
  'filename': 'foto.png',
  'mimeType': 'image/png',
  'sizeBytes': '70',
  'sha256': 'b' * 64,
  'capturedAt': null,
  'uploadedAt': '2026-09-01T10:00:00.000Z',
  'capturedBy': {'id': 'u1', 'name': 'Técnico'},
  'source': 'CAMERA',
  'localMediaId': 'lm-x',
  'previewAvailable': true,
  'downloadAvailable': true,
};

/// Um backend controlado pelo teste, que registra o que recebeu.
class Backend {
  Backend({
    this.reserveStatus = 'PENDING_UPLOAD',
    this.reserveUrl = 'https://storage.example/put/up-1?sig=abc',
    this.reserveExpiresAt = '2099-01-01T00:00:00.000Z',
    this.putStatus = 200,
    this.finalizeStatus = 200,
    this.finalizeBody,
  });

  String reserveStatus;
  String? reserveUrl;
  String reserveExpiresAt;
  int putStatus;
  int finalizeStatus;
  Map<String, Object?>? finalizeBody;

  final reserves = <Map<String, dynamic>>[];
  final puts = <RequestOptions>[];
  final finalizes = <String>[];

  Future<ResponseBody> call(RequestOptions options) async {
    final path = options.uri.path;

    if (options.uri.host == 'storage.example') {
      puts.add(options);
      return ResponseBody.fromString('', putStatus);
    }
    if (path.endsWith('/evidence/uploads')) {
      reserves.add(
        options.data is String
            ? jsonDecode(options.data as String) as Map<String, dynamic>
            : options.data as Map<String, dynamic>,
      );
      return jsonResponse({
        'success': true,
        'data': intentBody(
          status: reserveStatus,
          url: reserveUrl,
          expiresAt: reserveExpiresAt,
        ),
      });
    }
    if (path.endsWith('/finalize')) {
      finalizes.add(path);
      if (finalizeStatus != 200) {
        return jsonResponse({
          'success': false,
          'error': {
            'code': finalizeStatus == 409
                ? 'EVIDENCE_LIMIT_REACHED'
                : 'PROCESSING_ERROR',
            'message': finalizeStatus == 409
                ? 'O limite de 6 evidências foi atingido'
                : 'Falha temporária',
          },
        }, status: finalizeStatus);
      }
      return jsonResponse({
        'success': true,
        'data': finalizeBody ?? evidenceBody(),
      });
    }
    return ResponseBody.fromString('{}', 404);
  }
}

({
  MediaUploadController controller,
  MediaQueue queue,
  MemoryMediaFileStore files,
  List<FieldEvidenceTargetRef> confirmed,
})
build(Backend backend, {JournalFile? file, MemoryMediaFileStore? files}) {
  final dio = Dio()..httpClientAdapter = ScriptedAdapter(backend.call);
  final plain = Dio()..httpClientAdapter = ScriptedAdapter(backend.call);
  final client = OrbitApiClient.create(
    environment: OrbitEnvironment.fromDefines(),
    storage: InMemoryTokenStorage(),
    logger: const OrbitLogger(isProduction: true),
    dio: dio,
    retryDio: plain,
  );
  final store = files ?? MemoryMediaFileStore();
  final queue = MediaQueue(file: file ?? MemoryJournalFile(), files: store);
  final confirmed = <FieldEvidenceTargetRef>[];
  return (
    controller: MediaUploadController(
      queue: queue,
      repository: EvidenceRepository(client: client),
      scope: scope,
      onEvidenceConfirmed: confirmed.add,
    ),
    queue: queue,
    files: store,
    confirmed: confirmed,
  );
}

Future<LocalMedia> capture(MemoryMediaFileStore files) => intakeEvidence(
  files: files,
  bytes: Uint8List.fromList(png),
  filename: 'foto.png',
  mimeType: 'image/png',
  scope: scope,
  target: target,
  category: EvidenceCategory.general,
  source: EvidenceSource.camera,
);

void main() {
  group('os três passos', () {
    test('reservar, enviar os bytes e finalizar', () async {
      final backend = Backend();
      final harness = build(backend);
      await harness.controller.enqueue(await capture(harness.files));
      await harness.controller.process(manual: true);

      expect(backend.reserves, hasLength(1));
      expect(backend.puts, hasLength(1));
      expect(backend.finalizes, hasLength(1));

      /// Confirmada: o registro local sai e o arquivo vai junto.
      expect((await harness.queue.read()).media, isEmpty);
      expect(harness.confirmed, [target]);
    });

    test(
      'a reserva carrega o que o servidor precisa para casar a intenção',
      () async {
        final backend = Backend();
        final harness = build(backend);
        final media = await capture(harness.files);
        await harness.controller.enqueue(media);
        await harness.controller.process(manual: true);

        final body = backend.reserves.single;
        expect(body['localMediaId'], media.localMediaId);
        expect(body['idempotencyKey'], media.idempotencyKey);
        expect(body['expectedSha256'], media.sha256);
        expect(body['declaredMimeType'], 'image/png');
        expect(body['declaredSize'], media.sizeBytes);
        expect((body['target']! as Map)['type'], 'OPERATION');
      },
    );

    test('o PUT vai sem o token da sessão', () async {
      final backend = Backend();
      final harness = build(backend);
      await harness.controller.enqueue(await capture(harness.files));
      await harness.controller.process(manual: true);

      /// A assinatura da URL é a credencial. Mandar o `Bearer` para o storage
      /// seria vazá-lo para fora da API.
      final headers = backend.puts.single.headers;
      expect(headers.containsKey('Authorization'), isFalse);
      expect(headers['Content-Type'], 'image/png');
    });
  });

  group('PUT concluído não é evidência', () {
    test('falha no finalize mantém a mídia na fila', () async {
      final backend = Backend(finalizeStatus: 500);
      final harness = build(backend);
      await harness.controller.enqueue(await capture(harness.files));
      await harness.controller.process(manual: true);

      /// Os bytes chegaram ao storage, mas sem o `finalize` não há evidência.
      /// Tratar o PUT como sucesso prometeria em nome de uma validação que
      /// ainda não aconteceu.
      expect(backend.puts, hasLength(1));
      expect(harness.confirmed, isEmpty);

      final media = (await harness.queue.read()).media.single;
      expect(media.state, LocalMediaState.pending);
      expect(await harness.files.exists(media.path), isTrue);
    });

    test('o uploadId fica guardado para retomar depois', () async {
      final backend = Backend(finalizeStatus: 500);
      final harness = build(backend);
      await harness.controller.enqueue(await capture(harness.files));
      await harness.controller.process(manual: true);

      expect((await harness.queue.read()).media.single.uploadId, 'up-1');
    });
  });

  group('recuperação', () {
    test('intenção já finalizada é reconciliada sem novo upload', () async {
      /// O caso do app morto entre o `finalize` e a limpeza local: ao voltar,
      /// o servidor diz que a evidência já existe.
      final backend = Backend(reserveStatus: 'FINALIZED', reserveUrl: null);
      final harness = build(backend);
      await harness.controller.enqueue(await capture(harness.files));
      await harness.controller.process(manual: true);

      expect(backend.puts, isEmpty);
      expect(backend.finalizes, isEmpty);
      expect((await harness.queue.read()).media, isEmpty);
      expect(harness.confirmed, [target]);
    });

    test('a mesma captura reenviada não vira duas evidências', () async {
      final backend = Backend(finalizeStatus: 500);
      final harness = build(backend);
      final media = await capture(harness.files);
      await harness.controller.enqueue(media);
      await harness.controller.process(manual: true);

      backend.finalizeStatus = 200;
      await harness.controller.process(manual: true);

      /// Duas tentativas, a mesma identidade nas duas — é isso que impede o
      /// mesmo arquivo de virar duas evidências.
      expect(backend.reserves, hasLength(2));
      expect(
        backend.reserves[0]['localMediaId'],
        backend.reserves[1]['localMediaId'],
      );
      expect(
        backend.reserves[0]['idempotencyKey'],
        backend.reserves[1]['idempotencyKey'],
      );
      expect(harness.confirmed, hasLength(1));
    });

    test(
      'a fila sobrevive a reabrir e retoma com a mesma identidade',
      () async {
        final file = MemoryJournalFile();
        final files = MemoryMediaFileStore();
        final first = Backend(finalizeStatus: 500);
        final before = build(first, file: file, files: files);
        final media = await capture(files);
        await before.controller.enqueue(media);

        /// Outra instância, como quem reabre o app.
        final second = Backend();
        final after = build(second, file: file, files: files);
        await after.controller.process(manual: true);

        expect(second.reserves.single['localMediaId'], media.localMediaId);
        expect(second.reserves.single['expectedSha256'], media.sha256);
        expect((await after.queue.read()).media, isEmpty);
      },
    );
  });

  group('recusas', () {
    test('limite atingido é terminal e preserva o arquivo', () async {
      final backend = Backend(finalizeStatus: 409);
      final harness = build(backend);
      await harness.controller.enqueue(await capture(harness.files));
      await harness.controller.process(manual: true);

      final media = (await harness.queue.read()).media.single;
      expect(media.state, LocalMediaState.rejected);

      /// O arquivo fica: descartar o trabalho de alguém porque o servidor
      /// disse não é decisão da pessoa.
      expect(await harness.files.exists(media.path), isTrue);

      /// E não se repete sozinho.
      await harness.controller.process(manual: true);
      expect(backend.finalizes, hasLength(1));
    });

    test('falha temporária volta para a fila e é repetida', () async {
      final backend = Backend(finalizeStatus: 500);
      final harness = build(backend);
      await harness.controller.enqueue(await capture(harness.files));
      await harness.controller.process(manual: true);
      expect(
        (await harness.queue.read()).media.single.state,
        LocalMediaState.pending,
      );

      backend.finalizeStatus = 200;
      await harness.controller.process(manual: true);
      expect((await harness.queue.read()).media, isEmpty);
    });

    test('janela expirada não fica tentando para sempre', () async {
      final backend = Backend(reserveExpiresAt: '2020-01-01T00:00:00.000Z');
      final harness = build(backend);
      await harness.controller.enqueue(await capture(harness.files));
      await harness.controller.process(manual: true);

      final media = (await harness.queue.read()).media.single;
      expect(media.state, LocalMediaState.rejected);
      expect(media.failureCode, 'UPLOAD_EXPIRED');
      expect(backend.puts, isEmpty);
    });

    test('arquivo que sumiu do disco não é enviado', () async {
      final backend = Backend();
      final harness = build(backend);
      final media = await capture(harness.files);
      await harness.queue.enqueue(media);
      await harness.files.delete(media.path);

      await harness.controller.process(manual: true);

      expect(backend.reserves, isEmpty);
      expect(
        (await harness.queue.read()).media.single.state,
        LocalMediaState.missing,
      );
    });
  });

  group('descarte', () {
    test('só o que o servidor não aceitou', () async {
      final backend = Backend(finalizeStatus: 409);
      final harness = build(backend);
      final media = await capture(harness.files);
      await harness.controller.enqueue(media);
      await harness.controller.process(manual: true);

      await harness.controller.discard(media.localMediaId);
      expect((await harness.queue.read()).media, isEmpty);
      expect(await harness.files.exists(media.path), isFalse);
    });

    test('mídia pendente não pode ser descartada', () async {
      final backend = Backend(finalizeStatus: 500);
      final harness = build(backend);
      final media = await capture(harness.files);
      await harness.controller.enqueue(media);

      /// Pode estar em voo neste instante; apagá-la deixaria bytes no storage
      /// sem ninguém para finalizá-los.
      await harness.controller.discard(media.localMediaId);
      expect((await harness.queue.read()).media, hasLength(1));
    });
  });

  group('mutex', () {
    test('processamentos concorrentes viram um só', () async {
      final backend = Backend();
      final harness = build(backend);
      await harness.queue.enqueue(await capture(harness.files));

      await Future.wait([
        harness.controller.process(manual: true),
        harness.controller.process(manual: true),
        harness.controller.process(manual: true),
      ]);

      expect(backend.reserves, hasLength(1));
    });
  });

  group('espera entre tentativas', () {
    test('cresce e não é infinita', () {
      expect(mediaBackoff(1) < mediaBackoff(2), isTrue);
      expect(mediaBackoff(2) < mediaBackoff(3), isTrue);
      expect(mediaBackoff(99), const Duration(minutes: 30));
    });
  });
}
