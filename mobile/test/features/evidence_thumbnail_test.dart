import 'dart:typed_data';
import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/contracts/mobile_evidence_contracts.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/features/evidence/data/evidence_repository.dart';
import '../support/fakes.dart';
import '../support/scripted_adapter.dart';

void main() {
  for (final scenario in [
    'allowed',
    'unavailable',
    'oversized',
    'foreign',
    'expired',
    'hash',
    'cancelled',
  ]) {
    test(
      'thumbnail: $scenario respects published access and content integrity',
      () async {
        final bytes = Uint8List.fromList([137, 80, 78, 71, 13, 10, 26, 10]);
        var accesses = 0;
        var downloads = 0;
        Future<ResponseBody> handle(RequestOptions request) async {
          if (request.uri.host == 'storage.example') {
            downloads++;
            expect(
              request.headers.keys.map((key) => key.toLowerCase()),
              isNot(contains('authorization')),
            );
            return ResponseBody.fromBytes(
              bytes,
              200,
              headers: {
                'content-type': ['image/png'],
              },
            );
          }
          accesses++;
          return jsonResponse({
            'success': true,
            'data': {
              'evidenceId': scenario == 'foreign' ? 'other' : 'ev-1',
              'operation': 'preview',
              'url': 'https://storage.example/photo',
              'expiresAt':
                  (scenario == 'expired'
                          ? DateTime.utc(2000)
                          : DateTime.utc(2100))
                      .toIso8601String(),
              'requiredHeaders': <String, String>{},
            },
          });
        }

        final dio = Dio()..httpClientAdapter = ScriptedAdapter(handle);
        final client = OrbitApiClient.create(
          environment: OrbitEnvironment.fromDefines(),
          storage: InMemoryTokenStorage(),
          logger: const OrbitLogger(isProduction: true),
          dio: dio,
          retryDio: Dio()..httpClientAdapter = ScriptedAdapter(handle),
        );
        final evidence = FieldEvidence.fromJson({
          'id': 'ev-1',
          'target': {'type': 'OPERATION', 'id': 'op-1'},
          'category': 'BEFORE',
          'filename': 'before.png',
          'mimeType': 'image/png',
          'sizeBytes': scenario == 'oversized' ? '9000000' : '${bytes.length}',
          'sha256': scenario == 'hash'
              ? '0' * 64
              : sha256.convert(bytes).toString(),
          'capturedAt': null,
          'uploadedAt': '2026-09-08T12:00:00Z',
          'capturedBy': {'id': 'user-1', 'name': 'Técnico'},
          'source': 'CAMERA',
          'localMediaId': null,
          'previewAvailable': scenario != 'unavailable',
          'downloadAvailable': true,
        });
        final cancellation = OrbitRequestCancellation();
        if (scenario == 'cancelled') cancellation.cancel();
        final result = await EvidenceRepository(
          client: client,
        ).thumbnail(evidence, cancellation: cancellation);
        expect(result, scenario == 'allowed' ? orderedEquals(bytes) : isNull);
        expect(
          accesses,
          ['unavailable', 'oversized', 'cancelled'].contains(scenario) ? 0 : 1,
        );
        expect(downloads, ['allowed', 'hash'].contains(scenario) ? 1 : 0);
      },
    );
  }
}
