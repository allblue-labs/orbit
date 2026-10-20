/// Manter o servidor sabendo para onde mandar os avisos deste aparelho.
///
/// ## O ciclo
///
/// ```text
/// entrou     pede permissão → pega o token → registra
/// token novo re-registra (o sistema troca o token sozinho)
/// saiu       revoga
/// ```
///
/// ## Por que revogar no logout importa
///
/// O token é do **aparelho**; o vínculo é da pessoa. Sem revogar, quem sair
/// da conta continua recebendo no celular os avisos de trabalho de quem
/// entrou depois — e o nome do cliente aparece na tela de bloqueio, sem
/// desbloquear nada.
///
/// ## O que acontece quando falha
///
/// Nada visível. Push é conveniência: o trabalho está na lista de qualquer
/// jeito, e a pessoa abriu o aplicativo para trabalhar, não para ler um
/// erro sobre notificações. A falha vai para o log.
library;

import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../../core/contracts/mobile_push_device_contracts.dart';
import '../../../core/observability/orbit_logger.dart';
import '../../../core/push/push_channel.dart';
import '../data/mobile_device_repository.dart';

class PushRegistrar {
  PushRegistrar({
    required PushTokenSource source,
    required MobileDeviceRepository repository,
    required OrbitLogger logger,
    required Future<String> Function() deviceInstanceId,
    required Future<String> Function() appVersion,
  }) : _source = source,
       _repository = repository,
       _logger = logger,
       _deviceInstanceId = deviceInstanceId,
       _appVersion = appVersion;

  final PushTokenSource _source;
  final MobileDeviceRepository _repository;
  final OrbitLogger _logger;
  final Future<String> Function() _deviceInstanceId;
  final Future<String> Function() _appVersion;

  StreamSubscription<String>? _refresh;

  /// O último token registrado, para não repetir o `POST` a cada abertura.
  String? _registrado;

  /// Chamado quando há sessão.
  ///
  /// Idempotente: registrar o mesmo token duas vezes é uma requisição
  /// desperdiçada, e o aplicativo restaura a sessão a cada abertura.
  Future<void> start() async {
    _refresh ??= _source.onTokenRefresh.listen(_registrar);

    if (!await _source.requestPermission()) {
      _logger.info('push_permission_denied');
      return;
    }
    final token = await _source.token();
    if (token == null) {
      _logger.info('push_token_unavailable');
      return;
    }
    await _registrar(token);
  }

  Future<void> _registrar(String token) async {
    if (token == _registrado) return;
    try {
      await _repository.register(
        RegisterMobileDeviceRequest(
          deviceInstanceId: await _deviceInstanceId(),
          platform: defaultTargetPlatform == TargetPlatform.iOS
              ? MobilePlatform.ios
              : MobilePlatform.android,
          pushProvider: _source.provider,
          pushToken: token,
          appVersion: await _appVersion(),
          locale: PlatformDispatcher.instance.locale.toLanguageTag(),
          timezone: DateTime.now().timeZoneName,
        ),
      );
      _registrado = token;
      _logger.info('push_device_registered');
    } on Object catch (error) {
      /// Nunca o token no log: ele é credencial de entrega, e quem o tiver
      /// consegue mandar aviso para este aparelho.
      _logger.error('push_device_register_failed', error: error);
    }
  }

  /// Chamado no logout, **antes** de a sessão sumir: a chamada precisa do
  /// token de acesso que está prestes a ser descartado.
  Future<void> stop() async {
    await _refresh?.cancel();
    _refresh = null;
    final id = await _deviceInstanceId();
    _registrado = null;
    try {
      await _repository.revoke(id);
      _logger.info('push_device_revoked');
    } on Object catch (error) {
      _logger.error('push_device_revoke_failed', error: error);
    }
  }
}
