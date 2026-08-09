// remote-server-plugin.kt — P8b solo "share-to-agent" HTTP bridge.
// Thin Capacitor launcher for RemoteServerService (com.openfinance.app), which
// owns the port-8787 socket, wake lock, and foreground notification. This
// plugin only starts/stops the service and forwards each request from the
// service's accept loop into the WebView's soloDispatch via a JS bridge, so an
// agent hub can reach the phone DIRECTLY over Tailscale.
//
// Security: every request is bearer-token checked INSIDE soloDispatch (the JS
// side compares against the device's remote-access token stored in app_state).
// The native side never stores or sees the token. Requests without a valid
// `Authorization: Bearer *** header get a 401 JSON envelope.
//
// Bridge pattern: service accept loop → dispatcher lambda → webView.post {
// evaluateJavascript } → JS runs `window.__ofRemoteDispatch(req, id)`
// (registered in native-plugins.ts) → resolves `window.__ofRemoteResults[id]`
// → native polls the slot until set or times out → writes the HTTP response.

package com.openfinance.plugin

import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.openfinance.app.RemoteServerService
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@CapacitorPlugin(name = "RemoteServer")
class RemoteServerPlugin : Plugin() {

    @PluginMethod
    fun start(call: PluginCall) {
        val port = call.getInt("port", 8787) ?: 8787
        val context = activity ?: run {
            call.reject("Activity not available")
            return
        }
        // Persist "remote enabled" so the boot receiver restarts the bridge
        // after a reboot (and so the app can self-heal a killed process).
        context.getSharedPreferences("remote_server", android.content.Context.MODE_PRIVATE)
            .edit().putBoolean("enabled", true).apply()
        // The service owns the socket; this lambda is what it calls per request.
        RemoteServerService.dispatcher = { requestJson -> dispatchToJs(requestJson) }
        // Keep the WebView renderer (JS) alive in background: dispatch relies on
        // evaluateJavascript, whose renderer process Android otherwise suspends
        // when the app is backgrounded / screen off (the agent's "WebView bridge
        // is suspended" symptom). IMPORTANT + waiveWaitingToRender keeps it.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            bridge?.webView?.let { wv ->
                try {
                    wv.setRendererPriorityPolicy(
                        android.webkit.WebView.RENDERER_PRIORITY_IMPORTANT,
                        true
                    )
                } catch (_: Exception) {
                    /* best-effort — some OEM WebViews lack this API */
                }
            }
        }
        val intent = Intent(context, RemoteServerService::class.java).putExtra("port", port)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ContextCompat.startForegroundService(context, intent)
            } else {
                context.startService(intent)
            }
        } catch (e: Exception) {
            call.reject("Failed to start remote server: ${e.message}")
            return
        }
        // The service binds the socket in onStartCommand (main thread). Poll from
        // a background thread — blocking here would deadlock the main thread that
        // runs onStartCommand — then resolve with the real listening state.
        Thread {
            val deadline = System.currentTimeMillis() + 5_000
            while (System.currentTimeMillis() < deadline && !RemoteServerService.isRunning()) {
                Thread.sleep(100)
            }
            call.resolve(JSObject().put("ok", true).put("port", port).put("running", RemoteServerService.isRunning()))
        }.start()
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        val ctx = activity ?: context
        try {
            ctx?.getSharedPreferences("remote_server", android.content.Context.MODE_PRIVATE)
                ?.edit()?.putBoolean("enabled", false)?.apply()
            RemoteServerService.stopServer()
            ctx?.stopService(Intent(ctx, RemoteServerService::class.java))
        } catch (e: Exception) {
            call.reject("Failed to stop remote server: ${e.message}")
            return
        }
        call.resolve(JSObject().put("ok", true))
    }

    @PluginMethod
    fun status(call: PluginCall) {
        call.resolve(
            JSObject()
                .put("running", RemoteServerService.isRunning())
                .put("port", 8787)
        )
    }

    /** Forward one request to the WebView JS bridge and await its result. */
    private fun dispatchToJs(requestJson: String): String? {
        val webView = bridge?.webView ?: return null
        val id = System.nanoTime().toString()
        webView.post {
            webView.evaluateJavascript(
                "(function(){ " +
                    "window.__ofRemotePending = window.__ofRemotePending || {}; " +
                    "window.__ofRemoteResults = window.__ofRemoteResults || {}; " +
                    "window.__ofRemotePending['$id'] = true; " +
                    "window.__ofRemoteDispatch($requestJson, '$id').then(function(r){ " +
                    "window.__ofRemoteResults['$id'] = JSON.stringify(r); " +
                    "delete window.__ofRemotePending['$id']; " +
                    "}).catch(function(e){ " +
                    "window.__ofRemoteResults['$id'] = JSON.stringify({status:500,data:{error:{code:'internal',message:String(e&&e.message||e)}}}); " +
                    "delete window.__ofRemotePending['$id']; " +
                    "}); " +
                    "})()",
                null
            )
        }
        val deadline = System.currentTimeMillis() + 30_000
        var result: String? = null
        while (System.currentTimeMillis() < deadline && result == null) {
            Thread.sleep(50)
            val pollLatch = CountDownLatch(1)
            var slot: String? = null
            webView.post {
                webView.evaluateJavascript("window.__ofRemoteResults['$id'] ? JSON.stringify(window.__ofRemoteResults['$id']) : null", { v ->
                    slot = v
                    pollLatch.countDown()
                })
            }
            pollLatch.await(1, TimeUnit.SECONDS)
            val v = slot
            if (v != null && v != "null") {
                // evaluateJavascript returns a JSON-encoded string; unwrap once.
                result = try {
                    JSONObject("{\"v\":$v}").getString("v")
                } catch (_: Exception) {
                    null
                }
            }
        }
        webView.post {
            webView.evaluateJavascript("delete window.__ofRemoteResults['$id'];", null)
        }
        return result
    }
}
