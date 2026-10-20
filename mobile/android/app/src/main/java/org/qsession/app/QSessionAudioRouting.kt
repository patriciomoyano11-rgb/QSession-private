package org.qsession.app

import android.media.AudioDeviceInfo
import android.media.AudioManager

object QSessionAudioRouting {
  fun hasWiredOrUsbOutput(audioManager: AudioManager): Boolean =
      audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any { device ->
        isWiredOrUsbOutput(device.type)
      }

  internal fun isWiredOrUsbOutput(deviceType: Int): Boolean =
      deviceType == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
          deviceType == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
          deviceType == AudioDeviceInfo.TYPE_USB_DEVICE ||
          deviceType == AudioDeviceInfo.TYPE_USB_ACCESSORY ||
          deviceType == AudioDeviceInfo.TYPE_USB_HEADSET
}
