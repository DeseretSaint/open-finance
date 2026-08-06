// remote-server-plugin.kt — P8b solo "share-to-agent" HTTP bridge (v1.0 asset).
// A minimal HTTP/1.1 server on port 8787 that forwards each request into the
// WebView's soloDispatch via a JS bridge, so an agent hub can reach the phone
// DIRECTLY over Tailscale (no hub Open Finance install needed).
//
// Security: every request is bearer-token checked INSIDE soloDispatch (the JS
// side compares against the device's remote-access token stored in app_state).
// The native side never stores or sees the token. Requests without a valid
// `Authorization: Bearer <token>` header get a 401 JSON envelope.
//
// Bridge pattern: native server thread → webView.post { evaluateJavascript } →
// JS runs `window.__ofRemoteDispatch(req, id)` (registered in native-plugins.ts)
// → resolves `window.__ofRemoteResults[id]` → native polls the slot until set
// or times out → writes the HTTP response. No extra dependencies.

package com.openfinance.plugin

import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStream
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@CapacitorPlugin(name = "RemoteServer")
class RemoteServerPlugin : Plugin() {

    private var serverSocket: ServerSocket? = null
    private var executor: ExecutorService? = null

    @PluginMethod
    fun start(call: PluginCall) {
        val port = call.getInt("port", 8787)
        if (serverSocket != null) {
            call.resolve(JSObject().put("ok", true).put("port", port))
            return
        }
        var resolved = false
        executor = Executors.newCachedThreadPool()
        Thread {
            try {
                val ss = ServerSocket(port)
                serverSocket = ss
                call.resolve(JSObject().put("ok", true).put("port", port))
                resolved = true
                while (!ss.isClosed) {
                    val client = ss.accept()
                    executor?.execute { handle(client) }
                }
            } catch (e: Exception) {
                Log.w("RemoteServer", "server stopped", e)
                if (!resolved) {
                    call.reject("Failed to start remote server: ${e.message}")
                }
            }
        }.start()
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        try {
            serverSocket?.close()
        } catch (_: Exception) {
        }
        serverSocket = null
        call.resolve(JSObject().put("ok", true))
    }

    @PluginMethod
    fun status(call: PluginCall) {
        call.resolve(
            JSObject()
                .put("running", serverSocket != null && !serverSocket!!.isClosed)
                .put("port", 8787)
        )
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

            val resultJson = dispatchToJs(requestJson)
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

    /** Forward one request to the WebView JS bridge and await its result. */
    private fun dispatchToJs(requestJson: String): String? {
        val webView = bridge?.webView ?: return null
        val id = System.nanoTime().toString()
        val latch = CountDownLatch(1)
        var settled = false
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
}
