package org.qsession.app

import android.media.MediaPlayer
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

class QSessionVoiceNoteModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {

  private var recorder: MediaRecorder? = null
  private var recordingFile: File? = null
  private var recordingStartedAt = 0L
  private var player: MediaPlayer? = null
  private var playbackFile: File? = null

  override fun getName(): String = "QSessionVoiceNote"

  @Suppress("DEPRECATION")
  private fun newRecorder(): MediaRecorder =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(context) else MediaRecorder()

  @ReactMethod
  @Synchronized
  fun start(promise: Promise) {
    if (recorder != null) {
      promise.reject("QSESSION_VOICE_BUSY", "Ya hay una nota de voz grabándose.")
      return
    }
    val file = File.createTempFile("qsession-voice-", ".m4a", context.cacheDir)
    try {
      val next = newRecorder().apply {
        setAudioSource(MediaRecorder.AudioSource.MIC)
        setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
        setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
        setAudioChannels(1)
        setAudioSamplingRate(48000)
        setAudioEncodingBitRate(64000)
        setMaxDuration(30000)
        setOutputFile(file.absolutePath)
        prepare()
        start()
      }
      recorder = next
      recordingFile = file
      recordingStartedAt = System.currentTimeMillis()
      promise.resolve(true)
    } catch (error: Exception) {
      file.delete()
      recorder?.release()
      recorder = null
      recordingFile = null
      promise.reject("QSESSION_VOICE_START", error)
    }
  }

  @ReactMethod
  @Synchronized
  fun stop(promise: Promise) {
    val current = recorder
    val file = recordingFile
    if (current == null || file == null) {
      promise.reject("QSESSION_VOICE_IDLE", "No hay una nota de voz grabándose.")
      return
    }
    recorder = null
    recordingFile = null
    try {
      current.stop()
      current.release()
      val bytes = file.readBytes()
      if (bytes.size > 512 * 1024) throw IllegalStateException("La nota de voz es demasiado grande.")
      val duration = (System.currentTimeMillis() - recordingStartedAt).coerceIn(300L, 30000L)
      val result = Arguments.createMap().apply {
        putString("dataUrl", "data:audio/mp4;base64,${Base64.encodeToString(bytes, Base64.NO_WRAP)}")
        putString("mimeType", "audio/mp4")
        putDouble("durationMs", duration.toDouble())
        putInt("byteLength", bytes.size)
      }
      promise.resolve(result)
    } catch (error: Exception) {
      try { current.release() } catch (_: Exception) {}
      promise.reject("QSESSION_VOICE_STOP", error)
    } finally {
      file.delete()
      recordingStartedAt = 0L
    }
  }

  @ReactMethod
  @Synchronized
  fun cancel(promise: Promise) {
    try { recorder?.stop() } catch (_: Exception) {}
    try { recorder?.release() } catch (_: Exception) {}
    recorder = null
    recordingFile?.delete()
    recordingFile = null
    recordingStartedAt = 0L
    promise.resolve(true)
  }

  @ReactMethod
  @Synchronized
  fun play(source: String, authorization: String?, promise: Promise) {
    stopPlayer()
    val remote = source.startsWith("https://", ignoreCase = true) || source.startsWith("http://", ignoreCase = true)
    val match = if (remote) null else Regex("^data:audio/(mp4|mpeg|aac|webm|ogg)(?:;codecs=[A-Za-z0-9._-]+)?;base64,(.+)$", RegexOption.IGNORE_CASE).matchEntire(source)
    if (!remote && match == null) {
      promise.reject("QSESSION_VOICE_FORMAT", "El formato de esta nota de voz no es compatible.")
      return
    }
    try {
      val next = MediaPlayer().apply {
        if (remote) {
          val headers = if (authorization.isNullOrBlank()) emptyMap() else mapOf("Authorization" to "Bearer $authorization")
          setDataSource(context, Uri.parse(source), headers)
        } else {
          val resolved = requireNotNull(match)
          val bytes = Base64.decode(resolved.groupValues[2], Base64.DEFAULT)
          val extension = when (resolved.groupValues[1].lowercase()) {
            "webm" -> ".webm"
            "ogg" -> ".ogg"
            "mpeg" -> ".mp3"
            else -> ".m4a"
          }
          val file = File.createTempFile("qsession-play-", extension, context.cacheDir)
          file.writeBytes(bytes)
          playbackFile = file
          setDataSource(file.absolutePath)
        }
        setOnCompletionListener {
          stopPlayer()
          promise.resolve(true)
        }
        setOnErrorListener { _, what, extra ->
          stopPlayer()
          promise.reject("QSESSION_VOICE_PLAY", "No fue posible reproducir la nota de voz ($what/$extra).")
          true
        }
        prepare()
        start()
      }
      player = next
    } catch (error: Exception) {
      stopPlayer()
      promise.reject("QSESSION_VOICE_PLAY", error)
    }
  }

  @ReactMethod
  @Synchronized
  fun stopPlayback(promise: Promise) {
    stopPlayer()
    promise.resolve(true)
  }

  @Synchronized
  private fun stopPlayer() {
    try { player?.stop() } catch (_: Exception) {}
    try { player?.release() } catch (_: Exception) {}
    player = null
    playbackFile?.delete()
    playbackFile = null
  }

  override fun invalidate() {
    try { recorder?.release() } catch (_: Exception) {}
    recorder = null
    recordingFile?.delete()
    recordingFile = null
    stopPlayer()
    super.invalidate()
  }
}
