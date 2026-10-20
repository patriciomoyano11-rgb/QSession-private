package org.qsession.app

import android.app.Application
import android.media.AudioAttributes
import android.media.AudioManager
import android.view.View
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.ReactRootView
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.defaults.DefaultReactNativeHost
import com.livekit.reactnative.LiveKitReactNative
import com.livekit.reactnative.audio.AudioType

class MainApplication : Application(), ReactApplication {

  private var audioEngineRoot: ReactRootView? = null
  private var liveKitAudioInitialized = false

  override val reactNativeHost: ReactNativeHost =
      object : DefaultReactNativeHost(this) {
        override fun getPackages(): List<ReactPackage> =
            PackageList(this).packages.apply {
              add(QSessionPlaybackPackage())
            }

        override fun getJSMainModuleName(): String = "index"

        override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

        override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
        override val isHermesEnabled: Boolean = BuildConfig.IS_HERMES_ENABLED
      }

  override val reactHost: ReactHost
    get() = getDefaultReactHost(applicationContext, reactNativeHost)

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }

  @Synchronized
  fun ensureAudioEngineStarted(): ReactRootView {
    audioEngineRoot?.let { return it }
    if (!liveKitAudioInitialized) {
      val mediaAttributes = AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
          .build()
      LiveKitReactNative.setup(
          this,
          AudioType.CustomAudioType(
              AudioManager.MODE_NORMAL,
              mediaAttributes,
              AudioManager.STREAM_MUSIC,
          ),
      )
      liveKitAudioInitialized = true
    }
    return ReactRootView(applicationContext).also { reactRoot ->
      reactRoot.alpha = 0f
      reactRoot.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
      reactRoot.startReactApplication(
          reactNativeHost.reactInstanceManager,
          "QSessionAudioEngine",
          null,
      )
      audioEngineRoot = reactRoot
    }
  }
}
