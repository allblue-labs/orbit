import Flutter
import UIKit
import UserNotifications

/// A ponte entre o APNs e o Dart.
///
/// ## Por que não há Firebase aqui
///
/// O backend do Orbit aceita `APNS` como provedor. O token que ele precisa é
/// o que a Apple entrega em `didRegisterForRemoteNotificationsWithDeviceToken`
/// — Firebase serviria para traduzi-lo num token do Google, que o servidor
/// teria de traduzir de volta.
///
/// ## Três canais
///
/// ```text
/// orbit/push         requestPermission, token   (chamada e resposta)
/// orbit/push/token   o token, quando o sistema o troca
/// orbit/push/link    o caminho do aviso que a pessoa tocou
/// ```
final class PushBridge: NSObject {
  static let shared = PushBridge()

  private var tokenSink: FlutterEventSink?
  private var linkSink: FlutterEventSink?

  /// O token mais recente. Guardado porque ele pode chegar **antes** de o
  /// Dart perguntar — o sistema responde ao registro quando quer.
  private var currentToken: String?

  /// O toque que abriu o aplicativo, guardado até o Dart estar ouvindo.
  ///
  /// Sem isto, tocar num aviso com o aplicativo fechado abre a tela inicial:
  /// o evento acontece antes de a árvore de widgets existir.
  private var pendingLink: String?

  func register(with registrar: FlutterPluginRegistrar) {
    let methods = FlutterMethodChannel(
      name: "orbit/push",
      binaryMessenger: registrar.messenger()
    )
    methods.setMethodCallHandler { [weak self] call, result in
      switch call.method {
      case "requestPermission":
        self?.requestPermission(result)
      case "token":
        result(self?.currentToken)
      default:
        result(FlutterMethodNotImplemented)
      }
    }

    FlutterEventChannel(
      name: "orbit/push/token",
      binaryMessenger: registrar.messenger()
    ).setStreamHandler(TokenStreamHandler())

    FlutterEventChannel(
      name: "orbit/push/link",
      binaryMessenger: registrar.messenger()
    ).setStreamHandler(LinkStreamHandler())

    UNUserNotificationCenter.current().delegate = self
  }

  private func requestPermission(_ result: @escaping FlutterResult) {
    UNUserNotificationCenter.current().requestAuthorization(
      options: [.alert, .badge, .sound]
    ) { granted, _ in
      DispatchQueue.main.async {
        guard granted else {
          result(false)
          return
        }
        /// O registro no APNs só acontece depois do consentimento. Pedir
        /// antes rende um token que o sistema nunca usará.
        UIApplication.shared.registerForRemoteNotifications()
        result(true)
      }
    }
  }

  /// Chamado pelo `AppDelegate` quando a Apple entrega o token.
  func didRegister(deviceToken: Data) {
    let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
    currentToken = hex
    tokenSink?(hex)
  }

  fileprivate func attach(tokenSink: @escaping FlutterEventSink) {
    self.tokenSink = tokenSink
    /// O token pode ter chegado antes desta escuta começar.
    if let token = currentToken { tokenSink(token) }
  }

  fileprivate func detachTokenSink() { tokenSink = nil }

  fileprivate func attach(linkSink: @escaping FlutterEventSink) {
    self.linkSink = linkSink
    if let link = pendingLink {
      pendingLink = nil
      linkSink(link)
    }
  }

  fileprivate func detachLinkSink() { linkSink = nil }

  private func emit(link: String) {
    if let sink = linkSink {
      sink(link)
    } else {
      pendingLink = link
    }
  }

  /// O caminho vem do payload que o servidor publica (`deepLink`). Um aviso
  /// sem ele abre a caixa de avisos, decisão que é do Dart.
  fileprivate func handle(userInfo: [AnyHashable: Any]) {
    guard let link = userInfo["deepLink"] as? String, !link.isEmpty else {
      return
    }
    emit(link: link)
  }
}

extension PushBridge: UNUserNotificationCenterDelegate {
  /// Com o aplicativo aberto, o aviso continua aparecendo.
  ///
  /// Sem isto o iOS o engole silenciosamente, e quem está com o Orbit na
  /// mão é justamente quem mais precisa saber que chegou trabalho novo.
  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler:
      @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    completionHandler([.banner, .list, .sound])
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    handle(userInfo: response.notification.request.content.userInfo)
    completionHandler()
  }
}

private final class TokenStreamHandler: NSObject, FlutterStreamHandler {
  func onListen(
    withArguments arguments: Any?,
    eventSink events: @escaping FlutterEventSink
  ) -> FlutterError? {
    PushBridge.shared.attach(tokenSink: events)
    return nil
  }

  func onCancel(withArguments arguments: Any?) -> FlutterError? {
    PushBridge.shared.detachTokenSink()
    return nil
  }
}

private final class LinkStreamHandler: NSObject, FlutterStreamHandler {
  func onListen(
    withArguments arguments: Any?,
    eventSink events: @escaping FlutterEventSink
  ) -> FlutterError? {
    PushBridge.shared.attach(linkSink: events)
    return nil
  }

  func onCancel(withArguments arguments: Any?) -> FlutterError? {
    PushBridge.shared.detachLinkSink()
    return nil
  }
}
