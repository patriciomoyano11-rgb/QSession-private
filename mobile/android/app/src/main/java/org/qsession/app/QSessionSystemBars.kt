package org.qsession.app

import android.app.Activity
import android.graphics.Color
import android.os.Build
import android.view.View
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

object QSessionSystemBars {
  private val surfaceColor = Color.rgb(247, 244, 238)

  fun apply(activity: Activity) {
    activity.window.apply {
      statusBarColor = surfaceColor
      navigationBarColor = surfaceColor
      decorView.setBackgroundColor(surfaceColor)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        isStatusBarContrastEnforced = false
        isNavigationBarContrastEnforced = false
      }
    }
    WindowCompat.setDecorFitsSystemWindows(activity.window, false)
    WindowCompat.getInsetsController(activity.window, activity.window.decorView).apply {
      isAppearanceLightStatusBars = true
      isAppearanceLightNavigationBars = true
    }

    val content = activity.findViewById<View>(android.R.id.content)
    content.setBackgroundColor(surfaceColor)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val safeInsets = insets.getInsets(
          WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
      )
      view.setPadding(safeInsets.left, safeInsets.top, safeInsets.right, safeInsets.bottom)
      insets
    }
    ViewCompat.requestApplyInsets(content)
  }
}
