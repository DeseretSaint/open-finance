// RemoteServerBootReceiver.kt — restarts the remote bridge after a reboot.
// The foreground service is START_STICKY, but the OS does not re-start
// services for BOOT_COMPLETED on its own for an app that was never launched
// post-reboot; this receiver starts it (which re-binds the 8787 socket and,
// when the app UI opens, the WebView dispatcher re-registers). Only acts when
// the user had remote access enabled before the reboot (flag written by
// RemoteServerPlugin.start/stop).

package com.openfinance.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences

class RemoteServerBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val prefs: SharedPreferences = context.getSharedPreferences("remote_server", Context.MODE_PRIVATE)
        if (!prefs.getBoolean("enabled", false)) return
        val service = Intent(context, RemoteServerService::class.java).putExtra("port", 8787)
        try {
            context.startForegroundService(service)
        } catch (_: Exception) {
            // Best-effort — the app may be in a restricted state right after boot.
        }
    }
}
