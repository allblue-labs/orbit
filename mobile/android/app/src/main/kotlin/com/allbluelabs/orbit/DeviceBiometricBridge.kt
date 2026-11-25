package com.allbluelabs.orbit

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.math.BigInteger
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.util.UUID

internal class DeviceBiometricBridge(
    private val activity: FragmentActivity,
    messenger: BinaryMessenger,
) {
    private val channel = MethodChannel(messenger, "orbit/device_biometrics")
    private var pending: MethodChannel.Result? = null
    private var prompt: BiometricPrompt? = null
    private val keyIdPattern = Regex("[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}")
    private val challengePattern = Regex("orbit-device-v1\\.[A-Za-z0-9_-]{43}")
    private val strong = BiometricManager.Authenticators.BIOMETRIC_STRONG

    init {
        channel.setMethodCallHandler(::handle)
    }

    private fun handle(call: MethodCall, result: MethodChannel.Result) {
        try {
            when (call.method) {
                "isAvailable" -> result.success(isAvailable())
                "createKey" -> result.success(createKey())
                "deleteKey" -> {
                    keyStore().deleteEntry(alias(keyId(call)))
                    result.success(null)
                }
                "sign" -> {
                    val challenge = requireNotNull(call.argument<String>("challenge"))
                    require(challengePattern.matches(challenge))
                    val reason = requireNotNull(call.argument<String>("reason"))
                    sign(keyId(call), challenge, reason, result)
                }
                else -> result.notImplemented()
            }
        } catch (_: KeyPermanentlyInvalidatedException) {
            result.error("KEY_UNAVAILABLE", null, null)
        } catch (_: Exception) {
            result.error("BIOMETRIC_UNAVAILABLE", null, null)
        }
    }

    private fun isAvailable() =
        BiometricManager.from(activity).canAuthenticate(strong) == BiometricManager.BIOMETRIC_SUCCESS

    private fun keyId(call: MethodCall): String = requireNotNull(call.argument<String>("keyId"))
        .also { require(keyIdPattern.matches(it)) }

    private fun keyStore() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun alias(keyId: String) = "orbit.biometric.device.v1.$keyId"

    @Suppress("DEPRECATION")
    private fun createKey(): Map<String, String> {
        check(isAvailable())
        val keyId = UUID.randomUUID().toString()
        val alias = alias(keyId)
        try {
            val spec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
                .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256)
                .setUserAuthenticationRequired(true)
            if (Build.VERSION.SDK_INT >= 30) {
                spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
            } else {
                spec.setUserAuthenticationValidityDurationSeconds(-1)
            }
            if (Build.VERSION.SDK_INT >= 24) spec.setInvalidatedByBiometricEnrollment(true)
            val pair = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
                .apply { initialize(spec.build()) }.generateKeyPair()
            val info = KeyFactory.getInstance(pair.private.algorithm, "AndroidKeyStore")
                .getKeySpec(pair.private, KeyInfo::class.java)
            check(info.isInsideSecureHardware && info.isUserAuthenticationRequirementEnforcedBySecureHardware)
            val point = (pair.public as ECPublicKey).w
            val publicKey = byteArrayOf(4) + fixedCoordinate(point.affineX) + fixedCoordinate(point.affineY)
            return mapOf("keyId" to keyId, "publicKey" to encode(publicKey))
        } catch (error: Exception) {
            runCatching { keyStore().deleteEntry(alias) }
            throw error
        }
    }

    private fun sign(keyId: String, challenge: String, reason: String, result: MethodChannel.Result) {
        check(pending == null)
        val key = keyStore().getKey(alias(keyId), null) as? PrivateKey
        if (key == null) {
            result.error("KEY_UNAVAILABLE", null, null)
            return
        }
        val signature = Signature.getInstance("SHA256withECDSA").apply { initSign(key) }
        val biometricPrompt = BiometricPrompt(
            activity, ContextCompat.getMainExecutor(activity),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(auth: BiometricPrompt.AuthenticationResult) {
                    val callback = takePending() ?: return
                    try {
                        val unlocked = checkNotNull(auth.cryptoObject?.signature)
                        unlocked.update(challenge.toByteArray(Charsets.US_ASCII))
                        callback.success(encode(unlocked.sign()))
                    } catch (_: Exception) {
                        callback.error("BIOMETRIC_UNAVAILABLE", null, null)
                    }
                }

                override fun onAuthenticationError(code: Int, message: CharSequence) {
                    val callback = takePending() ?: return
                    when (code) {
                        BiometricPrompt.ERROR_CANCELED, BiometricPrompt.ERROR_USER_CANCELED,
                        BiometricPrompt.ERROR_NEGATIVE_BUTTON -> callback.success(null)
                        BiometricPrompt.ERROR_NO_BIOMETRICS -> callback.error("KEY_UNAVAILABLE", null, null)
                        else -> callback.error("BIOMETRIC_UNAVAILABLE", null, null)
                    }
                }
            },
        )
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(reason)
            .setNegativeButtonText("Cancelar")
            .setAllowedAuthenticators(strong)
            .build()
        pending = result
        prompt = biometricPrompt
        try {
            biometricPrompt.authenticate(info, BiometricPrompt.CryptoObject(signature))
        } catch (error: Exception) {
            takePending()
            throw error
        }
    }

    private fun takePending() = pending.also {
        pending = null
        prompt = null
    }

    fun detach() {
        val active = prompt
        takePending()?.success(null)
        active?.cancelAuthentication()
        channel.setMethodCallHandler(null)
    }

    private fun fixedCoordinate(value: BigInteger): ByteArray {
        val bytes = value.toByteArray().takeLast(32).toByteArray()
        return ByteArray(32 - bytes.size) + bytes
    }

    private fun encode(value: ByteArray) =
        Base64.encodeToString(value, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
}
