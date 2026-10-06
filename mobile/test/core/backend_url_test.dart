/// A tradução de endereços que o servidor entrega.
///
/// O que se protege aqui são dois defeitos observados em campo: "sem internet"
/// ao cadastrar assinatura ou foto, e a prévia que nunca carregava. Os dois
/// vinham de o aplicativo confiar no que o servidor diz sobre **onde ele mora**.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/network/backend_url.dart';

final _base = Uri.parse('http://10.0.2.2:6001/api/v1');

void main() {
  test('o host do servidor é descartado, não obedecido', () {
    /*
     * O provedor local assina a URL com o host de onde o servidor acha que
     * vive. Num aparelho, `localhost` é o próprio aparelho — o PUT morre em
     * conexão recusada e vira "sem internet" numa rede boa.
     */
    final resolvida = resolveBackendUrl(
      Uri.parse(
        'http://localhost:6001/api/v1/storage/objects'
        '?bucket=b&key=k&operation=upload&expires=1&signature=abc',
      ),
      _base,
    );

    expect(resolvida.host, '10.0.2.2');
    expect(resolvida.port, 6001);
    expect(resolvida.path, '/api/v1/storage/objects');
  });

  test('a query inteira sobrevive — nela estão validade e assinatura', () {
    final resolvida = resolveBackendUrl(
      Uri.parse(
        'http://localhost:6001/api/v1/storage/objects'
        '?bucket=b&key=k&operation=upload&expires=1&signature=abc',
      ),
      _base,
    );

    expect(resolvida.queryParameters, {
      'bucket': 'b',
      'key': 'k',
      'operation': 'upload',
      'expires': '1',
      'signature': 'abc',
    });
  });

  test('o prefixo não é duplicado', () {
    /*
     * A prévia vem sem host e **com** `/api/v1`. O Dio concatena caminho com
     * `baseUrl` em vez de resolver por RFC, e a base já termina em `/api/v1`:
     * sem esta tradução o pedido sai para `/api/v1/api/v1/...` e volta 404.
     */
    final resolvida = resolveBackendUrl(
      Uri.parse('/api/v1/mobile/field/me/signature/preview?expires=1'),
      _base,
    );

    expect(resolvida.toString(), contains('/api/v1/mobile/field/me/signature'));
    expect(resolvida.path.split('/api/v1').length - 1, 1);
  });

  test('um destino externo fica intocado', () {
    /*
     * A asserção que impede a tradução de virar um sequestro. Com S3 ou MinIO
     * de verdade o host é a informação essencial, e reescrevê-lo mandaria os
     * bytes para o lugar errado — silenciosamente.
     */
    final externa = Uri.parse(
      'https://bucket.s3.amazonaws.com/org/signature.png?X-Amz-Signature=abc',
    );

    expect(resolveBackendUrl(externa, _base), externa);
  });

  test('barra final na base não dobra a barra do caminho', () {
    final resolvida = resolveBackendUrl(
      Uri.parse('/api/v1/storage/objects?key=k'),
      Uri.parse('http://10.0.2.2:6001/api/v1/'),
    );

    expect(resolvida.path, '/api/v1/storage/objects');
  });

  test('base sem prefixo não reescreve nada', () {
    /* Sem prefixo, qualquer caminho "começa" com ele — e tudo viraria candidato
       a reescrita, inclusive o endereço de um bucket externo. */
    final externa = Uri.parse('https://exemplo.com/arquivo.png');

    expect(
      resolveBackendUrl(externa, Uri.parse('http://10.0.2.2:6001')),
      externa,
    );
  });
}
