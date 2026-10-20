package org.qsession.app

import android.content.Intent
import android.media.AudioManager
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class QSessionPlaybackModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {

  override fun getName(): String = "QSessionPlayback"

  override fun getConstants(): Map<String, Any> = mapOf(
      "appVersion" to BuildConfig.VERSION_NAME,
      "nativeRuntime" to true,
  )

  @ReactMethod
  fun hasWiredOrUsbOutput(promise: Promise) {
    try {
      val audioManager = context.getSystemService(android.content.Context.AUDIO_SERVICE) as AudioManager
      promise.resolve(QSessionAudioRouting.hasWiredOrUsbOutput(audioManager))
    } catch (error: Exception) {
      promise.reject("QSESSION_AUDIO_OUTPUT_CHECK", error)
    }
  }

  @ReactMethod
  fun start(server: String, roomCode: String, accessToken: String, gain: Double, promise: Promise) {
    try {
      val intent = Intent(context, QSessionPlaybackService::class.java).apply {
        action = QSessionPlaybackService.ACTION_START
        putExtra(QSessionPlaybackService.EXTRA_ROOM_CODE, roomCode)
        putExtra(QSessionPlaybackService.EXTRA_SERVER, server)
        putExtra(QSessionPlaybackService.EXTRA_ACCESS_TOKEN, accessToken)
        putExtra(QSessionPlaybackService.EXTRA_GAIN, gain)
      }
      ContextCompat.startForegroundService(context, intent)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("QSESSION_PLAYBACK_START", error)
    }
  }

  @ReactMethod
  fun startBroadcast(roomCode: String, promise: Promise) {
    try {
      val intent = Intent(context, QSessionPlaybackService::class.java).apply {
        action = QSessionPlaybackService.ACTION_START_BROADCAST
        putExtra(QSessionPlaybackService.EXTRA_ROOM_CODE, roomCode)
      }
      ContextCompat.startForegroundService(context, intent)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("QSESSION_BROADCAST_START", error)
    }
  }

  @ReactMethod
  fun ensureBackgroundPlayback(promise: Promise) {
    // Playback already runs as a mediaPlayback foreground service with a
    // partial WakeLock and Wi-Fi locks. Requesting a direct exemption from
    // Android battery optimization is unnecessary for that supported path and
    // is restricted by Google Play policy. Keep this method as a compatibility
    // acknowledgement for the JavaScript client without opening system UI.
    promise.resolve(true)
  }

  @ReactMethod
  fun stop(promise: Promise) {
    try {
      QSessionPlaybackService.clearPersistedListenerSession(context)
      context.stopService(Intent(context, QSessionPlaybackService::class.java))
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("QSESSION_PLAYBACK_STOP", error)
    }
  }

  @ReactMethod
  fun stopBroadcast(promise: Promise) = stop(promise)
}
