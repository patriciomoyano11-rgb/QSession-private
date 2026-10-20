package org.qsession.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

object QSessionSocialNotifications {
  private const val QSESSION_ORIGIN = "https://qsession.org"
  private const val MESSAGE_CHANNEL = "qsession_private_messages"
  private const val CALL_CHANNEL = "qsession_private_calls"

  fun createChannels(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val messages = NotificationChannel(
        MESSAGE_CHANNEL,
        "Mensajes privados",
        NotificationManager.IMPORTANCE_DEFAULT,
    ).apply {
      description = "Avisos cuando una persona te escribe en Q Session"
      enableVibration(true)
      lockscreenVisibility = Notification.VISIBILITY_PRIVATE
    }
    val calls = NotificationChannel(
        CALL_CHANNEL,
        "Llamadas privadas",
        NotificationManager.IMPORTANCE_HIGH,
    ).apply {
      description = "Avisos de llamadas privadas entrantes en Q Session"
      enableVibration(true)
      lockscreenVisibility = Notification.VISIBILITY_PRIVATE
    }
    manager.createNotificationChannels(listOf(messages, calls))
  }

  fun show(
      context: Context,
      type: String,
      actionId: String,
      conversationId: String,
      senderName: String,
      body: String,
  ) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
        ContextCompat.checkSelfPermission(context, android.Manifest.permission.POST_NOTIFICATIONS) !=
        android.content.pm.PackageManager.PERMISSION_GRANTED) return
    if (!Regex("^[a-zA-Z0-9_-]{10,100}$").matches(conversationId)) return
    createChannels(context)
    val incomingCall = type == "call"
    val destination = Uri.parse(QSESSION_ORIGIN).buildUpon()
        .appendQueryParameter("conversation", conversationId)
        .apply { if (incomingCall) appendQueryParameter("answerCall", "1") }
        .fragment("chat")
        .build()
    val openApp = Intent(context, MainActivity::class.java).apply {
      data = destination
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val requestCode = (actionId.ifBlank { "$type:$conversationId" }.hashCode() and 0x7fffffff)
    val contentIntent = PendingIntent.getActivity(
        context,
        requestCode,
        openApp,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val channel = if (incomingCall) CALL_CHANNEL else MESSAGE_CHANNEL
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(context, channel)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(context)
    }
    builder
        .setSmallIcon(R.mipmap.ic_launcher)
        .setContentTitle(if (incomingCall) "$senderName te está llamando" else senderName)
        .setContentText(body)
        .setStyle(Notification.BigTextStyle().bigText(body))
        .setContentIntent(contentIntent)
        .setAutoCancel(true)
        .setOnlyAlertOnce(true)
        .setVisibility(Notification.VISIBILITY_PRIVATE)
        .setCategory(if (incomingCall) Notification.CATEGORY_CALL else Notification.CATEGORY_MESSAGE)
        .setPriority(if (incomingCall) Notification.PRIORITY_HIGH else Notification.PRIORITY_DEFAULT)
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) builder.setDefaults(Notification.DEFAULT_ALL)
    if (incomingCall && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) builder.setTimeoutAfter(45_000L)
    (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
        .notify(requestCode.takeIf { it != 0 } ?: 1, builder.build())
  }
}

class QSessionFirebaseMessagingService : FirebaseMessagingService() {
  companion object {
    const val PREFERENCES = "qsession_push"
    const val TOKEN_KEY = "fcm_token"
  }

  override fun onNewToken(token: String) {
    getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
        .edit()
        .putString(TOKEN_KEY, token)
        .apply()
  }

  override fun onMessageReceived(message: RemoteMessage) {
    val data = message.data
    val type = if (data["type"] == "call") "call" else "message"
    val conversationId = data["conversationId"].orEmpty().trim().take(100)
    val actionId = data["actionId"].orEmpty().trim().take(100)
    val senderName = data["senderName"].orEmpty().trim().take(80).ifBlank { "Usuario Q Session" }
    val body = data["body"].orEmpty().trim().take(180).ifBlank {
      if (type == "call") "Llamada privada entrante" else "Nuevo mensaje privado"
    }
    QSessionSocialNotifications.show(this, type, actionId, conversationId, senderName, body)
  }
}
