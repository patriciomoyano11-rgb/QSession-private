package org.qsession.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import org.json.JSONObject

class QSessionPlaybackService : HeadlessJsTaskService() {
  companion object {
    const val ACTION_START = "org.qsession.app.START_PLAYBACK"
    const val ACTION_START_WEB_PLAYBACK = "org.qsession.app.START_WEB_PLAYBACK"
    const val ACTION_REASSERT_AUDIO_FOCUS = "org.qsession.app.REASSERT_AUDIO_FOCUS"
    const val ACTION_START_EDGE_PLAYBACK = "org.qsession.app.START_EDGE_PLAYBACK"
    const val ACTION_SET_EDGE_BACKGROUND = "org.qsession.app.SET_EDGE_BACKGROUND"
    const val ACTION_UPDATE_EDGE_AUDIO = "org.qsession.app.UPDATE_EDGE_AUDIO"
    const val ACTION_START_BROADCAST = "org.qsession.app.START_BROADCAST"
    const val ACTION_STOP = "org.qsession.app.STOP_PLAYBACK"
    const val EXTRA_ROOM_CODE = "roomCode"
    const val EXTRA_SERVER = "server"
    const val EXTRA_ACCESS_TOKEN = "accessToken"
    const val EXTRA_GAIN = "gain"
    const val EXTRA_PLAYBACK_URL = "playbackUrl"
    const val EXTRA_MUTED = "muted"
    const val EXTRA_BACKGROUND_ACTIVE = "backgroundActive"
    const val EXTRA_REQUIRES_MICROPHONE = "requiresMicrophone"
    const val EXTRA_REQUIRES_CAMERA = "requiresCamera"
    const val EXTRA_REQUEST_ID = "requestId"
    private const val CHANNEL_ID = "qsession_live_audio"
    private const val NOTIFICATION_ID = 2002
    private const val PREFERENCES_NAME = "qsession_playback_state"
    private const val PREF_LISTENER_ACTIVE = "listenerActive"
    private const val PREF_ROOM_CODE = "roomCode"
    private const val PREF_SERVER = "server"
    private const val PREF_ACCESS_TOKEN = "accessToken"
    private const val PREF_GAIN = "gain"
    private const val PREF_LISTENER_MODE = "listenerMode"
    private const val PREF_EDGE_PLAYBACK_URL = "edgePlaybackUrl"
    private const val PREF_MUTED = "muted"
    private const val PREF_EDGE_BACKGROUND_ACTIVE = "edgeBackgroundActive"

    fun clearPersistedListenerSession(context: Context) {
      context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
          .edit()
          .clear()
          .commit()
    }

    fun hasPersistedListenerSession(context: Context): Boolean =
        context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
            .getBoolean(PREF_LISTENER_ACTIVE, false)
  }

  private data class ListenerSession(
      val server: String,
      val roomCode: String,
      val accessToken: String,
      val gain: Double,
  )

  private data class EdgeListenerSession(
      val playbackUrl: String,
      val roomCode: String,
      val muted: Boolean,
      val gain: Double,
      val backgroundActive: Boolean,
  )

