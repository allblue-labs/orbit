import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:cryptography/cryptography.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/storage/offline_data.dart';
import 'package:orbit_operator/core/storage/read_cache.dart';
import 'package:shared_preferences/shared_preferences.dart';

OfflineDataCipher cipher() =>
    OfflineDataCipher(loadKey: () async => SecretKey(List<int>.filled(32, 7)));

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('ciphertext is randomized and bound to its original purpose', () async {
    final encryption = cipher();
    final original = utf8.encode('conteúdo de uma evidência');
    final sealed = await encryption.seal(original, purpose: 'evidence/photo');
    final second = await encryption.seal(original, purpose: 'evidence/photo');
    expect(sealed, isNot(second));
    expect(await cipher().open(sealed, purpose: 'evidence/photo'), original);
    await expectLater(
      encryption.open(sealed, purpose: 'evidence/another-photo'),
      throwsA(isA<SecretBoxAuthenticationError>()),
    );
    sealed[sealed.length - 1] ^= 1;
    await expectLater(
      encryption.open(sealed, purpose: 'evidence/photo'),
      throwsA(isA<SecretBoxAuthenticationError>()),
    );
  });

  test(
    'an interrupted migration preserves the original offline file',
    () async {
      final directory = await Directory.systemTemp.createTemp('offline-data-');
      addTearDown(() => directory.delete(recursive: true));
      final file = await File(
        '${directory.path}/journal.json',
      ).writeAsString('pendente');
      final unavailable = OfflineDataCipher(
        loadKey: () async =>
            throw const FileSystemException('armazenamento bloqueado'),
      );
      await expectLater(
        OfflineDataFile(file, scope: 'journal', cipher: unavailable).read(),
        throwsA(isA<FileSystemException>()),
      );
      expect(await file.readAsString(), 'pendente');
      final storage = OfflineDataFile(file, scope: 'journal', cipher: cipher());
      expect(utf8.decode((await storage.read())!), 'pendente');
      expect(await file.readAsBytes(), isNot(utf8.encode('pendente')));
      expect(utf8.decode((await storage.read())!), 'pendente');
    },
  );

  test(
    'cache expires and cannot be replayed into a different session',
    () async {
      SharedPreferences.setMockInitialValues({});
      final preferences = await SharedPreferences.getInstance();
      final encryption = cipher();
      final cache = PreferencesReadCache(
        preferences,
        namespace: 'a',
        cipher: encryption,
      );
      await cache.write('operations', {'customer': 'Conteúdo reservado'});
      const key = 'orbit.cache.v3.a.operations';
      final stored = preferences.getString(key)!;
      expect(
        utf8.decode(base64Decode(stored), allowMalformed: true),
        isNot(contains('Conteúdo reservado')),
      );
      expect((await cache.read('operations'))?.value, {
        'customer': 'Conteúdo reservado',
      });
      await preferences.setString('orbit.cache.v3.b.operations', stored);
      final other = PreferencesReadCache(
        preferences,
        namespace: 'b',
        cipher: encryption,
      );
      expect(await other.read('operations'), isNull);

      final old = await encryption.seal(
        utf8.encode(
          jsonEncode({
            'cachedAt': DateTime.now()
                .subtract(const Duration(days: 2))
                .toIso8601String(),
            'value': {'customer': 'Antigo'},
          }),
        ),
        purpose: key,
      );
      await preferences.setString(key, base64Encode(old));
      expect(await cache.read('operations'), isNull);
      expect(preferences.containsKey(key), isFalse);
    },
  );

  test('migration cannot overwrite a concurrent operational write', () async {
    final directory = await Directory.systemTemp.createTemp('offline-queue-');
    addTearDown(() => directory.delete(recursive: true));
    final file = await File(
      '${directory.path}/journal.json',
    ).writeAsString('antigo');
    final keyRequested = Completer<void>();
    final keyAvailable = Completer<SecretKey>();
    final migration = OfflineDataFile(
      file,
      scope: 'journal',
      cipher: OfflineDataCipher(
        loadKey: () {
          keyRequested.complete();
          return keyAvailable.future;
        },
      ),
    ).read();
    await keyRequested.future;

    final storage = OfflineDataFile(file, scope: 'journal', cipher: cipher());
    final queuedWrite = storage.write(utf8.encode('atualizado'));
    keyAvailable.complete(SecretKey(List<int>.filled(32, 7)));
    expect(utf8.decode((await migration)!), 'antigo');
    await queuedWrite;
    expect(utf8.decode((await storage.read())!), 'atualizado');
  });
}
