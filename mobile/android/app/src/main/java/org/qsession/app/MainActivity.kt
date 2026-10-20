package org.qsession.app

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.location.Geocoder
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.View
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject
import java.util.Locale

/**
 * Q Session has one canonical interface: https://qsession.org.
 *
 * Android renders that exact interface in a trusted WebView so En vivo,
 * Personas, Chat and Global cannot drift from the website. A hidden React
 * Native root owns the native LiveKit audio connection and foreground playback
 * service, keeping the media plane independent from WebView suspension.
 */
class MainActivity : Activity() {
  companion object {
    private const val QSESSION_ORIGIN = "https://qsession.org"
    private const val MEDIA_PERMISSION_REQUEST = 7101
    private const val LOCATION_PERMISSION_REQUEST = 7102
    private const val FILE_CHOOSER_REQUEST = 7103
    private const val GPS_COUNTRY_PERMISSION_REQUEST = 7104
    private const val NOTIFICATION_PERMISSION_REQUEST = 7105
  }

  private lateinit var root: FrameLayout
  private lateinit var webView: WebView
  private var fullScreenView: View? = null
  private var fullScreenCallback: WebChromeClient.CustomViewCallback? = null
  private var pendingMediaRequest: PermissionRequest? = null
  private var pendingLocationOrigin: String? = null
  private var pendingLocationCallback: GeolocationPermissions.Callback? = null
  private var pendingGpsRequestId: String? = null
  private var gpsLocationManager: LocationManager? = null
  private var gpsLocationListener: LocationListener? = null
  private val gpsTimeoutHandler = Handler(Looper.getMainLooper())
  private val gpsTimeout = Runnable {
    val lastFix = try {
      gpsLocationManager?.getLastKnownLocation(LocationManager.GPS_PROVIDER)
    } catch (_: SecurityException) {
      null
    }
    val freshFix = lastFix?.takeIf { fix ->
      System.currentTimeMillis() - fix.time <= 10 * 60 * 1000L
    }
    if (freshFix != null) {
      finishGpsCountryRequest(freshFix)
    } else {
      finishGpsCountryRequest(
          null,
          "El GPS todavía no obtuvo una posición. Sal al exterior o acércate a una ventana e inténtalo nuevamente.",
      )
    }
  }
  private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
  @Volatile private var activityInBackground = false
  @Volatile private var webListenerServiceActive = false
  @Volatile private var edgeListenerServiceActive = false
  private var webListenerRoom = ""
  private var edgeListenerRoom = ""
  private var edgeListenerUrl = ""
  private var edgeListenerMuted = false
  private var edgeListenerGain = 1.0
  private val listenerStopFallbackHandler = Handler(Looper.getMainLooper())
  private val listenerStopFallback = Runnable {
    stopService(Intent(this, QSessionPlaybackService::class.java))
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    volumeControlStream = android.media.AudioManager.STREAM_MUSIC
    createSocialNotificationChannels()

    root = FrameLayout(this).apply {
      setBackgroundColor(Color.rgb(247, 244, 237))
    }
    webView = createQSessionWebView()
    QSessionWebAudioBridge.registerWebReporter { message ->
      runOnUiThread {
        if (::webView.isInitialized) {
          val quotedMessage = JSONObject.quote(message)
          webView.evaluateJavascript(
              "window.dispatchEvent(new CustomEvent('qsession-native-audio-status',{detail:$quotedMessage}));",
              null,
          )
        }
      }
    }

    root.addView(
        webView,
        FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT,
        ),
    )
    setContentView(root)
    QSessionSystemBars.apply(this)

