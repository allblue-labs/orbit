/// A biometria do aparelho — digital, rosto ou o bloqueio de tela.
///
/// O app nunca vê a biometria: o sistema responde só "liberou" ou "não". O que
/// ela libera é um segredo guardado no armazenamento seguro ([BiometricVault]),
/// e quem confere o segredo é o servidor.
library;

import 'package:flutter/services.dart';
import 'package:local_auth/local_auth.dart';

abstract interface class DeviceBiometrics {
  /// O aparelho tem biometria (ou bloqueio de tela) cadastrada?
  Future<bool> isAvailable();

  /// Pede a biometria. `false` quando a pessoa cancelou ou não passou.
  Future<bool> authenticate(String reason);
}

class LocalDeviceBiometrics implements DeviceBiometrics {
  LocalDeviceBiometrics([LocalAuthentication? auth])
    : _auth = auth ?? LocalAuthentication();

  final LocalAuthentication _auth;

  @override
  Future<bool> isAvailable() async {
    try {
      if (!await _auth.isDeviceSupported()) return false;
      return await _auth.canCheckBiometrics &&
          (await _auth.getAvailableBiometrics()).isNotEmpty;
    } on PlatformException {
      return false;
    } on MissingPluginException {
      return false;
    }
  }

  @override
  Future<bool> authenticate(String reason) async {
    try {
      return await _auth.authenticate(
        localizedReason: reason,
        persistAcrossBackgrounding: true,
      );
    } on PlatformException {
      return false;
    } on LocalAuthException {
      return false;
    } on MissingPluginException {
      return false;
    }
  }
}
