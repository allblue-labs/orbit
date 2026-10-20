/// A foto no contrato da sessão.
///
/// O servidor assina o endereço com o host de onde **ele** acha que vive. Sem
/// tradução, o aparelho tenta carregar a foto de si mesmo — e cai nas iniciais,
/// em silêncio.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/contracts/session_contracts.dart';
import 'package:orbit_operator/core/network/backend_url.dart';

final _base = Uri.parse('http://10.0.2.2:6001/api/v1');
Uri _resolver(Uri url) => resolveBackendUrl(url, _base);

Map<String, dynamic> _json(String? avatar) => {
  'id': 'u1',
  'email': 'dono@exemplo.com',
  'displayName': 'Darlan Simplicio',
  'avatarUrl': avatar,
};

void main() {
  test('o host do servidor é trocado pelo que o aparelho alcança', () {
    final user = OrbitUser.fromJson(
      _json('http://localhost:6001/api/v1/storage/objects?signature=abc'),
      resolverUrl: _resolver,
    );

    expect(user.avatarUrl, contains('10.0.2.2'));
    expect(user.avatarUrl, isNot(contains('localhost')));
    expect(user.avatarUrl, contains('signature=abc'));
  });

  test('sem foto, continua sem foto', () {
    expect(
      OrbitUser.fromJson(_json(null), resolverUrl: _resolver).avatarUrl,
      isNull,
    );
  });

  test('string vazia vira nulo, e não um endereço quebrado', () {
    /* `Image.network('')` lança; a inicial é a resposta certa. */
    expect(
      OrbitUser.fromJson(_json('   '), resolverUrl: _resolver).avatarUrl,
      isNull,
    );
  });

  test('sem tradutor, o endereço passa como veio', () {
    /* O contrato não inventa host: quem não tem base alcançável a declarar
       recebe o que o servidor mandou. */
    expect(
      OrbitUser.fromJson(_json('https://cdn.exemplo.com/f.png')).avatarUrl,
      'https://cdn.exemplo.com/f.png',
    );
  });
}
