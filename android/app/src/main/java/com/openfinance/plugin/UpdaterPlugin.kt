// UpdaterPlugin.kt — in-app APK download + install (solo share-to-agent era).
// Downloads the release APK from GitHub and hands it to the system package
// installer via a FileProvider content URI. Because the Open Finance app
// itself is the install source (REQUEST_INSTALL_PACKAGES granted once in
// Settings → Special app access → Install unknown apps), installing an update
// no longer goes through a browser and skips the repeated "unknown app" /
// Play Protect "sketchy app" download warnings.

package com.openfinance.plugin

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.content.FileProvider
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

@CapacitorPlugin(name = "Updater")
class UpdaterPlugin : Plugin() {

    private val client by lazy {
        OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .followRedirects(false)
            .followSslRedirects(false)
            .build()
    }

    /**
     * Download an APK from `url` into the app's cache dir, verify `sha256`
     * (hex), then launch the system installer on the content URI.
     * Options: { url, sha256?, fileName? }
     *
     * SECURITY: the URL must be https and its host must be on the trusted
     * release host allowlist (GitHub releases for this repo). Redirects are
     * disabled so a malicious 302 cannot send the download to an untrusted
     * host. The `sha256` is verified against the value supplied here — it is
     * provided by the same release metadata that supplied the URL, so it
     * guards against corruption/transposition, not against a fully malicious
     * endpoint that also ships a matching hash. The trusted source of both
     * the URL and hash is the app's own update check (api.github.com, or a
     * deploy-controlled UPDATE_CHECK_URL), never an arbitrary caller.
     */
    private val trustedHosts = setOf(
        "github.com",
        "objects.githubusercontent.com",
        "release-assets.githubusercontent.com",
        "github-releases.githubusercontent.com"
    )

    @PluginMethod
    fun downloadAndInstall(call: PluginCall) {
        val ctx = context ?: run {
            call.reject("Context unavailable")
            return
        }
        val url = call.getString("url") ?: run {
            call.reject("url is required")
            return
        }
        val expectedSha = call.getString("sha256")?.lowercase()?.takeIf { it.length == 64 }
        val fileName = call.getString("fileName") ?: "openfinance-update.apk"

        // Validate the URL before any network use.
        val uri = try {
            java.net.URI(url)
        } catch (e: Exception) {
            call.reject("Invalid update URL.")
            return
        }
        if (uri.scheme != "https") {
            call.reject("Update URL must be https.")
            return
        }
        if (!trustedHosts.contains(uri.host)) {
            call.reject("Update URL host is not trusted: ${uri.host}")
            return
        }

        Thread {
            try {
                val request = Request.Builder().url(url).header("User-Agent", "open-finance-updater").build()
                client.newCall(request).execute().use { resp ->
                    if (!resp.isSuccessful) {
                        call.reject("Download failed: HTTP ${resp.code}")
                        return@Thread
                    }
                    val body = resp.body ?: run {
                        call.reject("Download failed: empty body")
                        return@Thread
                    }
                    val apkFile = File(ctx.cacheDir, fileName)
                    FileOutputStream(apkFile).use { out ->
                        body.byteStream().use { input ->
                            input.copyTo(out)
                        }
                    }
                    if (expectedSha != null) {
                        val actual = sha256(apkFile)
                        if (!actual.equals(expectedSha, ignoreCase = true)) {
                            apkFile.delete()
                            call.reject("Checksum mismatch — expected $expectedSha, got $actual")
                            return@Thread
                        }
                    }
                    val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.fileprovider", apkFile)
                    launchInstaller(ctx, uri)
                    call.resolve(JSObject().put("ok", true).put("path", apkFile.absolutePath))
                }
            } catch (e: Exception) {
                Log.w("Updater", "download/install failed", e)
                call.reject("Update failed: ${e.message}")
            }
        }.start()
    }

    /** True if this app is allowed to install APKs (REQUEST_INSTALL_PACKAGES granted). */
    @PluginMethod
    fun canInstallUnknownApps(call: PluginCall) {
        val ctx = context
        val ok = if (ctx == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) true else ctx.packageManager.canRequestPackageInstalls()
        call.resolve(JSObject().put("canInstall", ok))
    }

    /** Open the system settings page where the user allows this app to install packages. */
    @PluginMethod
    fun openInstallSettings(call: PluginCall) {
        val ctx = context ?: run {
            call.reject("Context unavailable")
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val intent = Intent(
                android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:${ctx.packageName}")
            )
            try {
                ctx.startActivity(intent)
                call.resolve(JSObject().put("ok", true))
                return
            } catch (e: Exception) {
                call.reject("Could not open install settings: ${e.message}")
                return
            }
        }
        call.resolve(JSObject().put("ok", true))
    }

    private fun launchInstaller(ctx: Context, uri: Uri) {
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        ctx.startActivity(intent)
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                digest.update(buf, 0, n)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
}
