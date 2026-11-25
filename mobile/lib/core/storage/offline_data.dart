import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Device-local encryption for operational data that survives an app restart.
class OfflineDataCipher {
  OfflineDataCipher({required Future<SecretKey> Function() loadKey})
    : _loadKey = loadKey;

  static final device = OfflineDataCipher(loadKey: _deviceKey);
  static final _cipher = AesGcm.with256bits();
  static final _version = ascii.encode('ORBIT-OFFLINE-AESGCM-1\n');
  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
    iOptions: IOSOptions(
      accessibility: KeychainAccessibility.first_unlock_this_device,
    ),
  );
  static const _keyName = 'orbit.offline_data.key.v1';

  final Future<SecretKey> Function() _loadKey;
  Future<SecretKey>? _key;

  static Future<SecretKey> _deviceKey() async {
    final stored = await _storage.read(key: _keyName);
    if (stored != null) {
      final key = base64Decode(stored);
      if (key.length != 32) throw const FormatException('Chave inválida.');
      return SecretKey(key);
    }
    final key = await _cipher.newSecretKey();
    await _storage.write(
      key: _keyName,
      value: base64Encode(await key.extractBytes()),
    );
    return key;
  }

  Future<SecretKey> _resolveKey() async {
    final pending = _key ??= _loadKey();
    try {
      return await pending;
    } catch (_) {
      // A temporarily unavailable device key can be read again after unlock.
      if (identical(_key, pending)) _key = null;
      rethrow;
    }
  }

  bool canRead(List<int> bytes) =>
      bytes.length >= _version.length &&
      Iterable<int>.generate(
        _version.length,
      ).every((i) => bytes[i] == _version[i]);

  Future<Uint8List> seal(List<int> bytes, {required String purpose}) async {
    final box = await _cipher.encrypt(
      bytes,
      secretKey: await _resolveKey(),
      aad: utf8.encode(purpose),
    );
    return (BytesBuilder(copy: false)
          ..add(_version)
          ..add(box.concatenation()))
        .takeBytes();
  }

  Future<Uint8List> open(List<int> bytes, {required String purpose}) async {
    final overhead =
        _version.length + _cipher.nonceLength + _cipher.macAlgorithm.macLength;
    if (bytes.length < overhead || !canRead(bytes)) {
      throw const FormatException('Formato inválido.');
    }
    final box = SecretBox.fromConcatenation(
      bytes.sublist(_version.length),
      nonceLength: _cipher.nonceLength,
      macLength: _cipher.macAlgorithm.macLength,
    );
    final data = await _cipher.decrypt(
      box,
      secretKey: await _resolveKey(),
      aad: utf8.encode(purpose),
    );
    return data is Uint8List ? data : Uint8List.fromList(data);
  }
}

class OfflineDataFile {
  OfflineDataFile(this.file, {required this.scope, OfflineDataCipher? cipher})
    : _cipher = cipher ?? OfflineDataCipher.device;

  final File file;
  final String scope;
  final OfflineDataCipher _cipher;
  static final _pending = <String, Future<void>>{};

  String get _purpose => '$scope/${file.uri.pathSegments.last}';

  Future<T> _serialized<T>(Future<T> Function() action) {
    final path = file.absolute.path;
    final result = (_pending[path] ?? Future<void>.value()).then(
      (_) => action(),
    );
    final done = result.then<void>(
      (_) {},
      onError: (Object _, StackTrace __) {},
    );
    _pending[path] = done;
    unawaited(
      done.then((_) {
        if (identical(_pending[path], done)) _pending.remove(path);
      }),
    );
    return result;
  }

  Future<Uint8List?> read() => _serialized(() async {
    if (!await file.exists()) return null;
    final bytes = await file.readAsBytes();
    if (_cipher.canRead(bytes)) return _cipher.open(bytes, purpose: _purpose);
    // Replace a legacy file atomically. If encryption fails, the only copy of
    // an unsent command or photo stays intact and sync can retry.
    await _write(bytes);
    return bytes;
  });

  Future<void> write(List<int> bytes) => _serialized(() => _write(bytes));

  Future<void> _write(List<int> bytes) async {
    final sealed = await _cipher.seal(bytes, purpose: _purpose);
    final staging = await file.parent.createTemp('.offline-');
    try {
      final temporary = File('${staging.path}/data');
      await temporary.writeAsBytes(sealed, flush: true);
      await temporary.rename(file.path);
    } finally {
      await staging.delete(recursive: true);
    }
  }
}
