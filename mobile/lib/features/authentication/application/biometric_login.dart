/// Cadastro, entrada e revogação de chaves biométricas protegidas pelo aparelho.
library;

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../app/providers.dart';
import '../../../core/errors/orbit_exception.dart';
import '../../../core/network/session_authenticator.dart';
import '../../../core/security/biometric_vault.dart';
import '../../../core/security/device_biometrics.dart';
import '../../../core/security/security_confirmation.dart';
import '../../../core/storage/device_identity.dart';
import '../../customer_portal/application/portal_session.dart';

export '../../../core/security/biometric_vault.dart' show BiometricAudience;

final deviceBiometricsProvider = Provider<DeviceBiometrics>(
  (ref) => LocalDeviceBiometrics(),
);

final biometricVaultProvider = Provider<BiometricVault>(
  (ref) => SecureBiometricVault(),
);

final biometricLoginProvider = Provider<BiometricLogin>(
  (ref) => BiometricLogin(ref),
);

/// O aparelho tem biometria? (Para mostrar ou esconder a opção.)
final biometricAvailableProvider = FutureProvider<bool>(
  (ref) => ref.watch(deviceBiometricsProvider).isAvailable(),
);

/// A biometria está ativada neste aparelho para este público?
final biometricEnabledProvider = FutureProvider.family<bool, BiometricAudience>(
  (ref, audience) async =>
      await ref.watch(biometricVaultProvider).read(audience) != null,
);

enum BiometricEnableResult { enabled, cancelled }

class BiometricLogin {
  BiometricLogin(this._ref);

  final Ref _ref;

  DeviceBiometrics get _device => _ref.read(deviceBiometricsProvider);
  BiometricVault get _vault => _ref.read(biometricVaultProvider);
  SharedPreferences get _prefs => _ref.read(sharedPreferencesProvider);

  /// Ativa neste aparelho. A assinatura de cadastro também exige biometria.
  Future<BiometricEnableResult> enable(
    BiometricAudience audience,
    SecurityCredentials credentials,
  ) async {
    final device = _device;
    final vault = _vault;
    final team = audience == BiometricAudience.team
        ? _ref.read(authRepositoryProvider)
        : null;
    final portal = audience == BiometricAudience.customer
        ? _ref.read(portalRepositoryProvider)
        : null;
    final auth = team?.authenticator ?? portal!.authenticator;
    final generation = auth.generation;
    final previous = await vault.read(audience);
    final deviceId = await deviceInstanceId(_prefs);
    final label = _deviceLabel();
    final key = await device.createKey();
    var saved = false;
    try {
      if (generation != auth.generation) throw SessionAuthenticator.changed;
      Future<String?> sign(String challenge) => device.sign(
        key.keyId,
        challenge,
        'Confirme para ativar a biometria no Orbit',
      );
      final credentialId = team != null
          ? await team.enrollDeviceCredential(
              deviceId: deviceId,
              label: label,
              publicKey: key.publicKey,
              sign: sign,
              credentials: credentials,
            )
          : await portal!.enrollDeviceCredential(
              deviceId: deviceId,
              label: label,
              publicKey: key.publicKey,
              sign: sign,
              credentials: credentials,
            );
      if (credentialId == null) return BiometricEnableResult.cancelled;
      if (generation != auth.generation) throw SessionAuthenticator.changed;
      await vault.write(
        audience,
        BiometricCredential(credentialId: credentialId, keyId: key.keyId),
      );
      saved = true;
    } finally {
      if (!saved) await _discardKey(device, key.keyId);
    }
    if (previous != null) await _discardKey(device, previous.keyId);
    _ref.invalidate(biometricEnabledProvider(audience));
    return BiometricEnableResult.enabled;
  }

