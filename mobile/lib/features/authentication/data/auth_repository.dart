/// Repositório de autenticação e sessão.
///
/// Fala com o NestJS diretamente (o BFF é da aplicação web) e compõe o estado
/// de sessão a partir de três leituras reais:
///
/// - `GET /identity/me` → perfil;
/// - `GET /organizations/current` → organização, plano e unidades;
/// - `GET /organizations/current/subscription` → direitos do plano.
///
/// As duas últimas não existem para o Platform Administrator (que não pertence
/// a tenant algum) e `organizations/current` exige assinatura ativa — as duas
/// falhas são toleradas para que a sessão exista mesmo assim.
library;

import 'dart:convert';

import '../../../core/contracts/session_contracts.dart';
import '../../../core/errors/orbit_exception.dart';
import '../../../core/network/orbit_api_client.dart';
import '../../../core/storage/token_storage.dart';

class AuthRepository {
  const AuthRepository({
    required OrbitApiClient client,
    required TokenStorage storage,
  }) : _client = client,
       _storage = storage;

  final OrbitApiClient _client;
  final TokenStorage _storage;

  /// Autentica e guarda o par de tokens no armazenamento seguro.
  Future<TokenPair> login({
    required String email,
    required String password,
    String? mfaCode,
  }) async {
    final data = await _client.post<Map<String, dynamic>>(
      '/identity/login',
      isPublic: true,
      body: {
        'email': email.trim().toLowerCase(),
        'password': password,
        if (mfaCode != null && mfaCode.isNotEmpty) 'mfaCode': mfaCode,
        'client': 'MOBILE',
      },
    );
    final tokens = TokenPair.fromJson(data);
    await _storage.write(tokens);
    return tokens;
  }

  /// Revoga a sessão no backend e limpa o armazenamento.
  ///
  /// A falha na revogação não impede o logout local: o usuário pediu para sair.
  Future<void> logout() async {
    final tokens = await _storage.read();
    if (tokens != null) {
      try {
        await _client.post<dynamic>(
          '/identity/logout',
          body: {'refreshToken': tokens.refreshToken},
        );
      } on OrbitException {
        // Sessão já inválida no servidor — segue limpando localmente.
      }
    }
    await _storage.clear();
  }

  Future<OrbitUser> loadProfile() async {
    final data = await _client.get<Map<String, dynamic>>('/identity/me');
    return OrbitUser.fromJson(data, resolverUrl: _client.resolveUrl);
  }

  /// Troca a própria senha.
  ///
  /// Exige a senha atual — é o que separa este fluxo do link de recuperação,
  /// que existe justamente para quem **não** a tem. O backend revoga as demais
  /// sessões e zera `mustChangePassword` na mesma transação.
  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    await _client.post<dynamic>(
      '/identity/me/password',
      body: {'currentPassword': currentPassword, 'newPassword': newPassword},
    );
  }

  /// Pede o link de redefinição para um e-mail.
  ///
  /// A resposta é sempre a mesma, exista a conta ou não: o servidor não conta a
  /// quem pergunta se aquele endereço tem cadastro.
  Future<void> requestPasswordReset(String email) async {
    await _client.post<dynamic>(
      '/identity/password/forgot',
      isPublic: true,
      body: {'email': email.trim().toLowerCase()},
    );
  }

  /// Organização ativa; `null` quando não há contexto de tenant ou o plano
  /// está inativo (`@RequiresActivePlan` responde 403).
  Future<Organization?> loadOrganization() async {
    try {
      final data = await _client.get<Map<String, dynamic>>(
        '/organizations/current',
      );
      return Organization.fromJson(data);
    } on OrbitException catch (error) {
      if (error.isForbidden || error.isNotFound) return null;
      rethrow;
    }
  }

  Future<Entitlements?> loadEntitlements() async {
    try {
      final data = await _client.get<Map<String, dynamic>>(
        '/organizations/current/subscription',
      );
      return Entitlements.fromJson(data);
    } on OrbitException catch (error) {
      if (error.isForbidden || error.isNotFound) return null;
      rethrow;
    }
  }

  Future<ProductAccess?> loadProductAccess() async {
    try {
      final data = await _client.get<Map<String, dynamic>>(
        '/organizations/current/product-access',
      );
      return ProductAccess.fromJson(data);
    } on OrbitException catch (error) {
      if (error.isForbidden || error.isNotFound) return null;
      rethrow;
    }
  }

  Future<TokenPair?> storedTokens() => _storage.read();

  /// Lê as claims do access token guardado.
  ///
  /// A assinatura é verificada pelo backend; aqui o payload serve apenas para
  /// conhecer papéis, permissões e escopo sem uma ida à rede.
  Future<AccessTokenClaims?> readClaims() async {
    final tokens = await _storage.read();
    if (tokens == null) return null;
    return decodeClaims(tokens.accessToken);
  }

  static AccessTokenClaims? decodeClaims(String accessToken) {
    final parts = accessToken.split('.');
    if (parts.length != 3) return null;
    try {
      final normalized = base64Url.normalize(parts[1]);
      final payload = jsonDecode(utf8.decode(base64Url.decode(normalized)));
      if (payload is! Map<String, dynamic>) return null;
      return AccessTokenClaims.fromJson(payload);
    } on FormatException {
      return null;
    }
  }
}
