/// Guarda dos tokens.
///
/// Tokens vivem **exclusivamente** no armazenamento seguro do sistema
/// (Keychain no iOS, EncryptedSharedPreferences no Android). Nunca em
/// `SharedPreferences`, nunca em cache de leitura, nunca em log.
library;

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Par de tokens devolvido por `/identity/login`, `/register` e `/refresh`.
class TokenPair {
  const TokenPair({
    required this.accessToken,
    required this.refreshToken,
    required this.expiresIn,
  });

  factory TokenPair.fromJson(Map<String, dynamic> json) => TokenPair(
    accessToken: json['accessToken'] as String,
    refreshToken: json['refreshToken'] as String,
    expiresIn: (json['expiresIn'] as num?)?.toInt() ?? 0,
  );

  final String accessToken;
  final String refreshToken;
  final int expiresIn;

  /// Nunca imprime o conteúdo dos tokens.
  @override
  String toString() => 'TokenPair(expiresIn: $expiresIn)';
}

abstract interface class TokenStorage {
  Future<TokenPair?> read();
  Future<void> write(TokenPair tokens);
  Future<void> clear();
}

/// Reads cannot observe half of a token rotation or race a logout write.
class SerializedTokenStorage implements TokenStorage {
  SerializedTokenStorage(this._storage);
  final TokenStorage _storage;
  Future<void> _pending = Future.value();

  Future<T> _run<T>(Future<T> Function() action) {
    final result = _pending.then((_) => action());
    _pending = result.then<void>((_) {}, onError: (Object _, StackTrace __) {});
    return result;
  }

  @override
  Future<TokenPair?> read() => _run(_storage.read);
  @override
  Future<void> write(TokenPair tokens) => _run(() => _storage.write(tokens));
  @override
  Future<void> clear() => _run(_storage.clear);
}

class SecureTokenStorage implements TokenStorage {
  SecureTokenStorage({FlutterSecureStorage? storage})
    : _storage =
          storage ??
          const FlutterSecureStorage(
            aOptions: AndroidOptions(encryptedSharedPreferences: true),
            iOptions: IOSOptions(
              accessibility: KeychainAccessibility.first_unlock_this_device,
            ),
          );

  static const _accessKey = 'orbit.access_token';
  static const _refreshKey = 'orbit.refresh_token';
  static const _expiresKey = 'orbit.expires_in';

  final FlutterSecureStorage _storage;

  @override
  Future<TokenPair?> read() async {
    final access = await _storage.read(key: _accessKey);
    final refresh = await _storage.read(key: _refreshKey);
    if (access == null || refresh == null) return null;
    final expires = await _storage.read(key: _expiresKey);
    return TokenPair(
      accessToken: access,
      refreshToken: refresh,
      expiresIn: int.tryParse(expires ?? '') ?? 0,
    );
  }

  @override
  Future<void> write(TokenPair tokens) async {
    await Future.wait([
      _storage.write(key: _accessKey, value: tokens.accessToken),
      _storage.write(key: _refreshKey, value: tokens.refreshToken),
      _storage.write(key: _expiresKey, value: '${tokens.expiresIn}'),
    ]);
  }

  @override
  Future<void> clear() async {
    await Future.wait([
      _storage.delete(key: _accessKey),
      _storage.delete(key: _refreshKey),
      _storage.delete(key: _expiresKey),
    ]);
  }
}
