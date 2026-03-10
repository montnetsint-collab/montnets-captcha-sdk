# Android Integration Guide

## Files to copy into your project

| Source file | Destination in your project |
|-------------|----------------------------|
| `MontnetsCaptcha.kt` | `app/src/main/java/…/MontnetsCaptcha.kt` |
| `captcha_bridge.html` | `app/src/main/assets/captcha_bridge.html` |

> Change the `package` declaration at the top of `MontnetsCaptcha.kt` to match your own package.

## Requirements

- Android API 21+
- `INTERNET` permission in `AndroidManifest.xml`

```xml
<uses-permission android:name="android.permission.INTERNET" />
```

## Usage

```kotlin
MontnetsCaptcha.show(
    activity  = this,
    serverUrl = "https://captcha-api.example.com",

    // tokenProvider: call YOUR backend to get an accessToken.
    // NEVER embed appSecret in the app.
    tokenProvider = { callback ->
        MyServer.getCaptchaToken(
            onResult = { token -> callback(token, null) },
            onError  = { err   -> callback(null, err.message) }
        )
    },

    // onSuccess: user passed the challenge.
    // Send captchaToken to your backend for server-side verification.
    onSuccess = { captchaToken ->
        MyServer.login(username, password, captchaToken)
    },

    onError = { message ->
        Toast.makeText(this, "Captcha error: $message", Toast.LENGTH_SHORT).show()
    },

    onClose = {
        // Modal dismissed (user tapped × or backdrop)
    }
)
```

## How tokenProvider should work

Your app calls **your own backend**, which calls `POST /captcha/init` server-to-server:

```
Android App                  Your Backend                Captcha Server
     │                            │                            │
     │── tokenProvider() ────────►│                            │
     │                            │── POST /captcha/init ─────►│
     │                            │   { appId, appSecret }     │
     │                            │◄── { accessToken } ────────│
     │◄── callback(token, null) ──│                            │
```

### Backend example (Node.js)

```js
app.get('/api/captcha-token', async (req, res) => {
  const resp = await fetch('https://captcha-api.example.com/captcha/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appId:     process.env.CAPTCHA_APP_ID,
      appSecret: process.env.CAPTCHA_APP_SECRET,  // stays on the server
      timestamp: Date.now(),
      nonce:     Math.random().toString(36).slice(2)
    })
  });
  const json = await resp.json();
  res.json({ accessToken: json.data.accessToken });
});
```

### Android tokenProvider calling the backend

```kotlin
tokenProvider = { callback ->
    val request = Request.Builder()
        .url("https://your-backend.com/api/captcha-token")
        .build()
    OkHttpClient().newCall(request).enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {
            callback(null, e.message)
        }
        override fun onResponse(call: Call, response: Response) {
            val json = JSONObject(response.body!!.string())
            callback(json.getString("accessToken"), null)
        }
    })
}
```

## Demo

See `demo/MainActivity.kt` and `demo/activity_main.xml` for a complete working example.

> The demo calls `POST /captcha/init` directly from the app for simplicity.
> **Do not do this in production** — move the appSecret to your backend.
