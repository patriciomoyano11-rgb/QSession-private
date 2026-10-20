package org.qsession.app

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Geocoder
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.Locale

class QSessionLocationModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {

  override fun getName(): String = "QSessionLocation"

  @Suppress("DEPRECATION")
  private fun countryCode(location: Location): String {
    if (!Geocoder.isPresent()) return ""
    return try {
      Geocoder(context, Locale.US)
        .getFromLocation(location.latitude, location.longitude, 1)
        ?.firstOrNull()
        ?.countryCode
        ?.uppercase(Locale.US)
        .orEmpty()
    } catch (_: Exception) {
      ""
    }
  }

  @ReactMethod
  fun getCurrentApproximate(promise: Promise) {
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
      promise.reject("QSESSION_LOCATION_PERMISSION", "Q Session necesita permiso de ubicación precisa para verificar el país por GPS.")
      return
    }

    val manager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    if (!manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
      promise.reject("QSESSION_LOCATION_DISABLED", "Activa la ubicación GPS del teléfono para aparecer en Global Rave.")
      return
    }
    val provider = LocationManager.GPS_PROVIDER

    val handler = Handler(Looper.getMainLooper())
    var completed = false
    lateinit var listener: LocationListener
    fun finish(location: Location?, error: String? = null) {
      if (completed) return
      completed = true
      handler.removeCallbacksAndMessages(listener)
      manager.removeUpdates(listener)
      if (location == null) {
        promise.reject("QSESSION_LOCATION_UNAVAILABLE", error ?: "No fue posible obtener la ubicación aproximada.")
        return
      }
      // Reverse geocoding runs away from the UI thread. The network request
      // later keeps only the ISO country code; coordinates never leave the app.
      Thread {
        val result = Arguments.createMap().apply {
          putDouble("latitude", location.latitude)
          putDouble("longitude", location.longitude)
          putDouble("accuracy", location.accuracy.toDouble())
          putDouble("capturedAt", location.time.toDouble())
          putString("countryCode", countryCode(location))
        }
        promise.resolve(result)
      }.start()
    }

    listener = object : LocationListener {
      override fun onLocationChanged(location: Location) = finish(location)
      override fun onProviderDisabled(disabledProvider: String) = Unit
      override fun onProviderEnabled(enabledProvider: String) = Unit
      override fun onStatusChanged(changedProvider: String?, status: Int, extras: Bundle?) = Unit
    }

    try {
      manager.requestLocationUpdates(provider, 0L, 0f, listener, Looper.getMainLooper())
      handler.postAtTime({
        val fallback = try { manager.getLastKnownLocation(provider) } catch (_: SecurityException) { null }
        val freshFallback = fallback?.takeIf { System.currentTimeMillis() - it.time <= 10 * 60 * 1000L }
        finish(freshFallback, "El GPS todavía no obtuvo una posición. Sal al exterior o acércate a una ventana e inténtalo nuevamente.")
      }, listener, android.os.SystemClock.uptimeMillis() + 12000L)
    } catch (error: Exception) {
      finish(null, error.message)
    }
  }
}
