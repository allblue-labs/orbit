/// Rede da área do cliente.
///
/// Usa um cliente HTTP **próprio**, com armazenamento e renovação próprios
/// (`/portal/auth/refresh`). O token do cliente nunca passa pelo cliente HTTP
/// da equipe, e vice-versa: o servidor já recusa a troca, e aqui ela nem tem
/// como acontecer.
library;

import 'dart:typed_data';

import '../../../core/network/orbit_api_client.dart';
import '../../../core/network/session_authenticator.dart';
import '../../../core/storage/token_storage.dart';
import 'portal_contracts.dart';

class PortalSession {
  const PortalSession({required this.tokens, required this.me});

  final TokenPair tokens;
  final PortalMe me;
}

class PortalRepository {
  PortalRepository({
    required OrbitApiClient client,
    required TokenStorage storage,
  }) : _client = client,
       _storage = storage;

  final OrbitApiClient _client;
  final TokenStorage _storage;

  SessionAuthenticator get authenticator => _client.authenticator;

  /// Há sessão de cliente guardada neste aparelho?
  Future<bool> hasStoredSession() async => (await _storage.read()) != null;

  /// Entra só com e-mail e senha: o domínio do e-mail já diz a organização.
  Future<PortalSession> login({
    required String email,
    required String password,
  }) async {
    final clearing = authenticator.clearSession();
    final generation = authenticator.generation;
    await clearing;
    if (generation != authenticator.generation) {
      throw SessionAuthenticator.changed;
    }
    final data = await _client.post<Map<String, dynamic>>(
      '/portal/auth/login',
      isPublic: true,
      body: {'email': email.trim().toLowerCase(), 'password': password},
    );
    final tokens = TokenPair.fromJson(data);
    await authenticator.storeTokens(tokens, generation: generation);
    return PortalSession(
      tokens: tokens,
      me: PortalMe.fromJson(data['me'] as Map<String, dynamic>),
    );
  }

  /// Entra com a credencial biométrica deste aparelho; devolve a sessão e o
  /// próximo segredo — o usado deixa de valer.
  Future<({PortalSession session, String nextSecret})>
  loginWithDeviceCredential({
    required String credentialId,
    required String secret,
  }) async {
    final clearing = authenticator.clearSession();
    final generation = authenticator.generation;
    await clearing;
    if (generation != authenticator.generation) {
      throw SessionAuthenticator.changed;
    }
    final data = await _client.post<Map<String, dynamic>>(
      '/portal/auth/biometrics/devices/login',
      isPublic: true,
      body: {'credentialId': credentialId, 'secret': secret},
    );
    final tokens = TokenPair.fromJson(data);
    await authenticator.storeTokens(tokens, generation: generation);
    return (
      session: PortalSession(
        tokens: tokens,
        me: PortalMe.fromJson(data['me'] as Map<String, dynamic>),
      ),
      nextSecret: data['deviceSecret'] as String,
    );
  }

  Future<({String credentialId, String secret})> enrollDeviceCredential({
    required String deviceId,
    required String label,
  }) async {
    final data = await _client.post<Map<String, dynamic>>(
      '/portal/me/biometrics/devices',
      body: {'deviceId': deviceId, 'label': label},
    );
    return (
      credentialId: data['credentialId'] as String,
      secret: data['secret'] as String,
    );
  }

  Future<void> revokeDeviceCredential(String credentialId) =>
      _client.delete<dynamic>(
        '/portal/me/biometrics/${Uri.encodeComponent(credentialId)}',
      );

  Future<PortalMe> me() async =>
      PortalMe.fromJson(await _client.get<Map<String, dynamic>>('/portal/me'));

