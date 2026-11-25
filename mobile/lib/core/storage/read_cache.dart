/// Cache de leitura.
///
/// Guarda a última resposta bem-sucedida de consultas específicas para que o
/// app abra com conteúdo quando a rede está ruim — situação normal em campo.
///
/// Limites desta PR, deliberados:
///
/// - **somente leitura**: nada de mutação offline, nada de fila de sincronismo;
/// - **nada sensível**: tokens e credenciais não passam por aqui;
/// - **sempre datado**: quem lê recebe também a idade do dado, para a interface
///   poder avisar que está desatualizado.
///
/// A interface [ReadCache] é o ponto de extensão para a PR de sincronismo:
/// trocar a implementação por uma com fila não muda quem a consome.
library;

import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'offline_data.dart';

/// Valor em cache com o instante em que foi gravado.
class CachedValue<T> {
  const CachedValue({required this.value, required this.cachedAt});

  final T value;
  final DateTime cachedAt;

  Duration get age => DateTime.now().difference(cachedAt);

  /// Considera-se desatualizado após [threshold].
  bool isStale(Duration threshold) => age > threshold;
}

abstract interface class ReadCache {
  Future<CachedValue<Map<String, dynamic>>?> read(String key);
  Future<void> write(String key, Map<String, dynamic> value);
  Future<void> clear();
}

class PreferencesReadCache implements ReadCache {
  PreferencesReadCache(
    this._preferences, {
    String? namespace,
    OfflineDataCipher? cipher,
  }) : _prefix = 'orbit.cache.v3.${namespace ?? 'unscoped'}.',
       _cipher = cipher ?? OfflineDataCipher.device;

  static const _maxAge = Duration(hours: 24);
  final String _prefix;
  final OfflineDataCipher _cipher;
  bool _closed = false;

  void close() => _closed = true;

  /// Discard unencrypted caches from earlier versions. They're rebuilt online.
  static Future<void> purgeLegacy(SharedPreferences preferences) async {
    for (final key
        in preferences
            .getKeys()
            .where(
              (key) =>
                  key.startsWith('orbit.cache.') &&
                  !key.startsWith('orbit.cache.v3.'),
            )
            .toList()) {
      await preferences.remove(key);
    }
  }

  final SharedPreferences _preferences;

  @override
  Future<CachedValue<Map<String, dynamic>>?> read(String key) async {
    if (_closed) return null;
    final entry = '$_prefix$key';
    final raw = _preferences.getString(entry);
    if (raw == null) return null;
    try {
      final bytes = await _cipher.open(base64Decode(raw), purpose: entry);
      if (_closed) return null;
      final decoded = jsonDecode(utf8.decode(bytes));
      if (decoded is! Map<String, dynamic>) return null;
      final timestamp = decoded['cachedAt'];
      final cachedAt = timestamp is String
          ? DateTime.tryParse(timestamp)
          : null;
      final value = decoded['value'];
      if (cachedAt == null || value is! Map<String, dynamic>) return null;
      if (DateTime.now().difference(cachedAt) > _maxAge) {
        if (_preferences.getString(entry) == raw) {
          await _preferences.remove(entry);
        }
        return null;
      }
      return CachedValue(value: value, cachedAt: cachedAt);
    } on Exception {
      // A cache miss keeps network reads working while device storage is locked.
      return null;
    }
  }

  @override
  Future<void> write(String key, Map<String, dynamic> value) async {
    if (_closed) return;
    final entry = '$_prefix$key';
    try {
      final bytes = await _cipher.seal(
        utf8.encode(
          jsonEncode({
            'cachedAt': DateTime.now().toIso8601String(),
            'value': value,
          }),
        ),
        purpose: entry,
      );
      if (!_closed) await _preferences.setString(entry, base64Encode(bytes));
    } on Exception {
      // The cache is optional. Never fall back to writing plaintext.
    }
  }

  @override
  Future<void> clear() async {
    final keys = _preferences.getKeys().where((key) => key.startsWith(_prefix));
    for (final key in keys) {
      await _preferences.remove(key);
    }
  }
}
