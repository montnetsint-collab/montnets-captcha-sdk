const Koa = require("koa");
const Router = require("@koa/router");
const bodyParser = require("koa-bodyparser");
const serve = require("koa-static");
const path = require("path");
const crypto = require("crypto");
require("dotenv").config();

const app = new Koa();
const router = new Router();

const PORT = Number(process.env.PORT || 3000);
const CAPTCHA_SERVER_URL = process.env.CAPTCHA_SERVER_URL;
const CAPTCHA_APP_ID = process.env.CAPTCHA_APP_ID || "";
const CAPTCHA_APP_SECRET = process.env.CAPTCHA_APP_SECRET || "";

async function getJson(url, extraHeaders = {}) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      ...extraHeaders,
    },
  });

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    const parseError = new Error(`Invalid JSON response from ${url}`);
    parseError.status = 502;
    throw parseError;
  }

  if (!response.ok) {
    const httpError = new Error(payload?.message || `HTTP ${response.status}`);
    httpError.status = response.status;
    httpError.payload = payload;
    throw httpError;
  }

  if (!payload?.success) {
    const businessError = new Error(payload?.message || "Captcha service request failed.");

    if (payload?.code === 401) {
      businessError.status = 401;
    } else {
      businessError.status = 400;
    }

    businessError.payload = payload;

    throw businessError;
  }

  return payload;
}

async function postJson(url, body, extraHeaders = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    const parseError = new Error(`Invalid JSON response from ${url}`);
    parseError.status = 502;
    throw parseError;
  }

  if (!response.ok) {
    const httpError = new Error(payload?.message || `HTTP ${response.status}`);
    httpError.status = response.status;
    httpError.payload = payload;
    throw httpError;
  }

  if (!payload?.success) {
    const businessError = new Error(payload?.message || "Captcha service request failed.");

    businessError.payload = payload;

    if (payload?.code === 401) {
      businessError.status = 401;
    } else if (payload?.code === 4004) {
      businessError.status = 200;
      businessError.payload.message = "Verification timed out. Please verify again.";
      businessError.message = "Verification timed out. Please verify again.";
    } else {
      businessError.status = 400;
    }

    throw businessError;
  }

  return payload;
}

app.use(bodyParser());
app.use(async (ctx, next) => {
  try {
    await next();
  } catch (error) {
    ctx.status = error.status || 500;
    ctx.body = {
      success: false,
      message: error.message,
      details: error.payload || null,
    };
  }
});

router.get("/api/health", (ctx) => {
  ctx.body = {
    success: true,
    data: {
      status: "ok",
      configured: Boolean(CAPTCHA_APP_ID && CAPTCHA_APP_SECRET),
      serverUrl: CAPTCHA_SERVER_URL,
    },
  };
});

router.get("/api/captcha-token", async (ctx) => {
  const payload = await postJson(`${CAPTCHA_SERVER_URL}/captcha/init`, {
    appId: CAPTCHA_APP_ID,
    appSecret: CAPTCHA_APP_SECRET,
    timestamp: Date.now(),
    nonce: Math.random().toString(36).slice(2)
  });

  ctx.body = payload
});

router.get("/captcha/challenge", async (ctx) => {
  const accessToken = ctx.get("X-Access-Token");
  if (!accessToken) {
    ctx.status = 400;
    ctx.body = {
      success: false,
      message: "Missing X-Access-Token header.",
    };
    return;
  }

  const payload = await getJson(`${CAPTCHA_SERVER_URL}/captcha/challenge`, {
    "X-Access-Token": accessToken,
  });

  ctx.body = payload;
});

router.post("/captcha/challenge/submit", async (ctx) => {
  const accessToken = ctx.get("X-Access-Token");
  if (!accessToken) {
    ctx.status = 400;
    ctx.body = {
      success: false,
      message: "Missing X-Access-Token header.",
    };
    return;
  }

  const { challengeId, endX, trajectory, duration } = ctx.request.body || {};
  if (!challengeId || typeof endX !== "number" || !Array.isArray(trajectory) || typeof duration !== "number") {
    ctx.status = 400;
    ctx.body = {
      success: false,
      message: "challengeId, endX, trajectory and duration are required.",
    };
    return;
  }

  const payload = await postJson(`${CAPTCHA_SERVER_URL}/captcha/challenge/submit`, {
    challengeId,
    endX,
    trajectory,
    duration,
  }, {
    "X-Access-Token": accessToken,
  });

  ctx.body = payload;
});

router.post("/api/login", async (ctx) => {
  const { username, password, captchaToken } = ctx.request.body || {};
  if (!username || !password || !captchaToken) {
    ctx.status = 400;
    ctx.body = {
      success: false,
      message: "username, password and captchaToken are required.",
    };
    return;
  }

  const payload = await postJson(`${CAPTCHA_SERVER_URL}/captcha/token/check`, {
    appId: CAPTCHA_APP_ID,
    captchaToken,
  });

  if (!payload.data.valid) {
    ctx.status = 400;
    ctx.body = {
      success: false,
      message: `Captcha verification failed: ${payload.data.code}`,
      data: payload.data,
    };
    return;
  }

  ctx.body = {
    success: true,
    message: "Captcha verified. Demo login accepted.",
    data: {
      tokenStatus: payload.data.code,
      user: {
        username,
      },
      session: {
        sessionId: crypto.randomUUID(),
        issuedAt: new Date().toISOString(),
      },
    },
  };
});

app.use(router.routes());
app.use(router.allowedMethods());
app.use(serve(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`Montnets captcha demo running at http://localhost:${PORT}`);
});
