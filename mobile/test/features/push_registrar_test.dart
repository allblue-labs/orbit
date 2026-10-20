/// O registro deste aparelho para receber avisos.
library;

import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/contracts/mobile_push_device_contracts.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/core/push/push_channel.dart';
import 'package:orbit_operator/features/notifications/application/push_registrar.dart';
import 'package:orbit_operator/features/notifications/data/mobile_device_repository.dart';

import '../support/fakes.dart';
import '../support/scripted_adapter.dart';

/// Uma fonte de token controlada pelo teste.
/// Tokens com o comprimento mínimo que o contrato exige (20).
const tokenA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const tokenB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

class FonteFalsa implements PushTokenSource {
  FonteFalsa({this.permitido = true, this.inicial = tokenA});

  bool permitido;
  String? inicial;
  final _refresh = StreamController<String>.broadcast();

  int permissoesPedidas = 0;

  @override
  MobilePushProvider get provider => MobilePushProvider.apns;

  @override
  Future<bool> requestPermission() async {
    permissoesPedidas += 1;
    return permitido;
  }

  @override
  Future<String?> token() async => inicial;

  @override
  Stream<String> get onTokenRefresh => _refresh.stream;

  @override
  Stream<String> get onDeepLink => const Stream<String>.empty();

  void rotacionar(String novo) => _refresh.add(novo);

  Future<void> fechar() => _refresh.close();
}

class Backend {
  final chamadas = <({String method, String path, Object? body})>[];
  int status = 200;

  Future<ResponseBody> call(RequestOptions options) async {
    chamadas.add((
      method: options.method,
      path: options.uri.path,
      body: options.data,
    ));
    if (status != 200) {
      return jsonResponse({
        'success': false,
        'error': {'code': 'SERVICE_UNAVAILABLE', 'message': 'Indisponível.'},
      }, status: status);
    }
    return jsonResponse({'success': true, 'data': const {}});
  }
}

({PushRegistrar registrar, Backend backend}) montar(FonteFalsa fonte) {
  final backend = Backend();
  final dio = Dio()..httpClientAdapter = ScriptedAdapter(backend.call);
  final plain = Dio()..httpClientAdapter = ScriptedAdapter(backend.call);
  final client = OrbitApiClient.create(
    environment: OrbitEnvironment.fromDefines(),
    storage: InMemoryTokenStorage(),
    logger: const OrbitLogger(isProduction: true),
    dio: dio,
    retryDio: plain,
  );

  return (
    registrar: PushRegistrar(
      source: fonte,
      repository: MobileDeviceRepository(client: client),
      logger: const OrbitLogger(isProduction: true),
      deviceInstanceId: () async => 'instalacao-de-teste-0001',
      appVersion: () async => '1.4.0+42',
    ),
    backend: backend,
  );
}

/// Espera uma condição acontecer, com teto.
Future<void> _ate(bool Function() pronto, {int tentativas = 100}) async {
  for (var i = 0; i < tentativas && !pronto(); i++) {
    await Future<void>.delayed(const Duration(milliseconds: 5));
  }
}

void main() {
  test('entrar registra o token deste aparelho', () async {
    final fonte = FonteFalsa();
    addTearDown(fonte.fechar);
    final (:registrar, :backend) = montar(fonte);

    await registrar.start();

    final pedido = backend.chamadas.single;
    expect(pedido.method, 'POST');
    expect(pedido.path, endsWith('/mobile/devices'));

    final corpo = pedido.body as Map<String, dynamic>;
    expect(corpo['pushToken'], tokenA);
    expect(corpo['deviceInstanceId'], 'instalacao-de-teste-0001');
    expect(corpo['appVersion'], '1.4.0+42');

    /// O provedor vem da fonte, não de um palpite sobre a plataforma: é o
    /// que separa um token do APNs de um do Firebase no servidor.
    expect(corpo['pushProvider'], 'APNS');
  });

  test('permissão negada não registra nada', () async {
    /// Registrar sem permissão guardaria no servidor um token que o sistema
    /// nunca vai aceitar — e o backend passaria a contar falhas de entrega
    /// para um aparelho que apenas disse não.
    final fonte = FonteFalsa(permitido: false);
    addTearDown(fonte.fechar);
    final (:registrar, :backend) = montar(fonte);

    await registrar.start();

    expect(backend.chamadas, isEmpty);
  });

  test('sem token, não registra', () async {
    final fonte = FonteFalsa(inicial: null);
    addTearDown(fonte.fechar);
    final (:registrar, :backend) = montar(fonte);

    await registrar.start();

    expect(backend.chamadas, isEmpty);
  });

  test('abrir de novo com o mesmo token não repete o POST', () async {
    /// O aplicativo restaura a sessão a cada abertura. Sem esta guarda, é
    /// uma requisição por abertura para dizer o que o servidor já sabe.
    final fonte = FonteFalsa();
    addTearDown(fonte.fechar);
    final (:registrar, :backend) = montar(fonte);

    await registrar.start();
    await registrar.start();

    expect(backend.chamadas, hasLength(1));
    expect(fonte.permissoesPedidas, 2);
  });

  test('token trocado pelo sistema é re-registrado', () async {
    /// O sistema troca o token sozinho — reinstalação, restauração de
    /// backup, atualização do sistema. Sem ouvir isso, o aparelho para de
    /// receber avisos e ninguém descobre até alguém reclamar.
    final fonte = FonteFalsa();
    addTearDown(fonte.fechar);
    final (:registrar, :backend) = montar(fonte);

    await registrar.start();
    fonte.rotacionar(tokenB);

    /// O evento atravessa o stream e uma requisição: um `Duration.zero` não
    /// basta, e um `delayed` fixo esconderia lentidão real.
    await _ate(() => backend.chamadas.length >= 2);

    expect(backend.chamadas, hasLength(2));
    expect(
      (backend.chamadas.last.body as Map<String, dynamic>)['pushToken'],
      tokenB,
    );
  });

  test('sair revoga o vínculo deste aparelho', () async {
    /// O token é do aparelho; o vínculo é da pessoa. Sem revogar, quem sai
    /// continua recebendo os avisos de quem entrar depois.
    final fonte = FonteFalsa();
    addTearDown(fonte.fechar);
    final (:registrar, :backend) = montar(fonte);

    await registrar.start();
    await registrar.stop();

    final ultima = backend.chamadas.last;
    expect(ultima.method, 'DELETE');
    expect(ultima.path, endsWith('/mobile/devices/instalacao-de-teste-0001'));
  });

  test('depois de sair, o mesmo token é registrado de novo', () async {
    /// Sem limpar a memória do último token, trocar de conta no mesmo
    /// aparelho deixaria o novo usuário sem avisos: o registrador acharia
    /// que já havia registrado.
    final fonte = FonteFalsa();
    addTearDown(fonte.fechar);
    final (:registrar, :backend) = montar(fonte);

    await registrar.start();
    await registrar.stop();
    await registrar.start();

    expect(backend.chamadas.where((c) => c.method == 'POST'), hasLength(2));
  });

  test('falha ao registrar não sobe para a tela', () async {
    /// Push é conveniência: o trabalho está na lista de qualquer jeito, e
    /// quem abriu o aplicativo abriu para trabalhar, não para ler um erro
    /// sobre notificações.
    final fonte = FonteFalsa();
    addTearDown(fonte.fechar);
    final (:registrar, :backend) = montar(fonte);
    backend.status = 503;

    await expectLater(registrar.start(), completes);
  });
}
