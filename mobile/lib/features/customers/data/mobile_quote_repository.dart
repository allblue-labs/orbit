import 'dart:convert';

import '../../../core/network/orbit_api_client.dart';
import '../../../core/errors/orbit_exception.dart';
import '../../artifact/data/document_file.dart';

/// Uses the commercial engine behind the restricted field surface. No local
/// approval state or financial records are invented by the app.
class MobileQuoteRepository {
  const MobileQuoteRepository({
    required OrbitApiClient client,
    required this.apiBaseUrl,
  }) : _client = client;
  final OrbitApiClient _client;
  final String apiBaseUrl;

  Future<Map<String, dynamic>> options(
    String customerId, {
    String? businessUnitId,
  }) => _client.get(
    '/mobile/field/quotes/customers/$customerId/options',
    query: {'businessUnitId': businessUnitId},
  );
  Future<List<Map<String, dynamic>>> catalog(
    String search, {
    String? businessUnitId,
  }) async {
    final data = await _client.get<List<dynamic>>(
      '/mobile/field/quotes/catalog',
      query: {'search': search, 'businessUnitId': businessUnitId},
    );
    return data.cast<Map<String, dynamic>>();
  }

  Future<Map<String, dynamic>> create(Map<String, dynamic> body) =>
      _client.post('/mobile/field/quotes', body: body);
  Future<String> acceptanceLink(String id) async {
    final data = await _client.post<Map<String, dynamic>>(
      '/mobile/field/quotes/$id/acceptance-link',
    );
    return data['token'] as String;
  }

  Future<void> approve(
    String token, {
    required String name,
    required List<int> signature,
  }) async {
    await _client.post<Map<String, dynamic>>(
      '/public/quotes/proposals/${Uri.encodeComponent(token)}/response',
      isPublic: true,
      body: {
        'decision': 'APPROVE',
        'signerName': name.trim(),
        'signatureBase64': 'data:image/png;base64,${base64Encode(signature)}',
        'consentAccepted': true,
      },
    );
  }

  Future<String> document(String id, DocumentFileStore files) async {
    final data = await _client.getBytes(
      url: Uri.parse(
        '${apiBaseUrl.replaceFirst(RegExp(r"/$"), "")}/mobile/field/quotes/$id/document',
      ),
      isPublic: false,
      maxBytes: 30 * 1024 * 1024,
    );
    if (checkDocumentBytes(data.bytes) != null) {
      throw const OrbitException(
        kind: OrbitErrorKind.parse,
        publicMessage: 'Não foi possível conferir o PDF do orçamento.',
        code: 'INVALID_DOCUMENT',
      );
    }
    _client.checkSession();
    final path = await files.write(
      data.fileName ?? 'orcamento.pdf',
      data.bytes,
    );
    _client.checkSession();
    return path;
  }

  void checkSession() => _client.checkSession();
}
