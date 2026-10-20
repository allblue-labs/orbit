/// O transporte do pipeline de evidências.
///
/// Quatro chamadas e nenhuma decisão: reservar, finalizar, listar, pedir
/// acesso. Quem orquestra é o controlador.
library;

import 'dart:typed_data';
import 'package:crypto/crypto.dart';

import '../../../core/contracts/mobile_evidence_contracts.dart';
import '../../../core/network/orbit_api_client.dart';

class EvidenceRepository {
  const EvidenceRepository({required OrbitApiClient client}) : _client = client;

  final OrbitApiClient _client;

  /// Bounded visual preview through the existing signed-access authority.
  /// Large artifacts remain metadata rows; they are never downloaded for a thumbnail.
  Future<Uint8List?> thumbnail(
    FieldEvidence evidence, {
    OrbitRequestCancellation? cancellation,
  }) async {
    if (cancellation?.isCancelled == true ||
        !evidence.previewAvailable ||
        !const [
          'image/jpeg',
          'image/png',
          'image/webp',
        ].contains(evidence.mimeType) ||
        evidence.sizeBytes <= 0 ||
        evidence.sizeBytes > 4 * 1024 * 1024) {
      return null;
    }
    final grant = await access(evidence.id);
    if (grant.evidenceId != evidence.id ||
        grant.operation != 'preview' ||
        grant.isExpired) {
      return null;
    }
    if (cancellation?.isCancelled == true) return null;
    final content = await _client.getBytes(
      url: grant.url,
      headers: grant.requiredHeaders,
      cancellation: cancellation,
      maxBytes: evidence.sizeBytes,
    );
    if (content.bytes.length != evidence.sizeBytes ||
        sha256.convert(content.bytes).toString() != evidence.sha256) {
      return null;
    }
    return Uint8List.fromList(content.bytes);
  }

  /// Cria a intenção e recebe a URL assinada.
  ///
  /// Repetir com a mesma `idempotencyKey` e o mesmo conteúdo devolve a mesma
  /// intenção — inclusive já finalizada, com `uploadUrl: null`. Com conteúdo
  /// diferente, o servidor responde `IDEMPOTENCY_MISMATCH`.
  Future<EvidenceUploadIntent> reserve(
    EvidenceUploadIntentRequest request,
  ) async {
    final data = await _client.post<Map<String, dynamic>>(
      '/mobile/field/evidence/uploads',
      body: request.toJson(),
    );
    return EvidenceUploadIntent.fromJson(data);
  }

  /// Materializa a evidência.
  ///
  /// É aqui que o servidor relê o objeto do storage, confere magic bytes,
  /// tamanho e SHA-256, aplica o limite do target e só então cria a Evidence.
  /// Antes disto não há evidência — há um objeto no storage.
  Future<FieldEvidence> finalize(
    String uploadId, {
    String? expectedSha256,
  }) async {
    final data = await _client.post<Map<String, dynamic>>(
      '/mobile/field/evidence/uploads/$uploadId/finalize',
      body: {if (expectedSha256 != null) 'expectedSha256': expectedSha256},
    );
    return FieldEvidence.fromJson(data);
  }

  /// Envia os bytes para a URL assinada.
  ///
  /// Passa pelo cliente canônico, e **sem** o token da sessão: a assinatura da
  /// URL já é a credencial, e mandar o `Bearer` para fora da API seria vazá-lo
  /// para o storage. Um `Dio` avulso aqui criaria um segundo caminho de rede,
  /// com um segundo tratamento de erro que alguém esqueceria de atualizar.
  Future<void> putBytes({
    required Uri url,
    required Map<String, String> headers,
    required List<int> bytes,
    void Function(double progress)? onProgress,
  }) => _client.putBytes(
    url: url,
    bytes: bytes,
    headers: headers,
    onProgress: onProgress,
  );

  /// As evidências confirmadas de um alvo.
  Future<List<FieldEvidence>> list({
    required FieldEvidenceTargetRef target,
    int limit = 50,
  }) async {
    final data = await _client.get<Map<String, dynamic>>(
      '/mobile/field/evidence',
      query: {
        'targetType': fieldEvidenceTargetWire(target.type),
        'targetId': target.id,
        'limit': limit,
      },
    );
    return (data['items'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(FieldEvidence.fromJson)
        .toList(growable: false);
  }

  /// Um acesso temporário para ver ou baixar.
  ///
  /// Pedido no momento de usar. A URL vale minutos, e guardá-la como se fosse
  /// atributo da evidência produziria um link morto na próxima abertura.
  Future<EvidenceAccess> access(
    String evidenceId, {
    bool download = false,
  }) async {
    final data = await _client.get<Map<String, dynamic>>(
      '/mobile/field/evidence/$evidenceId/access',
      query: {'operation': download ? 'download' : 'preview'},
    );
    return EvidenceAccess.fromJson(data);
  }
}
