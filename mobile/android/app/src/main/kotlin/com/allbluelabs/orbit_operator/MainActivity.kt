package com.allbluelabs.orbit_operator

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private var permissionResult: MethodChannel.Result? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        OrbitPushBridge.register(flutterEngine.dartExecutor.binaryMessenger)
        OrbitPushBridge.createChannel(this)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "orbit/push").setMethodCallHandler { call, result ->
            when (call.method) {
                "requestPermission" -> {
                    if (FirebaseApp.initializeApp(this) == null) {
                        result.success(false)
                    } else if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                        if (permissionResult != null) result.success(false)
                        else {
                            permissionResult = result
                            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 702)
                        }
                    } else result.success(getSystemService(android.app.NotificationManager::class.java).areNotificationsEnabled())
                }
                "token" -> {
                    if (FirebaseApp.initializeApp(this) == null) result.success(null)
                    else FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                        if (task.isSuccessful) { OrbitPushBridge.token(task.result); result.success(task.result) }
                        else result.success(null)
                    }
                }
                else -> result.notImplemented()
            }
        }
        OrbitPushBridge.open(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        OrbitPushBridge.open(intent)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 702) {
            permissionResult?.success(grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED)
            permissionResult = null
        }
    }

    override fun cleanUpFlutterEngine(flutterEngine: FlutterEngine) {
        OrbitPushBridge.detach()
        permissionResult?.success(false)
        permissionResult = null
        super.cleanUpFlutterEngine(flutterEngine)
    }
}
