// keystore-plugin.kt — P8a connected mode: hub session token + hub URL stored
// AES-256-GCM encrypted with an AndroidKeyStore key (no extra dependencies —
// the key never leaves the hardware-backed store). The webview loads the hub;
// the token survives app restarts so the phone stays paired.

package com.openfinance.plugin

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@CapacitorPlugin(name = "Keystore")
class KeystorePlugin : Plugin() {

    private val keyAlias = "of_session_key"
    private val prefsName = "of_keystore"

    private fun prefs() = context?.getSharedPreferences(prefsName, Context.MODE_PRIVATE)

    private fun getOrCreateKey(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(keyAlias, null) as? SecretKey)?.let { return it }
        val kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        kg.init(
            KeyGenParameterSpec.Builder(
                keyAlias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build()
        )
        return kg.generateKey()
    }

    private fun encrypt(plain: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val iv = cipher.iv
        val ct = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP)
    }

    private fun decrypt(stored: String): String? {
        return try {
            val parts = stored.split(":", limit = 2)
            if (parts.size != 2) return null
            val iv = Base64.decode(parts[0], Base64.NO_WRAP)
            val ct = Base64.decode(parts[1], Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, iv))
            String(cipher.doFinal(ct), Charsets.UTF_8)
        } catch (e: Exception) {
            null
        }
    }

    @PluginMethod
    fun setSessionToken(call: PluginCall) {
        val token = call.getString("token")
        val p = prefs()
        if (token == null || p == null) return call.reject("unavailable")
        p.edit().putString("of_session_token", encrypt(token)).apply()
        call.resolve(JSObject().put("ok", true))
    }

    @PluginMethod
    fun getSessionToken(call: PluginCall) {
        val p = prefs() ?: return call.reject("unavailable")
        val stored = p.getString("of_session_token", null) ?: return call.resolve(JSObject().put("token", null))
        call.resolve(JSObject().put("token", decrypt(stored)))
    }

    @PluginMethod
    fun clearSessionToken(call: PluginCall) {
        val p = prefs() ?: return call.reject("unavailable")
        p.edit().remove("of_session_token").apply()
        call.resolve(JSObject().put("ok", true))
    }

    @PluginMethod
    fun setHubUrl(call: PluginCall) {
        val url = call.getString("url")
        val p = prefs()
        if (url == null || p == null) return call.reject("unavailable")
        p.edit().putString("of_hub_url", encrypt(url)).apply()
        call.resolve(JSObject().put("ok", true))
    }

    @PluginMethod
    fun getHubUrl(call: PluginCall) {
        val p = prefs() ?: return call.reject("unavailable")
        val stored = p.getString("of_hub_url", null) ?: return call.resolve(JSObject().put("url", null))
        call.resolve(JSObject().put("url", decrypt(stored)))
    }
}
