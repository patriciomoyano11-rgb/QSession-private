package org.qsession.app

import android.os.Bundle
import com.journeyapps.barcodescanner.CaptureActivity

class QSessionCaptureActivity : CaptureActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    QSessionSystemBars.apply(this)
  }
}
