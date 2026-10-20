/// Assinatura profissional e aceite do cliente (MB-03).
///
/// ```text
/// GET    /mobile/field/me/signature
/// POST   /mobile/field/me/signature/uploads     → reserva URL assinada
/// PUT    <url assinada>                          → bytes
/// POST   /mobile/field/me/signature              → confirma e ativa
/// DELETE /mobile/field/me/signature
///
/// GET  /mobile/field/operations/:id/customer-acknowledgement/preparation
/// POST /mobile/field/operations/:id/customer-acknowledgement
/// ```
///
/// ## Três coisas que não se misturam
///
/// A **assinatura profissional** pertence ao usuário. O **aceite do cliente**
/// pertence à execução. A **finalização do documento** é outra coisa ainda, e
/// não está aqui. Fundir qualquer par delas — no código ou na tela — apaga uma
/// distinção que o domínio mantém de propósito.
library;

import 'dart:typed_data';

import 'package:crypto/crypto.dart';

import '../../../core/contracts/mobile_signature_contracts.dart';
import '../../../core/errors/orbit_exception.dart';
import '../../../core/errors/orbit_public_copy.dart';
import '../../../core/network/orbit_api_client.dart';

class SignatureRepository {
  const SignatureRepository({required OrbitApiClient client})
    : _client = client;

  final OrbitApiClient _client;

  /// Situação da própria assinatura.
  ///
  /// Só a própria: não há endpoint para gerenciar a de outro profissional, e
  /// o app não inventa um.
  Future<MobileSignatureStatus> status() async {
    final data = await _client.get<Map<String, dynamic>>(
      '/mobile/field/me/signature',
    );
    return MobileSignatureStatus.fromJson(data);
  }

  /// Baixa uma imagem da própria assinatura e confere o contrato inteiro.
  ///
  /// O Bearer permanece no endpoint autenticado e same-origin do Orbit; nunca
  /// é enviado ao storage. Tamanho, tipo e hash precisam coincidir antes que
  /// qualquer byte chegue à apresentação.
  Future<Uint8List> preview(
    MobileSignaturePreview grant, {
    OrbitRequestCancellation? cancellation,
  }) async {
    const allowedMimeTypes = {'image/png', 'image/jpeg', 'image/webp'};
    final queryExpires = int.tryParse(
      grant.url.queryParameters['expires'] ?? '',
    );
    final querySignature = grant.url.queryParameters['signature'] ?? '';
    if (cancellation?.isCancelled == true ||
        grant.isExpired ||
        grant.url.hasScheme ||
        grant.url.hasAuthority ||
        grant.url.path != '/api/v1/mobile/field/me/signature/preview' ||
        grant.url.queryParameters.keys.toSet().difference(const {
          'expires',
          'signature',
        }).isNotEmpty ||
        grant.url.queryParametersAll.length != 2 ||
        grant.url.queryParametersAll.values.any(
          (values) => values.length != 1,
        ) ||
        queryExpires == null ||
        queryExpires > 4_102_444_800 ||
        DateTime.fromMillisecondsSinceEpoch(
              queryExpires * 1000,
              isUtc: true,
            ).difference(grant.expiresAt.toUtc()).abs() >
            const Duration(seconds: 1) ||
        grant.expiresAt.toUtc().difference(DateTime.now().toUtc()) >
            const Duration(hours: 1, seconds: 5) ||
        !RegExp(r'^[a-f0-9]{64}$').hasMatch(querySignature) ||
        grant.requiredHeaders.isNotEmpty ||
        grant.sizeBytes <= 0 ||
        grant.sizeBytes > 2 * 1000 * 1000 ||
        !allowedMimeTypes.contains(grant.mimeType) ||
        !RegExp(r'^[a-f0-9]{64}$').hasMatch(grant.sha256)) {
      throw _invalidPreview;
    }

    final response = await _client.getBytes(
      url: grant.url,
      headers: grant.requiredHeaders,
      cancellation: cancellation,
      maxBytes: grant.sizeBytes,
      isPublic: false,
    );
    final responseMime = response.contentType?.split(';').first.trim();
    if (cancellation?.isCancelled == true ||
        response.bytes.length != grant.sizeBytes ||
        (responseMime != null && responseMime != grant.mimeType) ||
        sha256.convert(response.bytes).toString() != grant.sha256) {
      throw _invalidPreview;
    }
    return Uint8List.fromList(response.bytes);
  }

  static const _invalidPreview = OrbitException(
    kind: OrbitErrorKind.parse,
    publicMessage: OrbitPublicCopy.loadFailed,
    code: 'SIGNATURE_PREVIEW_INVALID',
  );

