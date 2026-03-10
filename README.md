# Montnets Captcha SDK

Integration demos and guides for the **Montnets International Sliding-Puzzle Captcha** service.

| Platform | Core file to copy | Demo |
|----------|-------------------|------|
| **Web (JS)** | `web/montnets-captcha-sdk.js` | `web/montnets-captcha-demo.html` |
| **Android** | `android/MontnetsCaptcha.kt` + `android/captcha_bridge.html` | `android/demo/` |
| **iOS** | `ios/MontnetsCaptcha.swift` + `ios/captcha_bridge.html` | `ios/demo/` |

---

## How it works

```
Your App / Page
  │
  ├─ tokenProvider() ──► YOUR backend ──► POST /captcha/init ──► accessToken
  │
  ├─ SDK loads challenge ──► GET /captcha/challenge
  │
  ├─ User drags slider ──► POST /captcha/challenge/submit ──► captchaToken
  │
  └─ onSuccess(captchaToken) ──► YOUR backend ──► POST /captcha/token/check
```

**appSecret never leaves your server.**

---

## API overview

| Endpoint | Caller | Purpose |
|----------|--------|---------|
| `POST /captcha/init` | Your backend | Exchange appId + appSecret → accessToken |
| `GET  /captcha/challenge` | SDK (auto) | Fetch puzzle image + challengeId |
| `POST /captcha/challenge/submit` | SDK (auto) | Submit slider result → captchaToken |
| `POST /captcha/token/check` | Your backend | Verify & consume captchaToken |

---

## Quick links

- [Web integration guide](web/README.md)
- [Android integration guide](android/README.md)
- [iOS integration guide](ios/README.md)

---

## Support

Homepage: https://www.int-montnets.com
