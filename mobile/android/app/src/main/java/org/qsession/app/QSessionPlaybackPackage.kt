package org.qsession.app

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class QSessionPlaybackPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
      listOf(
          QSessionPlaybackModule(reactContext),
          QSessionQrScannerModule(reactContext),
          QSessionProfileModule(reactContext),
          QSessionLocationModule(reactContext),
          QSessionVoiceNoteModule(reactContext),
          QSessionWebAudioModule(reactContext),
      )

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
      emptyList()
}