  /// Cadastra ou substitui a assinatura, em três passos.
  ///
  /// Reservar, enviar, confirmar — nessa ordem. A assinatura só passa a valer
  /// no terceiro passo: enquanto os bytes estão no storage e ninguém
  /// confirmou, o servidor não a considera ativa, e o app também não deve.
  Future<MobileSignatureUploadResult> upload({
    required String fileName,
    required String mimeType,
    required List<int> bytes,
  }) async {
    final reservation = MobileSignatureUploadReservation.fromJson(
      await _client.post<Map<String, dynamic>>(
        '/mobile/field/me/signature/uploads',
        body: MobileSignatureUploadReservationInput(
          fileName: fileName,
          mimeType: mimeType,
          sizeBytes: bytes.length,
        ).toJson(),
      ),
    );

    await _client.putBytes(
      url: reservation.url,
      bytes: bytes,
      headers: reservation.requiredHeaders,
    );

    return MobileSignatureUploadResult.fromJson(
      await _client.post<Map<String, dynamic>>(
        '/mobile/field/me/signature',
        body: MobileSignatureUploadInput(reservation.fileId).toJson(),
      ),
    );
  }

  /// Reserva e envia uma imagem de assinatura, sem ativá-la como a sua.
  ///
  /// É o que o aceite do cliente usa: os bytes vão para o storage e devolvem
  /// um identificador, que viaja no comando do aceite. **Não** chama
  /// `POST /me/signature` — fazer isso transformaria a assinatura do cliente
  /// na assinatura profissional de quem está com o aparelho.
  ///
  /// O `purpose` diz ao servidor o que registrar na trilha do arquivo. É a
  /// única diferença em relação ao caminho profissional; validação, teto e
  /// conferência de bytes são exatamente os mesmos.
  Future<String> uploadSignatureImage({
    required String fileName,
    required String mimeType,
    required List<int> bytes,
    required String purpose,
  }) async {
    final reservation = MobileSignatureUploadReservation.fromJson(
      await _client.post<Map<String, dynamic>>(
        '/mobile/field/me/signature/uploads',
        body: {
          ...MobileSignatureUploadReservationInput(
            fileName: fileName,
            mimeType: mimeType,
            sizeBytes: bytes.length,
          ).toJson(),
          'purpose': purpose,
        },
      ),
    );

    await _client.putBytes(
      url: reservation.url,
      bytes: bytes,
      headers: reservation.requiredHeaders,
    );
    return reservation.fileId;
  }

  Future<MobileSignatureStatus> revoke() async {
    final data = await _client.delete<Map<String, dynamic>>(
      '/mobile/field/me/signature',
    );
    return MobileSignatureStatus.fromJson(data);
  }

  /// O resumo congelado que o cliente revisa.
  Future<CustomerAcknowledgementPreparation> acknowledgementPreparation(
    String operationId,
  ) async {
    final data = await _client.get<Map<String, dynamic>>(
      '/mobile/field/operations/${Uri.encodeComponent(operationId)}'
      '/customer-acknowledgement/preparation',
    );
    return CustomerAcknowledgementPreparation.fromJson(data);
  }

  /// Registra a ciência do cliente.
  ///
  /// `contentVersion` e `contentHash` voltam **verbatim** da preparação: é o
  /// que amarra o aceite ao texto que o cliente leu. Se o atendimento mudou no
  /// meio, o servidor recusa com 409 em vez de registrar concordância com
  /// outro conteúdo.
  ///
  /// Nada aqui toca o cadastro do cliente. `signerName` é de quem deu ciência
  /// naquele atendimento — pode ser o zelador, e não vira nome do cliente.
  Future<CustomerAcknowledgementResult> acknowledge(
    String operationId, {
    required String signerName,
    required String contentVersion,
    required String contentHash,
    required String commandId,
    String? signatureStorageFileId,
    String? contactId,
  }) async {
    final data = await _client.post<Map<String, dynamic>>(
      '/mobile/field/operations/${Uri.encodeComponent(operationId)}'
      '/customer-acknowledgement',
      body: {
        'signerName': signerName,
        'expectedVersion': contentVersion,
        'contentHash': contentHash,
        'commandId': commandId,
        'occurredAt': DateTime.now().toUtc().toIso8601String(),
        if (signatureStorageFileId != null)
          'signatureStorageFileId': signatureStorageFileId,
        if (contactId != null) 'contactId': contactId,
      },
    );
    return CustomerAcknowledgementResult.fromJson(data);
  }
}
