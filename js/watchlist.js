/* Watchlist: live prices for several stocks using the same feed logic as the dashboard (js/price.js).
   - U.S. pre-market, regular session, after-hours: CNBC real-time last sale (one batched request, every 5 s).
   - Overnight, weekends, holidays (and fallback if CNBC fails): Hyperliquid HIP-3 perps on the xyz dex
     (WebSocket allMids + a metaAndAssetCtxs poll).
   All symbols and coins below were verified against both APIs on 20 Nov 2026. */
(function () {
  const P = window.SPCXPrice;
  const TZ = P.TZ;
  const ET = P.ET;

  const STOCKS = [
    { ticker: "SPCX", name: "SpaceX", full: "Space Exploration Technologies Corp.", cnbc: "SPCX", bars: "SPCX.O", coin: "xyz:SPCX", href: "./" },
    { ticker: "TSLA", name: "Tesla", full: "Tesla, Inc.", cnbc: "TSLA", bars: "TSLA.O", coin: "xyz:TSLA", href: "./?c=tesla" },
    { ticker: "ANT", name: "Anthropic", full: "Anthropic, PBC · Nasdaq since 19 Nov 2026 (IPO $83)", cnbc: "ANT", bars: "ANT.O", coin: "xyz:ANT" },
    { ticker: "NVDA", name: "Nvidia", full: "NVIDIA Corporation", cnbc: "NVDA", bars: "NVDA.O", coin: "xyz:NVDA" },
    { ticker: "AMD", name: "AMD", full: "Advanced Micro Devices, Inc.", cnbc: "AMD", bars: "AMD.O", coin: "xyz:AMD" },
    { ticker: "MU", name: "Micron", full: "Micron Technology, Inc.", cnbc: "MU", bars: "MU.O", coin: "xyz:MU" },
  ];

  const CNBC_FRESH_MS = 20 * 1000;
  const HL_FRESH_MS = 30 * 1000;
  const SESSION_TEXT = { pre: "PRE", regular: "MARKET", after: "AFTER" };

  const state = {};
  STOCKS.forEach((s) => {
    state[s.ticker] = { raw: null, off: null, offAt: 0, offErr: 0, hl: null, hlAt: 0, ah: null, ahKey: "", spark: null, sparkKey: "", sparkAt: 0 };
  });
  let cnbcOkAt = 0;
  let cnbcFailCount = 0;
  let hlOkAt = 0;
  let wsMsgAt = 0;

  /* ---------- formatting ---------- */
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function toDate(t) { return t instanceof Date ? t : new Date(typeof t === "number" && t < 1e12 ? t * 1000 : t); }
  function hms(t, withSec) {
    const d = toDate(t);
    if (Number.isNaN(d.getTime())) return "";
    const s = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: withSec ? "2-digit" : undefined, hourCycle: "h23" }).format(d);
    return s + " " + P.zoneAbbrev(d);
  }
  function dayHm(t) {
    const d = toDate(t);
    if (Number.isNaN(d.getTime())) return "";
    const day = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short" }).format(d);
    return day + ", " + hms(d, false);
  }
  function shortDay(key) {
    const [y, m, d] = key.split("-").map(Number);
    return d + " " + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
  }
  function signed(n, digits) {
    if (n == null || !Number.isFinite(n)) return "—";
    const sign = n > 0 ? "+" : n < 0 ? "−" : "";
    return sign + Math.abs(n).toFixed(digits == null ? 2 : digits);
  }
  function pctText(n) { return n == null || !Number.isFinite(n) ? "" : signed(n) + "%"; }

  /* ---------- ET calendar helpers ---------- */
  function dayKeyOf(ms) { return P.dayKeyFromParts(P.etParts(new Date(ms))); }
  function partsForKey(key) {
    const [y, m, d] = key.split("-").map(Number);
    const noon = P.clockToMs(y, m, d, 12, 0, ET);
    return P.etParts(new Date(noon));
  }
  function isTradingDay(key) { return !P.sessionBounds(partsForKey(key)).closed; }
  function prevTradingDay(key) {
    const [y, m, d] = key.split("-").map(Number);
    let ms = P.clockToMs(y, m, d, 12, 0, ET);
    for (let i = 0; i < 10; i++) {
      ms -= 24 * 3600 * 1000;
      const k = dayKeyOf(ms);
      if (isTradingDay(k)) return k;
    }
    return null;
  }
  /** Latest ET trading day whose after-hours session has fully ended. */
  function lastCompletedAfterDay(now) {
    const p = P.etParts(now);
    const key = P.dayKeyFromParts(p);
    const b = P.sessionBounds(p);
    if (!b.closed && p.hour * 60 + p.minute >= b.afterEnd) return key;
    return prevTradingDay(key);
  }
  function closeTimeMs(key) {
    const p = partsForKey(key);
    const b = P.sessionBounds(p);
    return P.clockToMs(p.year, p.month, p.day, Math.floor(b.regularEnd / 60), b.regularEnd % 60, ET);
  }
  /** Last time the overnight (Hyperliquid) window began: the end of the latest completed after-hours. */
  function overnightStartMs(now) {
    const key = lastCompletedAfterDay(now);
    if (!key) return now.getTime() - 12 * 3600 * 1000;
    const p = partsForKey(key);
    const b = P.sessionBounds(p);
    return P.clockToMs(p.year, p.month, p.day, Math.floor(b.afterEnd / 60), b.afterEnd % 60, ET);
  }

  /* ---------- derived values ---------- */
  /** Latest completed official regular-session close. */
  function regularClose(st, session) {
    const q = st.raw;
    if (!q) return null;
    const last = P.parseMoney(q.last);
    const chg = P.parseMoney(q.change);
    const pct = P.parseMoney(q.change_pct);
    const todayKey = P.dayKeyFromParts(P.etParts(new Date()));
    if (session.id === "regular") {
      // During the regular session q.last is live; the latest completed close is yesterday's.
      const base = last != null && chg != null ? last - chg : P.parseMoney(q.previous_day_closing);
      const key = prevTradingDay(todayKey);
      return base != null ? { price: base, key, time: key ? closeTimeMs(key) : null, pct: null } : null;
    }
    const key = /^\d{4}-\d{2}-\d{2}/.test(q.last_time || "") ? q.last_time.slice(0, 10) : null;
    if (last == null || last <= 0) return null;
    return { price: last, key, time: key ? closeTimeMs(key) : null, pct };
  }

  function afterHours(st, session, close) {
    const q = st.raw;
    const ext = q && q.ExtendedMktQuote;
    if (session.id === "after" && ext && /POST|AFTER/.test(ext.type || "")) {
      const px = P.parseMoney(ext.last);
      if (px != null) {
        const basis = close && close.price;
        const change = basis ? px - basis : P.parseMoney(ext.change);
        return { price: px, time: ext.last_time, change, pct: basis ? (change / basis) * 100 : P.parseMoney(ext.change_pct), live: true };
      }
    }
    return st.ah;
  }

  function display(st, session) {
    const now = Date.now();
    const off = st.off;
    const offFresh = off && now - st.offAt < CNBC_FRESH_MS;
    const hlFresh = st.hl && st.hl.mid != null && now - st.hlAt < HL_FRESH_MS;
    if (session.official && offFresh) {
      return { src: "cnbc", badge: SESSION_TEXT[session.id] || "MARKET", price: off.price, time: off.time, live: true, prev: off.prevClose, change: off.change, pct: off.changePct };
    }
    if (st.hl && st.hl.mid != null) {
      return { src: "hl", badge: "HYPERLIQUID", price: st.hl.mid, time: st.hl.asOf, live: hlFresh, fallback: session.official };
    }
    if (off) {
      return { src: "cnbc", badge: session.official ? (SESSION_TEXT[session.id] || "MARKET") : "LAST", price: off.price, time: off.time, live: false, prev: off.prevClose, change: off.change, pct: off.changePct };
    }
    return null;
  }

  /* ---------- sparkline ---------- */
  function sparkSvg(points, base, livePx, liveMs, upDown) {
    const pts = (points || []).slice();
    if (livePx != null && liveMs) pts.push({ t: liveMs, c: livePx });
    if (pts.length < 2) return '<div class="wl-spark-empty">—</div>';
    const W = 160, H = 44, PAD = 3;
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    let lo = Math.min(...pts.map((p) => p.c)), hi = Math.max(...pts.map((p) => p.c));
    if (base != null && Number.isFinite(base)) { lo = Math.min(lo, base); hi = Math.max(hi, base); }
    if (hi === lo) { hi += 1; lo -= 1; }
    const x = (t) => PAD + ((t - t0) / Math.max(1, t1 - t0)) * (W - 2 * PAD);
    const y = (v) => PAD + (1 - (v - lo) / (hi - lo)) * (H - 2 * PAD);
    const d = pts.map((p, i) => (i ? "L" : "M") + x(p.t).toFixed(1) + " " + y(p.c).toFixed(1)).join("");
    const cls = upDown > 0 ? "up" : upDown < 0 ? "down" : "flat";
    const baseLine = base != null && Number.isFinite(base)
      ? '<line class="base" x1="0" x2="' + W + '" y1="' + y(base).toFixed(1) + '" y2="' + y(base).toFixed(1) + '"/>'
      : "";
    return '<svg class="wl-svg ' + cls + '" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" aria-hidden="true">' + baseLine + '<path d="' + d + '"/></svg>';
  }

  /* ---------- rendering ---------- */
  function rowSkeleton(s) {
    const nameInner = '<div class="wl-ticker">' + esc(s.ticker) + "</div>" +
      '<div class="wl-name">' + esc(s.name) + "</div>" +
      '<div class="wl-full">' + esc(s.full) + "</div>" +
      (s.href ? '<div class="wl-go">Dashboard ›</div>' : "");
    const name = s.href
      ? '<a class="wl-cell wl-stock" href="' + s.href + '">' + nameInner + "</a>"
      : '<div class="wl-cell wl-stock">' + nameInner + "</div>";
    return '<div class="wl-row" role="row" id="row-' + s.ticker + '">' + name +
      '<div class="wl-cell wl-pricecell"><div class="wl-px" data-f="px">—</div>' +
      '<div class="wl-badge closed" data-f="badge"><span class="dot"></span><span data-f="badge-text">Loading</span></div>' +
      '<div class="wl-time" data-f="time"></div></div>' +
      '<div class="wl-cell wl-chgcell"><div class="wl-chg" data-f="chg">—</div><div class="wl-chg-pct" data-f="pct"></div><div class="wl-ref" data-f="ref"></div></div>' +
      '<div class="wl-cell wl-print"><div class="k">Regular close</div><div class="v" data-f="close">—</div><div class="when" data-f="close-when"></div></div>' +
      '<div class="wl-cell wl-print"><div class="k">After hours</div><div class="v" data-f="after">—</div><div class="when" data-f="after-when"></div></div>' +
      '<div class="wl-cell wl-sparkcell"><div class="wl-spark" data-f="spark"></div><div class="wl-spark-cap" data-f="spark-cap"></div></div>' +
      "</div>";
  }

  function setHTML(row, f, html) {
    const n = row.querySelector('[data-f="' + f + '"]');
    if (n && n.__h !== html) { n.innerHTML = html; n.__h = html; }
    return n;
  }

  function renderRow(s, session) {
    const row = document.getElementById("row-" + s.ticker);
    if (!row) return;
    const st = state[s.ticker];
    const disp = display(st, session);
    const close = regularClose(st, session);
    const ah = afterHours(st, session, close);

    let chg = null, pct = null, base = null, baseLabel = "";
    if (disp && disp.src === "cnbc" && disp.change != null) {
      chg = disp.change; pct = disp.pct; base = disp.prev;
    } else if (disp && close && close.price) {
      base = close.price; chg = disp.price - base; pct = (chg / base) * 100;
    }
    if (base != null) {
      const k = close && close.key;
      baseLabel = "vs close " + P.money(base) + (k ? " (" + shortDay(k) + ")" : "");
    }

    setHTML(row, "px", disp ? P.money(disp.price) : "—");
    const badge = row.querySelector('[data-f="badge"]');
    if (badge) {
      badge.classList.toggle("closed", !(disp && disp.live));
      badge.classList.toggle("hl", !!(disp && disp.src === "hl"));
      badge.classList.toggle("reg", !!(disp && disp.badge === "MARKET"));
    }
    setHTML(row, "badge-text", disp ? disp.badge + (disp.fallback ? " · FALLBACK" : "") : "Loading");
    setHTML(row, "time", disp && disp.time ? (disp.src === "hl" ? "Mid · " : "Last sale · ") + hms(disp.time, true) : "");
    const chgEl = setHTML(row, "chg", chg != null ? signed(chg) : "—");
    const pctEl = setHTML(row, "pct", pctText(pct));
    const cls = chg > 0 ? "up" : chg < 0 ? "down" : "";
    if (chgEl) chgEl.className = "wl-chg " + cls;
    if (pctEl) pctEl.className = "wl-chg-pct " + cls;
    setHTML(row, "ref", esc(baseLabel));

    if (close) {
      const c = close.pct != null ? ' <span class="' + P.chgClass(close.pct) + '">' + pctText(close.pct) + "</span>" : "";
      setHTML(row, "close", P.money(close.price) + c);
      setHTML(row, "close-when", close.time ? dayHm(close.time) : (close.key ? shortDay(close.key) : ""));
    } else {
      setHTML(row, "close", "—"); setHTML(row, "close-when", "n/a");
    }
    if (ah && ah.price != null) {
      const c = ah.change != null ? ' <span class="' + P.chgClass(ah.change) + '">' + signed(ah.change) + (ah.pct != null ? " (" + pctText(ah.pct) + ")" : "") + "</span>" : "";
      setHTML(row, "after", P.money(ah.price) + c);
      setHTML(row, "after-when", (ah.live ? "Live · " : "") + (ah.time ? dayHm(ah.time) : ""));
    } else {
      setHTML(row, "after", "—");
      setHTML(row, "after-when", st.ahKey ? "No after-hours trades" : "");
    }

    const sp = st.spark;
    if (sp && disp) {
      const liveMs = disp.src === sp.src ? Date.now() : null;
      setHTML(row, "spark", sparkSvg(sp.points, base, liveMs ? disp.price : null, liveMs, chg));
      setHTML(row, "spark-cap", esc(sp.caption));
    }
  }

  function renderAll() {
    const now = new Date();
    const session = P.getSession(now);
    STOCKS.forEach((s) => renderRow(s, session));
    const b = session.bounds;
    const label = document.getElementById("wl-session-label");
    const box = document.getElementById("wl-session");
    let txt;
    if (session.official) {
      const name = { pre: "Pre-market", regular: "Regular session", after: "After-hours" }[session.id];
      const ends = { pre: b.regularStart, regular: b.regularEnd, after: b.afterEnd }[session.id];
      const p = P.etParts(now);
      const endMs = P.clockToMs(p.year, p.month, p.day, Math.floor(ends / 60), ends % 60, ET);
      const cnbcDown = cnbcFailCount >= 2 || (cnbcOkAt && Date.now() - cnbcOkAt > CNBC_FRESH_MS);
      txt = name + (cnbcDown ? " · CNBC unavailable, showing Hyperliquid" : " · U.S. last sale via CNBC") + " · until " + hms(endMs, false) + (b.early ? " (early close: " + b.early + ")" : "");
    } else {
      txt = "U.S. market closed (" + (session.id === "overnight" ? "overnight" : session.id === "holiday" ? b.holiday : "weekend") + ") · Hyperliquid perps";
    }
    if (label) label.textContent = txt;
    const anyLive = STOCKS.some((s) => { const d = display(state[s.ticker], session); return d && d.live; });
    if (box) box.classList.toggle("closed", !anyLive);
    const upd = document.getElementById("wl-updated");
    if (upd) {
      const parts = [];
      if (cnbcOkAt) parts.push("CNBC quote " + hms(cnbcOkAt, true));
      if (hlOkAt || wsMsgAt) parts.push("Hyperliquid " + hms(Math.max(hlOkAt, wsMsgAt), true) + (Date.now() - wsMsgAt < 15000 ? " (WebSocket)" : ""));
      upd.textContent = parts.length ? "Last update: " + parts.join(" · ") + "." : "";
    }
  }

  /* ---------- feeds ---------- */
  function wantsOfficial(now) {
    if (P.getSession(now).official) return true;
    return P.getSession(new Date(now.getTime() + 2 * 60 * 1000)).official;
  }

  async function pollCnbc() {
    try {
      const map = await P.fetchCnbcQuotes(STOCKS.map((s) => s.cnbc));
      const now = new Date();
      STOCKS.forEach((s) => {
        const q = map[s.cnbc];
        if (!q || q.code === 1) return;
        const st = state[s.ticker];
        st.raw = q;
        try { st.off = P.parseCnbcQuote(q, now); st.offAt = Date.now(); } catch (e) { st.offErr++; }
      });
      cnbcOkAt = Date.now();
      cnbcFailCount = 0;
    } catch (e) {
      cnbcFailCount++;
      console.warn("CNBC watchlist quote failed", e);
    }
    renderAll();
  }

  async function pollHl() {
    try {
      const ctxs = await P.fetchHLCtxs("xyz");
      const now = Date.now();
      STOCKS.forEach((s) => {
        const c = ctxs[s.coin];
        if (!c) return;
        const mid = c.midPx != null ? +c.midPx : +c.markPx;
        if (!Number.isFinite(mid)) return;
        state[s.ticker].hl = { mid, mark: +c.markPx, prevDay: +c.prevDayPx, asOf: new Date(now) };
        state[s.ticker].hlAt = now;
      });
      hlOkAt = now;
    } catch (e) { console.warn("Hyperliquid poll failed", e); }
    renderAll();
  }

  function startSocket() {
    let ws, ping, retry = 0;
    function connect() {
      try { ws = new WebSocket(P.HL_WS); } catch (e) { return schedule(); }
      ws.onopen = () => {
        retry = 0;
        try { ws.send(JSON.stringify({ method: "subscribe", subscription: { type: "allMids", dex: "xyz" } })); } catch (e) { /* ignore */ }
        clearInterval(ping);
        ping = setInterval(() => { try { ws.send(JSON.stringify({ method: "ping" })); } catch (e) { /* ignore */ } }, 25000);
      };
      ws.onmessage = (ev) => {
        let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (!msg || msg.channel !== "allMids") return;
        const mids = (msg.data && (msg.data.mids || msg.data)) || {};
        const now = Date.now();
        let hit = false;
        STOCKS.forEach((s) => {
          const v = mids[s.coin] != null ? +mids[s.coin] : NaN;
          if (!Number.isFinite(v)) return;
          const st = state[s.ticker];
          st.hl = Object.assign({}, st.hl || {}, { mid: v, asOf: new Date(now) });
          st.hlAt = now;
          hit = true;
        });
        if (hit) { wsMsgAt = now; scheduleRender(); }
      };
      ws.onclose = () => { clearInterval(ping); schedule(); };
      ws.onerror = () => { try { ws.close(); } catch (e) { /* ignore */ } };
    }
    function schedule() { setTimeout(connect, Math.min(15000, 1500 * Math.pow(1.6, retry++))); }
    connect();
    return { ensure() { if (!ws || ws.readyState > 1) { retry = 0; connect(); } } };
  }

  let renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; renderAll(); });
  }

  /** After-hours print for the latest completed after-hours session (from CNBC 1-minute bars). */
  async function loadAfterHours(s) {
    const st = state[s.ticker];
    const key = lastCompletedAfterDay(new Date());
    if (!key || st.ahKey === key) return;
    try {
      const p = partsForKey(key);
      const b = P.sessionBounds(p);
      const bars = await P.fetchBarsFor(s.bars, p);
      const regEndMs = P.clockToMs(p.year, p.month, p.day, Math.floor(b.regularEnd / 60), b.regularEnd % 60, ET);
      const afterEndMs = P.clockToMs(p.year, p.month, p.day, Math.floor(b.afterEnd / 60), b.afterEnd % 60, ET);
      const after = bars.filter((x) => x.t >= regEndMs && x.t < afterEndMs);
      const reg = bars.filter((x) => x.t < regEndMs);
      let basis = null;
      const q = st.raw;
      if (q && (q.last_time || "").slice(0, 10) === key && P.getSession(new Date()).id !== "regular") basis = P.parseMoney(q.last);
      if (basis == null && reg.length) basis = reg[reg.length - 1].c;
      if (after.length) {
        const last = after[after.length - 1];
        const change = basis != null ? last.c - basis : null;
        st.ah = { price: last.c, time: last.t, change, pct: change != null && basis ? (change / basis) * 100 : null, live: false };
      } else {
        st.ah = null;
      }
      st.ahKey = key;
    } catch (e) { console.warn("After-hours bars failed for " + s.ticker, e); }
  }

  /** Sparkline data from whichever source the row is showing. */
  async function loadSpark(s, force) {
    const st = state[s.ticker];
    const now = new Date();
    const session = P.getSession(now);
    const useOfficial = session.official && st.off && Date.now() - st.offAt < CNBC_FRESH_MS;
    const src = useOfficial ? "cnbc" : "hl";
    const key = src + ":" + (useOfficial ? P.dayKeyFromParts(P.etParts(now)) : overnightStartMs(now));
    const maxAge = src === "cnbc" ? 60 * 1000 : 5 * 60 * 1000;
    if (!force && st.sparkKey === key && Date.now() - st.sparkAt < maxAge) return;
    try {
      let points, caption;
      if (src === "cnbc") {
        const bars = await P.fetchBarsFor(s.bars, now);
        points = bars.map((b) => ({ t: b.t, c: b.c }));
        const p = P.etParts(now);
        const start = P.clockToMs(p.year, p.month, p.day, 4, 0, ET);
        caption = "Since " + hms(start, false) + " · U.S. tape, 1-min";
      } else {
        const start = Math.max(overnightStartMs(now), Date.now() - 72 * 3600 * 1000);
        const iv = Date.now() - start > 18 * 3600 * 1000 ? "15m" : "5m";
        const rows = await P.fetchCandlesFor(s.coin, iv, start, Date.now());
        points = rows.map((r) => ({ t: r.t, c: r.c }));
        caption = "Since " + dayHm(start) + " · Hyperliquid, " + iv;
      }
      st.spark = { src, points, caption };
      st.sparkKey = key;
      st.sparkAt = Date.now();
    } catch (e) { console.warn("Sparkline failed for " + s.ticker, e); }
  }

  async function refreshSlow() {
    await Promise.all(STOCKS.map((s) => loadAfterHours(s)));
    await Promise.all(STOCKS.map((s) => loadSpark(s)));
    renderAll();
  }

  function notes() {
    const n = document.getElementById("wl-notes");
    if (!n) return;
    n.innerHTML = "Sources per stock — U.S.: CNBC symbols " + STOCKS.map((s) => "<code>" + s.cnbc + "</code>").join(", ") +
      " (real-time Nasdaq/NYSE Arca last sale, extended hours included). Overnight: Hyperliquid " +
      STOCKS.map((s) => "<code>" + s.coin + "</code>").join(", ") +
      ". “Regular close” is the latest official 4 pm ET close and its daily change. “After hours” is the latest after-hours trade, " +
      "live during the after-hours session, otherwise the last 1-minute bar of the most recent after-hours session, with its change vs that day’s close. " +
      "Anthropic listed on Nasdaq as <code>ANT</code> on 19 Nov 2026 at an $83 IPO price; <code>xyz:ANT</code> converted from a pre-IPO market to a standard perp tracking the stock the same day.";
  }

  function boot() {
    const rows = document.getElementById("wl-rows");
    rows.innerHTML = STOCKS.map(rowSkeleton).join("");
    notes();
    renderAll();
    pollCnbc().then(refreshSlow);
    pollHl();
    const sock = startSocket();
    setInterval(() => {
      // CNBC every 5 s while a U.S. session is open; once a minute otherwise (closes, after-hours tile).
      const now = new Date();
      if (wantsOfficial(now) || Date.now() - cnbcOkAt > 60 * 1000) pollCnbc();
    }, 5000);
    setInterval(() => {
      // Hyperliquid REST poll: every 5 s if the WebSocket is quiet, otherwise every 30 s as a check.
      if (Date.now() - wsMsgAt > 10000 || Date.now() - hlOkAt > 30000) pollHl();
    }, 5000);
    setInterval(refreshSlow, 30 * 1000);
    setInterval(renderAll, 5000); // keeps freshness dots honest even without new data
    const wake = () => { if (document.visibilityState === "visible") { sock.ensure(); pollCnbc(); pollHl(); refreshSlow(); } };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
