package org.qsession.app

import android.app.Activity
import android.content.Intent
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.google.zxing.integration.android.IntentIntegrator
import java.net.Inet4Address
import java.net.NetworkInterface

class QSessionQrScannerModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context), ActivityEventListener {

  private var scanPromise: Promise? = null

  init {
    context.addActivityEventListener(this)
  }

  override fun getName(): String = "QSessionQrScanner"

  @ReactMethod
  fun scan(promise: Promise) {
    val activity = context.currentActivity
    if (activity == null) {
      promise.reject("QSESSION_QR_ACTIVITY", "No fue posible abrir la cámara.")
      return
    }
    if (scanPromise != null) {
      promise.reject("QSESSION_QR_ACTIVE", "El escáner ya está abierto.")
      return
    }

    scanPromise = promise
    try {
      IntentIntegrator(activity).apply {
        setCaptureActivity(QSessionCaptureActivity::class.java)
        setDesiredBarcodeFormats(IntentIntegrator.QR_CODE)
        setPrompt("Apunta al código QR de la sala QSession")
        setBeepEnabled(false)
        setBarcodeImageEnabled(false)
        setOrientationLocked(true)
        initiateScan()
      }
    } catch (error: Exception) {
      scanPromise = null
      promise.reject("QSESSION_QR_OPEN", error)
    }
  }

  @ReactMethod
  fun getLocalIpv4(promise: Promise) {
    try {
      val interfaces = NetworkInterface.getNetworkInterfaces().toList()
          .sortedBy { if (it.name.startsWith("wlan", ignoreCase = true)) 0 else 1 }
      for (network in interfaces) {
        for (address in network.inetAddresses.toList()) {
          if (address is Inet4Address && !address.isLoopbackAddress && address.isSiteLocalAddress) {
            promise.resolve(address.hostAddress)
            return
          }
        }
      }
      promise.reject("QSESSION_WIFI_IP", "Android no encontró una dirección Wi-Fi local.")
    } catch (error: Exception) {
      promise.reject("QSESSION_WIFI_IP", error)
    }
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    val result = IntentIntegrator.parseActivityResult(requestCode, resultCode, data) ?: return
    val promise = scanPromise ?: return
    scanPromise = null
    promise.resolve(result.contents)
  }

  override fun onNewIntent(intent: Intent) = Unit
}
