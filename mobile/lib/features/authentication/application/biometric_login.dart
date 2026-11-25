/// Entrar com a biometria no app — equipe e cliente.
///
/// O fluxo inteiro em um lugar:
///
/// - **ativar**: a biometria confirma que é a pessoa; o servidor emite uma
///   credencial para este aparelho; o segredo vai para o cofre seguro;
/// - **entrar**: a biometria libera o segredo do cofre; o servidor confere,
///   abre a sessão e devolve o próximo segredo, que substitui o usado;
/// - **desativar**: confirma a identidade, revoga no servidor e apaga o cofre.
///
/// O convite depois do primeiro login com senha também mora aqui: a tela de
/// login marca, o shell pergunta uma vez, e "Agora não" não pergunta de novo.
library;

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../app/providers.dart';
import '../../../core/errors/orbit_exception.dart';
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

  /// Ativa neste aparelho. Exige sessão ativa do público pedido.
  Future<BiometricEnableResult> enable(
    BiometricAudience audience,
    SecurityCredentials credentials,
  ) async {
    if (!await _device.authenticate(
      'Confirme para entrar com biometria no Orbit',
    )) {
      return BiometricEnableResult.cancelled;
    }
    final deviceId = await deviceInstanceId(_prefs);
    final label = _deviceLabel();
    final issued = switch (audience) {
      BiometricAudience.team =>
        await _ref
            .read(authRepositoryProvider)
            .enrollDeviceCredential(
              deviceId: deviceId,
              label: label,
              credentials: credentials,
            ),
      BiometricAudience.customer =>
        await _ref
            .read(portalRepositoryProvider)
            .enrollDeviceCredential(
              deviceId: deviceId,
              label: label,
              credentials: credentials,
            ),
    };
    await _vault.write(
      audience,
      BiometricCredential(
        credentialId: issued.credentialId,
        secret: issued.secret,
      ),
    );
    _ref.invalidate(biometricEnabledProvider(audience));
    return BiometricEnableResult.enabled;
  }

  Future<void> disable(
    BiometricAudience audience,
    SecurityCredentials credentials,
  ) async {
    final stored = await _vault.read(audience);
    if (stored == null) return;
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
    await _vault.clear(audience);
    _ref.invalidate(biometricEnabledProvider(audience));
  }

  /// Entra. `false` quando a pessoa cancelou a biometria.
  ///
  /// Recusa do servidor (credencial removida, acesso desativado, senha
  /// trocada) apaga o cofre: o botão some e a pessoa entra com a senha.
  Future<bool> signIn(BiometricAudience audience) async {
    final stored = await _vault.read(audience);
    if (stored == null) return false;
    if (!await _device.authenticate('Entre no Orbit com a sua biometria')) {
      return false;
    }
    try {
      final next = switch (audience) {
        BiometricAudience.team =>
          await _ref
              .read(authControllerProvider.notifier)
              .loginWithDeviceCredential(
                credentialId: stored.credentialId,
                secret: stored.secret,
              ),
        BiometricAudience.customer =>
          await _ref
              .read(portalSessionProvider.notifier)
              .loginWithDeviceCredential(
                credentialId: stored.credentialId,
                secret: stored.secret,
              ),
      };
      await _vault.write(
        audience,
        BiometricCredential(credentialId: stored.credentialId, secret: next),
      );
      return true;
    } on OrbitException catch (error) {
      if (error.isUnauthorized) {
        await _vault.clear(audience);
        _ref.invalidate(biometricEnabledProvider(audience));
        throw OrbitException(
          kind: error.kind,
          publicMessage:
              'A biometria deste aparelho não vale mais. Entre com a senha e '
              'ative de novo em Configurações.',
          code: error.code,
          status: error.status,
        );
      }
      rethrow;
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
