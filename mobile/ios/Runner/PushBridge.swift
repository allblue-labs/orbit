import Flutter
import UIKit
import UserNotifications

import FirebaseCore
import FirebaseMessaging

/// Firebase is the single delivery provider on Android and iOS. APNs tokens
/// stay inside the Apple SDK; only the associated FCM token crosses to Dart.
final class PushBridge: NSObject {
  static let shared = PushBridge()

  private var tokenSink: FlutterEventSink?
  private var linkSink: FlutterEventSink?
  fileprivate var messageSink: FlutterEventSink?

  /// O token mais recente. Guardado porque ele pode chegar **antes** de o
  /// Dart perguntar — o sistema responde ao registro quando quer.
  private var currentToken: String?
  private var configured = false

  func configureFirebase() {
    guard Bundle.main.object(forInfoDictionaryKey: "OrbitPushEnabled") as? String == "YES",
          let path = Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist"),
          let options = FirebaseOptions(contentsOfFile: path) else { return }
    if FirebaseApp.app() == nil { FirebaseApp.configure(options: options) }
    Messaging.messaging().delegate = self
    configured = true
    UNUserNotificationCenter.current().delegate = self
  }

  private func fcmToken(_ result: @escaping FlutterResult) {
    guard configured, Messaging.messaging().apnsToken != nil else { result(nil); return }
    Messaging.messaging().token { [weak self] token, error in
      DispatchQueue.main.async {
        guard error == nil, let token = token else { result(nil); return }
        self?.currentToken = token
        result(token)
      }
    }
  }

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
        self?.fcmToken(result)
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

    FlutterEventChannel(name: "orbit/push/received", binaryMessenger: registrar.messenger()).setStreamHandler(MessageStreamHandler())
    UNUserNotificationCenter.current().delegate = self
  }

  private func requestPermission(_ result: @escaping FlutterResult) {
    guard configured else { result(false); return }
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
    guard configured else { return }
    Messaging.messaging().apnsToken = deviceToken
    Messaging.messaging().isAutoInitEnabled = true
    // Request again after APNs association; do not publish its raw hex token.
    Messaging.messaging().token { [weak self] token, error in
      guard error == nil, let token = token else { return }
      DispatchQueue.main.async { self?.publish(token: token) }
    }
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
    let keys = ["deepLink", "notificationId", "organizationId", "recipientUserId"]
    let payload = keys.reduce(into: [String: String]()) { result, key in
      if let value = userInfo[key] as? String { result[key] = value }
    }
    guard let data = try? JSONSerialization.data(withJSONObject: payload),
          let event = String(data: data, encoding: .utf8) else { return }
    emit(link: event)
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
    if let id = notification.request.content.userInfo["notificationId"] as? String { messageSink?(id) }
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

private final class MessageStreamHandler: NSObject, FlutterStreamHandler {
  func onListen(withArguments arguments: Any?, eventSink events: @escaping FlutterEventSink) -> FlutterError? { PushBridge.shared.messageSink = events; return nil }
  func onCancel(withArguments arguments: Any?) -> FlutterError? { PushBridge.shared.messageSink = nil; return nil }
}


extension PushBridge: MessagingDelegate {
  private func publish(token: String) {
    guard configured, Messaging.messaging().apnsToken != nil else { return }
    currentToken = token
    tokenSink?(token)
  }

  func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
    guard let token = fcmToken else { return }
    DispatchQueue.main.async { [weak self] in self?.publish(token: token) }
  }
}
