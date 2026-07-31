// keystore-plugin.kt — P8a connected mode: hub session token + hub URL stored
// in Android Keystore-backed EncryptedSharedPreferences. The webview loads the
// hub; the token survives app restarts so the phone stays paired.

package com.openfinance.plugin

import android.content.Context
import android.util.Base64
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "Keystore")
class KeystorePlugin : Plugin() {

    private fun prefs(): androidx.security.crypto.SharedPreferences? {
        val context: Context = context ?: return null
        return try {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            EncryptedSharedPreferences.create(
                context,
                "of_keystore",
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        } catch (e: Exception) {
            null
        }
    }

    @PluginMethod
    fun setSessionToken(call: PluginCall) {
        val token = call.getString("token")
        val p = prefs()
        if (token == null || p == null) return call.reject("unavailable")
        p.edit().putString("of_session_token", token).apply()
        call.resolve(JSObject().put("ok", true))
    }

    @PluginMethod
    fun getSessionToken(call: PluginCall) {
        val p = prefs()
        if (p == null) return call.reject("unavailable")
        val token = p.getString("of_session_token", null)
        call.resolve(JSObject().put("token", token))
    }

    @PluginMethod
    fun clearSessionToken(call: PluginCall) {
        val p = prefs()
        if (p == null) return call.reject("unavailable")
        p.edit().remove("of_session_token").apply()
        call.resolve(JSObject().put("ok", true))
    }

    @PluginMethod
    fun setHubUrl(call: PluginCall) {
        val url = call.getString("url")
        val p = prefs()
        if (url == null || p == null) return call.reject("unavailable")
        p.edit().putString("of_hub_url", url).apply()
        call.resolve(JSObject().put("ok", true))
    }

    @PluginMethod
    fun getHubUrl(call: PluginCall) {
        val p = prefs()
        if (p == null) return call.reject("unavailable")
        call.resolve(JSObject().put("url", p.getString("of_hub_url", null)))
    }
}
