import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/config/environment.dart';

Map<String, Object?> config(String path) =>
    jsonDecode(File(path).readAsStringSync()) as Map<String, Object?>;

void main() {
  test('presets de desenvolvimento cobrem Android e iOS', () {
    expect(
      config('config/development.android.json'),
      containsPair('ORBIT_API_URL', 'http://10.0.2.2:6001/api/v1'),
    );
    expect(
      config('config/development.ios.json'),
      containsPair('ORBIT_API_URL', 'http://localhost:6001/api/v1'),
    );
  });

  test('arquivo local é exemplo mínimo e não contém segredo', () {
    final local = config('config/local.example.json');
    expect(local.keys, unorderedEquals(['ORBIT_API_URL', 'ORBIT_FLAVOR']));
    expect(local['ORBIT_FLAVOR'], 'development');
    expect(
      File('.gitignore').readAsStringSync(),
      contains('/config/local.json'),
    );
  });

  test('produção é explícita e o exemplo não é distribuível', () {
    final production = config('config/production.example.json');
    final url = production['ORBIT_API_URL']! as String;
    expect(production['ORBIT_FLAVOR'], 'production');
    expect(OrbitEnvironment.isDevelopmentEndpoint(url), isTrue);
    expect(
      File('.gitignore').readAsStringSync(),
      contains('/config/production.json'),
    );
  });

  test('atalhos usam arquivos e recusam configuração ausente', () {
    final makefile = File('Makefile').readAsStringSync();
    expect(makefile, contains('--dart-define-from-file'));
    expect(makefile, isNot(contains('--dart-define=ORBIT_API_URL')));
    expect(makefile, contains('test -f "\$(PRODUCTION_CONFIG)"'));
    expect(makefile, contains('test -f "\$(LOCAL_CONFIG)"'));
  });
}
