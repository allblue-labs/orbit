/// A ponte com o sistema de notificação do aparelho.
///
/// ## Por que não há Firebase aqui
///
/// O backend aceita **APNS** como provedor (`MOBILE_PUSH_PROVIDERS`), então
/// no iOS o token vem direto do sistema: `registerForRemoteNotifications` e
/// pronto. Firebase resolveria o Android, e é onde ele continua necessário —
/// mas colocá-lo no caminho do iOS adicionaria um intermediário, um arquivo
/// de configuração e um SDK para obter um token que a Apple já entrega.
///
/// ## O que acontece sem a parte nativa
///
/// Tudo devolve vazio, e nada quebra. Um aplicativo que trava porque não há
/// push configurado é pior do que um sem push: o resto do trabalho continua
/// funcionando, e a ausência aparece na tela de Configurações, não num
/// diálogo de erro.
library;

import 'dart:async';

import 'package:flutter/foundation.dart';
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
class PushChannel implements PushTokenSource {
  PushChannel({
    MethodChannel? canal,
    EventChannel? tokens,
    EventChannel? links,
    TargetPlatform? plataforma,
  }) : _canal = canal ?? const MethodChannel('orbit/push'),
       _tokens = tokens ?? const EventChannel('orbit/push/token'),
       _links = links ?? const EventChannel('orbit/push/link'),
       _plataforma = plataforma ?? defaultTargetPlatform;

  final MethodChannel _canal;
  final EventChannel _tokens;
  final EventChannel _links;
  final TargetPlatform _plataforma;

  @override
  MobilePushProvider get provider => _plataforma == TargetPlatform.iOS
      ? MobilePushProvider.apns
      : MobilePushProvider.fcm;

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
  Stream<String> get onTokenRefresh => _tokens
      .receiveBroadcastStream()
      .map((evento) => evento as String?)
      .where((valor) => valor != null && valor.isNotEmpty)
      .cast<String>()
      .handleError((Object _) {});

  @override
  Stream<String> get onDeepLink => _links
      .receiveBroadcastStream()
      .map((evento) => evento as String?)
      .where((valor) => valor != null && valor.isNotEmpty)
      .cast<String>()
      .handleError((Object _) {});
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
