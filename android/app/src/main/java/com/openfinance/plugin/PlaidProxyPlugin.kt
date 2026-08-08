// plaid-proxy-plugin.kt — P8b phone-solo native Plaid proxy (v1.1 asset).
// Capacitor plugin: all Plaid REST calls go through OkHttp here (no CORS, no
// webview fetch), and Plaid Link launches natively via LinkKit (react-plaid-link
// in a webview is unsupported per plan §10). The web layer calls these methods
// with the user's own client_id/secret (never stored in the webview).

package com.openfinance.plugin

import androidx.activity.result.ActivityResultLauncher
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.plaid.link.FastOpenPlaidLink
import com.plaid.link.Plaid
import com.plaid.link.PlaidHandler
import com.plaid.link.configuration.LinkTokenConfiguration
import com.plaid.link.result.LinkExit
import com.plaid.link.result.LinkSuccess
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

@CapacitorPlugin(name = "PlaidProxy")
class PlaidProxyPlugin : Plugin() {

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private val json = "application/json".toMediaType()

    private fun baseUrl(env: String) = "https://$env.plaid.com"

    private fun post(env: String, path: String, body: JSONObject): JSONObject {
        val req = Request.Builder()
            .url(baseUrl(env) + path)
            .post(body.toString().toRequestBody(json))
            .build()
        client.newCall(req).execute().use { resp ->
            val text = resp.body?.string() ?: "{}"
            val parsed = if (text.isBlank()) JSONObject() else JSONObject(text)
            if (!resp.isSuccessful) {
                // Surface the Plaid error_code in the message (e.g.
                // "ITEM_LOGIN_REQUIRED: the login details of this item have
                // changed…"). The JS side matches on the code to detect
                // re-auth requirements and show the Reconnect path; the bare
                // human-readable error_message never contained it.
                val code = parsed.optString("error_code", "")
                val msg = parsed.optString("error_message", "Plaid error ${resp.code}")
                throw RuntimeException(if (code.isNotBlank()) "$code: $msg" else msg)
            }
            return parsed
        }
    }

    private fun params(clientId: String, secret: String): JSONObject =
        JSONObject().put("client_id", clientId).put("secret", secret)

    private fun normalizedType(type: String?, subtype: String?): String {
        val t = type?.lowercase() ?: ""
        val s = subtype?.lowercase() ?: ""
        return when {
            s.contains("credit card") || t == "credit" -> "credit"
            s.contains("auto loan") || s.contains("mortgage") || t == "loan" -> "loan"
            t == "investment" || t == "depository" -> t
            else -> "other"
        }
    }

    // testCredentials(clientId, secret, environment) -> {valid: boolean}
    @PluginMethod
    fun testCredentials(call: PluginCall) {
        val clientId = call.getString("clientId") ?: return call.reject("missing clientId")
        val secret = call.getString("secret") ?: return call.reject("missing secret")
        val env = call.getString("environment") ?: "sandbox"
        try {
            // Cheapest real call that only needs client_id + secret (no access
            // token): create a link token. A 2xx with a link_token means the
            // credentials are valid. (Probing /accounts/balance/get with a
            // dummy token used to return "access token is in an invalid
            // format", making every valid key look broken.)
            val body = params(clientId, secret)
                .put("client_name", "Open Finance")
                .put("language", "en")
                .put("country_codes", JSONArray().put("US"))
                .put("user", JSONObject().put("client_user_id", "open-finance-key-test"))
                .put("products", JSONArray().put("auth"))
            val resp = post(env, "/link/token/create", body)
            call.resolve(JSObject().put("valid", resp.has("link_token")))
        } catch (e: Exception) {
            // invalid credentials come back as a 400 with an error code — that's
            // the "invalid" answer, not a plugin failure
            call.resolve(JSObject().put("valid", false).put("error", e.message))
        }
    }

    // createLinkToken(clientId, secret, environment, config, accessToken) -> {linkToken}
    @PluginMethod
    fun createLinkToken(call: PluginCall) {
        val clientId = call.getString("clientId") ?: return call.reject("missing clientId")
        val secret = call.getString("secret") ?: return call.reject("missing secret")
        val env = call.getString("environment") ?: "sandbox"
        try {
            val config = call.getObject("config") ?: JSONObject()
            val body = params(clientId, secret)
                .put("client_name", config.optString("client_name", "Open Finance"))
                .put("language", config.optString("language", "en"))
                .put("country_codes", JSONArray().put(config.optString("country_codes", "US")))
                .put("user", JSONObject().put("client_user_id", config.optString("client_user_id", "open-finance")))
                .put("products", config.optJSONArray("products") ?: JSONArray().put("transactions"))
            // Update mode (reconnect): include the item's access token so Link
            // re-auths the SAME institution instead of creating a new item.
            // Without this, the token is an add-mode token and "Reconnect" is
            // silently a no-op for the existing item.
            val accessToken = call.getString("accessToken")
            if (!accessToken.isNullOrBlank()) body.put("access_token", accessToken)
            val resp = post(env, "/link/token/create", body)
            call.resolve(JSObject().put("linkToken", resp.optString("link_token")))
        } catch (e: Exception) {
            call.reject(e.message ?: "link token failed")
        }
    }

