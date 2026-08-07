// RemoteServerService.kt — P8b solo "share-to-agent" foreground service.
// Hosts the HTTP/1.1 socket on port 8787 so an agent hub can reach the phone
// DIRECTLY over Tailscale. Running as a foreground service with a wake lock
// keeps the socket reachable even when the app is backgrounded / screen sleeps.
//
// Why a foreground service: Android's power-management restrictions table
// (developer.android.com/topic/performance/power/power-details) states that an
// app process "running a foreground service" has NO network restrictions —
// without it, Doze/app-standby suspends the app's network access the moment it
// leaves the foreground, so inbound SYN packets to a plain-thread socket are
// never answered (the badge says "listening" but the OS drops the handshake).
//
// Type: specialUse — the dataSync type has a 6h/day cap on Android 15+ which
// would kill an always-on server; specialUse has no time limit and no runtime
// prerequisites (FGS types, developer.android.com/develop/background-work/
// services/fgs/service-types).
//
// Security: every request is bearer-token checked INSIDE soloDispatch (the JS
// side compares against the device's remote-access token stored in app_state).
// This service never sees the token. Requests without a valid
// `Authorization: Bearer *** header get a 401 JSON envelope.
//
// The socket/accept-loop live HERE (not the plugin) so a START_STICKY restart
// after a process kill re-binds the port without needing the WebView.

package com.openfinance.app

