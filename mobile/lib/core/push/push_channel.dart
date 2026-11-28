/// Native Firebase Messaging bridge. Both Android and iOS expose FCM tokens.
/// APNs registration is associated privately by the iOS SDK, never sent as FCM.
/// Local builds without push return empty; distribution is checked at build time.
library;

import 'dart:async';

import 'package:flutter/services.dart';

import '../contracts/mobile_push_device_contracts.dart';

/// De onde o token vem. Abstrato para que o registrador seja testável sem
/// um aparelho — e para que trocar APNs por FCM não mexa em quem o usa.
abstract interface class PushTokenSource {
  /// Pede a permissão ao sistema. `false` quando a pessoa recusa.
  Future<bool> requestPermission();

  /// O token atual, ou `null` quando não há permissão nem parte nativa.
  Future<String?> token();

  /// O sistema troca o token sozinho — reinstalação, restauração de backup,
  /// atualização do sistema. Sem ouvir isto, o aparelho para de receber
  /// avisos e ninguém descobre até alguém reclamar.
  Stream<String> get onTokenRefresh;

  /// O caminho interno do aviso que a pessoa tocou.
  Stream<String> get onDeepLink;

  /// Qual provedor este aparelho usa.
  MobilePushProvider get provider;
}

/// A implementação sobre o canal nativo.
abstract interface class PushMessageSource {
  Stream<String> get onNotificationReceived;
}

class PushChannel implements PushTokenSource, PushMessageSource {
  PushChannel({
    MethodChannel? canal,
    EventChannel? tokens,
    EventChannel? links,
  }) : _canal = canal ?? const MethodChannel('orbit/push'),
       _tokens = tokens ?? const EventChannel('orbit/push/token'),
       _links = links ?? const EventChannel('orbit/push/link');

  final MethodChannel _canal;
  final EventChannel _tokens;
  final EventChannel _links;

  // One broadcast subscription per native channel survives overlapping session
  // teardown/startup. Cancelling the old account cannot detach the new listener.
  late final Stream<String> _receiptEvents = _strings(
    const EventChannel('orbit/push/received'),
  );
  late final Stream<String> _tokenEvents = _strings(_tokens);
  late final Stream<String> _linkEvents = _strings(_links);

  static Stream<String> _strings(EventChannel channel) => channel
      .receiveBroadcastStream()
      .where((value) => value is String && value.isNotEmpty)
      .cast<String>()
      .handleError((Object _) {});

  @override
  Stream<String> get onNotificationReceived => _receiptEvents;

  @override
  MobilePushProvider get provider => MobilePushProvider.fcm;

  @override
  Future<bool> requestPermission() async {
    try {
      return await _canal.invokeMethod<bool>('requestPermission') ?? false;
    } on PlatformException {
      return false;
    } on MissingPluginException {
      /// A parte nativa não existe nesta plataforma. Não é erro.
      return false;
    }
  }

  @override
  Future<String?> token() async {
    try {
      return await _canal.invokeMethod<String>('token');
    } on PlatformException {
      return null;
    } on MissingPluginException {
      return null;
    }
  }

  @override
  Stream<String> get onTokenRefresh => _tokenEvents;

  @override
  Stream<String> get onDeepLink => _linkEvents;
}

/// A fonte que não faz nada.
///
/// Usada onde não há sistema de notificação — testes, e o Android enquanto
/// as credenciais do Firebase não existirem.
class SilentPushTokenSource implements PushTokenSource {
  const SilentPushTokenSource();

  @override
  MobilePushProvider get provider => MobilePushProvider.fcm;

  @override
  Future<bool> requestPermission() async => false;

  @override
  Future<String?> token() async => null;

  @override
  Stream<String> get onTokenRefresh => const Stream<String>.empty();

  @override
  Stream<String> get onDeepLink => const Stream<String>.empty();
}
