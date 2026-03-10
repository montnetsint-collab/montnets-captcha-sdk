package com.example.yourapp   // ← Replace with your own package name

import android.annotation.SuppressLint
import android.app.Activity
import android.app.Dialog
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import org.json.JSONObject

/**
 * Montnets International Sliding-Puzzle Captcha — Android integration helper.
 *
 * ── Integration steps ──────────────────────────────────────────────────────
 *  1. Copy this file (MontnetsCaptcha.kt) into your project.
 *  2. Copy captcha_bridge.html into  app/src/main/assets/
 *  3. Call MontnetsCaptcha.show() from your login button handler.
 *
 * ── Example usage ──────────────────────────────────────────────────────────
 *  MontnetsCaptcha.show(
 *      activity      = this,
 *      serverUrl     = "https://captcha-api.example.com",
 *      tokenProvider = { callback ->
 *          // Call YOUR backend endpoint to get an accessToken.
 *          // NEVER put appSecret in the app — keep it on your server.
 *          MyServer.getCaptchaToken(
 *              onResult = { token -> callback(token, null) },
 *              onError  = { err   -> callback(null, err.message) }
 *          )
 *      },
 *      onSuccess = { captchaToken ->
 *          // Pass captchaToken to your backend for server-side verification.
 *          // Your backend calls POST /captcha/token/check.
 *          MyServer.login(username, password, captchaToken)
 *      }
 *  )
 */
object MontnetsCaptcha {

    /**
     * Displays the sliding-puzzle captcha in a full-screen transparent dialog.
     *
     * @param activity        The foreground Activity (required to create a Dialog).
     * @param serverUrl       Base URL of the Montnets Captcha service (no trailing slash).
     *                        Example: "https://captcha-api.example.com"
     * @param tokenProvider   Invoked when the SDK needs a fresh accessToken.
     *                        Run your backend call, then invoke:
     *                          callback(token, null)    — on success
     *                          callback(null, message)  — on failure
     *                        This lambda may be called on any thread.
     * @param onSuccess       Called on the main thread with the captchaToken when the user passes.
     *                        Pass the token to your backend: POST /captcha/token/check.
     * @param onError         Called on the main thread when an unrecoverable error occurs (optional).
     * @param onClose         Called on the main thread when the dialog is dismissed (optional).
     */
    @SuppressLint("SetJavaScriptEnabled")
    fun show(
        activity: Activity,
        serverUrl: String,
        tokenProvider: (callback: (token: String?, error: String?) -> Unit) -> Unit,
        onSuccess: (captchaToken: String) -> Unit,
        onError: ((message: String) -> Unit)? = null,
        onClose: (() -> Unit)? = null
    ) {
        val mainHandler = Handler(Looper.getMainLooper())
        var closeFired = false

        fun fireClose() {
            if (!closeFired) {
                closeFired = true
                mainHandler.post { onClose?.invoke() }
            }
        }

        // Full-screen transparent dialog
        val dialog = Dialog(activity, android.R.style.Theme_Translucent_NoTitleBar_Fullscreen)
        dialog.setOnDismissListener {
            // Destroy the WebView to release native resources and stop JS execution.
            webView.destroy()
            fireClose()
        }

        // Build the WebView
        val webView = WebView(activity).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            // Allow mixed content so the bridge HTML (loaded with captcha server base URL)
            // can fetch resources from the same server over any scheme.
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            setBackgroundColor(Color.TRANSPARENT)
        }

        // Inject the native bridge object into the JS context as "AndroidBridge"
        webView.addJavascriptInterface(
            object : Any() {

                /**
                 * Called from JS when a fresh accessToken is needed.
                 * This method runs on a background thread (WebView's JS thread).
                 *
                 * @param callbackId  JS-side Promise ID; pass back to __nativeDeliverToken().
                 */
                @JavascriptInterface
                fun requestToken(callbackId: Int) {
                    tokenProvider { token, error ->
                        // Use JSONObject.quote() for safe JS string serialization —
                        // handles all special characters including \n, \r, \u2028, etc.
                        val js = if (error != null) {
                            "window.__nativeDeliverToken($callbackId, null, ${JSONObject.quote(error)})"
                        } else {
                            "window.__nativeDeliverToken($callbackId, ${JSONObject.quote(token ?: "")}, null)"
                        }
                        mainHandler.post { webView.evaluateJavascript(js, null) }
                    }
                }

                @JavascriptInterface
                fun onSuccess(captchaToken: String) {
                    mainHandler.post {
                        dialog.dismiss()
                        onSuccess(captchaToken)
                    }
                }

                @JavascriptInterface
                fun onError(message: String) {
                    mainHandler.post {
                        dialog.dismiss()
                        onError?.invoke(message)
                    }
                }

                @JavascriptInterface
                fun onClose() {
                    mainHandler.post { dialog.dismiss() }
                }
            },
            "AndroidBridge"
        )

        // Read captcha_bridge.html from assets
        val bridgeHtml = try {
            activity.assets.open("captcha_bridge.html").bufferedReader().use { it.readText() }
        } catch (e: Exception) {
            onError?.invoke("captcha_bridge.html not found in assets: ${e.message}")
            return
        }

        // Load the bridge HTML with serverUrl as the base URL.
        // This makes the relative path "/montnets-captcha-sdk.js" resolve to the
        // captcha server, and all subsequent fetch() calls appear same-origin.
        webView.loadDataWithBaseURL(
            serverUrl,    // baseUrl  — relative paths resolve against the captcha server
            bridgeHtml,   // data
            "text/html",  // mimeType
            "UTF-8",      // encoding
            null          // historyUrl
        )

        dialog.setContentView(
            webView,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )
        dialog.window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
        dialog.show()
    }
}
