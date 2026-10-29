/// Log sem dados sensíveis.
///
/// Regra dura do app: token, senha e cookie nunca aparecem em log, em nenhum
/// nível e em nenhuma profundidade.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/core/storage/token_storage.dart';

void main() {
  test('retira credenciais, assinatura, query e fragmento das URLs', () {
    const url =
        'https://user:password@storage.example.test/object?signature=private&key=customer#secret';
    final redacted = OrbitLogger.redact({
      'path': url,
      'nested': [
        {'url': url, 'signature': 'private'},
      ],
      'X-Amz-Signature': 'private',
    });
    expect(redacted['path'], '/object');
    expect(redacted['nested'], [
      {'url': '/object', 'signature': '***'},
    ]);
    expect(redacted['X-Amz-Signature'], '***');
    expect(OrbitLogger.safePath('/objects?signature=private'), '/objects');
    expect(OrbitLogger.safePath('https://['), '[caminho indisponível]');
  });
  test('mascara chaves sensíveis', () {
    final redacted = OrbitLogger.redact({
      'method': 'POST',
      'authorization': 'Bearer abc.def.ghi',
      'password': 'senha-do-usuario',
      'refreshToken': 'refresh-secreto',
      'status': 200,
    });

    expect(redacted['method'], 'POST');
    expect(redacted['status'], 200);
    expect(redacted['authorization'], '***');
    expect(redacted['password'], '***');
    expect(redacted['refreshToken'], '***');
  });

  test('mascara em mapas aninhados', () {
    final redacted = OrbitLogger.redact({
      'request': <String, Object?>{
        'headers': <String, Object?>{
          'authorization': 'Bearer segredo',
          'accept': 'application/json',
        },
      },
    });

    final request = redacted['request']! as Map<String, Object?>;
    final headers = request['headers']! as Map<String, Object?>;
    expect(headers['authorization'], '***');
    expect(headers['accept'], 'application/json');
  });

  test('TokenPair não expõe os tokens ao ser impresso', () {
    const pair = TokenPair(
      accessToken: 'access-super-secreto',
      refreshToken: 'refresh-super-secreto',
      expiresIn: 900,
    );

    final text = pair.toString();
    expect(text, isNot(contains('access-super-secreto')));
    expect(text, isNot(contains('refresh-super-secreto')));
    expect(text, contains('900'));
  });
}
