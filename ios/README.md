# iOS Integration Guide

## Files to copy into your project

| Source file | Action |
|-------------|--------|
| `MontnetsCaptcha.swift` | Add to Xcode project (any group) |
| `captcha_bridge.html` | Add to Xcode project → make sure it appears under **Build Phases → Copy Bundle Resources** |

## Requirements

- iOS 13+
- Swift 5+
- `NSAppTransportSecurity` in `Info.plist` if your captcha server uses HTTP (not HTTPS)

## Usage

```swift
MontnetsCaptcha.show(
    from:      self,
    serverUrl: "https://captcha-api.example.com",

    // tokenProvider: call YOUR backend to get an accessToken.
    // NEVER embed appSecret in the app.
    tokenProvider: { completion in
        MyServer.getCaptchaToken { token, error in
            completion(token, error?.localizedDescription)
        }
    },

    // onSuccess: user passed the challenge.
    // Send captchaToken to your backend for server-side verification.
    onSuccess: { captchaToken in
        MyServer.login(username: username, password: password, captchaToken: captchaToken)
    },

    onError: { message in
        print("Captcha error:", message)
    },

    onClose: {
        // Modal dismissed (user tapped × or backdrop)
    }
)
```

## How tokenProvider should work

Your app calls **your own backend**, which calls `POST /captcha/init` server-to-server:

```
iOS App                      Your Backend                Captcha Server
  │                               │                           │
  │── tokenProvider() ───────────►│                           │
  │                               │── POST /captcha/init ────►│
  │                               │   { appId, appSecret }    │
  │                               │◄── { accessToken } ───────│
  │◄── completion(token, nil) ────│                           │
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

### iOS tokenProvider calling the backend

```swift
tokenProvider: { completion in
    let url = URL(string: "https://your-backend.com/api/captcha-token")!
    URLSession.shared.dataTask(with: url) { data, _, error in
        if let error = error { completion(nil, error.localizedDescription); return }
        let json = try? JSONSerialization.jsonObject(with: data!) as? [String: Any]
        let token = json?["accessToken"] as? String
        completion(token, token == nil ? "No token in response" : nil)
    }.resume()
}
```

## Demo

See `demo/ViewController.swift` for a complete working example.

> The demo calls `POST /captcha/init` directly from the app for simplicity.
> **Do not do this in production** — move the appSecret to your backend.
