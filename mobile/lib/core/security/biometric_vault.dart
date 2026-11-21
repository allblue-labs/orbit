/// O cofre da biometria: a credencial deste aparelho para entrar sem senha.
///
/// Guarda o id da credencial e o segredo que o servidor emitiu, no mesmo
/// armazenamento seguro dos tokens (Keychain / EncryptedSharedPreferences),
/// num lugar próprio por público — equipe e cliente nunca se misturam. O
/// segredo muda a cada entrada: o servidor devolve o próximo, e o cofre troca.
library;

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

enum BiometricAudience { team, customer }

class BiometricCredential {
  const BiometricCredential({required this.credentialId, required this.secret});

  final String credentialId;
  final String secret;

  /// Nunca imprime o segredo.
  @override
  String toString() => 'BiometricCredential($credentialId)';
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

  String _id(BiometricAudience audience) =>
      'orbit.biometric.${audience.name}.credential';
  String _secret(BiometricAudience audience) =>
      'orbit.biometric.${audience.name}.secret';

  @override
  Future<BiometricCredential?> read(BiometricAudience audience) async {
    try {
      final id = await _storage.read(key: _id(audience));
      final secret = await _storage.read(key: _secret(audience));
      if (id == null || secret == null || id.isEmpty || secret.isEmpty) {
        return null;
      }
      return BiometricCredential(credentialId: id, secret: secret);
    } on Object {
      return null;
    }
  }

  @override
  Future<void> write(
    BiometricAudience audience,
    BiometricCredential value,
  ) async {
    await _storage.write(key: _id(audience), value: value.credentialId);
    await _storage.write(key: _secret(audience), value: value.secret);
  }

  @override
  Future<void> clear(BiometricAudience audience) async {
    await _storage.delete(key: _id(audience));
    await _storage.delete(key: _secret(audience));
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
