import 'package:flutter/services.dart';

import '../errors/orbit_exception.dart';

typedef DeviceKey = ({String keyId, String publicKey});

abstract interface class DeviceBiometrics {
  Future<bool> isAvailable();
  Future<DeviceKey> createKey();
  Future<String?> sign(String keyId, String challenge, String reason);
  Future<void> deleteKey(String keyId);
}

/// The OS authorizes the signing operation. Dart holds only a key reference.
class LocalDeviceBiometrics implements DeviceBiometrics {
  const LocalDeviceBiometrics();

  static const _channel = MethodChannel('orbit/device_biometrics');

  @override
  Future<bool> isAvailable() async {
    try {
      return await _channel.invokeMethod<bool>('isAvailable') ?? false;
    } on PlatformException {
      return false;
    } on MissingPluginException {
      return false;
    }
  }

  @override
  Future<DeviceKey> createKey() async {
    final data = await _invoke<Map<Object?, Object?>>('createKey');
    final keyId = data?['keyId'];
    final publicKey = data?['publicKey'];
    if (keyId is! String || publicKey is! String) {
      throw _unavailable;
    }
    return (keyId: keyId, publicKey: publicKey);
  }

  @override
  Future<String?> sign(String keyId, String challenge, String reason) =>
      _invoke<String>('sign', {
        'keyId': keyId,
        'challenge': challenge,
        'reason': reason,
      });

  @override
  Future<void> deleteKey(String keyId) =>
      _invoke<void>('deleteKey', {'keyId': keyId});

  Future<T?> _invoke<T>(String action, [Map<String, String>? arguments]) async {
    try {
      return await _channel.invokeMethod<T>(action, arguments);
    } on PlatformException catch (error) {
      if (error.code == 'KEY_UNAVAILABLE') {
        throw const OrbitException(
          kind: OrbitErrorKind.http,
          code: 'DEVICE_KEY_UNAVAILABLE',
          publicMessage:
              'A biometria deste aparelho precisa ser ativada novamente.',
        );
      }
      throw _unavailable;
    } on MissingPluginException {
      throw _unavailable;
    }
  }

  static const _unavailable = OrbitException(
    kind: OrbitErrorKind.http,
    code: 'DEVICE_BIOMETRICS_UNAVAILABLE',
    publicMessage:
        'A biometria segura está indisponível neste aparelho. Você pode entrar com a senha.',
  );
}