  private var wakeLock: PowerManager.WakeLock? = null
  private var wifiBackgroundLock: WifiManager.WifiLock? = null
  private var wifiLowLatencyLock: WifiManager.WifiLock? = null
  private var audioManager: AudioManager? = null
  private var audioFocusRequest: AudioFocusRequest? = null
  private var audioFocusHeld = false
  private var audioFocusRetryCount = 0
  private val audioFocusRetryHandler = Handler(Looper.getMainLooper())
  private val audioFocusRetry = Runnable {
    if (mode != Mode.BROADCAST && activeRoomCode.isNotBlank() && !audioFocusHeld) {
      requestMusicAudioFocus(resetRetryCount = false)
    }
  }
  private val audioFocusChangeListener = AudioManager.OnAudioFocusChangeListener { change ->
    when (change) {
      AudioManager.AUDIOFOCUS_GAIN -> {
        audioFocusHeld = true
        audioFocusRetryCount = 0
        audioFocusRetryHandler.removeCallbacks(audioFocusRetry)
        enforceMediaPlaybackRoute()
        QSessionWebAudioBridge.send("{\"type\":\"listener-resume\"}")
        QSessionWebAudioBridge.report("{\"type\":\"focus-gained\"}")
        if (mode == Mode.EDGE_LISTEN) {
          edgeAudioPlayer?.ensurePlaying(forceRecovery = true)
        }
      }
      AudioManager.AUDIOFOCUS_LOSS,
      AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
      AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
        audioFocusHeld = false
        QSessionWebAudioBridge.report("{\"type\":\"focus-lost\"}")
      }
    }
  }
  private val shutdownFallbackHandler = Handler(Looper.getMainLooper())
  private val shutdownFallback = Runnable {
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }
  private var activeRoomCode = ""
  private var listenerSession: ListenerSession? = null
  private var edgeListenerSession: EdgeListenerSession? = null
  private var edgeAudioPlayer: QSessionEdgeAudioPlayer? = null
  private var mode = Mode.NATIVE_LISTEN
  private var broadcastRequiresMicrophone = true
  private var broadcastRequiresCamera = false
  private var headlessPlaybackActive = false
  private var continuityReceiversRegistered = false
  private val listenerWatchdogHandler = Handler(Looper.getMainLooper())
  private val listenerWatchdog = object : Runnable {
    override fun run() {
      if (activeRoomCode.isBlank()) return
      if (mode == Mode.BROADCAST) ensureBroadcastContinuity() else ensureListenerContinuity()
      listenerWatchdogHandler.postDelayed(this, if (mode == Mode.BROADCAST) 5_000L else 20_000L)
    }
  }
  private val screenStateReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      if (mode == Mode.BROADCAST &&
          (intent?.action == Intent.ACTION_SCREEN_OFF || intent?.action == Intent.ACTION_USER_PRESENT)) {
        ensureBroadcastContinuity()
        return
      }
      if (
          mode != Mode.BROADCAST &&
              (intent?.action == Intent.ACTION_SCREEN_OFF || intent?.action == Intent.ACTION_USER_PRESENT)
      ) {
        if (mode == Mode.EDGE_LISTEN && intent?.action == Intent.ACTION_SCREEN_OFF) {
          setEdgeBackgroundPlayback(true)
        }
        ensureListenerContinuity()
      }
    }
  }
  private val networkCallback = object : ConnectivityManager.NetworkCallback() {
    override fun onAvailable(network: Network) {
      listenerWatchdogHandler.post {
        if (mode == Mode.BROADCAST) ensureBroadcastContinuity()
        else ensureListenerContinuity(forceEdgeRecovery = true)
      }
    }
  }

  private enum class Mode { NATIVE_LISTEN, WEB_LISTEN, EDGE_LISTEN, BROADCAST }

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
    audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
    registerContinuityReceivers()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    return try {
      startRuntime(intent, flags, startId)
    } catch (error: Exception) {
      android.util.Log.e("QSessionBroadcast", "Foreground audio service could not start", error)
      QSessionWebAudioBridge.report(JSONObject().apply {
        put("type", if (intent?.action == ACTION_START_BROADCAST) "broadcast-service-error" else "error")
        put("requestId", intent?.getStringExtra(EXTRA_REQUEST_ID).orEmpty())
        put("message", "Android no permitió iniciar el audio. Abre QSession y revisa el permiso de micrófono antes de reintentar.")
      }.toString())
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf(startId)
      START_NOT_STICKY
    }
  }

  private fun startRuntime(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopPlaybackRuntime()
      return START_NOT_STICKY
    }

    if (intent?.action == ACTION_REASSERT_AUDIO_FOCUS) {
      intent.getStringExtra(EXTRA_ROOM_CODE)?.trim()?.uppercase()
          ?.takeIf { it.matches(Regex("^[A-Z0-9]{6}$")) }
          ?.let { activeRoomCode = it }
      if (activeRoomCode.isBlank()) {
        listenerSession = loadPersistedListenerSession()
        activeRoomCode = listenerSession?.roomCode.orEmpty()
        mode = if (listenerSession != null) Mode.NATIVE_LISTEN else Mode.WEB_LISTEN
      }
      if (mode != Mode.BROADCAST && activeRoomCode.isNotBlank()) {
        startForegroundForMode(createNotification(activeRoomCode))
        requestMusicAudioFocus()
        ensureListenerContinuity(forceEdgeRecovery = true)
      }
      return START_REDELIVER_INTENT
    }

    mode = when (intent?.action) {
      ACTION_START_BROADCAST -> Mode.BROADCAST
      ACTION_START_WEB_PLAYBACK -> Mode.WEB_LISTEN
      ACTION_START_EDGE_PLAYBACK,
      ACTION_SET_EDGE_BACKGROUND,
      ACTION_UPDATE_EDGE_AUDIO -> Mode.EDGE_LISTEN
      null -> if (persistedListenerMode() == "edge") Mode.EDGE_LISTEN else Mode.NATIVE_LISTEN
      else -> Mode.NATIVE_LISTEN
    }
    if (mode == Mode.BROADCAST) {
      broadcastRequiresMicrophone = intent?.getBooleanExtra(EXTRA_REQUIRES_MICROPHONE, true) ?: true
      broadcastRequiresCamera = intent?.getBooleanExtra(EXTRA_REQUIRES_CAMERA, false) ?: false
      if (broadcastRequiresMicrophone &&
          ContextCompat.checkSelfPermission(this, android.Manifest.permission.RECORD_AUDIO) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
        throw SecurityException("Microphone permission is required before starting capture")
      }
    }
    if (mode == Mode.NATIVE_LISTEN) {
      listenerSession = listenerSessionFromIntent(intent) ?: loadPersistedListenerSession()
      listenerSession?.let { session ->
        activeRoomCode = session.roomCode
        persistListenerSession(session)
      }
    } else if (mode == Mode.EDGE_LISTEN) {
      edgeListenerSession = edgeSessionFromIntent(intent) ?: loadPersistedEdgeSession()
      val session = edgeListenerSession
      if (session == null) {
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        return START_NOT_STICKY
      }
      activeRoomCode = session.roomCode
      persistEdgeSession(session)
    } else {
      intent?.getStringExtra(EXTRA_ROOM_CODE)?.takeIf { it.isNotBlank() }?.let {
        activeRoomCode = it
      }
    }
    startForegroundForMode(createNotification(activeRoomCode))
    if (mode == Mode.NATIVE_LISTEN || mode == Mode.WEB_LISTEN) {
      (application as? MainApplication)?.ensureAudioEngineStarted()
      startHeadlessPlaybackTask()
      // A normal start came from the already-running JS listener. Replaying it
      // there would echo start -> service -> start forever. Android marks only
      // a process-recovery delivery with START_FLAG_REDELIVERY.
      if (mode == Mode.NATIVE_LISTEN &&
          (flags and START_FLAG_REDELIVERY != 0 || intent == null)) {
        restoreListenerCommand()
      }
    }
    if (mode == Mode.EDGE_LISTEN) {
      val session = edgeListenerSession!!
      prepareEdgeAudioPlayer(session)
      setEdgeBackgroundPlayback(session.backgroundActive)
    } else if (mode != Mode.BROADCAST) {
      requestMusicAudioFocus()
    } else {
      prepareBroadcastAudio()
    }
    acquireWakeLock()
    acquireWifiLocks()
    startListenerWatchdog()
    if (mode == Mode.BROADCAST) QSessionWebAudioBridge.report(JSONObject().apply {
      put("type", "broadcast-service-ready")
      put("requestId", intent?.getStringExtra(EXTRA_REQUEST_ID).orEmpty())
    }.toString())
    return START_REDELIVER_INTENT
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    // Swiping Q Session away is an explicit app close. Unlike screen lock or
    // switching apps, it must release the listener room and stop the music.
    if (mode != Mode.BROADCAST) stopPlaybackRuntime()
    super.onTaskRemoved(rootIntent)
  }

  private fun stopPlaybackRuntime() {
    if (mode == Mode.BROADCAST) {
      activeRoomCode = ""
      stopListenerWatchdog()
      QSessionWebAudioBridge.report("{\"type\":\"broadcast-runtime-stop\"}")
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
      return
    }
    if (mode == Mode.WEB_LISTEN) {
      activeRoomCode = ""
      abandonMusicAudioFocus()
      stopListenerWatchdog()
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
      return
    }
    if (mode == Mode.EDGE_LISTEN) {
      clearPersistedListenerSession(this)
      edgeListenerSession = null
      activeRoomCode = ""
      edgeAudioPlayer?.release()
      edgeAudioPlayer = null
      abandonMusicAudioFocus()
      stopListenerWatchdog()
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
      return
    }
    clearPersistedListenerSession(this)
    listenerSession = null
    activeRoomCode = ""
    QSessionWebAudioBridge.send("{\"type\":\"listener-runtime-stop\"}")
    stopListenerWatchdog()
    // Keep the service alive briefly so the hidden React/LiveKit engine can
    // synchronously mute its tracks and complete room.disconnect(). Normally
    // QSessionPlaybackModule.stop() removes us sooner; this is the safety net.
    shutdownFallbackHandler.removeCallbacks(shutdownFallback)
    shutdownFallbackHandler.postDelayed(shutdownFallback, 3_000L)
  }

  override fun onDestroy() {
    shutdownFallbackHandler.removeCallbacks(shutdownFallback)
    audioFocusRetryHandler.removeCallbacks(audioFocusRetry)
    stopListenerWatchdog()
    unregisterContinuityReceivers()
    wakeLock?.takeIf { it.isHeld }?.release()
    wakeLock = null
    wifiBackgroundLock?.takeIf { it.isHeld }?.release()
    wifiBackgroundLock = null
    wifiLowLatencyLock?.takeIf { it.isHeld }?.release()
    wifiLowLatencyLock = null
    edgeAudioPlayer?.release()
    edgeAudioPlayer = null
    abandonMusicAudioFocus()
    audioManager?.mode = AudioManager.MODE_NORMAL
    super.onDestroy()
  }

  override fun onHeadlessJsTaskFinish(taskId: Int) {
    headlessPlaybackActive = false
    super.onHeadlessJsTaskFinish(taskId)
  }

  override fun onBind(intent: Intent): IBinder? = null

  private fun startHeadlessPlaybackTask() {
    if (headlessPlaybackActive) return
    headlessPlaybackActive = true
    startTask(
        HeadlessJsTaskConfig(
            "QSessionAudioPlayback",
            Arguments.createMap(),
            0L,
            true,
        ),
    )
  }

  private fun restoreListenerCommand() {
    val session = listenerSession ?: loadPersistedListenerSession() ?: return
    val command = JSONObject().apply {
      put("type", "listener-start")
      put("server", session.server)
      put("roomCode", session.roomCode)
      put("accessToken", session.accessToken)
      put("gain", session.gain)
    }
    QSessionWebAudioBridge.send(command.toString())
  }

  private fun listenerSessionFromIntent(intent: Intent?): ListenerSession? {
    val roomCode = intent?.getStringExtra(EXTRA_ROOM_CODE)?.trim()?.uppercase().orEmpty()
    val server = intent?.getStringExtra(EXTRA_SERVER)?.trim().orEmpty()
    if (!roomCode.matches(Regex("^[A-Z0-9]{6}$")) || server.isBlank()) return null
    return ListenerSession(
        server = server,
        roomCode = roomCode,
        accessToken = intent?.getStringExtra(EXTRA_ACCESS_TOKEN).orEmpty(),
        gain = intent?.getDoubleExtra(EXTRA_GAIN, 1.0) ?: 1.0,
    )
  }

  private fun persistListenerSession(session: ListenerSession) {
    getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
        .edit()
        .putBoolean(PREF_LISTENER_ACTIVE, true)
        .putString(PREF_LISTENER_MODE, "native")
        .putString(PREF_ROOM_CODE, session.roomCode)
        .putString(PREF_SERVER, session.server)
        .putString(PREF_ACCESS_TOKEN, session.accessToken)
        .putString(PREF_GAIN, session.gain.toString())
        .remove(PREF_EDGE_PLAYBACK_URL)
        .remove(PREF_MUTED)
        .remove(PREF_EDGE_BACKGROUND_ACTIVE)
        .apply()
  }

  private fun loadPersistedListenerSession(): ListenerSession? {
    val preferences = getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
    if (!preferences.getBoolean(PREF_LISTENER_ACTIVE, false)) return null
    val roomCode = preferences.getString(PREF_ROOM_CODE, "")?.trim()?.uppercase().orEmpty()
    val server = preferences.getString(PREF_SERVER, "")?.trim().orEmpty()
    if (!roomCode.matches(Regex("^[A-Z0-9]{6}$")) || server.isBlank()) return null
    return ListenerSession(
        server = server,
        roomCode = roomCode,
        accessToken = preferences.getString(PREF_ACCESS_TOKEN, "").orEmpty(),
        gain = preferences.getString(PREF_GAIN, "1.0")?.toDoubleOrNull() ?: 1.0,
    )
  }

  private fun persistedListenerMode(): String =
      getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
          .getString(PREF_LISTENER_MODE, "")
          .orEmpty()

  private fun edgeSessionFromIntent(intent: Intent?): EdgeListenerSession? {
    val previous = edgeListenerSession ?: loadPersistedEdgeSession()
    val playbackUrl = intent?.getStringExtra(EXTRA_PLAYBACK_URL)?.trim()
        ?.takeIf { it.isNotBlank() }
        ?: previous?.playbackUrl
        ?: return null
    val playbackUri = Uri.parse(playbackUrl)
    if (!playbackUri.scheme.equals("https", ignoreCase = true) || playbackUri.host.isNullOrBlank()) {
      return null
    }
    val roomCode = intent?.getStringExtra(EXTRA_ROOM_CODE)?.trim()?.uppercase()
        ?.takeIf { it.matches(Regex("^[A-Z0-9]{6}$")) }
        ?: previous?.roomCode
        ?: return null
    val muted = if (intent?.hasExtra(EXTRA_MUTED) == true) {
      intent.getBooleanExtra(EXTRA_MUTED, false)
    } else {
      previous?.muted ?: false
    }
    val gain = (if (intent?.hasExtra(EXTRA_GAIN) == true) {
      intent.getDoubleExtra(EXTRA_GAIN, 1.0)
    } else {
      previous?.gain ?: 1.0
    }).coerceIn(0.0, 1.0)
    val backgroundActive = if (intent?.hasExtra(EXTRA_BACKGROUND_ACTIVE) == true) {
      intent.getBooleanExtra(EXTRA_BACKGROUND_ACTIVE, false)
    } else {
      previous?.backgroundActive ?: false
    }
    return EdgeListenerSession(
        playbackUrl = playbackUrl,
        roomCode = roomCode,
        muted = muted,
        gain = gain,
        backgroundActive = backgroundActive,
    )
  }

  private fun persistEdgeSession(session: EdgeListenerSession) {
    getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
        .edit()
        .putBoolean(PREF_LISTENER_ACTIVE, true)
        .putString(PREF_LISTENER_MODE, "edge")
        .putString(PREF_ROOM_CODE, session.roomCode)
        .putString(PREF_EDGE_PLAYBACK_URL, session.playbackUrl)
        .putBoolean(PREF_MUTED, session.muted)
        .putString(PREF_GAIN, session.gain.toString())
        .putBoolean(PREF_EDGE_BACKGROUND_ACTIVE, session.backgroundActive)
        .remove(PREF_SERVER)
        .remove(PREF_ACCESS_TOKEN)
        .apply()
  }

  private fun loadPersistedEdgeSession(): EdgeListenerSession? {
    val preferences = getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
    if (!preferences.getBoolean(PREF_LISTENER_ACTIVE, false) ||
        preferences.getString(PREF_LISTENER_MODE, "") != "edge") {
      return null
    }
    val playbackUrl = preferences.getString(PREF_EDGE_PLAYBACK_URL, "")?.trim().orEmpty()
    val playbackUri = Uri.parse(playbackUrl)
    val roomCode = preferences.getString(PREF_ROOM_CODE, "")?.trim()?.uppercase().orEmpty()
    if (!playbackUri.scheme.equals("https", ignoreCase = true) ||
        playbackUri.host.isNullOrBlank() ||
        !roomCode.matches(Regex("^[A-Z0-9]{6}$"))) {
      return null
    }
    return EdgeListenerSession(
        playbackUrl = playbackUrl,
        roomCode = roomCode,
        muted = preferences.getBoolean(PREF_MUTED, false),
        gain = preferences.getString(PREF_GAIN, "1.0")?.toDoubleOrNull()?.coerceIn(0.0, 1.0) ?: 1.0,
        backgroundActive = preferences.getBoolean(PREF_EDGE_BACKGROUND_ACTIVE, false),
    )
  }

  private fun ensureBroadcastContinuity() {
    if (mode != Mode.BROADCAST || activeRoomCode.isBlank()) return
    acquireWakeLock()
    acquireWifiLocks()
    QSessionWebAudioBridge.report(JSONObject().apply {
      put("type", "broadcast-continuity")
      put("roomCode", activeRoomCode)
    }.toString())
  }

  private fun ensureListenerContinuity(forceEdgeRecovery: Boolean = false) {
    if (mode == Mode.BROADCAST) return
    acquireWakeLock()
    acquireWifiLocks()
    if (!audioFocusHeld && mode != Mode.EDGE_LISTEN) {
      requestMusicAudioFocus(resetRetryCount = false)
    }
    if (mode == Mode.NATIVE_LISTEN) {
      QSessionWebAudioBridge.send("{\"type\":\"listener-resume\"}")
    } else if (mode == Mode.WEB_LISTEN) {
      QSessionWebAudioBridge.report("{\"type\":\"focus-gained\"}")
    } else if (mode == Mode.EDGE_LISTEN && edgeListenerSession?.backgroundActive == true) {
      edgeAudioPlayer?.ensurePlaying(forceRecovery = forceEdgeRecovery)
    }
  }

  private fun prepareEdgeAudioPlayer(session: EdgeListenerSession) {
    val player = edgeAudioPlayer ?: QSessionEdgeAudioPlayer(applicationContext) {
      listenerWatchdogHandler.postDelayed({ ensureListenerContinuity(forceEdgeRecovery = true) }, 1_500L)
    }.also { edgeAudioPlayer = it }
    player.prepare(session.playbackUrl, session.muted, session.gain)
  }

  private fun setEdgeBackgroundPlayback(active: Boolean) {
    if (mode != Mode.EDGE_LISTEN) return
    val current = edgeListenerSession ?: return
    val updated = current.copy(backgroundActive = active)
    edgeListenerSession = updated
    persistEdgeSession(updated)
    prepareEdgeAudioPlayer(updated)
    // ExoPlayer owns media focus through setAudioAttributes(..., true). Remove
    // any focus request left by the WebView/LiveKit path before the handoff.
    abandonMusicAudioFocus()
    if (active) enforceMediaPlaybackRoute()
    edgeAudioPlayer?.setBackgroundActive(active)
    val notification = createNotification(activeRoomCode)
    getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification)
  }

  private fun registerContinuityReceivers() {
    if (continuityReceiversRegistered) return
    val filter = IntentFilter().apply {
      addAction(Intent.ACTION_SCREEN_OFF)
      addAction(Intent.ACTION_USER_PRESENT)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      registerReceiver(screenStateReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      @Suppress("DEPRECATION")
      registerReceiver(screenStateReceiver, filter)
    }
    (getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager)
        .registerDefaultNetworkCallback(networkCallback)
    continuityReceiversRegistered = true
  }

  private fun unregisterContinuityReceivers() {
    if (!continuityReceiversRegistered) return
    try {
      unregisterReceiver(screenStateReceiver)
    } catch (_: IllegalArgumentException) {
      // The receiver was already removed by Android during process teardown.
    }
    try {
      (getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager)
          .unregisterNetworkCallback(networkCallback)
    } catch (_: IllegalArgumentException) {
      // The callback was already removed by Android during process teardown.
    }
    continuityReceiversRegistered = false
  }

  private fun startListenerWatchdog() {
    listenerWatchdogHandler.removeCallbacks(listenerWatchdog)
    listenerWatchdogHandler.postDelayed(listenerWatchdog, 10_000L)
  }

  private fun stopListenerWatchdog() {
    listenerWatchdogHandler.removeCallbacks(listenerWatchdog)
  }

  private fun requestMusicAudioFocus(resetRetryCount: Boolean = true): Boolean {
    if (resetRetryCount) audioFocusRetryCount = 0
    enforceMediaPlaybackRoute()
    val result = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val attributes = AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
          .build()
      val request = audioFocusRequest ?: AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
          .setAudioAttributes(attributes)
          .setAcceptsDelayedFocusGain(true)
          .setWillPauseWhenDucked(false)
          .setOnAudioFocusChangeListener(audioFocusChangeListener)
          .build()
          .also { audioFocusRequest = it }
      audioManager?.requestAudioFocus(request) ?: AudioManager.AUDIOFOCUS_REQUEST_FAILED
    } else {
      @Suppress("DEPRECATION")
      audioManager?.requestAudioFocus(
          audioFocusChangeListener,
          AudioManager.STREAM_MUSIC,
          AudioManager.AUDIOFOCUS_GAIN,
      ) ?: AudioManager.AUDIOFOCUS_REQUEST_FAILED
    }
    audioFocusHeld = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    if (audioFocusHeld) {
      audioFocusRetryCount = 0
      audioFocusRetryHandler.removeCallbacks(audioFocusRetry)
      QSessionWebAudioBridge.send("{\"type\":\"listener-resume\"}")
      QSessionWebAudioBridge.report("{\"type\":\"focus-gained\"}")
      return true
    }
    if (result != AudioManager.AUDIOFOCUS_REQUEST_DELAYED && audioFocusRetryCount < 3) {
      audioFocusRetryCount += 1
      audioFocusRetryHandler.removeCallbacks(audioFocusRetry)
      audioFocusRetryHandler.postDelayed(audioFocusRetry, 350L * audioFocusRetryCount)
    }
    return false
  }

  @Suppress("DEPRECATION")
  private fun abandonMusicAudioFocus() {
    audioFocusRetryHandler.removeCallbacks(audioFocusRetry)
    audioFocusRetryCount = 0
    audioFocusHeld = false
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      audioFocusRequest?.let { audioManager?.abandonAudioFocusRequest(it) }
      audioFocusRequest = null
    } else {
      audioManager?.abandonAudioFocus(audioFocusChangeListener)
    }
  }

  private fun prepareBroadcastAudio() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      audioFocusRequest?.let { audioManager?.abandonAudioFocusRequest(it) }
      audioFocusRequest = null
    }
    // The foreground microphone service and wake lock keep capture alive in
    // the background. Do not use MODE_IN_COMMUNICATION here: that mode tells
    // Android this is a VoIP call and may route music through voice processing
    // or the lower-bandwidth Bluetooth hands-free profile.
    audioManager?.mode = AudioManager.MODE_NORMAL
  }

  private fun startForegroundForMode(notification: Notification) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      var serviceType = if (mode == Mode.BROADCAST && broadcastRequiresMicrophone) {
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
      } else {
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
      }
      if (mode == Mode.BROADCAST && broadcastRequiresCamera) {
        serviceType = serviceType or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
      }
      startForeground(NOTIFICATION_ID, notification, serviceType)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  @Suppress("DEPRECATION")
  private fun enforceMediaPlaybackRoute() {
    val manager = audioManager ?: return
    val physicalHeadphonesConnected = QSessionAudioRouting.hasWiredOrUsbOutput(manager)
    manager.mode = AudioManager.MODE_NORMAL
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      // Samsung and some USB-C adapters lose an already active wired route when
      // clearCommunicationDevice() runs as playback starts. Preserve that route;
      // Android will continue handling later plug/unplug events normally.
      if (!physicalHeadphonesConnected) manager.clearCommunicationDevice()
    } else {
      manager.stopBluetoothSco()
      manager.isBluetoothScoOn = false
    }
  }

  private fun acquireWakeLock() {
    if (wakeLock?.isHeld == true) return
    val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "QSession::LiveAudio").apply {
      setReferenceCounted(false)
      // This lock exists only while the foreground playback service is alive
      // and is always released in onDestroy(). It keeps WebRTC/LiveKit able to
      // decode audio while Android has the display turned off.
      acquire()
    }
  }

  @Suppress("DEPRECATION")
  private fun acquireWifiLocks() {
    val wifiManager = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager

    // LOW_LATENCY is suspended by Android when the display turns off. Keep a
    // HIGH_PERF lock as the background path so the incoming stream does not
    // lose Wi-Fi as soon as the phone is locked.
    if (wifiBackgroundLock?.isHeld != true) {
      wifiBackgroundLock = wifiManager.createWifiLock(
          WifiManager.WIFI_MODE_FULL_HIGH_PERF,
          "QSession::BackgroundWifi",
      ).apply {
        setReferenceCounted(false)
        acquire()
      }
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && wifiLowLatencyLock?.isHeld != true) {
      wifiLowLatencyLock = wifiManager.createWifiLock(
          WifiManager.WIFI_MODE_FULL_LOW_LATENCY,
          "QSession::LowLatencyWifi",
      ).apply {
        setReferenceCounted(false)
        acquire()
      }
    }
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel = NotificationChannel(CHANNEL_ID, "Q Session en vivo", NotificationManager.IMPORTANCE_LOW).apply {
      description = "Mantiene activa la recepción o transmisión de Q Session"
      setSound(null, null)
    }
    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }

  private fun createNotification(roomCode: String): Notification {
    val openApp = Intent(this, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
      if (roomCode.matches(Regex("^[A-Z0-9]{6}$"))) {
        data = Uri.parse("qsession://join?room=$roomCode")
      }
    }
    val pendingIntent = PendingIntent.getActivity(
        this,
        0,
        openApp,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val preparing = roomCode.isBlank() || roomCode == "PREPARANDO"
    val roomText = when {
      preparing && mode == Mode.BROADCAST -> "Preparando el micrófono y la sala"
      preparing -> "Conectando con la sala"
      mode == Mode.BROADCAST -> "Transmitiendo sala $roomCode · micrófono activo"
      mode == Mode.EDGE_LISTEN && edgeListenerSession?.backgroundActive == true ->
        "Escuchando sala $roomCode · audio activo con la pantalla bloqueada"
      mode == Mode.EDGE_LISTEN -> "Sala $roomCode preparada para audio en segundo plano"
      else -> "Escuchando sala $roomCode · pantalla bloqueada activa"
    }
    return NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(R.mipmap.ic_launcher)
        .setContentTitle(if (mode == Mode.BROADCAST) "Q Session · Transmisión activa" else "Q Session · Audio en vivo")
        .setContentText(roomText)
        .setContentIntent(pendingIntent)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .build()
  }
}