  Future<void> disable(
    BiometricAudience audience,
    SecurityCredentials credentials,
  ) async {
    final stored = await _vault.read(audience);
    if (stored == null) return;
    try {
      switch (audience) {
        case BiometricAudience.team:
          await _ref
              .read(authRepositoryProvider)
              .revokeDeviceCredential(
                stored.credentialId,
                credentials: credentials,
              );
        case BiometricAudience.customer:
          await _ref
              .read(portalRepositoryProvider)
              .revokeDeviceCredential(
                stored.credentialId,
                credentials: credentials,
              );
      }
    } on OrbitException catch (error) {
      if (error.status != 404) rethrow;
    }
    await _clearIfCurrent(audience, stored);
  }

  /// Solicita a assinatura ao sistema. Cancelar mantém a credencial cadastrada.
  Future<bool> signIn(BiometricAudience audience) async {
    final stored = await _vault.read(audience);
    if (stored == null) return false;
    final device = _device;
    Future<String?> sign(String challenge) => device.sign(
      stored.keyId,
      challenge,
      'Entre no Orbit com a sua biometria',
    );
    try {
      return switch (audience) {
        BiometricAudience.team =>
          await _ref
              .read(authControllerProvider.notifier)
              .loginWithDeviceCredential(
                credentialId: stored.credentialId,
                sign: sign,
              ),
        BiometricAudience.customer =>
          await _ref
              .read(portalSessionProvider.notifier)
              .loginWithDeviceCredential(
                credentialId: stored.credentialId,
                sign: sign,
              ),
      };
    } on OrbitException catch (error) {
      if (error.code == 'DEVICE_KEY_UNAVAILABLE' ||
          error.code == 'BIOMETRIC_INVALID') {
        await _clearIfCurrent(audience, stored);
        throw OrbitException(
          kind: error.kind,
          publicMessage:
              'A biometria deste aparelho precisa ser ativada novamente. Entre com a senha.',
          code: error.code,
          status: error.status,
        );
      }
      rethrow;
    }
  }

  Future<void> _clearIfCurrent(
    BiometricAudience audience,
    BiometricCredential stored,
  ) async {
    final current = await _vault.read(audience);
    if (current?.keyId != stored.keyId) return;
    await _vault.clear(audience);
    await _discardKey(_device, stored.keyId);
    _ref.invalidate(biometricEnabledProvider(audience));
  }

  static Future<void> _discardKey(DeviceBiometrics device, String keyId) async {
    try {
      await device.deleteKey(keyId);
    } on OrbitException {
      // A credential rejected by the API cannot be restored by leaving its key.
    }
  }

  /* ------------------------- convite pós-login ------------------------- */

  static const _pendingKey = 'orbit.biometric.offer.pending';
  static String _dismissedKey(BiometricAudience audience) =>
      'orbit.biometric.offer.dismissed.${audience.name}';

  /// A tela de login marca antes de entrar com senha.
  Future<void> markPasswordLogin(BiometricAudience audience) async {
    try {
      await _prefs.setString(_pendingKey, audience.name);
    } on Object {
      // Sem preferências, sem convite — a opção segue em Configurações.
    }
  }

  Future<void> clearPasswordLogin() async {
    try {
      await _prefs.remove(_pendingKey);
    } on Object {
      // Idem.
    }
  }

  /// Convidar agora? Consome a marca: o convite aparece uma vez por login.
  Future<bool> takeOffer(BiometricAudience audience) async {
    try {
      if (_prefs.getString(_pendingKey) != audience.name) return false;
      await _prefs.remove(_pendingKey);
      if (_prefs.getBool(_dismissedKey(audience)) ?? false) return false;
      if (await _vault.read(audience) != null) return false;
      return await _device.isAvailable();
    } on Object {
      return false;
    }
  }

  /// "Agora não": não pergunta mais neste aparelho.
  Future<void> dismissOffer(BiometricAudience audience) async {
    try {
      await _prefs.setBool(_dismissedKey(audience), true);
    } on Object {
      // No pior caso, pergunta de novo no próximo login.
    }
  }

  static String _deviceLabel() => switch (defaultTargetPlatform) {
    TargetPlatform.iOS => 'iPhone',
    TargetPlatform.android => 'Android',
    _ => 'Celular',
  };
}
