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
    this.sleep = _wait,
    this.now = DateTime.now,
  }) : _client = client;
  final OrbitApiClient _client;
  final String apiBaseUrl;

  /// Substituíveis no teste: o polling não precisa esperar de verdade.
  final Future<void> Function(Duration) sleep;
  final DateTime Function() now;

  static Future<void> _wait(Duration duration) => Future.delayed(duration);

  /// Primeira consulta em 1,5 s, crescendo 1,5× até 5 s; desiste em 2 min.
  static Duration exportPollDelay(int attempt) {
    final ms = (1500 * _pow15(attempt < 0 ? 0 : attempt)).round();
    return Duration(milliseconds: ms > 5000 ? 5000 : ms);
  }

  static double _pow15(int n) {
    var value = 1.0;
    for (var i = 0; i < n; i++) {
      value *= 1.5;
    }
    return value;
  }

  static const exportTimeout = Duration(minutes: 2);

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

  Future<Map<String, dynamic>> createEquipment(
    String customerId,
    Map<String, dynamic> equipment, {
    required String businessUnitId,
  }) => _client.post(
    '/mobile/field/quotes/customers/$customerId/equipment',
    body: {...equipment, 'businessUnitId': businessUnitId},
  );

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

  Future<({List<int> bytes, String? contentType, String? fileName})> download(
    String id,
  ) => _client.getBytes(
    url: Uri.parse(
      '${apiBaseUrl.replaceFirst(RegExp(r"/$"), "")}/mobile/field/quotes/$id/document',
    ),
    isPublic: false,
    maxBytes: 30 * 1024 * 1024,
  );

  /// Exportação assíncrona: pede (202), acompanha até ficar pronto e baixa
  /// da URL assinada — sem o token da sessão, porque a assinatura é a
  /// credencial e o destino é o armazenamento, não a API.
  Future<({List<int> bytes, String? contentType, String? fileName})>
  exportDocument(String id) async {
    final Map<String, dynamic> accepted;
    try {
      accepted = await _client.post<Map<String, dynamic>>(
        '/mobile/field/quotes/$id/document/exports',
        body: const <String, dynamic>{},
      );
    } on OrbitException catch (error) {
      if (error.status == 429) {
        throw OrbitException(
          kind: OrbitErrorKind.http,
          publicMessage:
              'Há muitos documentos sendo gerados agora na sua empresa. '
              'Aguarde um instante e tente de novo.',
          status: 429,
          code: 'DOCUMENT_EXPORT_RATE_LIMITED',
          requestId: error.requestId,
        );
      }
      rethrow;
    }
    final exportId = accepted['exportId'] as String;
    final started = now();
    for (var attempt = 0; ; attempt++) {
      if (now().difference(started) >= exportTimeout) {
        throw const OrbitException(
          kind: OrbitErrorKind.timeout,
          publicMessage:
              'O documento está demorando mais que o normal para ficar '
              'pronto. Tente novamente em alguns minutos.',
          code: 'DOCUMENT_EXPORT_TIMEOUT',
        );
      }
      await sleep(exportPollDelay(attempt));
      final status = await _client.get<Map<String, dynamic>>(
        '/document-exports/$exportId',
      );
      final situation = status['status'];
      final link = status['download'];
      if (situation == 'COMPLETED' && link is Map<String, dynamic>) {
        final data = await _client.getBytes(
          url: Uri.parse(link['url'] as String),
          isPublic: true,
          maxBytes: 30 * 1024 * 1024,
        );
        return (
          bytes: data.bytes,
          contentType: data.contentType ?? status['contentType'] as String?,
          fileName: status['fileName'] as String? ?? data.fileName,
        );
      }
      if (situation == 'FAILED') {
        throw const OrbitException(
          kind: OrbitErrorKind.http,
          publicMessage:
              'Não foi possível gerar o documento. Tente novamente em instantes.',
          status: 500,
          code: 'DOCUMENT_EXPORT_FAILED',
        );
      }
    }
  }

  Future<String> document(String id, DocumentFileStore files) async {
    ({List<int> bytes, String? contentType, String? fileName}) data;
    try {
      data = await exportDocument(id);
    } on OrbitException catch (error) {
      /* Servidor anterior às exportações: a rota síncrona continua lá. */
      if (!error.isNotFound) rethrow;
      data = await download(id);
    }
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
