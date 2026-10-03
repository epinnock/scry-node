// Release copy of ScryLaunch.kt: does nothing. The real hook and the screen registry live in
// app/src/debug, so a release build has no capture code, no `scry_screen` extra and no registry.
package com.scrymore.kettle

import android.content.Intent
import androidx.compose.runtime.Composable

object ScryLaunch {
    @Suppress("UNUSED_PARAMETER")
    fun requestedScreen(intent: Intent?): String? = null
}

@Composable
@Suppress("UNUSED_PARAMETER")
fun ScryCaptureRoot(id: String) {
}
