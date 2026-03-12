/*!
 * Montnets International Captcha SDK v1.0.0
 *
 * Copyright (c) 2025-2026 MONTNETS INTERNATIONAL COMMUNICATIONS (HK) CO., LTD
 * All rights reserved.
 *
 * This software and its source code are proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * via any medium, is strictly prohibited without the prior written permission
 * of MONTNETS INTERNATIONAL COMMUNICATIONS (HK) CO., LTD.
 *
 * Product   : Montnets Sliding-Puzzle Captcha SDK
 * Version   : 1.0.0
 * Author    : Leon Huang
 * Homepage  : https://www.int-montnets.com
 * Support   : huangzxc@montnets.com
 *
 * ┌─ Quick Start ──────────────────────────────────────────────────────────────┐
 * │  <script src="/montnets-captcha-sdk.js"></script>                                        │
 * │  <script>                                                                   │
 * │    CaptchaSDK.init({                                                        │
 * │      serverUrl: 'http://your-captcha-server',                               │
 * │      tokenProvider: async () => {                                           │
 * │        // Call YOUR backend to exchange appId+appSecret for accessToken.   │
 * │        const res = await fetch('/api/get-captcha-token');                   │
 * │        return (await res.json()).accessToken;                               │
 * │      },                                                                     │
 * │      onSuccess: (captchaToken) => {                                         │
 * │        // Pass captchaToken to your backend for server-side verification.  │
 * │        console.log('Captcha passed:', captchaToken);                        │
 * │      }                                                                      │
 * │    });                                                                      │
 * │    CaptchaSDK.warmup();  // Pre-fetch token to eliminate open latency.     │
 * │    document.getElementById('login-btn').onclick = () => CaptchaSDK.show(); │
 * │  </script>                                                                  │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * API flow:
 *   tokenProvider()          → caller's backend → POST /captcha/init → accessToken
 *   GET  /captcha/challenge  → bgImage (PNG base64) + sliceImage + sliceY + challengeId
 *   POST /captcha/challenge/submit → { challengeId, endX, trajectory, duration } → captchaToken
 *   POST /captcha/token/check      → server-to-server, not called by the SDK
 */
