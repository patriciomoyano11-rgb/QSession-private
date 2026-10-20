package org.qsession.app

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

object QSessionWebAudioBridge {
  private const val EVENT_NAME = "QSessionNativeAudioCommand"
  private val pending = mutableListOf<String>()
  private var context: ReactApplicationContext? = null
  private var ready = false
  private var webReporter: ((String) -> Unit)? = null

  @Synchronized
  fun register(reactContext: ReactApplicationContext) {
    context = reactContext
  }

  @Synchronized
  fun registerWebReporter(reporter: ((String) -> Unit)?) {
    webReporter = reporter
  }

  @Synchronized
  fun report(message: String) {
    webReporter?.invoke(message)
  }

  @Synchronized
  fun markReady() {
    ready = true
    val queued = pending.toList()
    pending.clear()
    queued.forEach(::emit)
  }

  @Synchronized
  fun send(message: String) {
    if (!ready || context?.hasActiveReactInstance() != true) {
      if (pending.size >= 20) pending.removeAt(0)
      pending += message
      return
    }
    emit(message)
  }

  private fun emit(message: String) {
    context
        ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        ?.emit(EVENT_NAME, message)
  }
}

class QSessionWebAudioModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  init {
    QSessionWebAudioBridge.register(reactContext)
  }

  override fun getName(): String = "QSessionWebAudio"

  @ReactMethod
  fun ready() {
    QSessionWebAudioBridge.markReady()
  }

  @ReactMethod
  fun report(message: String) {
    QSessionWebAudioBridge.report(message)
  }

  @ReactMethod
  fun addListener(eventName: String) = Unit

  @ReactMethod
  fun removeListeners(count: Int) = Unit
}
