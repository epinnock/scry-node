// ScryLaunch.kt (debug source set only) - lets scripts/capture.sh ask the app for one screen by id.
// Start the activity with `--es scry_screen <id>`; it then renders only that screen on the fixed canvas.
// The release source set has a no-op copy of this file, so a release build carries no capture code.
package com.scrymore.kettle

import android.content.Intent
import android.util.Log
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.withFrameNanos
import com.scrymore.kettle.ui.KettleCanvasBox

data class ScryScreen(val id: String, val name: String, val file: String, val line: Int, val content: @Composable () -> Unit)

object ScryLaunch {
    const val EXTRA = "scry_screen"
    fun requestedScreen(intent: Intent?): String? = intent?.getStringExtra(EXTRA)
}

@Composable
fun ScryCaptureRoot(id: String) {
    val screen = ScryScreens.all.firstOrNull { it.id == id }
    if (screen == null) {
        Log.i("scry", "scry:unknown $id")
        return
    }
    KettleCanvasBox { screen.content() }
    LaunchedEffect(id) {
        // Two frames after the first composition, so the pixels are on screen before capture.sh looks.
        withFrameNanos { }
        withFrameNanos { }
        Log.i("scry", "scry:ready $id")  // capture.sh waits for this logcat line
    }
}
