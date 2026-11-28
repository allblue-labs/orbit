import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

enum BiometricAudience { team, customer }

class BiometricCredential {
  const BiometricCredential({required this.credentialId, required this.keyId});

  final String credentialId;
  final String keyId;
}

abstract interface class BiometricVault {
  Future<BiometricCredential?> read(BiometricAudience audience);
  Future<void> write(BiometricAudience audience, BiometricCredential value);
  Future<void> clear(BiometricAudience audience);
}

class SecureBiometricVault implements BiometricVault {
  SecureBiometricVault([FlutterSecureStorage? storage])
    : _storage =
          storage ??
          const FlutterSecureStorage(
            aOptions: AndroidOptions(encryptedSharedPreferences: true),
            iOptions: IOSOptions(
              accessibility: KeychainAccessibility.first_unlock_this_device,
            ),
          );

  final FlutterSecureStorage _storage;

  String _prefix(BiometricAudience audience) =>
      'orbit.biometric.${audience.name}';
  String _id(BiometricAudience audience) => '${_prefix(audience)}.deviceKey.v1';
  final Set<BiometricAudience> _cleaned = {};

  Future<void> _removeLegacy(BiometricAudience audience) async {
    if (_cleaned.contains(audience)) return;
    final prefix = _prefix(audience);
    await _storage.delete(key: '$prefix.secret');
    await _storage.delete(key: '$prefix.credential');
    _cleaned.add(audience);
  }

  @override
  Future<BiometricCredential?> read(BiometricAudience audience) async {
    try {
      await _removeLegacy(audience);
      final encoded = await _storage.read(key: _id(audience));
      if (encoded == null) return null;
      final result = jsonDecode(encoded);
      if (result is! Map<String, dynamic>) return null;
      final id = result['credentialId'];
      final keyId = result['keyId'];
      if (id is! String || id.isEmpty || keyId is! String || keyId.isEmpty) {
        return null;
      }
      return BiometricCredential(credentialId: id, keyId: keyId);
    } on Object {
      return null;
    }
  }

  @override
  Future<void> write(
    BiometricAudience audience,
    BiometricCredential value,
  ) async {
    await _storage.write(
      key: _id(audience),
      value: jsonEncode({
        'credentialId': value.credentialId,
        'keyId': value.keyId,
      }),
    );
  }

  @override
  Future<void> clear(BiometricAudience audience) async {
    await _storage.delete(key: _id(audience));
    await _removeLegacy(audience);
  }
}

/// Em memória — testes e plataformas sem armazenamento seguro.
class MemoryBiometricVault implements BiometricVault {
  final Map<BiometricAudience, BiometricCredential> _values = {};

  @override
  Future<BiometricCredential?> read(BiometricAudience audience) async =>
      _values[audience];

  @override
  Future<void> write(
    BiometricAudience audience,
    BiometricCredential value,
  ) async => _values[audience] = value;

  @override
  Future<void> clear(BiometricAudience audience) async =>
      _values.remove(audience);
}
