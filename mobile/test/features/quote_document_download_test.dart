import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/core/storage/token_storage.dart';
import 'package:orbit_operator/features/artifact/application/document_downloader.dart';
import 'package:orbit_operator/features/artifact/data/artifact_repository.dart';
import 'package:orbit_operator/features/artifact/data/document_file.dart';
import 'package:orbit_operator/features/customers/data/mobile_quote_repository.dart';
import '../support/fakes.dart';
import '../support/scripted_adapter.dart';

void main() {
  for (final valid in [true, false]) {
    test(
      'orçamento usa API autenticada e ${valid ? "salva PDF" : "recusa HTML sem gravar arquivo"}',
      () async {
        final requests = <RequestOptions>[];
        final dio = Dio()
          ..httpClientAdapter = ScriptedAdapter((request) async {
            requests.add(request);
            return ResponseBody.fromBytes(
              utf8.encode(
                valid
                    ? '%PDF-1.7\nconteudo de teste\n%%EOF'
                    : '<html>erro</html>',
              ),
              200,
              headers: {
                Headers.contentTypeHeader: ['application/pdf'],
              },
            );
          });
        final environment = OrbitEnvironment.fromDefines();
        final client = OrbitApiClient.create(
          environment: environment,
          storage: InMemoryTokenStorage(
            const TokenPair(
              accessToken: 'document-test-token',
              refreshToken: 'document-test-refresh',
              expiresIn: 3600,
            ),
          ),
          logger: const OrbitLogger(isProduction: true),
          dio: dio,
        );
        final quotes = MobileQuoteRepository(
          client: client,
          apiBaseUrl: environment.apiBaseUrl,
        );
        final files = MemoryDocumentFileStore();
        final downloader = DocumentDownloader(
          repository: ArtifactRepository(client: client),
          files: files,
        );
        final states = await downloader
            .fetchBytes(
              load: () => quotes.download('quote-1'),
              fileName: 'orcamento.pdf',
            )
            .toList();
        expect(requests, hasLength(1));
        expect(
          requests.single.uri.path,
          endsWith('/mobile/field/quotes/quote-1/document'),
        );
        expect(
          requests.single.headers['authorization'],
          'Bearer document-test-token',
        );
        if (valid) {
          expect(states.last.phase, DownloadPhase.availableLocally);
          expect(await files.exists(states.last.path!), isTrue);
        } else {
          expect(states.last.phase, DownloadPhase.error);
          expect(states.last.path, isNull);
        }
      },
    );
  }
}