  /// Sai: local primeiro, servidor depois — sair não depende de sinal.
  Future<void> logout() async {
    final tokens = await authenticator.clearSession();
    if (tokens == null) return;
    try {
      await _client.post<dynamic>(
        '/portal/auth/logout',
        isPublic: true,
        headers: {'authorization': 'Bearer ${tokens.accessToken}'},
      );
    } on Object {
      // A sessão local já se foi; a do servidor expira sozinha.
    }
  }

  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  }) => _client.patch<dynamic>(
    '/portal/auth/password',
    body: {'currentPassword': currentPassword, 'newPassword': newPassword},
  );

  Future<PortalSummary> summary() async => PortalSummary.fromJson(
    await _client.get<Map<String, dynamic>>('/portal/me/summary'),
  );

  Future<PortalPage<PortalOperation>> operations({
    int page = 1,
    String? assetId,
    int limit = 20,
  }) async => PortalPage.fromJson(
    await _client.get<Map<String, dynamic>>(
      '/portal/me/operations',
      query: {
        'page': page,
        'limit': limit,
        'sortBy': 'date',
        'order': 'desc',
        'assetId': ?assetId,
      },
    ),
    PortalOperation.fromJson,
  );

  Future<PortalOperation> operation(String id) async =>
      PortalOperation.fromJson(
        await _client.get<Map<String, dynamic>>(
          '/portal/me/operations/${Uri.encodeComponent(id)}',
        ),
      );

  Future<PortalPage<PortalAsset>> assets({
    int page = 1,
    String? search,
  }) async => PortalPage.fromJson(
    await _client.get<Map<String, dynamic>>(
      '/portal/me/assets',
      query: {
        'page': page,
        'limit': 30,
        'sortBy': 'name',
        'order': 'asc',
        if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
      },
    ),
    PortalAsset.fromJson,
  );

  Future<PortalAsset> asset(String id) async => PortalAsset.fromJson(
    await _client.get<Map<String, dynamic>>(
      '/portal/me/assets/${Uri.encodeComponent(id)}',
    ),
  );

  Future<PortalPage<PortalDocument>> documents({
    int page = 1,
    PortalDocumentCategory? category,
    String? operationId,
    String? assetId,
    int limit = 30,
  }) async => PortalPage.fromJson(
    await _client.get<Map<String, dynamic>>(
      '/portal/me/documents',
      query: {
        'page': page,
        'limit': limit,
        'sortBy': 'issuedAt',
        'order': 'desc',
        'category': ?category?.code,
        'operationId': ?operationId,
        'assetId': ?assetId,
      },
    ),
    PortalDocument.fromJson,
  );

  /// Os bytes do documento, por uma URL assinada pedida agora — ela vence em
  /// minutos, e por isso nunca é guardada.
  Future<({List<int> bytes, String? contentType, String? fileName})>
  downloadDocument(String documentId) async {
    final access = await _client.get<Map<String, dynamic>>(
      '/portal/me/documents/${Uri.encodeComponent(documentId)}/access',
    );
    return _client.getBytes(
      url: Uri.parse(access['url'] as String),
      maxBytes: 50 * 1024 * 1024,
    );
  }

  Future<PortalProfile> profile() async =>
      _profile(await _client.get<Map<String, dynamic>>('/portal/me/profile'));

  /// A foto já enquadrada. O tipo vem dos bytes, não de um palpite pelo nome.
  Future<PortalProfile> setAvatar(
    Uint8List bytes, {
    required String mimeType,
  }) => _sendImage(
    '/portal/me/avatar',
    bytes,
    fileName: 'foto.${mimeType.split('/').last}',
    mimeType: mimeType,
  );

  Future<PortalProfile> removeAvatar() async =>
      _profile(await _client.delete<Map<String, dynamic>>('/portal/me/avatar'));

  Future<PortalProfile> setSignature(Uint8List png) => _sendImage(
    '/portal/me/signature',
    png,
    fileName: 'assinatura.png',
    mimeType: 'image/png',
  );

  Future<PortalProfile> removeSignature() async => _profile(
    await _client.delete<Map<String, dynamic>>('/portal/me/signature'),
  );

  Future<PortalProfile> _sendImage(
    String path,
    Uint8List bytes, {
    required String fileName,
    required String mimeType,
  }) async => _profile(
    await _client.putFile<Map<String, dynamic>>(
      path,
      bytes: bytes,
      fileName: fileName,
      mimeType: mimeType,
    ),
  );

  /// URLs do storage local vêm com o host do servidor; o app as resolve para
  /// o endereço que ele de fato alcança.
  PortalProfile _profile(Map<String, dynamic> json) {
    final profile = PortalProfile.fromJson(json);
    PortalMedia resolve(PortalMedia media) => media.url == null
        ? media
        : PortalMedia(
            available: media.available,
            url: _client.resolveUrl(Uri.parse(media.url!)).toString(),
            updatedAt: media.updatedAt,
          );
    return PortalProfile(
      avatar: resolve(profile.avatar),
      signature: resolve(profile.signature),
    );
  }

  /* ---------------------------------------------------------------- */
  /* Chamados                                                          */
  /* ---------------------------------------------------------------- */

  Future<PortalPage<ServiceRequest>> serviceRequests({int page = 1}) async =>
      PortalPage.fromJson(
        await _client.get<Map<String, dynamic>>(
          '/portal/me/service-requests',
          query: {'page': page, 'limit': 50},
        ),
        ServiceRequest.fromJson,
      );

  Future<ServiceRequest> serviceRequest(String id) async =>
      ServiceRequest.fromJson(
        await _client.get<Map<String, dynamic>>(
          '/portal/me/service-requests/${Uri.encodeComponent(id)}',
        ),
      );

  /// Abre o chamado. A chave de idempotência vem de quem chama e é a mesma
  /// a cada nova tentativa do mesmo envio: rede ruim não vira dois chamados.
  Future<ServiceRequest> openServiceRequest(
    ServiceRequestDraft draft, {
    required String idempotencyKey,
  }) async => ServiceRequest.fromJson(
    await _client.post<Map<String, dynamic>>(
      '/portal/me/service-requests',
      body: draft.toJson(),
      headers: {'idempotency-key': idempotencyKey},
    ),
  );

  Future<ServiceRequest> updateServiceRequest(
    String id,
    ServiceRequestDraft draft, {
    required int expectedVersion,
  }) async => ServiceRequest.fromJson(
    await _client.patch<Map<String, dynamic>>(
      '/portal/me/service-requests/${Uri.encodeComponent(id)}',
      body: {...draft.toJson(), 'expectedVersion': expectedVersion},
    ),
  );

  Future<ServiceRequest> replyServiceRequest(
    String id,
    String message, {
    required int expectedVersion,
  }) async => ServiceRequest.fromJson(
    await _client.post<Map<String, dynamic>>(
      '/portal/me/service-requests/${Uri.encodeComponent(id)}/messages',
      body: {'message': message.trim(), 'expectedVersion': expectedVersion},
    ),
  );

  Future<ServiceRequest> cancelServiceRequest(
    String id, {
    required int expectedVersion,
  }) async => ServiceRequest.fromJson(
    await _client.post<Map<String, dynamic>>(
      '/portal/me/service-requests/${Uri.encodeComponent(id)}/cancel',
      body: {'expectedVersion': expectedVersion},
    ),
  );
}
