/// Para onde os bytes vão de verdade.
///
/// `backend_url_test` prende a regra; isto prende que o cliente a **usa** — nos
/// dois verbos que falam com endereços entregues pelo servidor. Sem este nível,
/// a regra poderia estar certa e nenhum upload passar por ela.
library;

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';

import '../support/fakes.dart';
import '../support/scripted_adapter.dart';

void main() {
  late List<Uri> pedidos;
  late OrbitApiClient client;

  setUp(() {
    pedidos = [];
    Future<ResponseBody> handler(RequestOptions options) async {
      pedidos.add(options.uri);
      return ResponseBody.fromString('', 200);
    }

    /*
     * `Dio` injetado **sem** `baseUrl`, de propósito: é como `create` o deixa
     * quando recebe um de fora. Se a tradução dependesse de `_dio.options`,
     * este teste mostraria o endereço relativo — e é o que acontecia.
     */
    final dio = Dio()..httpClientAdapter = ScriptedAdapter(handler);
    final plain = Dio()..httpClientAdapter = ScriptedAdapter(handler);
    client = OrbitApiClient.create(
      environment: OrbitEnvironment.fromDefines(),
      storage: InMemoryTokenStorage(),
      logger: const OrbitLogger(isProduction: true),
      dio: dio,
      retryDio: plain,
    );
  });

  test('o upload vai para o host que o aparelho alcança', () async {
    /*
     * O provedor local assina com `localhost`, que no aparelho é o próprio
     * aparelho. Era isto que produzia "sem internet" ao cadastrar assinatura ou
     * foto de perfil — as duas passam por aqui.
     */
    await client.putBytes(
      url: Uri.parse(
        'http://localhost:6001/api/v1/storage/objects'
        '?bucket=b&key=k&operation=upload&expires=1&signature=abc',
      ),
      bytes: const [1, 2, 3],
      headers: const {'content-type': 'image/png'},
    );

    final destino = pedidos.single;
    expect(destino.host, isNot('localhost'));
    expect(destino.path, '/api/v1/storage/objects');
    expect(destino.queryParameters['signature'], 'abc');
  });

  test('a leitura não duplica o prefixo da API', () async {
    /* A prévia da assinatura vem como `/api/v1/...`, e o Dio concatena com uma
       base que já termina em `/api/v1`. */
    await client.getBytes(
      url: Uri.parse('/api/v1/mobile/field/me/signature/preview?expires=1'),
    );

    final destino = pedidos.single;
    expect(destino.path, '/api/v1/mobile/field/me/signature/preview');
    expect(destino.hasAuthority, isTrue);
  });

  test('um destino externo continua externo', () async {
    final externa = Uri.parse(
      'https://bucket.s3.amazonaws.com/org/x.png?X-Amz-Signature=abc',
    );

    await client.putBytes(
      url: externa,
      bytes: const [1],
      headers: const {'content-type': 'image/png'},
    );

    expect(pedidos.single.host, 'bucket.s3.amazonaws.com');
  });
}
