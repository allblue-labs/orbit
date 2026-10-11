/// Perfil: editar os próprios dados e escolher os avisos.
library;

import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/app/providers.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/features/profile/application/notification_settings_providers.dart';
import 'package:orbit_operator/features/profile/application/profile_providers.dart';
import 'package:orbit_operator/features/profile/data/notification_preferences_repository.dart';

import '../support/fakes.dart';
import '../support/scripted_adapter.dart';

/// Registra o que o aplicativo mandou, e responde o que o servidor mandaria.
class Backend {
  Backend({this.comFoto = true});

  /// A organização tem foto cadastrada? Separa "não tem" de "não carregou".
  final bool comFoto;

  final pedidos = <({String method, String path, Object? body})>[];

  Future<ResponseBody> call(RequestOptions options) async {
    pedidos.add((
      method: options.method,
      path: options.uri.path,
      body: options.data,
    ));

    if (options.uri.path.endsWith('/notifications/preferences')) {
      return jsonResponse({
        'success': true,
        'data': [
          {
            'type': 'WORK_ASSIGNED',
            'enabled': true,
            'channels': ['IN_APP', 'PUSH'],
          },
          {
            'type': 'SYNC_ATTENTION_REQUIRED',
            'enabled': false,
            'channels': <String>[],
          },
        ],
      });
    }

    /// A reserva do avatar, no formato que o servidor devolve de verdade:
    /// `fileId` na raiz e o resto sob `upload`. É a forma que `files.reserve`
    /// produz, a mesma da reserva da assinatura.
    if (options.uri.path.endsWith('/identity/me/avatar/uploads')) {
      return jsonResponse({
        'success': true,
        'data': {
          'fileId': 'storage-file-7',
          'upload': {
            'url': 'https://storage.example.com/avatars/storage-file-7',
            'expiresAt': '2026-10-04T23:59:00.000Z',
            'method': 'PUT',
            'requiredHeaders': {'x-amz-acl': 'private'},
          },
        },
      });
    }

    /// A foto atual: endereço assinado e o prazo dele.
    if (options.uri.path.endsWith('/identity/me/avatar')) {
      return jsonResponse({
        'success': true,
        'data': {
          'available': comFoto,
          /* O endereço vai mesmo quando `available` é falso: é o que torna a
             checagem de disponibilidade observável. */
          'url': 'http://localhost:6001/api/v1/storage/objects?key=k',
          'expiresAt': DateTime.now()
              .toUtc()
              .add(const Duration(minutes: 5))
              .toIso8601String(),
          'updatedAt': '2026-10-04T12:00:00.000Z',
        },
      });
    }

    if (options.uri.path.endsWith('/storage/objects')) {
      return ResponseBody.fromBytes(const [137, 80, 78, 71], 200);
    }

    if (options.uri.path.endsWith('/identity/me')) {
      return jsonResponse({
        'success': true,
        'data': {
          'id': 'user-1',
          'email': 'tecnico@acme.com',
          'displayName': 'Marina D. Duarte',
          'firstName': 'Marina',
          'lastName': 'Duarte',
          'phone': '+55 81 99999-0000',
        },
      });
    }

    return jsonResponse({'success': true, 'data': const {}});
  }
}

ProviderContainer containerCom(Backend backend) {
  final dio = Dio()..httpClientAdapter = ScriptedAdapter(backend.call);
  final plain = Dio()..httpClientAdapter = ScriptedAdapter(backend.call);
  final client = OrbitApiClient.create(
    environment: OrbitEnvironment.fromDefines(),
    storage: InMemoryTokenStorage(),
    logger: const OrbitLogger(isProduction: true),
    dio: dio,
    retryDio: plain,
  );
  final container = ProviderContainer(
    overrides: [apiClientProvider.overrideWithValue(client)],
  );
  addTearDown(container.dispose);

  /// Segura os provedores `autoDispose`, que é o que a tela faz ao observá-los.
  /// Sem isto eles são descartados entre a leitura e a resposta, e o teste
  /// falha por um motivo que o produto não tem.
  container.listen(profileEditControllerProvider, (_, __) {});
  container.listen(avatarBytesProvider, (_, __) {});
  container.listen(notificationSettingsControllerProvider, (_, __) {});
  container.listen(notificationPreferencesProvider, (_, __) {});
  return container;
}