    if (savedInstanceState == null) {
      webView.loadUrl(qSessionUrlFromIntent(intent))
    } else {
      webView.restoreState(savedInstanceState)
    }
  }

  private fun createQSessionWebView() = WebView(this).apply {
    setBackgroundColor(Color.rgb(247, 244, 237))
    settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = true
      databaseEnabled = true
      setGeolocationEnabled(true)
      mediaPlaybackRequiresUserGesture = false
      allowFileAccess = false
      allowContentAccess = true
      builtInZoomControls = false
      displayZoomControls = false
      loadWithOverviewMode = false
      useWideViewPort = true
      // QSession is a live product shell: HTML and JavaScript must be
      // revalidated on every launch so Android never keeps an interface that
      // predates new room features such as promotions or camera effects.
      cacheMode = WebSettings.LOAD_NO_CACHE
      mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
      userAgentString = "$userAgentString QSessionAndroid/${BuildConfig.VERSION_NAME}"
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) safeBrowsingEnabled = true
    }

    val qSessionWebView = this
    CookieManager.getInstance().apply {
      setAcceptCookie(true)
      setAcceptThirdPartyCookies(qSessionWebView, false)
    }

    addJavascriptInterface(NativeBridge(), "QSessionNativeBridge")
    addJavascriptInterface(PlaybackBridge(), "QSessionPlaybackBridge")
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
    }

    webViewClient = object : WebViewClient() {
      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
          openUri(request.url)

      @Suppress("DEPRECATION")
      override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean =
          openUri(Uri.parse(url))

      override fun onReceivedError(
          view: WebView,
          request: WebResourceRequest,
          error: WebResourceError,
      ) {
        if (request.isForMainFrame) showConnectionError()
      }

      override fun onPageFinished(view: WebView, url: String) {
        super.onPageFinished(view, url)
        if (isTrustedQSessionUri(Uri.parse(url))) {
          installNativeLifecycleHooks(view)
          dispatchStoredPushToken()
        }
      }
    }

    webChromeClient = object : WebChromeClient() {
      override fun getDefaultVideoPoster(): Bitmap =
          Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888).apply {
            eraseColor(Color.TRANSPARENT)
          }

      override fun onPermissionRequest(request: PermissionRequest) {
        runOnUiThread { handleMediaPermissionRequest(request) }
      }

      override fun onPermissionRequestCanceled(request: PermissionRequest) {
        if (pendingMediaRequest == request) pendingMediaRequest = null
      }

      override fun onGeolocationPermissionsShowPrompt(
          origin: String,
          callback: GeolocationPermissions.Callback,
      ) {
        handleLocationPermissionRequest(origin, callback)
      }

      override fun onShowFileChooser(
          view: WebView,
          callback: ValueCallback<Array<Uri>>,
          params: FileChooserParams,
      ): Boolean {
        fileChooserCallback?.onReceiveValue(null)
        fileChooserCallback = callback
        return try {
          startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST)
          true
        } catch (_: ActivityNotFoundException) {
          fileChooserCallback = null
          Toast.makeText(
              this@MainActivity,
              "No hay una aplicación para elegir el archivo.",
              Toast.LENGTH_LONG,
          ).show()
          false
        }
      }

      override fun onShowCustomView(view: View, callback: CustomViewCallback) {
        if (fullScreenView != null) {
          callback.onCustomViewHidden()
          return
        }
        fullScreenView = view
        fullScreenCallback = callback
        qSessionWebView.visibility = View.GONE
        root.addView(
            view,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            ),
        )
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility =
            View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
      }

      override fun onHideCustomView() = hideFullScreenVideo()
    }

    setDownloadListener { url, _, _, _, _ ->
      if (!url.isNullOrBlank()) openExternal(Uri.parse(url))
    }
  }

  private inner class PlaybackBridge {
    @JavascriptInterface
    fun postMessage(message: String) {
      val command = try {
        JSONObject(message)
      } catch (_: Exception) {
        JSONObject()
      }
      when (command.optString("type")) {
        "listener-web-service-start" -> {
          startWebListenerService(command.optString("roomCode"))
          return
        }
        "listener-audio-focus" -> {
          reassertListenerAudioFocus(command.optString("roomCode"))
          return
        }
        "listener-edge-start" -> {
          startEdgeListenerService(
              command.optString("roomCode"),
              command.optString("url"),
              command.optBoolean("muted", false),
              command.optDouble("gain", 1.0),
          )
          return
        }
        "listener-edge-stop" -> {
          stopEdgeListenerService()
          return
        }
        "listener-edge-foreground-ready" -> {
          setEdgeBackgroundPlayback(false)
          return
        }
        "listener-muted" -> {
          if (edgeListenerServiceActive) {
            edgeListenerMuted = command.optBoolean("muted", false)
            updateEdgeListenerAudio()
          }
        }
        "listener-output-gain" -> {
          if (edgeListenerServiceActive) {
            edgeListenerGain = command.optDouble("gain", 1.0).coerceIn(0.0, 1.0)
            updateEdgeListenerAudio()
          }
        }
        "broadcast-service-start" -> {
          runOnUiThread {
            startBroadcastService(command.optString("roomCode"), command.optBoolean("requiresMicrophone", true), command.optString("requestId"), command.optBoolean("requiresCamera", false))
          }
          return
        }
        "broadcast-service-stop" -> {
          if (activityInBackground && command.optString("reason") == "page-unload") return
          stopService(Intent(this@MainActivity, QSessionPlaybackService::class.java))
          return
        }
      }
      // A WebView teardown can run the page's beforeunload handlers after the
      // phone is locked or Q Session is placed behind another app. That is an
      // Android lifecycle event, not a user's request to leave the room.
      if (isListenerStopCommand(message)) {
        if (activityInBackground) return
        stopListenerPlaybackForExplicitExit(message)
        return
      }
      QSessionWebAudioBridge.send(message)
    }
  }

  private inner class NativeBridge {
    @JavascriptInterface
    fun copyText(label: String, text: String) {
      runOnUiThread {
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText(label, text))
      }
    }

    @JavascriptInterface
    fun shareRoom(title: String, text: String) {
      runOnUiThread {
        val shareIntent = Intent(Intent.ACTION_SEND).apply {
          type = "text/plain"
          putExtra(Intent.EXTRA_SUBJECT, title)
          putExtra(Intent.EXTRA_TEXT, text)
        }
        try {
          startActivity(Intent.createChooser(shareIntent, title))
        } catch (_: ActivityNotFoundException) {
          Toast.makeText(
              this@MainActivity,
              "No hay una aplicación disponible para compartir.",
              Toast.LENGTH_LONG,
          ).show()
        }
      }
    }

    @JavascriptInterface
    fun requestNotificationPermission() {
      if (!isTrustedQSessionUri(Uri.parse(webView.url ?: ""))) return
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
      runOnUiThread {
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
          requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), NOTIFICATION_PERMISSION_REQUEST)
        }
      }
    }

    @JavascriptInterface
    fun requestPushToken() {
      if (!isTrustedQSessionUri(Uri.parse(webView.url ?: ""))) return
      FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
        if (token.isBlank()) return@addOnSuccessListener
        getSharedPreferences(QSessionFirebaseMessagingService.PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .putString(QSessionFirebaseMessagingService.TOKEN_KEY, token)
            .apply()
        dispatchPushToken(token)
      }
    }

    @JavascriptInterface
    fun showSocialNotification(
        type: String,
        actionId: String,
        conversationId: String,
        senderName: String,
        body: String,
    ) {
      if (!isTrustedQSessionUri(Uri.parse(webView.url ?: ""))) return
      val safeType = if (type == "call") "call" else "message"
      val safeActionId = actionId.trim().take(100)
      val safeConversationId = conversationId.trim().take(100)
      val safeSenderName = senderName.trim().take(80).ifBlank { "Usuario Q Session" }
      val safeBody = body.trim().take(180).ifBlank {
        if (safeType == "call") "Llamada privada entrante" else "Nuevo mensaje privado"
      }
      if (!Regex("^[a-zA-Z0-9_-]{10,100}$").matches(safeConversationId)) return
      runOnUiThread {
        showSocialNotificationNow(
            safeType,
            safeActionId,
            safeConversationId,
            safeSenderName,
            safeBody,
        )
      }
    }

    /**
     * Resolves the country from an actual GPS fix. When Android's Geocoder is
     * unavailable, coordinates are passed only to Q Session's local WebView so
     * its bundled political map can resolve the country. They are never sent to
     * the server.
     */
    @JavascriptInterface
    fun requestGpsCountry(requestId: String) {
      runOnUiThread { requestGpsCountryFix(requestId) }
    }
  }

  private fun createSocialNotificationChannels() {
    QSessionSocialNotifications.createChannels(this)
  }

  private fun showSocialNotificationNow(
      type: String,
      actionId: String,
      conversationId: String,
      senderName: String,
      body: String,
  ) {
    QSessionSocialNotifications.show(this, type, actionId, conversationId, senderName, body)
  }

  private fun dispatchStoredPushToken() {
    val token = getSharedPreferences(QSessionFirebaseMessagingService.PREFERENCES, Context.MODE_PRIVATE)
        .getString(QSessionFirebaseMessagingService.TOKEN_KEY, "")
        .orEmpty()
    if (token.isNotBlank()) dispatchPushToken(token)
  }

  private fun dispatchPushToken(token: String) {
    runOnUiThread {
      if (!::webView.isInitialized || !isTrustedQSessionUri(Uri.parse(webView.url ?: ""))) return@runOnUiThread
      val detail = JSONObject().put("token", token).put("platform", "android").toString()
      webView.evaluateJavascript(
          "window.dispatchEvent(new CustomEvent('qsession-native-push-token',{detail:$detail}));",
          null,
      )
    }
  }

  private fun requestGpsCountryFix(requestId: String) {
    val safeRequestId = requestId.trim().take(80)
    if (safeRequestId.isBlank() || !isTrustedQSessionUri(Uri.parse(webView.url ?: ""))) return
    cancelGpsCountryRequest(notify = false)
    pendingGpsRequestId = safeRequestId
    if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
      requestPermissions(
          arrayOf(
              Manifest.permission.ACCESS_FINE_LOCATION,
              Manifest.permission.ACCESS_COARSE_LOCATION,
          ),
          GPS_COUNTRY_PERMISSION_REQUEST,
      )
      return
    }
    startGpsCountryFix()
  }

  private fun startGpsCountryFix() {
    val requestId = pendingGpsRequestId ?: return
    val manager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
    gpsLocationManager = manager
    if (!manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
      dispatchGpsCountryResult(
          requestId,
          countryCode = "",
          error = "Activa la ubicación GPS del teléfono y vuelve a tocar Compartir mi país.",
      )
      pendingGpsRequestId = null
      try {
        startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
      } catch (_: ActivityNotFoundException) {
        // The message above remains actionable even on devices without the standard settings screen.
      }
      return
    }

    val listener = object : LocationListener {
      override fun onLocationChanged(location: Location) {
        if (location.provider == LocationManager.GPS_PROVIDER) finishGpsCountryRequest(location)
      }
      override fun onProviderDisabled(provider: String) {
        if (provider == LocationManager.GPS_PROVIDER) {
          finishGpsCountryRequest(null, "La ubicación GPS fue desactivada antes de completar la verificación.")
        }
      }
      override fun onProviderEnabled(provider: String) = Unit
      @Deprecated("Legacy callback retained for Android 7 compatibility")
      override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
    }
    gpsLocationListener = listener
    try {
      manager.requestLocationUpdates(
          LocationManager.GPS_PROVIDER,
          0L,
          0f,
          listener,
          Looper.getMainLooper(),
      )
      gpsTimeoutHandler.postDelayed(gpsTimeout, 25_000L)
    } catch (_: SecurityException) {
      finishGpsCountryRequest(null, "Q Session necesita permiso de ubicación precisa para verificar el país por GPS.")
    } catch (error: Exception) {
      finishGpsCountryRequest(null, error.message ?: "No fue posible iniciar el GPS.")
    }
  }

  @Suppress("DEPRECATION")
  private fun gpsCountryCode(location: Location): String {
    if (!Geocoder.isPresent()) return ""
    return try {
      Geocoder(this, Locale.US)
          .getFromLocation(location.latitude, location.longitude, 1)
          ?.firstOrNull()
          ?.countryCode
          ?.uppercase(Locale.US)
          .orEmpty()
    } catch (_: Exception) {
      ""
    }
  }

  private fun finishGpsCountryRequest(location: Location?, error: String? = null) {
    val requestId = pendingGpsRequestId ?: return
    val listener = gpsLocationListener
    gpsTimeoutHandler.removeCallbacks(gpsTimeout)
    if (listener != null) {
      try {
        gpsLocationManager?.removeUpdates(listener)
      } catch (_: SecurityException) {
        // The permission can be revoked while a fix is in flight.
      }
    }
    gpsLocationListener = null
    gpsLocationManager = null
    if (location == null) {
      pendingGpsRequestId = null
      dispatchGpsCountryResult(requestId, countryCode = "", error = error ?: "No fue posible verificar el país por GPS.")
      return
    }
    Thread {
      val countryCode = gpsCountryCode(location)
      runOnUiThread {
        if (pendingGpsRequestId != requestId) return@runOnUiThread
        pendingGpsRequestId = null
        if (countryCode.matches(Regex("^[A-Z]{2}$"))) {
          dispatchGpsCountryResult(requestId, countryCode, accuracy = location.accuracy.toDouble())
        } else {
          dispatchGpsCountryResult(
              requestId,
              countryCode = "",
              accuracy = location.accuracy.toDouble(),
              latitude = location.latitude,
              longitude = location.longitude,
          )
        }
      }
    }.start()
  }

  private fun cancelGpsCountryRequest(notify: Boolean) {
    val requestId = pendingGpsRequestId
    gpsTimeoutHandler.removeCallbacks(gpsTimeout)
    gpsLocationListener?.let { listener ->
      try {
        gpsLocationManager?.removeUpdates(listener)
      } catch (_: SecurityException) {
        // Nothing else to release.
      }
    }
    gpsLocationListener = null
    gpsLocationManager = null
    pendingGpsRequestId = null
    if (notify && requestId != null) {
      dispatchGpsCountryResult(requestId, countryCode = "", error = "La verificación GPS fue cancelada.")
    }
  }

  private fun dispatchGpsCountryResult(
      requestId: String,
      countryCode: String,
      accuracy: Double? = null,
      latitude: Double? = null,
      longitude: Double? = null,
      error: String? = null,
  ) {
    if (!::webView.isInitialized) return
    val detail = JSONObject()
        .put("requestId", requestId)
        .put("countryCode", countryCode)
        .put("verifiedBy", if (countryCode.isNotBlank() || latitude != null) "gps" else JSONObject.NULL)
    if (accuracy != null) detail.put("accuracy", accuracy)
    if (latitude != null) detail.put("latitude", latitude)
    if (longitude != null) detail.put("longitude", longitude)
    if (!error.isNullOrBlank()) detail.put("error", error)
    webView.evaluateJavascript(
        "window.dispatchEvent(new CustomEvent('qsession-native-gps-country',{detail:${detail}}));",
        null,
    )
  }

  private fun installNativeLifecycleHooks(view: WebView) {
    view.evaluateJavascript(
        """
        (() => {
          if (window.__qsessionNativeLifecycleV1) return;
          window.__qsessionNativeLifecycleV1 = true;
          const bridge = window.QSessionPlaybackBridge;
          const send = payload => {
            try { bridge?.postMessage?.(JSON.stringify(payload)); } catch (_) {}
          };
          const roomCode = () =>
            (document.getElementById('mediaRoomCode')?.textContent ||
             document.getElementById('createdRoomCode')?.textContent ||
             'PREPARANDO').trim();
          let listenerServiceRoom = '';
          const syncListenerService = () => {
            const mediaConsole = document.getElementById('mediaConsole');
            const listenerControls = document.getElementById('listenerControls');
            const code = roomCode().toUpperCase();
            const active = !!mediaConsole && !mediaConsole.hidden &&
              !!listenerControls && !listenerControls.hidden && /^[A-Z0-9]{6}$/.test(code);
            if (active && listenerServiceRoom !== code) {
              listenerServiceRoom = code;
              send({type: 'listener-web-service-start', roomCode: code});
            } else if (!active && listenerServiceRoom) {
              listenerServiceRoom = '';
              send({type: 'listener-stop'});
            }
          };
          new MutationObserver(syncListenerService).observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['hidden'],
            childList: true,
            subtree: true,
          });
          setInterval(syncListenerService, 1000);
          syncListenerService();
          document.getElementById('stopBroadcast')?.addEventListener('click', () => {
            send({type: 'broadcast-service-stop'});
          }, true);
          window.addEventListener('beforeunload', () => {
            send({type: 'broadcast-service-stop', reason: 'page-unload'});
            if (listenerServiceRoom) send({type: 'listener-stop'});
          });
        })();
        """.trimIndent(),
        null,
    )
  }

  private fun isListenerStopCommand(message: String): Boolean = try {
    JSONObject(message).optString("type") == "listener-stop"
  } catch (_: Exception) {
    false
  }

  private fun stopListenerPlaybackForExplicitExit(command: String? = null) {
    webListenerServiceActive = false
    edgeListenerServiceActive = false
    webListenerRoom = ""
    edgeListenerRoom = ""
    edgeListenerUrl = ""
    QSessionPlaybackService.clearPersistedListenerSession(this)
    QSessionWebAudioBridge.send(
        command ?: JSONObject().put("type", "listener-stop").toString(),
    )
    // The hidden LiveKit engine owns the actual AudioTrack. Give it time to
    // mute and disconnect before removing the foreground service that keeps
    // its JS runtime alive. The delayed stop is only a safety fallback; the
    // engine stops the service itself as soon as the room has been released.
    listenerStopFallbackHandler.removeCallbacks(listenerStopFallback)
    listenerStopFallbackHandler.postDelayed(listenerStopFallback, 3_000L)
  }

  private fun startWebListenerService(roomCode: String) {
    val normalized = roomCode.trim().uppercase()
    if (!normalized.matches(Regex("^[A-Z0-9]{6}$"))) return
    if (edgeListenerServiceActive && edgeListenerRoom == normalized) return
    webListenerServiceActive = true
    webListenerRoom = normalized
    val intent = Intent(this, QSessionPlaybackService::class.java).apply {
      action = QSessionPlaybackService.ACTION_START_WEB_PLAYBACK
      putExtra(QSessionPlaybackService.EXTRA_ROOM_CODE, normalized)
    }
    ContextCompat.startForegroundService(this, intent)
  }

  private fun startEdgeListenerService(
      roomCode: String,
      playbackUrl: String,
      muted: Boolean,
      gain: Double,
  ) {
    val normalizedRoom = roomCode.trim().uppercase()
    val uri = Uri.parse(playbackUrl.trim())
    if (!normalizedRoom.matches(Regex("^[A-Z0-9]{6}$")) ||
        !uri.scheme.equals("https", ignoreCase = true) ||
        uri.host.isNullOrBlank()) {
      return
    }
    listenerStopFallbackHandler.removeCallbacks(listenerStopFallback)
    webListenerServiceActive = true
    edgeListenerServiceActive = true
    webListenerRoom = normalizedRoom
    edgeListenerRoom = normalizedRoom
    edgeListenerUrl = uri.toString()
    edgeListenerMuted = muted
    edgeListenerGain = gain.coerceIn(0.0, 1.0)
    val intent = edgePlaybackIntent(QSessionPlaybackService.ACTION_START_EDGE_PLAYBACK).apply {
      putExtra(QSessionPlaybackService.EXTRA_BACKGROUND_ACTIVE, activityInBackground)
    }
    ContextCompat.startForegroundService(this, intent)
  }

  private fun stopEdgeListenerService() {
    edgeListenerServiceActive = false
    webListenerServiceActive = false
    webListenerRoom = ""
    edgeListenerRoom = ""
    edgeListenerUrl = ""
    QSessionPlaybackService.clearPersistedListenerSession(this)
    stopService(Intent(this, QSessionPlaybackService::class.java))
  }

  private fun setEdgeBackgroundPlayback(active: Boolean) {
    if (!edgeListenerServiceActive || edgeListenerUrl.isBlank()) return
    val intent = edgePlaybackIntent(QSessionPlaybackService.ACTION_SET_EDGE_BACKGROUND).apply {
      putExtra(QSessionPlaybackService.EXTRA_BACKGROUND_ACTIVE, active)
    }
    ContextCompat.startForegroundService(this, intent)
  }

  private fun updateEdgeListenerAudio() {
    if (!edgeListenerServiceActive || edgeListenerUrl.isBlank()) return
    ContextCompat.startForegroundService(
        this,
        edgePlaybackIntent(QSessionPlaybackService.ACTION_UPDATE_EDGE_AUDIO),
    )
  }

  private fun reassertListenerAudioFocus(roomCode: String = webListenerRoom) {
    val normalized = roomCode.trim().uppercase().takeIf {
      it.matches(Regex("^[A-Z0-9]{6}$"))
    } ?: webListenerRoom
    if (!webListenerServiceActive || normalized.isBlank()) return
    val intent = Intent(this, QSessionPlaybackService::class.java).apply {
      action = QSessionPlaybackService.ACTION_REASSERT_AUDIO_FOCUS
      putExtra(QSessionPlaybackService.EXTRA_ROOM_CODE, normalized)
    }
    ContextCompat.startForegroundService(this, intent)
  }

  private fun edgePlaybackIntent(actionName: String) =
      Intent(this, QSessionPlaybackService::class.java).apply {
        action = actionName
        putExtra(QSessionPlaybackService.EXTRA_ROOM_CODE, edgeListenerRoom)
        putExtra(QSessionPlaybackService.EXTRA_PLAYBACK_URL, edgeListenerUrl)
        putExtra(QSessionPlaybackService.EXTRA_MUTED, edgeListenerMuted)
        putExtra(QSessionPlaybackService.EXTRA_GAIN, edgeListenerGain)
      }

  private fun notifyWebEdgeBackground(active: Boolean) {
    if (!edgeListenerServiceActive || !::webView.isInitialized) return
    val detail = if (active) "true" else "false"
    webView.evaluateJavascript(
        "window.dispatchEvent(new CustomEvent('qsession-native-edge-background',{detail:{active:$detail}}));",
        null,
    )
  }

  private fun notifyWebBroadcastBackground(active: Boolean) {
    if (!::webView.isInitialized) return
    val detail = if (active) "true" else "false"
    webView.evaluateJavascript(
        "window.dispatchEvent(new CustomEvent('qsession-native-broadcast-background',{detail:{active:$detail}}));",
        null,
    )
  }

  private fun startBroadcastService(roomCode: String, requiresMicrophone: Boolean, requestId: String, requiresCamera: Boolean = false) {
    try {
      if (activityInBackground) throw IllegalStateException("Open QSession before starting a broadcast")
      if (requiresMicrophone && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
        throw SecurityException("Microphone permission has not been granted")
      }
      if (requiresCamera && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
        throw SecurityException("Camera permission has not been granted")
      }
      val intent = Intent(this, QSessionPlaybackService::class.java).apply {
        action = QSessionPlaybackService.ACTION_START_BROADCAST
        putExtra(QSessionPlaybackService.EXTRA_ROOM_CODE, roomCode)
        putExtra(QSessionPlaybackService.EXTRA_REQUIRES_MICROPHONE, requiresMicrophone)
        putExtra(QSessionPlaybackService.EXTRA_REQUIRES_CAMERA, requiresCamera)
        putExtra(QSessionPlaybackService.EXTRA_REQUEST_ID, requestId)
      }
      ContextCompat.startForegroundService(this, intent)
    } catch (error: Exception) {
      android.util.Log.e("QSessionBroadcast", "Broadcast service rejected", error)
      QSessionWebAudioBridge.report(JSONObject().apply {
        put("type", "broadcast-service-error")
        put("requestId", requestId)
        put("message", "No se pudo preparar la transmisión. Mantén QSession abierta y permite el micrófono si usas esa entrada.")
      }.toString())
    }
  }

  private fun isTrustedQSessionUri(uri: Uri): Boolean =
      uri.scheme.equals("https", ignoreCase = true) &&
          uri.host.equals("qsession.org", ignoreCase = true)

  private fun openUri(uri: Uri): Boolean {
    if (isTrustedQSessionUri(uri)) return false
    if (uri.scheme.equals("qsession", ignoreCase = true)) {
      webView.loadUrl(qSessionUrlFromDeepLink(uri))
      return true
    }
    openExternal(uri)
    return true
  }

  private fun openExternal(uri: Uri) {
    try {
      startActivity(Intent(Intent.ACTION_VIEW, uri))
    } catch (_: ActivityNotFoundException) {
      Toast.makeText(
          this,
          "No hay una aplicación disponible para abrir este enlace.",
          Toast.LENGTH_LONG,
      ).show()
    }
  }

  private fun handleMediaPermissionRequest(request: PermissionRequest) {
    if (!isTrustedQSessionUri(request.origin)) {
      request.deny()
      return
    }

    val resources = request.resources.toSet()
    val missingPermissions = mutableListOf<String>()
    if (
        PermissionRequest.RESOURCE_VIDEO_CAPTURE in resources &&
            checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED
    ) {
      missingPermissions += Manifest.permission.CAMERA
    }
    if (
        PermissionRequest.RESOURCE_AUDIO_CAPTURE in resources &&
            checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED
    ) {
      missingPermissions += Manifest.permission.RECORD_AUDIO
    }

    if (missingPermissions.isEmpty()) {
      grantSupportedMediaResources(request)
      return
    }
    pendingMediaRequest?.deny()
    pendingMediaRequest = request
    requestPermissions(missingPermissions.distinct().toTypedArray(), MEDIA_PERMISSION_REQUEST)
  }

  private fun grantSupportedMediaResources(request: PermissionRequest) {
    val grantedResources = request.resources.filter { resource ->
      when (resource) {
        PermissionRequest.RESOURCE_VIDEO_CAPTURE ->
          checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        PermissionRequest.RESOURCE_AUDIO_CAPTURE ->
          checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        else -> false
      }
    }.toTypedArray()
    if (grantedResources.isEmpty()) request.deny() else request.grant(grantedResources)
  }

  private fun handleLocationPermissionRequest(
      origin: String,
      callback: GeolocationPermissions.Callback,
  ) {
    val uri = Uri.parse(origin)
    if (!isTrustedQSessionUri(uri)) {
      callback.invoke(origin, false, false)
      return
    }
    if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
      callback.invoke(origin, true, false)
      return
    }
    pendingLocationOrigin = origin
    pendingLocationCallback = callback
    requestPermissions(
        arrayOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
        ),
        LOCATION_PERMISSION_REQUEST,
    )
  }

  override fun onRequestPermissionsResult(
      requestCode: Int,
      permissions: Array<out String>,
      grantResults: IntArray,
  ) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    when (requestCode) {
      MEDIA_PERMISSION_REQUEST -> {
        pendingMediaRequest?.let(::grantSupportedMediaResources)
        pendingMediaRequest = null
      }
      LOCATION_PERMISSION_REQUEST -> {
        val granted = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        pendingLocationCallback?.invoke(pendingLocationOrigin, granted, false)
        pendingLocationCallback = null
        pendingLocationOrigin = null
      }
      GPS_COUNTRY_PERMISSION_REQUEST -> {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
          startGpsCountryFix()
        } else {
          val requestId = pendingGpsRequestId
          pendingGpsRequestId = null
          if (requestId != null) {
            dispatchGpsCountryResult(
                requestId,
                countryCode = "",
                error = "Q Session necesita permiso de ubicación precisa para verificar el país mediante GPS.",
            )
          }
        }
      }
    }
  }

  @Deprecated("Uses the WebView file chooser compatibility contract")
  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.onActivityResult(requestCode, resultCode, data)
    if (requestCode != FILE_CHOOSER_REQUEST) return
    fileChooserCallback?.onReceiveValue(
        WebChromeClient.FileChooserParams.parseResult(resultCode, data),
    )
    fileChooserCallback = null
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    if (intent.data != null) webView.loadUrl(qSessionUrlFromIntent(intent))
  }

  private fun qSessionUrlFromIntent(intent: Intent?): String {
    val data = intent?.data ?: return androidVersionedUrl(Uri.parse("$QSESSION_ORIGIN/"))
    if (isTrustedQSessionUri(data)) return androidVersionedUrl(data)
    if (data.scheme.equals("qsession", ignoreCase = true)) return qSessionUrlFromDeepLink(data)
    return androidVersionedUrl(Uri.parse("$QSESSION_ORIGIN/"))
  }

  private fun androidVersionedUrl(uri: Uri): String = uri.buildUpon()
      .appendQueryParameter("androidVersion", BuildConfig.VERSION_NAME)
      .build()
      .toString()

  private fun qSessionUrlFromDeepLink(uri: Uri): String {
    val roomCode = (uri.getQueryParameter("room")
        ?: uri.getQueryParameter("code")
        ?: uri.lastPathSegment)
        ?.trim()
        ?.uppercase(Locale.ROOT)
        .orEmpty()
    if (!Regex("^[A-Z0-9]{6}$").matches(roomCode)) return androidVersionedUrl(Uri.parse("$QSESSION_ORIGIN/"))
    return androidVersionedUrl(Uri.parse("$QSESSION_ORIGIN/")
        .buildUpon()
        .appendQueryParameter("room", roomCode)
        .build())
  }

  private fun showConnectionError() {
    webView.loadDataWithBaseURL(
        QSESSION_ORIGIN,
        """
        <!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1">
        <body style="margin:0;background:#f7f4ed;color:#102d50;font-family:system-ui;display:grid;min-height:100vh;place-items:center;text-align:center">
          <main style="max-width:330px;padding:28px"><h1 style="font-size:32px;margin:0 0 12px">Volvamos a conectar.</h1>
          <p style="color:#638198;line-height:1.5">Q Session necesita Internet para abrir la experiencia compartida.</p>
          <button onclick="location.href='https://qsession.org/'" style="border:0;border-radius:18px;background:#69d3d7;color:#102d50;font-weight:800;padding:16px 24px">Reintentar</button></main>
        </body></html>
        """.trimIndent(),
        "text/html",
        "UTF-8",
        null,
    )
  }

  private fun hideFullScreenVideo() {
    val view = fullScreenView ?: return
    root.removeView(view)
    fullScreenView = null
    fullScreenCallback?.onCustomViewHidden()
    fullScreenCallback = null
    webView.visibility = View.VISIBLE
    @Suppress("DEPRECATION")
    window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_VISIBLE
    QSessionSystemBars.apply(this)
  }

  @Deprecated("Android back dispatch remains compatible with the current minimum SDK")
  override fun onBackPressed() {
    if (webListenerServiceActive || QSessionPlaybackService.hasPersistedListenerSession(this)) {
      stopListenerPlaybackForExplicitExit()
    }
    when {
      fullScreenView != null -> hideFullScreenVideo()
      webView.canGoBack() -> webView.goBack()
      else -> super.onBackPressed()
    }
  }

  override fun onSaveInstanceState(outState: Bundle) {
    webView.saveState(outState)
    super.onSaveInstanceState(outState)
  }

  override fun onResume() {
    super.onResume()
    activityInBackground = false
    notifyWebBroadcastBackground(false)
    webView.onResume()
    reassertListenerAudioFocus()
    webView.evaluateJavascript(
        "window.dispatchEvent(new Event('qsession-native-audio-resume'));",
        null,
    )
    notifyWebEdgeBackground(false)
    QSessionSystemBars.apply(this)
  }

  override fun onPause() {
    activityInBackground = true
    notifyWebBroadcastBackground(true)
    // onPause is the last lifecycle callback Android guarantees before it can
    // freeze a WebView. Start native HLS first, then stop Chromium's copy, so
    // locking the phone never creates a silent gap between the two players.
    setEdgeBackgroundPlayback(true)
    notifyWebEdgeBackground(true)
    super.onPause()
  }

  override fun onStop() {
    // Repeat the idempotent handoff for OEMs that skip or reorder screen-state
    // broadcasts. The foreground service keeps ownership until WebView reports
    // that visible playback has really resumed.
    setEdgeBackgroundPlayback(true)
    super.onStop()
  }

  override fun onDestroy() {
    if (isFinishing && !isChangingConfigurations &&
        (webListenerServiceActive || QSessionPlaybackService.hasPersistedListenerSession(this))) {
      stopListenerPlaybackForExplicitExit()
    }
    QSessionWebAudioBridge.registerWebReporter(null)
    cancelGpsCountryRequest(notify = false)
    pendingMediaRequest?.deny()
    pendingMediaRequest = null
    fileChooserCallback?.onReceiveValue(null)
    fileChooserCallback = null

    if (::webView.isInitialized) {
      webView.stopLoading()
      webView.webChromeClient = null
      webView.webViewClient = WebViewClient()
      root.removeView(webView)
      webView.destroy()
    }
    super.onDestroy()
  }
}