import android.app.ActivityManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStream
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class RemoteServerService : Service() {

    companion object {
        const val NOTIF_ID = 8787
        private const val CHANNEL_ID = "openfinance_remote"

        @Volatile
        var serverSocket: ServerSocket? = null
        @Volatile
        private var executor: ExecutorService? = null

        /** Set by RemoteServerPlugin.start() — bridges one request to the WebView JS. */
        @Volatile
        var dispatcher: ((String) -> String?)? = null

        fun isRunning(): Boolean =
            serverSocket != null && !serverSocket!!.isClosed

        /** Close the socket and stop the accept loop (idempotent). */
        fun stopServer() {
            try {
                serverSocket?.close()
            } catch (_: Exception) {
            }
            serverSocket = null
            executor?.shutdownNow()
            executor = null
        }
    }

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        // Must be called within ~5s of startForegroundService — the notification
        // is the user-visible proof the remote server is alive.
        startForegroundCompat()
        acquireWakeLock()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Re-bind the socket if this is a START_STICKY restart after a process
        // kill (serverSocket would be null).
        if (serverSocket == null) {
            val port = intent?.getIntExtra("port", 8787) ?: 8787
            startAcceptLoop(port)
        }
        return START_STICKY
    }

    override fun onDestroy() {
        stopServer()
        wakeLock?.let {
            if (it.isHeld) it.release()
        }
        wakeLock = null
        super.onDestroy()
    }

    private fun startForegroundCompat() {
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) { // 34+
            startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIF_ID, notification)
        }
    }

    private fun acquireWakeLock() {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "OpenFinance::RemoteServer")
        wakeLock?.setReferenceCounted(false)
        // No timeout: released in onDestroy. Holding it keeps the CPU up so the
        // accept loop can answer handshakes while the screen is off.
        wakeLock?.acquire()
    }

    private fun startAcceptLoop(port: Int) {
        executor = Executors.newCachedThreadPool()
        Thread {
            try {
                // Bind to all interfaces (0.0.0.0) so the agent can reach the
                // phone over Tailscale (packets arrive destined for the
                // device's 100.x.y.z address, not loopback) AND over a LAN if
                // the user is on one. Exposure is controlled by the bearer-token
                // gate in solo-router (every remote request must present it),
                // not by the bind interface — binding loopback would break
                // Tailscale connectivity. The port only listens while remote
                // access is enabled, and the token is device-local.
                val ss = ServerSocket(port)
                serverSocket = ss
                Log.i("RemoteServer", "listening on $port")
                while (!ss.isClosed) {
                    val client = ss.accept()
                    executor?.execute { handle(client) }
                }
            } catch (e: Exception) {
                Log.w("RemoteServer", "server stopped", e)
            }
        }.start()
    }

    private fun handle(client: Socket) {
        try {
            client.soTimeout = 30_000
            val reader = BufferedReader(InputStreamReader(client.getInputStream()))
            val requestLine = reader.readLine() ?: return
            val parts = requestLine.split(" ")
            if (parts.size < 2) return
            val method = parts[0]
            val target = parts[1]
            val qIndex = target.indexOf('?')
            val path = if (qIndex >= 0) target.substring(0, qIndex) else target
            val query = if (qIndex >= 0) target.substring(qIndex + 1) else ""

            val headers = mutableMapOf<String, String>()
            var contentLength = 0
            while (true) {
                val line = reader.readLine() ?: break
                if (line.isEmpty()) break
                val ci = line.indexOf(':')
                if (ci > 0) {
                    val name = line.substring(0, ci).trim().lowercase()
                    val value = line.substring(ci + 1).trim()
                    headers[name] = value
                    if (name == "content-length") contentLength = value.toIntOrNull() ?: 0
                }
            }
            val body = if (contentLength > 0) {
                val chars = CharArray(contentLength)
                var read = 0
                while (read < contentLength) {
                    val n = reader.read(chars, read, contentLength - read)
                    if (n < 0) break
                    read += n
                }
                String(chars, 0, read)
            } else ""

            val requestJson = JSONObject()
                .put("method", method)
                .put("path", path)
                .put("query", query)
                .put("body", if (body.isBlank()) JSONObject.NULL else JSONObject(body))
                .put("headers", JSONObject(headers))
                .toString()

            // If the app is backgrounded, Android freezes the WebView renderer
            // (timer throttling + paused JS event loop), so the bridge dispatched
            // below would never run and time out → 503. Bring the app to the
            // foreground first so the renderer wakes and can answer. This is what
            // the user does manually ("open the app and keep it up"); we automate it.
            wakeAppIfBackgrounded()

            val resultJson = dispatcher?.invoke(requestJson)
            val out = client.getOutputStream()
            if (resultJson == null) {
                writeResponse(out, 503, """{"error":{"code":"bridge_unavailable","message":"Phone webview not ready."}}""")
            } else {
                writeResponse(out, 200, resultJson)
            }
        } catch (e: Exception) {
            Log.w("RemoteServer", "request failed", e)
            try {
                val msg = (e.message ?: "error").replace("\"", "'")
                writeResponse(client.getOutputStream(), 500, """{"error":{"code":"internal","message":"$msg"}}""")
            } catch (_: Exception) {
            }
        } finally {
            try {
                client.close()
            } catch (_: Exception) {
            }
        }
    }

    /**
     * True when the app is not in the foreground. A backgrounded app has its
     * WebView renderer throttled/frozen by Android, which makes the JS bridge
     * unreliable (requests time out → 503). We use the process importance flag,
     * which is the signal Android itself uses for foreground/background.
     */
    private fun isAppBackgrounded(): Boolean {
        val am = getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return false
        val procs = am.runningAppProcesses ?: return true
        for (proc in procs) {
            if (proc.processName == packageName) {
                return proc.importance != ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
            }
        }
        return true
    }

    /**
     * If the app is backgrounded, bring its task to the foreground so the WebView
     * renderer wakes and can service the bridge request. Without this, the agent's
     * writes "doze off" because the renderer is frozen. This mirrors what the user
     * does manually (open the app and keep it up) — but automatic.
     */
    private fun wakeAppIfBackgrounded() {
        if (!isAppBackgrounded()) return
        try {
            val launch = packageManager.getLaunchIntentForPackage(packageName)
            if (launch != null) {
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
                startActivity(launch)
                // Give the renderer a moment to spin back up before we dispatch.
                Thread.sleep(400)
            }
        } catch (_: Exception) {
            // Best-effort: if we can't wake it, the dispatch will still try and
            // may 503 — the agent retries.
        }
    }

    private fun writeResponse(out: OutputStream, status: Int, body: String) {
        val statusText = when (status) {
            200 -> "OK"
            401 -> "Unauthorized"
            404 -> "Not Found"
            503 -> "Service Unavailable"
            else -> "Internal Server Error"
        }
        val bytes = body.toByteArray(Charsets.UTF_8)
        out.write("HTTP/1.1 $status $statusText\r\n".toByteArray(Charsets.US_ASCII))
        out.write("Content-Type: application/json\r\n".toByteArray(Charsets.US_ASCII))
        out.write("Content-Length: ${bytes.size}\r\n".toByteArray(Charsets.US_ASCII))
        out.write("Connection: close\r\n\r\n".toByteArray(Charsets.US_ASCII))
        out.write(bytes)
        out.flush()
    }

    private fun buildNotification(): Notification {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(CHANNEL_ID, "Remote agent access", NotificationManager.IMPORTANCE_LOW)
            ch.description = "Open Finance remote agent connection is active"
            nm.createNotificationChannel(ch)
        }
        val launch = packageManager.getLaunchIntentForPackage(packageName)
        val pi = PendingIntent.getActivity(
            this, 0, launch,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Open Finance remote access")
            .setContentText("Agent hub can reach this phone on port 8787 (Tailscale)")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentIntent(pi)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }
}