    // exchangePublicToken(clientId, secret, environment, publicToken) -> {accessToken, itemId}
    @PluginMethod
    fun exchangePublicToken(call: PluginCall) {
        val clientId = call.getString("clientId") ?: return call.reject("missing clientId")
        val secret = call.getString("secret") ?: return call.reject("missing secret")
        val env = call.getString("environment") ?: "sandbox"
        val publicToken = call.getString("publicToken") ?: return call.reject("missing publicToken")
        try {
            val body = params(clientId, secret).put("public_token", publicToken)
            val resp = post(env, "/item/public_token/exchange", body)
            call.resolve(
                JSObject()
                    .put("accessToken", resp.optString("access_token"))
                    .put("itemId", resp.optString("item_id"))
            )
        } catch (e: Exception) {
            call.reject(e.message ?: "exchange failed")
        }
    }

    // getAccounts(accessToken) -> {accounts: [...]}
    @PluginMethod
    fun getAccounts(call: PluginCall) {
        val clientId = call.getString("clientId") ?: return call.reject("missing clientId")
        val secret = call.getString("secret") ?: return call.reject("missing secret")
        val env = call.getString("environment") ?: "sandbox"
        val accessToken = call.getString("accessToken") ?: return call.reject("missing accessToken")
        try {
            val body = params(clientId, secret).put("access_token", accessToken)
            val resp = post(env, "/accounts/get", body)
            val raw = resp.optJSONArray("accounts") ?: JSONArray()
            val mapped = JSONArray()
            for (i in 0 until raw.length()) {
                val a = raw.optJSONObject(i) ?: continue
                val balances = a.optJSONObject("balances") ?: JSONObject()
                val out = JSObject()
                    .put("id", a.optString("account_id"))
                    .put("name", a.optString("name"))
                    .put("officialName", if (a.isNull("official_name")) JSONObject.NULL else a.optString("official_name"))
                    .put("type", normalizedType(a.optString("type"), a.optString("subtype")))
                    .put("subtype", if (a.isNull("subtype")) JSONObject.NULL else a.optString("subtype"))
                    .put("mask", if (a.isNull("mask")) JSONObject.NULL else a.optString("mask"))
                    .put("currentBalanceCents", if (balances.isNull("current")) JSONObject.NULL else Math.round(balances.optDouble("current") * 100.0))
                    .put("availableBalanceCents", if (balances.isNull("available")) JSONObject.NULL else Math.round(balances.optDouble("available") * 100.0))
                    .put("currency", a.optString("iso_currency_code", "USD"))
                mapped.put(out)
            }
            call.resolve(JSObject().put("accounts", mapped))
        } catch (e: Exception) {
            call.reject(e.message ?: "accounts failed")
        }
    }

