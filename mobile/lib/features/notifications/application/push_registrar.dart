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
    this.retryDelay = const Duration(seconds: 30),
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

  final Duration retryDelay;
  StreamSubscription<String>? _refresh;
  Timer? _retry;
  Future<void> _registration = Future.value();
  Future<void>? _starting;
  String? _latestToken;
  bool _permitted = false;

  /// O último token registrado, para não repetir o `POST` a cada abertura.
  String? _registrado;
  bool _active = true;
  int _generation = 0;

  /// Chamado quando há sessão.
  ///
  /// Idempotente: registrar o mesmo token duas vezes é uma requisição
  /// desperdiçada, e o aplicativo restaura a sessão a cada abertura.
  Future<void> start() {
    if (_starting case final pending?) return pending;
    late final Future<void> work;
    work = _start().whenComplete(() {
      if (identical(_starting, work)) _starting = null;
    });
    _starting = work;
    return work;
  }

  Future<void> _start() async {
    _active = true;
    final generation = _generation;
    _refresh ??= _source.onTokenRefresh.listen((token) {
      if (_permitted) unawaited(_registrar(token));
    });

    final permitted = await _source.requestPermission();
    if (!_active || generation != _generation) return;
    _permitted = permitted;
    if (!permitted) {
      _logger.info('push_permission_denied');
      return;
    }
    if (!_active || generation != _generation) return;
    final token = await _source.token();
    if (!_active || generation != _generation) return;
    if (token == null) {
      _logger.info('push_token_unavailable');
      return;
    }
    await _registrar(token);
  }

  Future<void> _registrar(String token) {
    _latestToken = token;
    final generation = _generation;
    _registration = _registration.then((_) async {
      if (!_active ||
          generation != _generation ||
          !_permitted ||
          _latestToken != token) {
        return;
      }
      await _register(token);
    });
    return _registration;
  }

  Future<void> _register(String token) async {
    if (!_active || token == _registrado) return;
    final generation = _generation;
    try {
      final id = await _deviceInstanceId();
      final version = await _appVersion();
      if (!_active || generation != _generation) return;
      await _repository.register(
        RegisterMobileDeviceRequest(
          deviceInstanceId: id,
          platform: defaultTargetPlatform == TargetPlatform.iOS
              ? MobilePlatform.ios
              : MobilePlatform.android,
          pushProvider: _source.provider,
          pushToken: token,
          appVersion: version,
          locale: PlatformDispatcher.instance.locale.toLanguageTag(),
          timezone: DateTime.now().timeZoneName,
        ),
      );
      if (!_active || generation != _generation) return;
      _registrado = token;
      _retry?.cancel();
      _retry = null;
      _logger.info('push_device_registered');
    } on Object catch (error) {
      /// Nunca o token no log: ele é credencial de entrega, e quem o tiver
      /// consegue mandar aviso para este aparelho.
      _logger.error('push_device_register_failed', error: error);
      if (_active && generation == _generation) {
        _retry?.cancel();
        _retry = Timer(retryDelay, () {
          final latest = _latestToken;
          if (_active && latest != null) unawaited(_registrar(latest));
        });
      }
    }
  }

  /// Chamado no logout, **antes** de a sessão sumir: a chamada precisa do
  /// token de acesso que está prestes a ser descartado.
  Future<void> stop() async {
    _active = false;
    _generation++;
    _permitted = false;
    _starting = null;
    _retry?.cancel();
    _retry = null;
    _latestToken = null;
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

  /// Stops callbacks even when credentials have already expired.
  void dispose() {
    _active = false;
    _generation++;
    _permitted = false;
    _starting = null;
    _retry?.cancel();
    _retry = null;
    _latestToken = null;
    unawaited(_refresh?.cancel());
    _refresh = null;
    _registrado = null;
  }
}
