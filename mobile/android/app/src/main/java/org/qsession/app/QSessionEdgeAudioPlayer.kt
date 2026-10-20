package org.qsession.app

import android.content.Context
import android.os.SystemClock
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector

/**
 * Audio-only HLS handoff used while Q Session's WebView is in the background.
 *
 * The visible WebView remains the only player while the app is on screen. This
 * player keeps just a small buffer warm, takes over when Android backgrounds
 * the Activity, and gives playback back after the WebView confirms that its
 * live video is running again. System volume is never written here: USAGE_MEDIA
 * deliberately leaves the physical volume buttons in charge of STREAM_MUSIC.
 */
@OptIn(UnstableApi::class)
class QSessionEdgeAudioPlayer(
    context: Context,
    private val onPlaybackFailure: () -> Unit,
) {
  private val trackSelector = DefaultTrackSelector(context).apply {
    parameters = buildUponParameters()
        .setTrackTypeDisabled(C.TRACK_TYPE_VIDEO, true)
        .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
        .build()
  }
  private val loadControl = DefaultLoadControl.Builder()
      .setBufferDurationsMs(
          2_000,
          6_000,
          350,
          750,
      )
      .build()
  private val player = ExoPlayer.Builder(context)
      .setTrackSelector(trackSelector)
      .setLoadControl(loadControl)
      .build()
      .apply {
        setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .build(),
            true,
        )
        setWakeMode(C.WAKE_MODE_NETWORK)
        setHandleAudioBecomingNoisy(true)
        addListener(object : Player.Listener {
          override fun onPlayerError(error: PlaybackException) {
            if (backgroundActive) onPlaybackFailure()
          }
          override fun onPlaybackStateChanged(playbackState: Int) {
            if (playbackState == Player.STATE_READY) lastHealthyAt = SystemClock.elapsedRealtime()
            if (playbackState == Player.STATE_ENDED && backgroundActive) onPlaybackFailure()
          }
          override fun onIsPlayingChanged(isPlaying: Boolean) {
            if (isPlaying) lastHealthyAt = SystemClock.elapsedRealtime()
          }
        })
      }

  private var sourceUrl = ""
  private var backgroundActive = false
  private var lastRecoveryAt = 0L
  private var lastHealthyAt = 0L

  fun prepare(url: String, muted: Boolean, gain: Double) {
    val normalizedUrl = url.trim()
    updateVolume(muted, gain)
    if (normalizedUrl.isBlank()) return
    if (sourceUrl != normalizedUrl) {
      sourceUrl = normalizedUrl
      player.setMediaItem(
          MediaItem.Builder()
              .setUri(normalizedUrl)
              .setMimeType(MimeTypes.APPLICATION_M3U8)
              .build(),
      )
      player.prepare()
      return
    }
    if (player.playbackState == Player.STATE_IDLE) player.prepare()
  }

  fun updateVolume(muted: Boolean, gain: Double) {
    player.volume = if (muted) 0f else gain.coerceIn(0.0, 1.0).toFloat()
  }

  fun setBackgroundActive(active: Boolean) {
    backgroundActive = active
    player.setForegroundMode(active)
    if (!active) {
      player.pause()
      return
    }
    if (sourceUrl.isBlank()) return
    if (player.playbackState == Player.STATE_IDLE || player.playbackState == Player.STATE_ENDED) {
      player.prepare()
    }
    // The player may have been warm for several minutes. Jump to the current
    // default position so lock-screen playback starts at the live edge.
    player.seekToDefaultPosition()
    player.playWhenReady = true
  }

  fun ensurePlaying(forceRecovery: Boolean = false) {
    if (!backgroundActive || sourceUrl.isBlank() || player.isPlaying) return
    val now = SystemClock.elapsedRealtime()
    val stalled = player.playbackState == Player.STATE_BUFFERING
        && now - maxOf(lastHealthyAt, lastRecoveryAt) >= 12_000L
    if ((forceRecovery || stalled || player.playbackState == Player.STATE_IDLE || player.playbackState == Player.STATE_ENDED)
        && now - lastRecoveryAt >= 1_500L) {
      recoverAtLiveEdge(now)
      return
    }
    player.playWhenReady = true
  }

  private fun recoverAtLiveEdge(now: Long = SystemClock.elapsedRealtime()) {
    if (sourceUrl.isBlank()) return
    lastRecoveryAt = now
    player.stop()
    player.setMediaItem(
        MediaItem.Builder()
            .setUri(sourceUrl)
            .setMimeType(MimeTypes.APPLICATION_M3U8)
            .build(),
    )
    player.prepare()
    player.seekToDefaultPosition()
    player.playWhenReady = true
  }

  fun release() {
    backgroundActive = false
    sourceUrl = ""
    player.release()
  }
}
