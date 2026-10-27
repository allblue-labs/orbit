package com.allbluelabs.orbit_operator

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.EventChannel

class OrbitMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) = OrbitPushBridge.token(token)
    override fun onMessageReceived(message: RemoteMessage) {
        OrbitPushBridge.createChannel(this)
        val data = message.data
        val id = data["notificationId"] ?: message.messageId ?: return
        val deepLink = data["deepLink"]?.takeIf { it.startsWith("/field/") }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("deepLink", deepLink)
        }
        val pending = PendingIntent.getActivity(this, id.hashCode(), intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        @Suppress("DEPRECATION")
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, "orbit_work") else Notification.Builder(this)
        val notification = builder
            .setSmallIcon(R.drawable.ic_stat_orbit)
            .setContentTitle(message.notification?.title ?: data["title"] ?: "Novo aviso do Orbit")
            .setContentText(message.notification?.body ?: data["body"] ?: "Abra o aplicativo para consultar os detalhes.")
            .setContentIntent(pending)
            .setAutoCancel(true)
            .build()
        getSystemService(NotificationManager::class.java).notify(id.hashCode(), notification)
        OrbitPushBridge.received(id)
    }
}

object OrbitPushBridge {
    private val main = Handler(Looper.getMainLooper())
    private var tokenSink: EventChannel.EventSink? = null
    private var linkSink: EventChannel.EventSink? = null
    private var messageSink: EventChannel.EventSink? = null
    private var currentToken: String? = null
    private var pendingLink: String? = null

    fun register(messenger: BinaryMessenger) {
        EventChannel(messenger, "orbit/push/token").setStreamHandler(stream({ sink -> tokenSink = sink; currentToken?.let { sink.success(it) } }, { tokenSink = null }))
        EventChannel(messenger, "orbit/push/link").setStreamHandler(stream({ sink -> linkSink = sink; pendingLink?.let { pendingLink = null; sink.success(it) } }, { linkSink = null }))
        EventChannel(messenger, "orbit/push/received").setStreamHandler(stream({ sink -> messageSink = sink }, { messageSink = null }))
    }
    private fun stream(attach: (EventChannel.EventSink) -> Unit, detach: () -> Unit) = object : EventChannel.StreamHandler {
        override fun onListen(arguments: Any?, events: EventChannel.EventSink) = attach(events)
        override fun onCancel(arguments: Any?) = detach()
    }
    fun token(token: String) { main.post { currentToken = token; tokenSink?.success(token) } }
    fun received(id: String) { main.post { messageSink?.success(id) } }
    fun open(intent: Intent?) {
        val link = intent?.getStringExtra("deepLink")?.takeIf { it.startsWith("/field/") } ?: return
        intent.removeExtra("deepLink")
        if (linkSink != null) linkSink?.success(link) else pendingLink = link
    }
    fun detach() { tokenSink = null; linkSink = null; messageSink = null }
    fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= 26) context.getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel("orbit_work", "Atendimentos e documentos", NotificationManager.IMPORTANCE_HIGH))
    }
}
