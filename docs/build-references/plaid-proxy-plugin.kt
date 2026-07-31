// plaid-proxy-plugin.kt — reference skeleton for P8b (phone-solo).
// Capacitor native plugin: Plaid proxy methods (OkHttp) + native LinkKit hook.
// Copy from here, don't invent. Full implementation lands in P8b.

package com.openfinance.plugin

import android.content.Context
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.MediaType.Companion.toMediaType
import java.util.concurrent.TimeUnit

@CapacitorPlugin(name = "PlaidProxy")
class PlaidProxyPlugin : Plugin() {

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .build()

    // testCredentials(clientId, secret, environment) -> {valid: boolean}
    // createLinkToken(clientId, secret, environment, config) -> {linkToken}
    // exchangePublicToken(clientId, secret, environment, publicToken) -> {accessToken, itemId}
    // getAccounts(accessToken) -> {accounts: [...]}
    // syncTransactions(accessToken, cursor) -> {added, modified, removed, nextCursor}
    // removeItem(accessToken) -> {removed: true}

    @PluginMethod
    fun testCredentials(call: PluginCall) {
        val clientId = call.getString("clientId") ?: return call.reject("missing clientId")
        val secret = call.getString("secret") ?: return call.reject("missing secret")
        val env = call.getString("environment") ?: "sandbox"
        val url = "https://$env.plaid.com/accounts/balance/get"
        val body = """{"client_id":"$clientId","secret":"$secret","access_token":"<probe>"}"""
        // …OkHttp POST, map result → call.resolve(JSObject().put("valid", true))
        call.reject("not implemented until P8b")
    }

    // LinkKit: launch native Plaid Link from a link_token (no webview Plaid Link).
    // Add the Plaid Link SDK dependency and launch ActivityForResult here (P8b).
}
