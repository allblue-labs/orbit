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
  PreferencesReadCache(this._preferences, {String? namespace})
    : _prefix = namespace == null
          ? 'orbit.cache.'
          : 'orbit.cache.v2.$namespace.';

  final String _prefix;
  bool _closed = false;

  void close() => _closed = true;

  /// Old versions did not record an owner: those entries cannot be migrated safely.
  static Future<void> purgeLegacy(SharedPreferences preferences) async {
    for (final key
        in preferences
            .getKeys()
            .where(
              (key) =>
                  key.startsWith('orbit.cache.') &&
                  !key.startsWith('orbit.cache.v2.'),
            )
            .toList()) {
      await preferences.remove(key);
    }
  }

  final SharedPreferences _preferences;

  @override
  Future<CachedValue<Map<String, dynamic>>?> read(String key) async {
    if (_closed) return null;
    final raw = _preferences.getString('$_prefix$key');
    if (raw == null) return null;
    try {
      final decoded = jsonDecode(raw) as Map<String, dynamic>;
      final cachedAt = DateTime.tryParse(decoded['cachedAt'] as String? ?? '');
      final value = decoded['value'];
      if (cachedAt == null || value is! Map<String, dynamic>) return null;
      return CachedValue(value: value, cachedAt: cachedAt);
    } on FormatException {
      // Cache corrompido não pode derrubar a leitura: descarta e segue online.
      await _preferences.remove('$_prefix$key');
      return null;
    }
  }

  @override
  Future<void> write(String key, Map<String, dynamic> value) async {
    if (_closed) return;
    await _preferences.setString(
      '$_prefix$key',
      jsonEncode({
        'cachedAt': DateTime.now().toIso8601String(),
        'value': value,
      }),
    );
  }

  @override
  Future<void> clear() async {
    final keys = _preferences.getKeys().where((key) => key.startsWith(_prefix));
    for (final key in keys) {
      await _preferences.remove(key);
    }
  }
}
