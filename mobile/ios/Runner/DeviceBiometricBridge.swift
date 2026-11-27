import CryptoKit
import Flutter
import LocalAuthentication
import Security

final class DeviceBiometricBridge {
  private let queue = DispatchQueue(label: "com.allbluelabs.orbit.biometric-keys")
  private let keyIdPattern = #"^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$"#
  private let challengePattern = #"^orbit-device-v1\.[A-Za-z0-9_-]{43}$"#

  static func register(with registrar: FlutterPluginRegistrar) {
    let bridge = DeviceBiometricBridge()
    FlutterMethodChannel(name: "orbit/device_biometrics", binaryMessenger: registrar.messenger())
      .setMethodCallHandler { call, result in
        bridge.queue.async {
          let response = bridge.handle(call)
          DispatchQueue.main.async { result(response) }
        }
      }
  }

  private func handle(_ call: FlutterMethodCall) -> Any? {
    switch call.method {
    case "isAvailable":
      return isAvailable()
    case "createKey":
      return createKey()
    case "deleteKey", "sign":
      guard let arguments = call.arguments as? [String: String],
            let keyId = arguments["keyId"],
            keyId.range(of: keyIdPattern, options: .regularExpression) != nil else {
        return unavailable()
      }
      if call.method == "deleteKey" {
        let status = SecItemDelete(keyQuery(keyId) as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound ? nil : unavailable()
      }
      guard let challenge = arguments["challenge"],
            challenge.range(of: challengePattern, options: .regularExpression) != nil,
            let reason = arguments["reason"] else {
        return unavailable()
      }
      return sign(keyId, challenge: challenge, reason: reason)
    default:
      return FlutterMethodNotImplemented
    }
  }

  private func isAvailable() -> Bool {
    SecureEnclave.isAvailable &&
      LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
  }

  private func createKey() -> Any {
    guard isAvailable(),
          let access = SecAccessControlCreateWithFlags(
            nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
            [.privateKeyUsage, .biometryCurrentSet], nil
          ) else { return unavailable() }
    let keyId = UUID().uuidString.lowercased()
    let attributes: [String: Any] = [
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeySizeInBits as String: 256,
      kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
      kSecPrivateKeyAttrs as String: [
        kSecAttrIsPermanent as String: true,
        kSecAttrApplicationTag as String: tag(keyId),
        kSecAttrAccessControl as String: access,
      ],
    ]
    guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, nil) else {
      return unavailable()
    }
    guard let publicKey = SecKeyCopyPublicKey(key),
          let bytes = SecKeyCopyExternalRepresentation(publicKey, nil) as Data?,
          bytes.count == 65, bytes.first == 4 else {
      SecItemDelete(keyQuery(keyId) as CFDictionary)
      return unavailable()
    }
    return ["keyId": keyId, "publicKey": encode(bytes)]
  }

  private func sign(_ keyId: String, challenge: String, reason: String) -> Any? {
    let context = LAContext()
    context.localizedReason = reason
    context.localizedFallbackTitle = ""
    defer { context.invalidate() }

    var query = keyQuery(keyId)
    query[kSecUseAuthenticationContext as String] = context
    query[kSecReturnRef as String] = true
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecUserCanceled { return nil }
    if status == errSecItemNotFound { return missingKey() }
    guard status == errSecSuccess, let item, CFGetTypeID(item) == SecKeyGetTypeID() else {
      return unavailable()
    }
    let key = item as! SecKey
    var failure: Unmanaged<CFError>?
    guard let signature = SecKeyCreateSignature(
      key, .ecdsaSignatureMessageX962SHA256, Data(challenge.utf8) as CFData, &failure
    ) as Data? else {
      if let failure {
        let error = failure.takeRetainedValue() as Error as NSError
        if error.domain == LAError.errorDomain &&
          [LAError.userCancel, .appCancel, .systemCancel].contains(where: { $0.rawValue == error.code }) { return nil }
        if error.domain == NSOSStatusErrorDomain {
          if error.code == Int(errSecUserCanceled) { return nil }
          if error.code == Int(errSecItemNotFound) { return missingKey() }
        }
      }
      return unavailable()
    }
    return encode(signature)
  }

  private func keyQuery(_ keyId: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassKey,
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
      kSecAttrApplicationTag as String: tag(keyId),
    ]
  }

  private func tag(_ keyId: String) -> Data { Data("orbit.biometric.device.v1.\(keyId)".utf8) }

  private func encode(_ data: Data) -> String {
    data.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  private func unavailable() -> FlutterError {
    FlutterError(code: "BIOMETRIC_UNAVAILABLE", message: nil, details: nil)
  }

  private func missingKey() -> FlutterError {
    FlutterError(code: "KEY_UNAVAILABLE", message: nil, details: nil)
  }
}