void main() {
  group('meus dados', () {
    test('salvar manda só o que foi informado', () async {
      final backend = Backend();
      final container = containerCom(backend);

      await container
          .read(profileEditControllerProvider.notifier)
          .save(displayName: 'Marina D. Duarte', phone: '+55 81 99999-0000');

      final pedido = backend.pedidos.last;
      expect(pedido.method, 'PATCH');
      expect(pedido.path, endsWith('/identity/me'));

      final corpo = pedido.body as Map<String, dynamic>;
      expect(corpo['displayName'], 'Marina D. Duarte');
      expect(corpo['phone'], '+55 81 99999-0000');

      /// Campo não preenchido não vai como `null`: o `PATCH` apagaria o
      /// sobrenome de quem só quis corrigir o telefone.
      expect(corpo.containsKey('firstName'), isFalse);
      expect(corpo.containsKey('lastName'), isFalse);
    });

    test('a resposta do servidor é o que vale, não o que foi digitado', () {
      /// O `PATCH` devolve o perfil como ficou — com a normalização que o
      /// servidor fizer. Aplicar o texto do formulário em vez da resposta
      /// mostraria na tela algo diferente do que foi gravado.
      ///
      /// Que esse usuário chegue à sessão é assunto do `AuthController`, e
      /// está preso em `auth_controller_test.dart` — 'applyUser troca o
      /// usuário sem recompor o resto da sessão'.
      final backend = Backend();
      final container = containerCom(backend);

      return expectLater(
        container
            .read(profileRepositoryProvider)
            .update(displayName: 'marina d. duarte')
            .then((usuario) => usuario.displayName),
        completion('Marina D. Duarte'),
      );
    });
  });

  group('foto de perfil', () {
    /// A leitura da reserva, que é onde a troca de foto quebrava.
    ///
    /// O servidor responde `{ fileId, upload: { url, requiredHeaders } }`, e a
    /// leitura antiga procurava `storageObjectId`, `uploadUrl` e `headers` na raiz.
    /// Com `?? ''` em cada campo, o resultado não era erro: era um bilhete vazio.
    test('lê o id e a URL de dentro de "upload"', () async {
      final backend = Backend();
      final container = containerCom(backend);

      final ticket = await container
          .read(profileRepositoryProvider)
          .reserveAvatar(
            fileName: 'avatar.png',
            mimeType: 'image/png',
            sizeBytes: 1024,
          );

      expect(ticket.storageObjectId, 'storage-file-7');
      expect(
        ticket.uploadUrl,
        'https://storage.example.com/avatars/storage-file-7',
      );
      expect(ticket.headers, {'x-amz-acl': 'private'});
    });

    /// O que o bilhete vazio causava, visto de fora.
    ///
    /// Esta é a asserção que importa: não que os campos sejam lidos, mas que os
    /// bytes cheguem ao endereço reservado. Com a leitura antiga, o `PUT` saía para
    /// string vazia e a ativação mandava id vazio — e nada disso levantava erro
    /// perto de onde o erro estava.
    test('manda os bytes para o endereço reservado e ativa aquele arquivo', () async {
      final backend = Backend();
      final container = containerCom(backend);

      final ok = await container
          .read(profileEditControllerProvider.notifier)
          .changePhoto(
            bytes: Uint8List.fromList(const [137, 80, 78, 71]),
            fileName: 'avatar.png',
            mimeType: 'image/png',
          );

      expect(ok, isTrue);

      final put = backend.pedidos.firstWhere(
        (pedido) => pedido.method == 'PUT' && pedido.path.contains('avatars'),
      );
      expect(put.path, '/avatars/storage-file-7');

      final ativacao = backend.pedidos.lastWhere(
        (pedido) =>
            pedido.method == 'PUT' && pedido.path.endsWith('/identity/me/avatar'),
      );
      expect(
        (ativacao.body as Map<String, dynamic>)['storageObjectId'],
        'storage-file-7',
      );
    });
  });

  /// A foto vem por bytes, e não por um endereço guardado.
  ///
  /// O endereço é assinado e vale cinco minutos. A sessão o guardava e o
  /// entregava a `Image.network` pelo resto do uso: passados os cinco minutos
  /// o `GET` respondia 403 e a tela caía nas iniciais, sem erro. A foto
  /// aparecia logo depois de trocada e sumia sozinha.
  group('foto exibida', () {
    test('busca o endereço na hora e devolve os bytes', () async {
      final backend = Backend();
      final container = containerCom(backend);

      final bytes = await container.read(avatarBytesProvider.future);

      expect(bytes, isNotNull);
      /* Pediu o endereço antes de buscar a imagem — não reusou um guardado. */
      expect(
        backend.pedidos.any(
          (p) => p.path.endsWith('/identity/me/avatar') && p.method == 'GET',
        ),
        isTrue,
      );
    });

    test('sem foto, devolve nulo sem buscar bytes', () async {
      /*
       * `available: false` manda, mesmo com endereço presente na resposta.
       * Buscar assim mesmo gastaria uma requisição para receber 404 — e, pior,
       * trataria "não tem foto" como "falhou ao carregar".
       */
      final backend = Backend(comFoto: false);
      final container = containerCom(backend);

      expect(await container.read(avatarBytesProvider.future), isNull);
      expect(
        backend.pedidos.any((p) => p.path.endsWith('/storage/objects')),
        isFalse,
      );
    });
  });

  group('avisos', () {
    test('tipo ausente na resposta segue ligado', () async {
      /// O servidor guarda só o que foi mexido. Desenhar "desligado" para o
      /// que nunca foi tocado faria a pessoa acreditar que não recebe avisos
      /// que recebe.
      final container = containerCom(Backend());
      final mapa = await container.read(notificationPreferencesProvider.future);

      expect(mapa['WORK_ASSIGNED']?.enabled, isTrue);
      expect(mapa['SYNC_ATTENTION_REQUIRED']?.enabled, isFalse);
      expect(mapa['ARTIFACT_AVAILABLE'], isNull);
      expect(
        mapa['ARTIFACT_AVAILABLE']?.enabled ?? true,
        isTrue,
        reason: 'ausente é o padrão do servidor, que é receber',
      );
    });

    test('desligar apaga todos os canais, não só o push', () async {
      /// Um interruptor rotulado "Novo atendimento" que continuasse mandando
      /// e-mail seria um interruptor quebrado.
      final backend = Backend();
      final container = containerCom(backend);

      await container
          .read(notificationSettingsControllerProvider.notifier)
          .toggle(type: 'WORK_ASSIGNED', enabled: false);

      final corpo =
          backend.pedidos.lastWhere((p) => p.method == 'PATCH').body
              as Map<String, dynamic>;
      expect(corpo['type'], 'WORK_ASSIGNED');
      expect(corpo['enabled'], isFalse);
      expect(corpo['channels'], isEmpty);
    });

    test('ligar manda a lista inteira de canais', () async {
      /// O contrato **substitui** a lista, não faz união: mandar só `PUSH`
      /// apagaria o aviso dentro do aplicativo.
      final backend = Backend();
      final container = containerCom(backend);

      await container
          .read(notificationSettingsControllerProvider.notifier)
          .toggle(type: 'ARTIFACT_AVAILABLE', enabled: true);

      final corpo =
          backend.pedidos.lastWhere((p) => p.method == 'PATCH').body
              as Map<String, dynamic>;
      expect(corpo['channels'], containsAll(['IN_APP', 'REALTIME', 'PUSH']));
    });

    test('os três tipos do app são os três que o backend empurra', () {
      expect(mobileNoticeCodes.values, [
        'WORK_ASSIGNED',
        'ARTIFACT_AVAILABLE',
        'SYNC_ATTENTION_REQUIRED',
      ]);
      for (final tipo in MobileNoticeKind.values) {
        expect(mobileNoticeLabels[tipo], isNotNull, reason: '$tipo sem rótulo');
      }
    });
  });
}
