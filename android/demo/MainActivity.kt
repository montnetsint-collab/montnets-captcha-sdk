package com.example.captchademo

import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.example.yourapp.MontnetsCaptcha   // ← use your actual package name
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException

/**
 * Demo Activity — shows how to integrate MontnetsCaptcha into a login screen.
 *
 * In a real app:
 *   • Replace getCaptchaToken() with a call to your own backend endpoint.
 *   • Your backend holds appSecret and calls POST /captcha/init server-to-server.
 *   • After onSuccess, call your backend's login API with captchaToken.
 *
 * Dependencies to add in build.gradle:
 *   implementation("com.squareup.okhttp3:okhttp:4.12.0")
 */
class MainActivity : AppCompatActivity() {

    // ── Configuration — replace with your actual values ──────────────────────
    private val CAPTCHA_SERVER_URL = "https://captcha-api.example.com"
    private val APP_ID             = "YOUR_APP_ID"
    // ─────────────────────────────────────────────────────────────────────────

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        val etUsername = findViewById<EditText>(R.id.et_username)
        val etPassword = findViewById<EditText>(R.id.et_password)
        val btnLogin   = findViewById<Button>(R.id.btn_login)
        val tvStatus   = findViewById<TextView>(R.id.tv_status)

        btnLogin.setOnClickListener {
            val username = etUsername.text.toString().trim()
            val password = etPassword.text.toString().trim()

            if (username.isEmpty() || password.isEmpty()) {
                tvStatus.text = "Please enter username and password."
                return@setOnClickListener
            }

            btnLogin.isEnabled = false
            tvStatus.text = "Opening captcha…"

            // ── Show the sliding-puzzle captcha modal ─────────────────────────
            MontnetsCaptcha.show(
                activity  = this,
                serverUrl = CAPTCHA_SERVER_URL,

                // tokenProvider: called when the SDK needs an accessToken.
                // Replace this with a call to YOUR backend endpoint.
                tokenProvider = { callback ->
                    getCaptchaToken(callback)
                },

                // onSuccess: the user passed the challenge.
                // In a real app, send captchaToken + credentials to your backend.
                onSuccess = { captchaToken ->
                    tvStatus.text =
                        "✓ Captcha passed!\n\ncaptchaToken:\n$captchaToken\n\n" +
                        "→ Your backend should call POST /captcha/token/check to verify it,\n" +
                        "  then proceed with login."
                    btnLogin.isEnabled = true
                    // myServer.login(username, password, captchaToken)
                },

                onError = { message ->
                    tvStatus.text = "✗ Captcha error: $message"
                    btnLogin.isEnabled = true
                },

                onClose = {
                    // Re-enable the button if the user dismissed without completing
                    if (!btnLogin.isEnabled) btnLogin.isEnabled = true
                }
            )
        }
    }

    /**
     * Obtains a captcha accessToken.
     *
     * ⚠ DEMO ONLY — this implementation calls POST /captcha/init directly from
     * the app, which requires the appSecret to be present here.  In production,
     * create a backend endpoint (e.g. GET /api/captcha-token) that holds the
     * appSecret securely and returns only the accessToken.
     */
    private fun getCaptchaToken(callback: (token: String?, error: String?) -> Unit) {
        val client = OkHttpClient()

        val body = JSONObject().apply {
            put("appId",     APP_ID)
            put("appSecret", "YOUR_APP_SECRET")  // ← DEMO ONLY — move to your backend
            put("timestamp", System.currentTimeMillis())
            put("nonce",     System.nanoTime().toString(36))
        }.toString().toRequestBody("application/json".toMediaType())

        val request = Request.Builder()
            .url("$CAPTCHA_SERVER_URL/captcha/init")
            .post(body)
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                callback(null, e.message)
            }
            override fun onResponse(call: Call, response: Response) {
                try {
                    val json = JSONObject(response.body!!.string())
                    if (json.optBoolean("success")) {
                        val token = json.getJSONObject("data").getString("accessToken")
                        callback(token, null)
                    } else {
                        callback(null, json.optString("message", "Failed to obtain token"))
                    }
                } catch (e: Exception) {
                    callback(null, e.message)
                }
            }
        })
    }
}
