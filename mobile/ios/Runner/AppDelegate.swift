import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)

    /// A ponte do push sobe junto com os plugins, e não no
    /// `didFinishLaunching`: ela precisa do `binaryMessenger`, que só existe
    /// depois de o motor do Flutter estar de pé.
    PushBridge.shared.register(
      with: engineBridge.pluginRegistry.registrar(forPlugin: "OrbitPush")!
    )
  }

  /// A Apple entregou o token deste aparelho.
  override func application(
    _ application: UIApplication,
    didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
  ) {
    PushBridge.shared.didRegister(deviceToken: deviceToken)
    super.application(
      application,
      didRegisterForRemoteNotificationsWithDeviceToken: deviceToken
    )
  }

  /// Falhou o registro — sem rede, sem entitlement, ou perfil sem push.
  ///
  /// Não vira erro de tela: o aplicativo funciona inteiro sem push, e quem
  /// abriu o Orbit abriu para trabalhar.
  override func application(
    _ application: UIApplication,
    didFailToRegisterForRemoteNotificationsWithError error: Error
  ) {
    NSLog("[orbit] push registration failed: %@", error.localizedDescription)
    super.application(
      application,
      didFailToRegisterForRemoteNotificationsWithError: error
    )
  }
}