    // syncTransactions(accessToken, cursor) -> {added, modified, removed, nextCursor}
    @PluginMethod
    fun syncTransactions(call: PluginCall) {
        val clientId = call.getString("clientId") ?: return call.reject("missing clientId")
        val secret = call.getString("secret") ?: return call.reject("missing secret")
        val env = call.getString("environment") ?: "sandbox"
        val accessToken = call.getString("accessToken") ?: return call.reject("missing accessToken")
        val cursor = call.getString("cursor")
        try {
            // Follow has_more so the FULL history is imported (Plaid pages ~100
            // transactions per call; a month of activity can span several pages).
            var nextCursor = cursor
            var hasMore = true
            var guard = 0
            val addedAll = JSONArray()
            val modifiedAll = JSONArray()
            val removedAll = JSONArray()
            fun mapTransactions(page: JSONObject, key: String): JSONArray {
                val raw = page.optJSONArray(key) ?: JSONArray()
                val mapped = JSONArray()
                for (i in 0 until raw.length()) {
                    val t = raw.optJSONObject(i) ?: continue
                    val out = JSObject()
                        .put("id", t.optString("transaction_id"))
                        .put("accountId", t.optString("account_id"))
                        .put("amountCents", Math.round(t.optDouble("amount") * 100.0))
                        .put("date", t.optString("date"))
                        .put("authorizedDate", if (t.isNull("authorized_date")) JSONObject.NULL else t.optString("authorized_date"))
                        .put("name", t.optString("name"))
                        .put("merchantName", if (t.isNull("merchant_name")) JSONObject.NULL else t.optString("merchant_name"))
                        .put("categoryPath", if (t.isNull("category")) JSONObject.NULL else t.optJSONArray("category")?.join("|") ?: JSONObject.NULL)
                        .put("personalFinanceCategory", if (t.isNull("personal_finance_category")) JSONObject.NULL else t.optJSONObject("personal_finance_category")?.optString("primary"))
                        .put("pending", t.optBoolean("pending", false))
                    mapped.put(out)
                }
                return mapped
            }
            var resp: JSONObject
            while (hasMore && guard < 50) {
                guard++
                val body = params(clientId, secret).put("access_token", accessToken)
                if (!nextCursor.isNullOrBlank()) body.put("cursor", nextCursor)
                resp = post(env, "/transactions/sync", body)
                mapTransactions(resp, "added").let { for (i in 0 until it.length()) addedAll.put(it.get(i)) }
                mapTransactions(resp, "modified").let { for (i in 0 until it.length()) modifiedAll.put(it.get(i)) }
                val removedRaw = resp.optJSONArray("removed") ?: JSONArray()
                for (i in 0 until removedRaw.length()) {
                    val r = removedRaw.optJSONObject(i) ?: continue
                    removedAll.put(JSObject().put("transactionId", r.optString("transaction_id")))
                }
                nextCursor = resp.optString("next_cursor", "")
                hasMore = resp.optBoolean("has_more", false)
            }
            call.resolve(
                JSObject()
                    .put("added", addedAll)
                    .put("modified", modifiedAll)
                    .put("removed", removedAll)
                    .put("nextCursor", nextCursor ?: "")
            )
        } catch (e: Exception) {
            call.reject(e.message ?: "sync failed")
        }
    }

    // removeItem(accessToken) -> {removed: true}
    @PluginMethod
    fun removeItem(call: PluginCall) {
        val clientId = call.getString("clientId") ?: return call.reject("missing clientId")
        val secret = call.getString("secret") ?: return call.reject("missing secret")
        val env = call.getString("environment") ?: "sandbox"
        val accessToken = call.getString("accessToken") ?: return call.reject("missing accessToken")
        try {
            val body = params(clientId, secret).put("access_token", accessToken)
            post(env, "/item/remove", body)
            call.resolve(JSObject().put("removed", true))
        } catch (e: Exception) {
            call.reject(e.message ?: "remove failed")
        }
    }

    // launchLink(linkToken) — opens native Plaid Link via LinkKit (v5 handler
    // API: FastOpenPlaidLink contract + PlaidHandler). The result arrives on
    // the launcher callback; the web layer then calls exchangePublicToken with
    // the public token.
    @PluginMethod
    fun launchLink(call: PluginCall) {
        val linkToken = call.getString("linkToken") ?: return call.reject("missing linkToken")
        try {
            val config = LinkTokenConfiguration.Builder()
                .token(linkToken)
                .build()
            val app = activity.application as android.app.Application
            val handler = Plaid.create(app, config)
            pendingCall = call
            linkLauncher.launch(handler)
        } catch (e: Exception) {
            call.reject(e.message ?: "LinkKit launch failed")
        }
    }

    private var pendingCall: PluginCall? = null

    // MUST be registered before the activity is STARTED — a lazy
    // registerForActivityResult throws "attempting to register while current
    // state is RESUMED". Capacitor calls load() during Bridge onCreate, so the
    // activity is still in CREATED state here and registration is legal.
    private lateinit var linkLauncher: ActivityResultLauncher<PlaidHandler>

    override fun load() {
        super.load()
        linkLauncher = activity.registerForActivityResult(FastOpenPlaidLink()) { result ->
            val call = pendingCall ?: return@registerForActivityResult
            pendingCall = null
            when (result) {
                is LinkSuccess -> call.resolve(
                    JSObject()
                        .put("cancelled", false)
                        .put("publicToken", result.publicToken)
                        .put("metadata", JSObject().put("institutionName", result.metadata.institution?.name))
                )
                is LinkExit -> {
                    val err = result.error
                    call.resolve(
                        JSObject()
                            .put("cancelled", true)
                            .put(
                                "exit",
                                err?.let {
                                    JSObject()
                                        .put("code", it.errorCode.toString())
                                        .put("message", it.displayMessage ?: it.errorMessage)
                                }
                            )
                    )
                }
            }
        }
    }
}
