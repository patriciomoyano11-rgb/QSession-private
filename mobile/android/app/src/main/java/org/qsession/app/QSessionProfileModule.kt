package org.qsession.app

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.ByteArrayOutputStream
import java.security.KeyStore
import java.util.Locale
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class QSessionProfileModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context), ActivityEventListener {

  companion object {
    private const val PICK_PROFILE_PHOTO = 7341
    private const val PREFERENCES = "qsession_profile"
    private const val PROFILE_KEY = "profile_json"
    private const val LANGUAGE_KEY = "preferred_language"
    private const val ACTIVE_USAGE_MS_KEY = "active_usage_ms"
    private const val NOTIFICATION_PROMPTED_KEY = "notification_permission_prompted"
    private const val ACCOUNT_SESSION_KEY = "account_session_encrypted"
    private const val ACCOUNT_KEY_ALIAS = "qsession_account_session_v1"
  }

  private var photoPromise: Promise? = null

  init {
    context.addActivityEventListener(this)
  }

  override fun getName(): String = "QSessionProfile"

  @ReactMethod
  fun load(promise: Promise) {
    try {
      val profile = context.getSharedPreferences(PREFERENCES, 0).getString(PROFILE_KEY, null)
      promise.resolve(profile)
    } catch (error: Exception) {
      promise.reject("QSESSION_PROFILE_LOAD", error)
    }
  }

  @ReactMethod
  fun save(profileJson: String, promise: Promise) {
    try {
      context.getSharedPreferences(PREFERENCES, 0)
          .edit()
          .putString(PROFILE_KEY, profileJson)
          .apply()
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("QSESSION_PROFILE_SAVE", error)
    }
  }

  private fun accountKey(): SecretKey {
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (keyStore.getKey(ACCOUNT_KEY_ALIAS, null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(
        KeyGenParameterSpec.Builder(
            ACCOUNT_KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build(),
    )
    return generator.generateKey()
  }

  @ReactMethod
  fun saveAccountSession(sessionJson: String, promise: Promise) {
    try {
      val preferences = context.getSharedPreferences(PREFERENCES, 0)
      if (sessionJson.isBlank()) {
        preferences.edit().remove(ACCOUNT_SESSION_KEY).apply()
        promise.resolve(true)
        return
      }
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.ENCRYPT_MODE, accountKey())
      val encrypted = cipher.doFinal(sessionJson.toByteArray(Charsets.UTF_8))
      val packed = Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + "." + Base64.encodeToString(encrypted, Base64.NO_WRAP)
      preferences.edit().putString(ACCOUNT_SESSION_KEY, packed).apply()
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("QSESSION_ACCOUNT_SESSION_SAVE", error)
    }
  }

  @ReactMethod
  fun loadAccountSession(promise: Promise) {
    try {
      val preferences = context.getSharedPreferences(PREFERENCES, 0)
      val packed = preferences.getString(ACCOUNT_SESSION_KEY, null)
      if (packed.isNullOrBlank()) {
        promise.resolve(null)
        return
      }
      val parts = packed.split('.', limit = 2)
      if (parts.size != 2) throw IllegalStateException("La sesión guardada no es válida.")
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(
          Cipher.DECRYPT_MODE,
          accountKey(),
          GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)),
      )
      val decrypted = cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP))
      promise.resolve(String(decrypted, Charsets.UTF_8))
    } catch (error: Exception) {
      context.getSharedPreferences(PREFERENCES, 0).edit().remove(ACCOUNT_SESSION_KEY).apply()
      promise.reject("QSESSION_ACCOUNT_SESSION_LOAD", error)
    }
  }

  @ReactMethod
  fun clearAccountSession(promise: Promise) {
    try {
      context.getSharedPreferences(PREFERENCES, 0).edit().remove(ACCOUNT_SESSION_KEY).apply()
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("QSESSION_ACCOUNT_SESSION_CLEAR", error)
    }
  }

  @ReactMethod
  fun loadLanguage(promise: Promise) {
    try {
      val saved = context.getSharedPreferences(PREFERENCES, 0).getString(LANGUAGE_KEY, null)
      val detected = if (Locale.getDefault().language.equals("es", ignoreCase = true)) "es" else "en"
      promise.resolve(saved ?: detected)
    } catch (error: Exception) {
      promise.reject("QSESSION_LANGUAGE_LOAD", error)
    }
  }

  @ReactMethod
  fun saveLanguage(language: String, promise: Promise) {
    if (language != "es" && language != "en") {
      promise.reject("QSESSION_LANGUAGE_INVALID", "Unsupported QSession language")
      return
    }
    try {
      context.getSharedPreferences(PREFERENCES, 0).edit().putString(LANGUAGE_KEY, language).apply()
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("QSESSION_LANGUAGE_SAVE", error)
    }
  }

  @ReactMethod
  fun loadEngagementState(promise: Promise) {
    try {
      val preferences = context.getSharedPreferences(PREFERENCES, 0)
      val result = Arguments.createMap().apply {
        putDouble("activeUsageMs", preferences.getLong(ACTIVE_USAGE_MS_KEY, 0L).toDouble())
        putBoolean("notificationPrompted", preferences.getBoolean(NOTIFICATION_PROMPTED_KEY, false))
      }
      promise.resolve(result)
    } catch (error: Exception) {
      promise.reject("QSESSION_ENGAGEMENT_LOAD", error)
    }
  }

  @ReactMethod
  fun saveEngagementState(activeUsageMs: Double, notificationPrompted: Boolean, promise: Promise) {
    try {
      context.getSharedPreferences(PREFERENCES, 0)
          .edit()
          .putLong(ACTIVE_USAGE_MS_KEY, activeUsageMs.coerceAtLeast(0.0).toLong())
          .putBoolean(NOTIFICATION_PROMPTED_KEY, notificationPrompted)
          .apply()
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("QSESSION_ENGAGEMENT_SAVE", error)
    }
  }

  @ReactMethod
  fun pickPhoto(promise: Promise) {
    val activity = context.currentActivity
    if (activity == null) {
      promise.reject("QSESSION_PROFILE_ACTIVITY", "No fue posible abrir tus fotos.")
      return
    }
    if (photoPromise != null) {
      promise.reject("QSESSION_PROFILE_PICKER_ACTIVE", "El selector de fotos ya está abierto.")
      return
    }

    photoPromise = promise
    try {
      val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        Intent(MediaStore.ACTION_PICK_IMAGES).apply { type = "image/*" }
      } else {
        Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
          addCategory(Intent.CATEGORY_OPENABLE)
          type = "image/*"
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        }
      }
      activity.startActivityForResult(intent, PICK_PROFILE_PHOTO)
    } catch (error: Exception) {
      photoPromise = null
      promise.reject("QSESSION_PROFILE_PICKER", error)
    }
  }

  @ReactMethod
  fun readPhotoData(uriValue: String, promise: Promise) {
    try {
      promise.resolve(optimizedPhotoData(Uri.parse(uriValue)))
    } catch (error: Exception) {
      promise.reject("QSESSION_PROFILE_PHOTO_READ", error)
    }
  }

  private fun optimizedPhotoData(uri: Uri): String {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        ?: throw IllegalArgumentException("No fue posible leer la foto seleccionada.")
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
      throw IllegalArgumentException("El archivo seleccionado no contiene una imagen válida.")
    }

    var sampleSize = 1
    while (bounds.outWidth / sampleSize > 1024 || bounds.outHeight / sampleSize > 1024) sampleSize *= 2
    val options = BitmapFactory.Options().apply {
      inSampleSize = sampleSize
      inPreferredConfig = Bitmap.Config.ARGB_8888
    }
    var decoded: Bitmap? = null
    var resized: Bitmap? = null
    try {
      val bitmap = context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) }
          ?: throw IllegalArgumentException("No fue posible procesar la foto seleccionada.")
      decoded = bitmap
      val longest = maxOf(bitmap.width, bitmap.height)
      val outputBitmap = if (longest > 512) {
        val scale = 512f / longest.toFloat()
        Bitmap.createScaledBitmap(
            bitmap,
            maxOf(1, (bitmap.width * scale).toInt()),
            maxOf(1, (bitmap.height * scale).toInt()),
            true,
        )
      } else bitmap
      resized = outputBitmap

      val output = ByteArrayOutputStream()
      if (!outputBitmap.compress(Bitmap.CompressFormat.JPEG, 82, output)) {
        throw IllegalStateException("No fue posible comprimir la foto.")
      }
      val encoded = Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)
      return "data:image/jpeg;base64,$encoded"
    } finally {
      if (resized != null && resized !== decoded) resized.recycle()
      decoded?.recycle()
    }
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != PICK_PROFILE_PHOTO) return
    val promise = photoPromise ?: return
    photoPromise = null
    if (resultCode != Activity.RESULT_OK || data?.data == null) {
      promise.resolve(null)
      return
    }

    val uri = data.data!!
    try {
      context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
    } catch (_: SecurityException) {
      // The selected provider may grant access without supporting persistable permissions.
    }
    Thread {
      try {
        val result = Arguments.createMap().apply {
          putString("uri", uri.toString())
          putString("dataUrl", optimizedPhotoData(uri))
        }
        promise.resolve(result)
      } catch (error: Exception) {
        promise.reject("QSESSION_PROFILE_PHOTO_READ", error)
      }
    }.start()
  }

  override fun onNewIntent(intent: Intent) = Unit
}