;(function (global) {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  //  Constants
  // ═══════════════════════════════════════════════════════════════════════════

  /** sessionStorage key for the cached accessToken. */
  var TOKEN_CACHE_KEY = '__captcha_sdk_token__';
  /** Client-side TTL for the cached token (2 h, aligned with server-side TTL). */
  var TOKEN_CACHE_TTL = 2 * 60 * 60 * 1000;

  /**
   * Modal content width (px).
   * The background image fills this width; height is automatic (aspect-ratio preserved).
   * Background images are 640 × 320; at 360 px the scale is 0.5625 which keeps the
   * modal compact on all screen sizes.
   */
  var MODAL_W = 360;

  /**
   * Jigsaw canvas size in natural pixels (sliceWidth + tabRadius = 60 + 10 = 70).
   * Used to compute the display size and max-offset of the slider.
   */
  var CANVAS_PX = 70;

  // ═══════════════════════════════════════════════════════════════════════════
  //  Module state (private)
  // ═══════════════════════════════════════════════════════════════════════════

  var _config      = null;
  var _overlay     = null;
  var _isDragging  = false;
  var _currentX    = 0;       // Slider offset in DISPLAY pixels (absolute from track left)
  var _dragStart   = 0;       // dragStartTime (ms) for duration calculation
  var _trajectory  = [];      // [{x, y, t}, …] in display pixels
  var _challenge   = null;    // { challengeId, sliceY } from last server response
  var _bgNatW      = 0;       // bg image natural width  (px)
  var _bgDispW     = 0;       // bg image displayed width (px) — equals MODAL_W once loaded

  // ═══════════════════════════════════════════════════════════════════════════
  //  Utilities
  // ═══════════════════════════════════════════════════════════════════════════

  function _nonce(len) {
    var chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    var s = '';
    for (var i = 0; i < len; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
    return s;
  }

  function _log(msg, data) {
    if (_config && _config.debug) console.log('[CaptchaSDK] ' + msg, data !== undefined ? data : '');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  UI messages (defaults; override via config.messages)
  // ═══════════════════════════════════════════════════════════════════════════

  var DEFAULT_MESSAGES = {
    loadingCaptcha:     'Loading captcha…',
    dragToComplete:     'Drag the slider to complete the puzzle',
    loadFailed:         'Failed to load, please refresh and try again',
    verificationFailed: 'Verification failed, please try again',
    submissionFailed:   'Submission failed, please try again',
    verificationPassed: 'Verification passed'
  };

  /**
   * Resolves the display text for a given message key.
   *
   * Priority (highest → lowest):
   *   1. config.messageResolver(key, ctx) — returns a string
   *      Full control: receives the key and a ctx object, can return any string.
   *      If it returns a non-string (or nothing), falls through to the next level.
   *   2. config.messages[key]
   *      Simple key→value map. Ideal for plain text overrides without writing a function.
   *      e.g. messages: { verificationFailed: '验证码错误，请重新验证' }
   *   3. Built-in English default (DEFAULT_MESSAGES[key])
   *
   * Used only for static text (e.g. HTML template rendering).
   * For live UI-state events with DOM element access, see _dispatch().
   */
  function _msg(key) {
    if (_config && typeof _config.messageResolver === 'function') {
      var r = _config.messageResolver(key, { defaultMessage: DEFAULT_MESSAGES[key] });
      if (typeof r === 'string') return r;
    }
    return (_config && _config.messages && _config.messages[key]) || DEFAULT_MESSAGES[key] || key;
  }

  /**
   * Dispatches a UI-state event to config.messageResolver (if configured).
   *
   * Used for live events where DOM elements are already rendered (verificationPassed,
   * verificationFailed, submissionFailed, loadFailed). The caller uses _msg() as the
   * fallback message when _dispatch() returns undefined (i.e. no messageResolver set),
   * so config.messages overrides still apply in that path.
   *
   * ctx shape:
   *   { defaultMessage: string, elements: { hint?, fill?, thumb?, loading? }, error?, captchaToken? }
   *
   * Return value from messageResolver:
   *   string  — use this text instead of defaultMessage (SDK still applies default CSS/classes)
   *   false   — user handled everything; SDK skips all default visual updates for this event
   *   other   — SDK uses defaultMessage as-is (which was already resolved via _msg())
   *
   * @returns the raw return value from messageResolver, or undefined if not configured.
   */
  function _dispatch(key, ctx) {
    if (_config && typeof _config.messageResolver === 'function') {
      return _config.messageResolver(key, ctx);
    }
    return undefined;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  AccessToken cache (sessionStorage)
  // ═══════════════════════════════════════════════════════════════════════════

  function _getCachedToken() {
    try {
      var raw = sessionStorage.getItem(TOKEN_CACHE_KEY);
      if (!raw) return null;
      var cached = JSON.parse(raw);
      if (Date.now() < cached.expireAt) {
        _log('Using cached token. TTL remaining (s):', Math.floor((cached.expireAt - Date.now()) / 1000));
        return cached.token;
      }
      sessionStorage.removeItem(TOKEN_CACHE_KEY);
    } catch (e) { /* ignore */ }
    return null;
  }

  function _setCachedToken(token) {
    try {
      sessionStorage.setItem(TOKEN_CACHE_KEY, JSON.stringify({
        token: token,
        expireAt: Date.now() + TOKEN_CACHE_TTL
      }));
    } catch (e) { /* sessionStorage unavailable — degrade gracefully */ }
  }

  function _clearTokenCache() {
    try { sessionStorage.removeItem(TOKEN_CACHE_KEY); } catch (e) { /* ignore */ }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  AccessToken retrieval (cache-first)
  // ═══════════════════════════════════════════════════════════════════════════

  function _getAccessToken() {
    return new Promise(function (resolve, reject) {
      var cached = _getCachedToken();
      if (cached) return resolve(cached);

      if (typeof _config.tokenProvider !== 'function') {
        return reject(new Error('tokenProvider is not configured.'));
      }
      Promise.resolve()
        .then(function () { return _config.tokenProvider(); })
        .then(function (token) {
          if (!token) throw new Error('tokenProvider returned an empty token.');
          _setCachedToken(token);
          _log('accessToken fetched and cached.');
          resolve(token);
        })
        .catch(reject);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  HTTP helper
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Sends an HTTP request, attaches X-Access-Token header, and unwraps the
   * CaptchaResult envelope.  Business errors (success=false) are thrown as
   * Error objects with a numeric `.code` property matching the server ErrorCode.
   */
  function _request(method, path, body, accessToken) {
    var url     = (_config.serverUrl || '').replace(/\/$/, '') + path;
    var headers = { 'Content-Type': 'application/json' };
    if (accessToken) headers['X-Access-Token'] = accessToken;

    return fetch(url, {
      method:  method,
      headers: headers,
      body:    body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      if (!res.ok) {
        var err = new Error('HTTP ' + res.status);
        err.code = res.status;
        throw err;
      }
      return res.json();
    }).then(function (json) {
      if (!json.success) {
        var err = new Error(json.message || 'Request failed.');
        err.code = json.code;   // integer, e.g. 401 for ACCESS_TOKEN_INVALID
        throw err;
      }
      return json.data;
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Phase 2: GET /captcha/challenge
  // ═══════════════════════════════════════════════════════════════════════════

  function _fetchChallenge(accessToken) {
    return _request('GET', '/captcha/challenge', null, accessToken);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Phase 3: POST /captcha/challenge/submit
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * @param {string}   accessToken
   * @param {string}   challengeId
   * @param {number}   endX         Natural-pixel X coordinate (must match server's realX)
   * @param {Array}    trajectory   [{x, y, t}, …] — display-pixel positions, relative timestamps
   * @param {number}   duration     Total drag duration (ms)
   */
  function _submitChallenge(accessToken, challengeId, endX, trajectory, duration) {
    return _request('POST', '/captcha/challenge/submit', {
      challengeId: challengeId,
      endX:        endX,
      trajectory:  trajectory,
      duration:    duration
    }, accessToken);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Styles (injected once into <head>)
  // ═══════════════════════════════════════════════════════════════════════════

  var STYLES = [
    '.csk-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:center;justify-content:center;animation:cskFadeIn .2s ease}',
    '.csk-modal{background:#fff;border-radius:14px;width:' + MODAL_W + 'px;box-shadow:0 20px 60px rgba(0,0,0,.3);overflow:hidden;animation:cskSlideUp .25s ease;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI",sans-serif}',
    '.csk-header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #f0f0f0}',
    '.csk-title{font-size:14px;font-weight:600;color:#1a1a2e}',
    '.csk-close{width:28px;height:28px;border:none;background:none;cursor:pointer;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:18px;line-height:1;transition:background .15s}',
    '.csk-close:hover{background:#f3f4f6;color:#374151}',
    '.csk-body{padding:0}',
    /* Image container — relative so the slice img can overlay the bg. */
    '.csk-img-wrap{position:relative;line-height:0;background:#e0e0e0;min-height:80px}',
    '.csk-bg-img{width:100%;display:block}',
    '.csk-slice-img{position:absolute;top:0;left:0;pointer-events:none;filter:drop-shadow(0 2px 4px rgba(0,0,0,.3))}',
    /* Loading overlay. */
    '.csk-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.88);font-size:13px;color:#666}',
    '.csk-spinner{width:18px;height:18px;border:2px solid #e5e7eb;border-top-color:#4361ee;border-radius:50%;animation:cskSpin .7s linear infinite;margin-right:8px}',
    /* Refresh button on image. */
    '.csk-btn-refresh{position:absolute;top:8px;right:8px;width:28px;height:28px;border-radius:50%;background:rgba(0,0,0,.35);border:none;cursor:pointer;color:#fff;font-size:15px;display:flex;align-items:center;justify-content:center;transition:background .2s,transform .35s;z-index:10}',
    '.csk-btn-refresh:hover{background:rgba(0,0,0,.55)}',
    '.csk-btn-refresh.csk-spinning{transform:rotate(360deg)}',
    /* Bottom bar. */
    '.csk-bar{padding:10px 12px 14px}',
    '.csk-hint{font-size:12px;color:#bbb;text-align:center;margin-bottom:8px;height:16px;line-height:16px;transition:color .2s}',
    '.csk-hint.csk-ok{color:#52c41a}.csk-hint.csk-err{color:#ff4d4f}',
    /* Slider track. */
    '.csk-track{height:38px;border-radius:19px;background:#f0f2f5;border:1px solid #ddd;display:flex;align-items:center;padding:0 3px;user-select:none;cursor:grab;overflow:hidden}',
    '.csk-track:active{cursor:grabbing}',
    '.csk-track.csk-disabled{cursor:not-allowed;opacity:.6}',
    '.csk-fill{height:32px;min-width:32px;border-radius:16px;background:linear-gradient(90deg,#4361ee,#7b96f7);display:flex;align-items:center;justify-content:flex-end;transition:width .04s linear,background .3s}',
    '.csk-fill.csk-ok{background:linear-gradient(90deg,#52c41a,#73d13d)}',
    '.csk-fill.csk-err{background:linear-gradient(90deg,#ff4d4f,#ff7875)}',
    '.csk-thumb{width:32px;height:32px;flex-shrink:0;background:#fff;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,.18);display:flex;align-items:center;justify-content:center;font-size:15px;color:#666;transition:color .2s;user-select:none}',
    '@keyframes cskFadeIn{from{opacity:0}to{opacity:1}}',
    '@keyframes cskSlideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}',
    '@keyframes cskSpin{to{transform:rotate(360deg)}}'
  ].join('');

  function _injectStyles() {
    if (document.getElementById('csk-styles')) return;
    var s = document.createElement('style');
    s.id = 'csk-styles';
    s.textContent = STYLES;
    document.head.appendChild(s);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  DOM construction
  // ═══════════════════════════════════════════════════════════════════════════

  function _buildDOM() {
    var wrap = document.createElement('div');
    wrap.className = 'csk-overlay';
    wrap.innerHTML = [
      '<div class="csk-modal">',
      '  <div class="csk-header">',
      '    <span class="csk-title">Security Verification</span>',
      '    <button class="csk-close" id="csk-close">×</button>',
      '  </div>',
      '  <div class="csk-body">',
      '    <div class="csk-img-wrap" id="csk-img-wrap">',
      '      <img class="csk-bg-img"    id="csk-bg-img"    alt="">',
      '      <img class="csk-slice-img" id="csk-slice-img" alt="">',
      '      <div class="csk-loading" id="csk-loading"><div class="csk-spinner"></div></div>',
      '      <button class="csk-btn-refresh" id="csk-refresh" title="Refresh">↺</button>',
      '    </div>',
      '    <div class="csk-bar">',
      '      <div class="csk-hint" id="csk-hint">' + _msg('loadingCaptcha') + '</div>',
      '      <div class="csk-track csk-disabled" id="csk-track">',
      '        <div class="csk-fill" id="csk-fill" style="width:32px">',
      '          <div class="csk-thumb" id="csk-thumb">→</div>',
      '        </div>',
      '      </div>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('');
    return wrap;
  }

  function _q(id) { return document.getElementById(id); }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Slider mechanics
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Max slider offset in DISPLAY pixels.
   * The slice canvas is CANVAS_PX natural px wide; scale it to display px, then subtract
   * from the track width so the piece never goes past the right edge of the bg image.
   */
  function _maxOffset() {
    if (_bgDispW > 0 && _bgNatW > 0) return _bgDispW - CANVAS_PX * (_bgDispW / _bgNatW);
    return MODAL_W - 32;
  }

  function _moveSlider(clientX, clientY) {
    if (!_isDragging) return;
    var track = _q('csk-track');
    var r     = track.getBoundingClientRect();
    var ox    = clientX - r.left - 16; // 16 = half of thumb (32px)
    ox = Math.max(0, Math.min(ox, _maxOffset()));
    _currentX = ox;

    var fill  = _q('csk-fill');
    var slice = _q('csk-slice-img');
    if (fill)  fill.style.width   = (ox + 32) + 'px';
    if (slice) slice.style.left   = ox + 'px';

    _trajectory.push({ x: Math.round(ox), y: Math.round(clientY - r.top), t: Date.now() - _dragStart });
  }

  function _onDragStart(e) {
    var track = _q('csk-track');
    if (!_challenge || !track || track.classList.contains('csk-disabled')) return;
    _isDragging  = true;
    _dragStart   = Date.now();
    _trajectory  = [];
    var r = track.getBoundingClientRect();
    var cx = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
    var cy = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
    _trajectory.push({ x: Math.round(_currentX), y: Math.round(cy - r.top), t: 0 });
    _moveSlider(cx, cy);
    e.preventDefault();
  }

  function _onDragMove(e) {
    if (!_isDragging) return;
    var cx = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
    var cy = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
    _moveSlider(cx, cy);
    e.preventDefault();
  }

  function _onDragEnd() {
    if (!_isDragging || !_challenge) return;
    _isDragging = false;
    var duration = Date.now() - _dragStart;
    // Convert display-pixel offset to natural-pixel coordinate for the server.
    var scale = (_bgDispW > 0 && _bgNatW > 0) ? _bgNatW / _bgDispW : 1;
    var endX  = Math.round(_currentX * scale);
    var snap  = _challenge;
    _challenge = null;                    // prevent double submission
    _q('csk-track').classList.add('csk-disabled');
    _doSubmit(snap, endX, _trajectory, duration);
  }

  function _bindDrag() {
    var track = _q('csk-track');
    if (!track) return;
    track.addEventListener('mousedown',    _onDragStart);
    track.addEventListener('touchstart',   _onDragStart, { passive: false });
    document.addEventListener('mousemove', _onDragMove);
    document.addEventListener('touchmove', _onDragMove, { passive: false });
    document.addEventListener('mouseup',   _onDragEnd);
    document.addEventListener('touchend',  _onDragEnd);
  }

  function _unbindDrag() {
    var track = _q('csk-track');
    if (track) {
      track.removeEventListener('mousedown',    _onDragStart);
      track.removeEventListener('touchstart',   _onDragStart);
    }
    document.removeEventListener('mousemove', _onDragMove);
    document.removeEventListener('touchmove', _onDragMove);
    document.removeEventListener('mouseup',   _onDragEnd);
    document.removeEventListener('touchend',  _onDragEnd);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Challenge loading & rendering
  // ═══════════════════════════════════════════════════════════════════════════

  function _resetSlider() {
    _currentX   = 0;
    _trajectory = [];
    _bgNatW     = 0;
    _bgDispW    = 0;

    var fill  = _q('csk-fill');
    var thumb = _q('csk-thumb');
    var slice = _q('csk-slice-img');
    if (fill)  { fill.style.width = '32px'; fill.className = 'csk-fill'; }
    if (thumb) { thumb.textContent = '→'; thumb.style.color = ''; }
    if (slice) { slice.style.width = '0'; slice.style.height = '0'; }
  }

  function _setHint(msg, cls) {
    var el = _q('csk-hint');
    if (!el) return;
    el.textContent = msg;
    el.className   = 'csk-hint' + (cls ? ' ' + cls : '');
  }

  function _renderChallenge(data) {
    _challenge = { challengeId: data.challengeId, sliceY: data.sliceY };
    _resetSlider();

    var bgImg   = _q('csk-bg-img');
    var slice   = _q('csk-slice-img');
    var loading = _q('csk-loading');

    var track = _q('csk-track');

    if (track) track.classList.add('csk-disabled');

    bgImg.onload = function () {
      _bgNatW = bgImg.naturalWidth;
      if (loading) loading.style.display = 'none';
      // requestAnimationFrame ensures the browser has laid out the image
      // before we read clientWidth (parent must be visible).
      requestAnimationFrame(function () {
        _bgDispW = bgImg.clientWidth;
        var scale    = _bgNatW > 0 ? _bgDispW / _bgNatW : 1;
        var pxSize   = Math.round(CANVAS_PX * scale);

        slice.style.top    = Math.round(data.sliceY * scale) + 'px';
        slice.style.left   = '0px';
        slice.style.width  = pxSize + 'px';
        slice.style.height = pxSize + 'px';

        if (track) track.classList.remove('csk-disabled');
        var hintEl  = _q('csk-hint');
        var drResult = _dispatch('dragToComplete', {
          defaultMessage: DEFAULT_MESSAGES.dragToComplete,
          elements: { hint: hintEl }
        });
        if (drResult !== false) _setHint(typeof drResult === 'string' ? drResult : DEFAULT_MESSAGES.dragToComplete, '');
        _bindDrag();
      });
    };

    bgImg.src  = 'data:image/png;base64,' + data.bgImage;
    slice.src  = 'data:image/png;base64,' + data.sliceImage;
  }

  function _loadChallenge() {
    _unbindDrag();
    var loading = _q('csk-loading');
    var hintEl  = _q('csk-hint');
    if (loading) loading.style.display = 'flex';
    var lcResult = _dispatch('loadingCaptcha', {
      defaultMessage: DEFAULT_MESSAGES.loadingCaptcha,
      elements: { hint: hintEl, loading: loading }
    });
    if (lcResult !== false) _setHint(typeof lcResult === 'string' ? lcResult : DEFAULT_MESSAGES.loadingCaptcha, '');

    _getAccessToken().then(function (token) {
      return _fetchChallenge(token);
    }).then(function (data) {
      _renderChallenge(data);
    }).catch(function (err) {
      _log('Failed to load challenge:', err.message);
      var loadingEl = _q('csk-loading');
      var lfResult  = _dispatch('loadFailed', {
        defaultMessage: DEFAULT_MESSAGES.loadFailed,
        elements: { loading: loadingEl, hint: _q('csk-hint') },
        error: err
      });
      if (lfResult !== false) {
        var lfMsg = typeof lfResult === 'string' ? lfResult : DEFAULT_MESSAGES.loadFailed;
        if (loadingEl) loadingEl.style.display = 'none';
        _setHint(lfMsg, 'csk-err');
      }
      // Clear token cache if it's an auth error (server returns 401).
      if (err.code === 401) _clearTokenCache();
      if (typeof _config.onError === 'function') _config.onError(err);
    });
  }

  function _refresh() {
    _challenge = null;
    var rb = _q('csk-refresh');
    if (rb)     { rb.classList.add('csk-spinning'); setTimeout(function () { rb.classList.remove('csk-spinning'); }, 400); }
    _loadChallenge();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Submission & result handling
  // ═══════════════════════════════════════════════════════════════════════════

  function _doSubmit(snap, endX, traj, duration) {
    _log('Submitting: challengeId=' + snap.challengeId + ' endX=' + endX + ' duration=' + duration);
    _getAccessToken().then(function (token) {
      return _submitChallenge(token, snap.challengeId, endX, traj, duration);
    }).then(function (data) {
      if (data.passed) {
        _onPass(data.captchaToken);
      } else {
        _onFail('verificationFailed', null);
      }
    }).catch(function (err) {
      _log('Submit failed:', err.message);
      if (err.code === 401) _clearTokenCache();
      _onFail('submissionFailed', err);
    });
  }

  function _onPass(captchaToken) {
    var fill  = _q('csk-fill');
    var thumb = _q('csk-thumb');
    var hint  = _q('csk-hint');
    var result = _dispatch('verificationPassed', {
      defaultMessage: _msg('verificationPassed'),
      elements: { fill: fill, thumb: thumb, hint: hint },
      captchaToken: captchaToken
    });
    if (result !== false) {
      var msg = typeof result === 'string' ? result : _msg('verificationPassed');
      if (fill)  fill.className = 'csk-fill csk-ok';
      if (thumb) { thumb.textContent = '✓'; thumb.style.color = '#52c41a'; }
      _setHint(msg, 'csk-ok');
    }
    _log('Verification passed. captchaToken:', captchaToken);
    setTimeout(function () {
      _close();
      if (typeof _config.onSuccess === 'function') _config.onSuccess(captchaToken);
    }, 800);
  }

  function _onFail(key, error) {
    var fill  = _q('csk-fill');
    var thumb = _q('csk-thumb');
    var hint  = _q('csk-hint');
    var defaultMessage = (key === 'submissionFailed' && error && error.message)
      ? error.message
      : _msg(key);
    var result = _dispatch(key, {
      defaultMessage: defaultMessage,
      elements: { fill: fill, thumb: thumb, hint: hint },
      error: error || null
    });
    if (result !== false) {
      var msg = typeof result === 'string' ? result : defaultMessage;
      if (fill)  fill.className = 'csk-fill csk-err';
      if (thumb) { thumb.textContent = '✗'; thumb.style.color = '#ff4d4f'; }
      _setHint(msg, 'csk-err');
    }
    setTimeout(function () { _refresh(); }, 2000);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Modal show / close
  // ═══════════════════════════════════════════════════════════════════════════

  function _show() {
    if (!_config) { console.error('[CaptchaSDK] Call CaptchaSDK.init() before show().'); return; }
    if (_overlay && document.body.contains(_overlay)) return; // already open

    _injectStyles();
    _overlay = _buildDOM();
    document.body.appendChild(_overlay);

    _q('csk-close').addEventListener('click', _close);
    _q('csk-refresh').addEventListener('click', _refresh);
    _overlay.addEventListener('click', function (e) { if (e.target === _overlay) _close(); });

    _loadChallenge();
  }

  function _close() {
    _unbindDrag();
    _challenge = null;
    if (_overlay && document.body.contains(_overlay)) {
      _overlay.style.opacity   = '0';
      _overlay.style.transition = 'opacity .2s';
      setTimeout(function () {
        if (_overlay && document.body.contains(_overlay)) document.body.removeChild(_overlay);
        _overlay = null;
      }, 200);
    }
    if (_config && typeof _config.onClose === 'function') _config.onClose();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Public API
  // ═══════════════════════════════════════════════════════════════════════════

  var CaptchaSDK = {
    /**
     * Initialises the SDK. Must be called once before any other method.
     *
     * @param {Object}   config
     * @param {Function} config.tokenProvider
     *   Required. An async function that returns an accessToken string.
     *   Implement this in your own backend to exchange appId + appSecret for a token;
     *   never expose appSecret on the client side.
     *   Example:
     *     async () => {
     *       const res = await fetch('/api/captcha-token');
     *       return (await res.json()).accessToken;
     *     }
     *
     * @param {string}   [config.serverUrl='']
     *   Base URL of the Captcha service.
     *   Omit if the page is served from the same origin as the captcha backend.
     *
     * @param {Function} [config.onSuccess]
     *   Called with the captchaToken string when verification passes.
     *   Pass this token to your backend and validate it via POST /captcha/token/check.
     *
     * @param {Function} [config.onError]
     *   Called with an Error when an unrecoverable error occurs (e.g. network failure).
     *   The Error may have a numeric `.code` property matching the server ErrorCode.
     *
     * @param {Function} [config.onClose]
     *   Called whenever the modal is closed (user cancel or after success).
     *
     * @param {Function} [config.messageResolver]
     *   Callback invoked for every UI state change, giving full control over what is displayed.
     *   Signature: (key: string, ctx: object) => string | false | undefined
     *
     *   ctx properties (varies by key):
     *     ctx.defaultMessage  {string}      Built-in default text for this event.
     *     ctx.elements        {object}      Live DOM nodes — mutate them directly if needed.
     *       .hint             {HTMLElement} The status bar below the slider.
     *       .fill             {HTMLElement} The coloured slider fill strip.
     *       .thumb            {HTMLElement} The draggable thumb button.
     *       .loading          {HTMLElement} The loading overlay on the image (loadingCaptcha / loadFailed).
     *     ctx.error           {Error|null}  The Error object (submissionFailed / loadFailed only).
     *     ctx.captchaToken    {string}      The issued token (verificationPassed only).
     *
     *   Return values:
     *     string  — SDK applies default CSS state but uses this text instead of defaultMessage.
     *     false   — Skip all SDK default visual updates; you have full control via ctx.elements.
     *     other   — SDK uses defaultMessage as-is.
     *
     *   Keys: loading | loadingCaptcha | dragToComplete | loadFailed |
     *         verificationFailed | submissionFailed | verificationPassed
     *
     *   Example — translate messages and hide the success overlay:
     *     messageResolver: function(key, ctx) {
     *       var map = {
     *         dragToComplete:     '拖动滑块完成拼图',
     *         verificationFailed: '验证未通过，请重试',
     *         verificationPassed: '验证通过'
     *       };
     *       return map[key]; // undefined for unmapped keys → SDK uses defaultMessage
     *     }
     *
     *   Example — fully custom rendering on failure:
     *     messageResolver: function(key, ctx) {
     *       if (key === 'verificationFailed' || key === 'submissionFailed') {
     *         ctx.elements.hint.style.color = 'orange';
     *         ctx.elements.hint.textContent = ctx.error ? ctx.error.message : 'Try again';
     *         return false; // skip SDK's default CSS updates
     *       }
     *     }
     *
     * @param {Object}   [config.messages]
     *   Override any subset of the built-in UI strings. Unspecified keys fall back to defaults.
     *   Available keys and their defaults:
     *     loadingCaptcha     – 'Loading captcha…'
     *     dragToComplete     – 'Drag the slider to complete the puzzle'
     *     loadFailed         – 'Failed to load, please refresh and try again'
     *     verificationFailed – 'Verification failed, please try again'
     *     submissionFailed   – 'Submission failed, please try again'
     *     verificationPassed – 'Verification passed'
     *   Example:
     *     messages: { verificationFailed: '验证未通过，请重试', verificationPassed: '验证通过' }
     *
     * @param {boolean}  [config.debug=false]
     *   Enables verbose [CaptchaSDK] console logging.
     */
    init: function (config) {
      if (!config || typeof config.tokenProvider !== 'function') {
        console.error('[CaptchaSDK] init() requires a tokenProvider function.');
        return;
      }
      _config = Object.assign({ serverUrl: '', debug: false }, config);
      _log('SDK v2.0.0 initialised.');
    },

    /** Opens the captcha modal. */
    show: function () { _show(); },

    /** Programmatically closes the captcha modal. */
    close: function () { if (_overlay) _close(); },

    /**
     * Clears the locally cached accessToken.
     * Call this if your application detects the token has been revoked or expired
     * on the server, so the next show() fetches a fresh one via tokenProvider.
     */
    clearCache: function () { _clearTokenCache(); _log('Token cache cleared.'); },

    /**
     * Pre-fetches and caches the accessToken so the modal opens without latency.
     * Recommended: call warmup() right after init() on page load.
     *
     * @returns {Promise<string>} Resolves with the cached accessToken.
     */
    warmup: function () { return _getAccessToken(); },

    /**
     * All built-in UI message keys and their default values.
     * Use this as a reference when configuring config.messages, or as a base to extend:
     *   messages: Object.assign({}, CaptchaSDK.defaultMessages, { verificationFailed: '...' })
     */
    defaultMessages: DEFAULT_MESSAGES,

    version: '2.0.0'
  };

  global.CaptchaSDK = CaptchaSDK;

})(typeof window !== 'undefined' ? window : this);
