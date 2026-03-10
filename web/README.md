# Web Integration Guide

## Files

| File | Purpose |
|------|---------|
| `montnets-captcha-sdk.js` | The JS SDK — include this in your page |
| `montnets-captcha-demo.html` | Runnable demo showing the full integration flow |

## Quick start

```html
<!-- Step 1: Load the SDK -->
<script src="/montnets-captcha-sdk.js"></script>

<script>
  // Step 2: Initialise once on page load
  CaptchaSDK.init({
    serverUrl: 'https://captcha-api.example.com',

    // tokenProvider: called when a fresh accessToken is needed.
    // Call YOUR backend — never expose appSecret in the browser.
    tokenProvider: async () => {
      const res = await fetch('/api/captcha-token');
      return (await res.json()).accessToken;
    },

    // onSuccess: called with captchaToken after the user passes.
    // Send it to your backend for server-side verification.
    onSuccess: (captchaToken) => {
      myServer.login(username, password, captchaToken);
    }
  });

  // Optional: pre-fetch the accessToken to eliminate open latency.
  CaptchaSDK.warmup();

  // Step 3: Open the captcha from your submit button.
  document.getElementById('btn-login').onclick = () => CaptchaSDK.show();
</script>
```

## API

| Method | Description |
|--------|-------------|
| `CaptchaSDK.init(config)` | Initialise the SDK. Must be called once before any other method. |
| `CaptchaSDK.show()` | Open the captcha modal. |
| `CaptchaSDK.close()` | Programmatically close the modal. |
| `CaptchaSDK.warmup()` | Pre-fetch and cache the accessToken (returns Promise). |
| `CaptchaSDK.clearCache()` | Clear the locally cached accessToken. |

### `init(config)` options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `tokenProvider` | `async () => string` | Yes | Returns an accessToken from your backend. |
| `serverUrl` | `string` | No | Captcha server base URL. Defaults to same origin. |
| `onSuccess` | `(token: string) => void` | No | Called when the user passes the captcha. |
| `onError` | `(err: Error) => void` | No | Called on unrecoverable errors. |
| `onClose` | `() => void` | No | Called when the modal is dismissed. |
| `debug` | `boolean` | No | Enable verbose console logging. |

## tokenProvider — backend example

Your backend endpoint (e.g. `GET /api/captcha-token`) should:

```js
// Node.js / Express example
app.get('/api/captcha-token', async (req, res) => {
  const response = await fetch('https://captcha-api.example.com/captcha/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appId:     process.env.CAPTCHA_APP_ID,
      appSecret: process.env.CAPTCHA_APP_SECRET,   // stays on the server
      timestamp: Date.now(),
      nonce:     Math.random().toString(36).slice(2)
    })
  });
  const json = await response.json();
  res.json({ accessToken: json.data.accessToken });
});
```
