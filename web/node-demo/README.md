# Montnets Captcha Web SDK Demo

Standalone Web SDK demo project with:

- `public/index.html`: frontend demo page using the Web SDK
- `public/montnets-captcha-sdk.js`: local SDK bundle used by the demo
- `server.js`: Koa backend for issuing `accessToken` and verifying `captchaToken`

## Getting Started

```bash
cd montnets-captcha-websdk-demo
npm install
cp .env.example .env
npm start
```

The demo runs on `http://localhost:3000` by default.

## Environment Variables

- `CAPTCHA_APP_ID`: captcha application `appId`
- `CAPTCHA_APP_SECRET`: captcha application `appSecret`
- `CAPTCHA_SERVER_URL`: captcha service base URL, for example `https://your-captcha-server.example.com`
- `PORT`: local server port, default `3000`

## Backend Endpoints

- `GET /api/captcha-token`: calls `/captcha/init` and returns an `accessToken`
- `POST /api/login`: mock sign-in endpoint that calls `/captcha/token/check` to validate and consume `captchaToken`
- `GET /api/health`: health check endpoint

## Notes

- `appSecret` is used only on the backend and is never exposed to the browser.
- The page demonstrates `CaptchaSDK.init()`, `CaptchaSDK.show()`, `CaptchaSDK.warmup()`, and `CaptchaSDK.clearCache()`.
- The sign-in endpoint is a demo mock. It does not perform real user authentication and is intended only to show the captcha integration flow.
