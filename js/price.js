/* Live price & chart: Hyperliquid xyz:SPCX 24/7, with Regular close and After hours from the Yahoo snapshot. */
(function (global) {
  const TZ = "Europe/Stockholm";
  const ET = "America/New_York";
  const HL_INFO = "https://api.hyperliquid.xyz/info";
  const HL_WS = "wss://api.hyperliquid.xyz/ws";
  const COIN = "xyz:SPCX";
  const INTERVAL = "5m";
  const INTERVAL_MS = 5 * 60 * 1000;
  const WINDOW_MS = 24 * 3600 * 1000;

  function pad(n) { return String(n).padStart(2, "0"); }

  function toDate(ts) {
    return ts instanceof Date ? ts : new Date(typeof ts === "number" && ts < 1e12 ? ts * 1000 : ts);
  }

  function zoneAbbrev(date) {
    // Europe/Stockholm: CEST (UTC+2) during DST, otherwise CET (UTC+1).
    // Do not rely on Intl timeZoneName, which may render "GMT+1" instead of CET.
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      timeZoneName: "shortOffset",
      hour: "2-digit",
    }).formatToParts(date);
    const off = ((parts.find((p) => p.type === "timeZoneName") || {}).value || "").replace("UTC", "GMT");
    if (/[+−\-]0?2\b/.test(off)) return "CEST";
    return "CET";
  }

  function formatIn(ts, zone, withSec) {
    const d = toDate(ts);
    if (Number.isNaN(d.getTime())) return "";
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      year: "numeric", month: "short", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
      second: withSec ? "2-digit" : undefined,
      hour12: false, hourCycle: "h23",
    }).formatToParts(d);
    const get = (typ) => ((parts.find((p) => p.type === typ) || {}).value || "");
    const time = get("hour") + ":" + get("minute") + (withSec ? ":" + get("second") : "");
    const label = zone === TZ ? zoneAbbrev(d) : (zone === ET ? "ET" : zone);
    return String(+get("day")) + " " + get("month") + " " + get("year") + ", " + time + " " + label;
  }

  function etParts(date) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: ET,
      weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false, hourCycle: "h23",
    }).formatToParts(date);
    const get = (t) => parts.find((p) => p.type === t).value;
    return {
      weekday: get("weekday"),
      year: +get("year"), month: +get("month"), day: +get("day"),
      hour: +get("hour") === 24 ? 0 : +get("hour"),
      minute: +get("minute"),
    };
  }

  function zoneParts(ms, zone) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      weekday: "short", year: "numeric", month: "short", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false, hourCycle: "h23",
    }).formatToParts(new Date(ms));
    const get = (typ) => {
      const f = parts.find((x) => x.type === typ);
      return f ? f.value : "";
    };
    let hour = +get("hour");
    if (hour === 24) hour = 0;
    return { year: +get("year"), month: get("month"), day: get("day"), hour, minute: +get("minute"), weekday: get("weekday") };
  }

  /** Convert a wall-clock time in a zone to a UTC millisecond timestamp. */
  function clockToMs(year, month, day, hour, minute, zone) {
    let guess = Date.UTC(year, month - 1, day, hour, minute);
    for (let i = 0; i < 8; i++) {
      const p = zone === ET ? etParts(new Date(guess)) : zoneParts(guess, zone);
      const mon = zone === ET ? p.month : monthNum(p.month);
      const got = (((p.year * 12 + mon) * 32 + p.day) * 24 + p.hour) * 60 + p.minute;
      const want = (((year * 12 + month) * 32 + day) * 24 + hour) * 60 + minute;
      const diff = want - got;
      if (diff === 0) return guess;
      guess += diff * 60 * 1000;
    }
    return guess;
  }

  function monthNum(name) {
    const map = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
    return map[name] || 1;
  }

  /** US equity session. Used only to label the official Nasdaq/Yahoo snapshot. */
  function getSession(date) {
    const p = etParts(date);
    const mins = p.hour * 60 + p.minute;
    const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
    const isWeekend = dow === 0 || dow === 6 || (dow === 5 && mins >= 20 * 60);
    if (isWeekend) return { id: "weekend", label: "U.S. cash market closed (weekend)", official: false, cashOpen: false };
    if (mins >= 9 * 60 + 30 && mins < 16 * 60) {
      return { id: "regular", label: "U.S. regular session open", official: true, cashOpen: true };
    }
    if (mins >= 4 * 60 && mins < 9 * 60 + 30) {
      return { id: "pre", label: "U.S. pre-market open", official: true, cashOpen: true };
    }
    if (mins >= 16 * 60 && mins < 20 * 60) {
      return { id: "after", label: "U.S. after-hours open", official: true, cashOpen: true };
    }
    return { id: "overnight", label: "U.S. cash market closed (overnight)", official: false, cashOpen: false };
  }

  function money(n, digits) {
    if (n == null || Number.isNaN(+n)) return "—";
    const d = digits == null ? 2 : digits;
    return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function compact(n) {
    if (n == null || Number.isNaN(+n)) return "—";
    const a = Math.abs(n);
    if (a >= 1e12) return "$" + (n / 1e12).toFixed(2) + "T";
    if (a >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
    return money(n, 0);
  }

  function fmtVol(n) {
    if (n == null) return "—";
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(0) + "K";
    return String(n);
  }

  function chgClass(n) { return n > 0 ? "up" : n < 0 ? "down" : ""; }
  function chgText(d, pct) {
    if (d == null || Number.isNaN(+d)) return "";
    const sign = d > 0 ? "+" : "";
    const p = pct != null ? "  (" + sign + Number(pct).toFixed(2) + "%)" : "";
    return sign + Number(d).toFixed(2) + p;
  }

  async function postInfo(body) {
    const res = await fetch(HL_INFO, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("HL HTTP " + res.status);
    return res.json();
  }

  async function fetchHL() {
    const data = await postInfo({ type: "metaAndAssetCtxs", dex: "xyz" });
    const uni = (data[0] && data[0].universe) || [];
    const i = uni.findIndex((u) => u.name === COIN);
    if (i < 0) throw new Error(COIN + " not listed");
    const ctx = data[1][i];
    return {
      midPx: +ctx.midPx,
      markPx: +ctx.markPx,
      oraclePx: +ctx.oraclePx,
      prevDayPx: +ctx.prevDayPx,
      funding: ctx.funding != null ? +ctx.funding : null,
      dayNtlVlm: +ctx.dayNtlVlm,
      asOf: new Date(),
    };
  }

  async function fetchCandles(startMs, endMs) {
    const data = await postInfo({
      type: "candleSnapshot",
      req: { coin: COIN, interval: INTERVAL, startTime: startMs, endTime: endMs },
    });
    if (!Array.isArray(data)) throw new Error("unexpected candle payload");
    return data.map((c) => ({ t: +c.t, T: +c.T, o: +c.o, c: +c.c, h: +c.h, l: +c.l, v: +c.v, n: +c.n })).filter((c) => Number.isFinite(c.t) && Number.isFinite(c.c));
  }

  async function tryYahooLive() {
    const url = "https://query1.finance.yahoo.com/v8/finance/chart/SPCX?interval=1m&range=1d&includePrePost=true";
    const res = await fetch(url);
    if (!res.ok) throw new Error("yahoo " + res.status);
    return res.json();
  }

  let chart = null;
  let chartKey = "";
  let unlocksData = null;
  let live = {
    quote: null,
    hl: null,
    candles: [],
    onTick: null,
  };

  function livePx() {
    const h = live.hl;
    if (!h) return null;
    if (h.midPx != null && !Number.isNaN(h.midPx)) return h.midPx;
    if (h.markPx != null && !Number.isNaN(h.markPx)) return h.markPx;
    return null;
  }

  function upsertCandle(c) {
    if (!c || c.t == null) return;
    const row = { t: +c.t, T: +c.T, o: +c.o, c: +c.c, h: +c.h, l: +c.l, v: +c.v, n: +c.n };
    const i = live.candles.findIndex((x) => x.t === row.t);
    if (i >= 0) live.candles[i] = row;
    else {
      live.candles.push(row);
      live.candles.sort((a, b) => a.t - b.t);
    }
    const cutoff = Date.now() - WINDOW_MS - INTERVAL_MS;
    live.candles = live.candles.filter((x) => x.t >= cutoff);
  }

  function tsMs(ts) {
    if (ts == null || ts === "") return null;
    const d = toDate(ts);
    const ms = d.getTime();
    return Number.isNaN(ms) ? null : ms;
  }

  function etDayKey(ms) {
    const p = etParts(new Date(ms));
    return p.year + "-" + String(p.month).padStart(2, "0") + "-" + String(p.day).padStart(2, "0");
  }

  function etKind(ms) {
    const p = etParts(new Date(ms));
    const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
    if (dow === 0 || dow === 6) return "closed";
    const m = p.hour * 60 + p.minute;
    if (m >= 4 * 60 && m < 9 * 60 + 30) return "pre";
    if (m >= 9 * 60 + 30 && m < 16 * 60) return "regular";
    if (m >= 16 * 60 && m < 20 * 60) return "after";
    return "closed";
  }

  function isCompletedCloseTime(ms) {
    const p = etParts(new Date(ms));
    return p.hour * 60 + p.minute >= 16 * 60;
  }

  function prevCloseBefore(quote, closeMs) {
    const y = (quote && quote.yahoo) || {};
    const day = etDayKey(closeMs);
    let prev = null;
    for (const p of (quote && quote.daily) || []) {
      if (p.c == null) continue;
      const ms = tsMs(p.t);
      if (ms != null && etDayKey(ms) < day) prev = p.c;
    }
    if (prev != null) return prev;
    return y.previousClose != null ? y.previousClose : null;
  }

  /** Last completed U.S. regular-session close (not an in-progress regular print). */
  function lastRegularClose(quote, now) {
    const y = (quote && quote.yahoo) || {};
    const session = getSession(now || new Date());
    if (y.regularMarketPrice != null && y.regularMarketTime != null) {
      const ms = tsMs(y.regularMarketTime);
      if (ms != null && isCompletedCloseTime(ms)) {
        const prev = y.previousClose != null ? y.previousClose : prevCloseBefore(quote, ms);
        const change = prev != null ? y.regularMarketPrice - prev : null;
        const changePct = y.regularMarketChangePercent != null
          ? y.regularMarketChangePercent
          : (change != null && prev ? (change / prev) * 100 : null);
        return { price: y.regularMarketPrice, time: y.regularMarketTime, change, changePct };
      }
    }
    const today = etDayKey((now || new Date()).getTime());
    let last = null;
    for (const p of (quote && quote.intraday) || []) {
      if (p.c == null) continue;
      const ms = tsMs(p.t);
      if (ms == null || etKind(ms) !== "regular") continue;
      if (etDayKey(ms) === today && session.id === "regular") continue;
      last = { price: p.c, time: p.t, ms };
    }
    if (!last) {
      const daily = (quote && quote.daily) || [];
      for (let i = daily.length - 1; i >= 0; i--) {
        const p = daily[i];
        if (p.c == null) continue;
        const ms = tsMs(p.t);
        if (ms == null) continue;
        if (etDayKey(ms) === today && session.id === "regular") continue;
        const ep = etParts(new Date(ms));
        const closeMs = clockToMs(ep.year, ep.month, ep.day, 16, 0, ET);
        const prev = prevCloseBefore(quote, closeMs);
        const change = prev != null ? p.c - prev : null;
        const changePct = change != null && prev ? (change / prev) * 100 : null;
        return { price: p.c, time: closeMs / 1000, change, changePct };
      }
      return null;
    }
    const prev = prevCloseBefore(quote, last.ms);
    const change = prev != null ? last.price - prev : null;
    const changePct = change != null && prev ? (change / prev) * 100 : null;
    return { price: last.price, time: last.time, change, changePct };
  }

  function regularCloseOnEtDay(quote, dayKey) {
    const y = (quote && quote.yahoo) || {};
    if (y.regularMarketPrice != null && y.regularMarketTime != null) {
      const ms = tsMs(y.regularMarketTime);
      if (ms != null && etDayKey(ms) === dayKey && isCompletedCloseTime(ms)) {
        return { price: y.regularMarketPrice, time: y.regularMarketTime };
      }
    }
    let last = null;
    for (const p of (quote && quote.intraday) || []) {
      if (p.c == null) continue;
      const ms = tsMs(p.t);
      if (ms != null && etDayKey(ms) === dayKey && etKind(ms) === "regular") last = { price: p.c, time: p.t };
    }
    if (last) return last;
    for (const p of (quote && quote.daily) || []) {
      if (p.c == null) continue;
      const ms = tsMs(p.t);
      if (ms == null || etDayKey(ms) !== dayKey) continue;
      const ep = etParts(new Date(ms));
      return { price: p.c, time: clockToMs(ep.year, ep.month, ep.day, 16, 0, ET) / 1000 };
    }
    return null;
  }

  /**
   * After-hours print for the current U.S. day if that session has data;
   * otherwise the latest completed after-hours session.
   */
  function lastAfterHours(quote) {
    const pp = (quote && quote.prePostFromChart) || {};
    let last = null;
    for (const p of (quote && quote.intraday) || []) {
      if (p.c == null) continue;
      const ms = tsMs(p.t);
      if (ms != null && etKind(ms) === "after") last = { price: p.c, time: p.t, ms };
    }
    if (pp.postMarket && pp.postMarket.price != null) {
      const ms = tsMs(pp.postMarket.time);
      if (ms != null && (!last || ms >= last.ms)) last = { price: pp.postMarket.price, time: pp.postMarket.time, ms };
    }
    if (!last) return null;
    const sameDay = regularCloseOnEtDay(quote, etDayKey(last.ms));
    const basis = sameDay && sameDay.price != null ? sameDay.price : null;
    const change = basis != null ? last.price - basis : null;
    const changePct = change != null && basis ? (change / basis) * 100 : null;
    return { price: last.price, time: last.time, change, changePct };
  }

  function yahooRegularSeries(quote, minX, maxX) {
    const series = (quote && quote.intraday) || [];
    const pts = [];
    for (const p of series) {
      const ms = p.t * 1000;
      if (ms < minX - 5 * 60 * 1000 || ms > maxX) continue;
      const ep = etParts(new Date(ms));
      const m = ep.hour * 60 + ep.minute;
      if (m < 9 * 60 + 30 || m >= 16 * 60) continue;
      if (p.c == null) continue;
      pts.push({ x: ms, y: p.c });
    }
    return pts;
  }

  function cashBands(minX, maxX) {
    const bands = [];
    let open = null; // {kind, from}
    const lo = minX - 2 * 3600 * 1000;
    const hi = maxX + 2 * 3600 * 1000;
    // Sample every minute to catch 9:30 exactly, but skip ahead in a cheap way:
    // walk 1-minute steps only near possible boundaries by stepping 15m and refining.
    let lastKey = "";
    function kindAt(ms) {
      const p = etParts(new Date(ms));
      const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
      if (dow === 0 || dow === 6) return "closed";
      const m = p.hour * 60 + p.minute;
      if (m >= 4 * 60 && m < 9 * 60 + 30) return "pre";
      if (m >= 9 * 60 + 30 && m < 16 * 60) return "regular";
      if (m >= 16 * 60 && m < 20 * 60) return "after";
      return "closed";
    }
    const meta = {
      pre: { color: "rgba(240,240,250,0.03)", label: "PRE" },
      regular: { color: "rgba(240,240,250,0.08)", label: "REGULAR" },
      after: { color: "rgba(240,240,250,0.03)", label: "AFTER" },
    };
    const step = 60 * 1000;
    let prev = kindAt(lo);
    let from = lo;
    for (let t = lo + step; t <= hi; t += step) {
      const k = kindAt(t);
      if (k !== prev) {
        if (prev !== "closed" && meta[prev]) {
          bands.push({ from: from, to: t, color: meta[prev].color, label: meta[prev].label });
        }
        from = t;
        prev = k;
      }
    }
    if (prev !== "closed" && meta[prev]) {
      bands.push({ from: from, to: hi, color: meta[prev].color, label: meta[prev].label });
    }
    return bands;
  }

  function isCompactView() {
    return window.matchMedia("(max-width: 900px), (max-height: 500px)").matches;
  }

  function buildTimeTicks(minX, maxX, compact) {
    const stepH = compact ? 6 : 3;
    const ticks = [];
    const step = 15 * 60 * 1000;
    const start = Math.ceil(minX / step) * step;
    for (let t = start; t <= maxX - 20 * 60 * 1000; t += step) {
      const p = zoneParts(t, TZ);
      if (p.minute === 0 && p.hour % stepH === 0) ticks.push(t);
    }
    ticks.push(maxX);
    const out = [];
    for (const t of ticks) {
      if (!out.length || Math.abs(t - out[out.length - 1]) > 25 * 60 * 1000) out.push(t);
      else out[out.length - 1] = t;
    }
    if (compact && out.length > 5) {
      const mid = out.slice(1, -1);
      const kept = [out[0]];
      const take = 3;
      for (let i = 1; i <= take && mid.length; i++) {
        const idx = Math.round(i * mid.length / (take + 1)) - 1;
        const v = mid[Math.max(0, Math.min(mid.length - 1, idx))];
        if (v != null && kept.indexOf(v) < 0) kept.push(v);
      }
      kept.push(out[out.length - 1]);
      return kept.sort((a, b) => a - b).slice(0, 5);
    }
    return out;
  }

  function hmStockholm(ms, withDate) {
    const p = zoneParts(ms, TZ);
    const label = pad(p.hour) + ":" + pad(p.minute);
    return withDate ? label + " " + p.day + " " + p.month : label;
  }

  function sessionBandsPlugin(bands) {
    return {
      id: "sessionBands",
      beforeDraw(chart) {
        const { ctx, chartArea, scales } = chart;
        if (!chartArea || !scales.x) return;
        ctx.save();
        for (const band of bands) {
          const x1 = Math.max(chartArea.left, scales.x.getPixelForValue(band.from));
          const x2 = Math.min(chartArea.right, scales.x.getPixelForValue(band.to));
          if (x2 - x1 < 2) continue;
          ctx.fillStyle = band.color;
          ctx.fillRect(x1, chartArea.top, x2 - x1, chartArea.bottom - chartArea.top);
          ctx.fillStyle = "rgba(240,240,250,0.4)";
          ctx.font = "500 9px Barlow, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          if (x2 - x1 > 44) ctx.fillText(band.label, (x1 + x2) / 2, chartArea.top + 4);
        }
        ctx.strokeStyle = "rgba(240,240,250,0.14)";
        ctx.lineWidth = 1;
        for (const band of bands) {
          if (band.label !== "REGULAR") continue;
          for (const edge of [band.from, band.to]) {
            const x = scales.x.getPixelForValue(edge);
            if (x < chartArea.left || x > chartArea.right) continue;
            ctx.beginPath();
            ctx.moveTo(x, chartArea.top);
            ctx.lineTo(x, chartArea.bottom);
            ctx.stroke();
          }
        }
        ctx.restore();
      },
    };
  }

  function buildHlSeries(candles, px, now) {
    const start = now - WINDOW_MS;
    const bucket = Math.floor(now / INTERVAL_MS) * INTERVAL_MS;
    const pts = [];
    for (const c of candles) {
      if (c.t < start - INTERVAL_MS) continue;
      if (c.t >= bucket) continue;
      pts.push({ x: c.t + INTERVAL_MS, y: c.c });
    }
    if (px != null) pts.push({ x: now, y: px });
    return pts;
  }

  function paintChart() {
    const el = document.getElementById("intraday-chart");
    if (!el || !global.Chart) return;
    const now = Date.now();
    const px = livePx();
    const minX = now - WINDOW_MS;
    const maxX = now;
    const hlPts = buildHlSeries(live.candles, px, now);
    const yPts = yahooRegularSeries(live.quote, minX, maxX);
    const prev = live.quote && live.quote.yahoo && live.quote.yahoo.previousClose;
    const last = px != null ? px : (hlPts.length ? hlPts[hlPts.length - 1].y : null);
    const up = last != null && (prev != null ? last >= prev : (hlPts[0] && last >= hlPts[0].y));
    const color = up ? "rgba(61,214,140,1)" : "rgba(255,90,90,1)";
    const fill = up ? "rgba(61,214,140,0.12)" : "rgba(255,90,90,0.12)";
    const compact = isCompactView();
    const ticks = buildTimeTicks(minX, maxX, compact);
    const tickLabels = {};
    ticks.forEach((ms, i) => {
      const p = zoneParts(ms, TZ);
      const prevT = i ? zoneParts(ticks[i - 1], TZ) : null;
      const crossed = !prevT || prevT.day !== p.day || prevT.month !== p.month;
      tickLabels[ms] = hmStockholm(ms, crossed);
    });
    // Round key to the current minute so we do not rebuild the Chart every poll
    const key = [Math.floor(minX / 60000), Math.floor(maxX / 60000), compact ? 1 : 0, ticks.length, yPts.length > 0 ? 1 : 0].join(":");
    const caption = document.getElementById("intraday-caption");
    if (caption) {
      caption.textContent = "Hyperliquid xyz:SPCX, 5-minute candles, time in CET/CEST. The last point is the live mid, at the current time. The dashed line is the official Nasdaq/Yahoo regular session. Shaded bands are U.S. pre / regular / after-hours sessions.";
    }
    const bands = cashBands(minX, maxX);
    const datasets = [{
      label: "Hyperliquid xyz:SPCX",
      data: hlPts,
      borderColor: color,
      backgroundColor: fill,
      fill: true,
      borderWidth: 1.35,
      pointRadius: 0,
      pointHitRadius: compact ? 18 : 8,
      tension: 0.15,
      order: 1,
    }];
    if (yPts.length) {
      datasets.push({
        label: "Nasdaq / Yahoo regular (snapshot)",
        data: yPts,
        borderColor: "rgba(240,240,250,0.55)",
        backgroundColor: "transparent",
        fill: false,
        borderWidth: 1.1,
        borderDash: [5, 3],
        pointRadius: 0,
        pointHitRadius: compact ? 14 : 4,
        tension: 0.05,
        order: 2,
      });
    }
    const cfg = {
      type: "line",
      data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        parsing: false,
        interaction: { mode: "index", intersect: false, axis: "x" },
        plugins: {
          legend: {
            display: yPts.length > 0,
            labels: { color: "rgba(240,240,250,0.6)", font: { size: compact ? 11 : 10, family: "Barlow, sans-serif" }, boxWidth: 12, padding: 8 },
          },
          tooltip: {
            mode: "index", intersect: false,
            titleFont: { size: 13, family: "Barlow, sans-serif" },
            bodyFont: { size: 13, family: "Barlow, sans-serif" },
            padding: 10,
            callbacks: {
              title: (items) => items[0] ? formatIn(items[0].parsed.x, TZ, true) : "",
              label: (i) => " " + (i.dataset.label || "") + "  " + money(i.parsed.y),
            },
          },
        },
        scales: {
          x: {
            type: "linear",
            min: minX,
            max: maxX,
            afterBuildTicks(axis) { axis.ticks = ticks.map((v) => ({ value: v })); },
            ticks: {
              color: "rgba(240,240,250,0.55)",
              font: { size: compact ? 11 : 10, family: "Barlow, sans-serif" },
              maxRotation: 0, minRotation: 0, autoSkip: false,
              callback(val) { return tickLabels[val] || (Math.abs(val - maxX) < 2000 ? hmStockholm(val, false) : ""); },
            },
            grid: { color: "rgba(240,240,250,0.06)", drawTicks: false },
            border: { display: false },
          },
          y: {
            ticks: { color: "rgba(240,240,250,0.45)", font: { size: compact ? 11 : 10 }, callback: (v) => "$" + v, maxTicksLimit: compact ? 6 : 8 },
            grid: { color: "rgba(240,240,250,0.08)" },
            border: { display: false },
          },
        },
      },
      plugins: [sessionBandsPlugin(bands)],
    };
    if (chart && chartKey === key) {
      chart.data.datasets = datasets;
      chart.options.scales.x.min = minX;
      chart.options.scales.x.max = maxX;
      chart.options.scales.x.afterBuildTicks = cfg.options.scales.x.afterBuildTicks;
      chart.options.scales.x.ticks.callback = cfg.options.scales.x.ticks.callback;
      chart.update("none");
      return;
    }
    if (chart) { chart.destroy(); chart = null; }
    chartKey = key;
    chart = new Chart(el, cfg);
  }

  function render(quote, hl) {
    if (quote) live.quote = quote;
    if (hl) live.hl = hl;
    const q = live.quote || {};
    const y = q.yahoo || {};
    const now = new Date();
    const session = getSession(now);
    const px = livePx();
    const prev = y.previousClose;
    const display = px;
    const stamp = (live.hl && live.hl.asOf) || now;
    const delta = display != null && prev != null ? display - prev : null;
    const pct = delta != null && prev ? (delta / prev) * 100 : null;

    const priceEl = document.getElementById("hero-price");
    const chgEl = document.getElementById("hero-chg");
    const badge = document.getElementById("session-badge");
    const label = document.getElementById("session-label");
    const asof = document.getElementById("hero-asof");
    const printsEl = document.getElementById("session-prints");

    if (priceEl) priceEl.textContent = display != null ? money(display) : "—";
    if (chgEl) {
      chgEl.textContent = delta != null ? chgText(delta, pct) + " vs official previous close" : "";
      chgEl.className = "chg " + chgClass(delta);
    }
    if (badge && label) {
      badge.classList.remove("closed");
      label.textContent = "Hyperliquid xyz:SPCX perp – 24/7";
    }
    if (asof) {
      asof.innerHTML = "Live mid · " + formatIn(stamp, TZ, true) +
        " · the last point on the chart is this same price, at the current time.";
    }

    if (printsEl) {
      const close = lastRegularClose(q, now);
      const after = lastAfterHours(q);
      function tile(label, row, kind) {
        if (!row || row.price == null) {
          return '<div class="print"><div class="k">' + label + '</div><div class="v">—</div><div class="when">n/a</div></div>';
        }
        let chg = "";
        if (kind === "close" && row.changePct != null) {
          const sign = row.changePct > 0 ? "+" : "";
          chg = '<span class="chg-line ' + chgClass(row.changePct) + '">' + sign + Number(row.changePct).toFixed(2) + "%</span>";
        } else if (kind === "after" && row.change != null) {
          const sign = row.change > 0 ? "+" : (row.change < 0 ? "-" : "");
          const pct = row.changePct != null
            ? " (" + (row.changePct > 0 ? "+" : "") + Number(row.changePct).toFixed(2) + "%)"
            : "";
          chg = '<span class="chg-line ' + chgClass(row.change) + '">' + sign + money(Math.abs(row.change)) + pct + "</span>";
        }
        return '<div class="print"><div class="k">' + label + '</div>' +
          '<div class="v">' + money(row.price) + (chg ? " " + chg : "") + "</div>" +
          '<div class="when">' + (row.time != null ? formatIn(row.time, TZ) : "time n/a") + "</div></div>";
      }
      printsEl.innerHTML = tile("Regular close", close, "close") + tile("After hours", after, "after");
    }

    const shares = q.fundamentals && q.fundamentals.sharesOutstanding;
    const cash = q.fundamentals && q.fundamentals.cashAndStInvestmentsUsd;
    const debt = q.fundamentals && q.fundamentals.totalDebtUsd;
    const mkt = shares && display != null ? shares * display : null;
    const ev = mkt != null && cash != null && debt != null ? mkt - cash + debt : null;

    const stats = [
      { k: "Market cap", v: compact(mkt), s: shares ? "13.581B shares × live Hyperliquid mid" : "" },
      { k: "Enterprise value", v: compact(ev), s: "Net cash $52.0B (30 Sep 2026 10-Q)" },
      { k: "52-week range", v: money(y.fiftyTwoWeekLow) + " – " + money(y.fiftyTwoWeekHigh) },
      { k: "Day range (regular)", v: money(y.regularMarketDayLow) + " – " + money(y.regularMarketDayHigh) },
      { k: "Volume (regular)", v: fmtVol(y.regularMarketVolume) },
      { k: "IPO / first trade", v: "$135.00 · 12 Jun 2026" },
      { k: "Next catalyst", v: "Starship Flight 15 · 13 Nov" },
      (global.SPCXUnlocks && typeof SPCXUnlocks.overviewStat === "function"
        ? SPCXUnlocks.overviewStat(unlocksData)
        : { k: "Next share unlock", v: "—", s: "" }),
    ];
    const box = document.getElementById("key-stats");
    if (box) {
      box.innerHTML = stats.map((s) => '<div class="stat"><div class="k">' + s.k + '</div><div class="v">' + s.v + '</div>' + (s.s ? '<div class="tiny">' + s.s + "</div>" : "") + "</div>").join("");
    }
    paintChart();
    const state = { display, session, mkt, ev, hlPx: px, regular: y.regularMarketPrice, prev };
    if (typeof live.onTick === "function") {
      try { live.onTick(state); } catch (e) { console.warn(e); }
    }
    return state;
  }

  function touchLiveCandle(px, now) {
    if (px == null) return;
    const bucket = Math.floor(now / INTERVAL_MS) * INTERVAL_MS;
    const existing = live.candles.find((c) => c.t === bucket);
    if (existing) {
      existing.c = px;
      existing.h = Math.max(existing.h, px);
      existing.l = Math.min(existing.l, px);
    } else {
      upsertCandle({ t: bucket, T: bucket + INTERVAL_MS - 1, o: px, c: px, h: px, l: px, v: 0, n: 0 });
    }
  }

  function applyHl(h) {
    live.hl = h;
    touchLiveCandle(livePx(), Date.now());
    return render(live.quote, live.hl);
  }

  async function refreshCandles() {
    const end = Date.now();
    const start = end - WINDOW_MS - INTERVAL_MS;
    const rows = await fetchCandles(start, end);
    live.candles = rows;
    touchLiveCandle(livePx(), end);
  }

  function startSocket() {
    let ws, pingTimer, retry = 0, startedVis = false;
    function alive() { return ws && ws.readyState === WebSocket.OPEN; }
    function connect() {
      try { ws = new WebSocket(HL_WS); }
      catch (e) { schedule(); return; }
      ws.onopen = () => {
        retry = 0;
        try {
          ws.send(JSON.stringify({ method: "subscribe", subscription: { type: "candle", coin: COIN, interval: INTERVAL } }));
          ws.send(JSON.stringify({ method: "subscribe", subscription: { type: "allMids", dex: "xyz" } }));
        } catch (e) { /* ignore */ }
        clearInterval(pingTimer);
        pingTimer = setInterval(() => { try { ws.send(JSON.stringify({ method: "ping" })); } catch (e) { /* ignore */ } }, 25000);
      };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (!msg || !msg.channel) return;
        if (msg.channel === "candle") {
          const rows = Array.isArray(msg.data) ? msg.data : [msg.data];
          rows.forEach(upsertCandle);
          if (live.hl) render(live.quote, live.hl);
        } else if (msg.channel === "allMids") {
          const mids = (msg.data && (msg.data.mids || msg.data)) || {};
          const mid = mids[COIN] != null ? +mids[COIN] : null;
          if (mid && !Number.isNaN(mid)) {
            const h = Object.assign({}, live.hl || {}, { midPx: mid, asOf: new Date() });
            applyHl(h);
          }
        }
      };
      ws.onclose = () => { clearInterval(pingTimer); schedule(); };
      ws.onerror = () => { try { ws.close(); } catch (e) { /* ignore */ } };
    }
    function schedule() {
      const wait = Math.min(15000, 1500 * Math.pow(1.6, retry++));
      setTimeout(connect, wait);
    }
    function ensureOpen() {
      if (alive()) {
        try { ws.send(JSON.stringify({ method: "ping" })); } catch (e) { try { ws.close(); } catch (e2) { /* ignore */ } }
        return;
      }
      retry = 0;
      connect();
    }
    function onForeground() {
      ensureOpen();
      fetchHL().then(applyHl).catch((e) => console.warn("Hyperliquid poll failed", e));
      refreshCandles().then(() => render(live.quote, live.hl)).catch((e) => console.warn("HL candles failed", e));
    }
    connect();
    if (!startedVis) {
      startedVis = true;
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") onForeground();
      });
      window.addEventListener("pageshow", (ev) => { if (ev.persisted) onForeground(); });
      window.addEventListener("online", onForeground);
    }
  }

  let started = false;
  function startLive(quote, onTick) {
    live.quote = quote;
    live.onTick = onTick;
    if (quote && quote.hyperliquid && quote.hyperliquid.ok) {
      live.hl = {
        midPx: quote.hyperliquid.midPx,
        markPx: quote.hyperliquid.markPx,
        prevDayPx: quote.hyperliquid.prevDayPx,
        asOf: quote.updated ? new Date(quote.updated) : new Date(),
      };
    }
    render(live.quote, live.hl);
    if (started) return;
    started = true;
    if (!global.__spacexChartResizeBound) {
      global.__spacexChartResizeBound = true;
      let resizeTimer = null;
      window.addEventListener("resize", () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { chartKey = ""; paintChart(); }, 200);
      });
    }
    async function tick() {
      try {
        const h = await fetchHL();
        applyHl(h);
      } catch (e) { console.warn("Hyperliquid poll failed", e); }
    }
    tick();
    setInterval(tick, 5000);
    refreshCandles().then(() => render(live.quote, live.hl)).catch((e) => console.warn("HL candles failed", e));
    setInterval(() => { refreshCandles().catch((e) => console.warn("HL candles failed", e)); }, 60000);
    startSocket();
  }

  function setQuote(quote) {
    live.quote = quote;
    return render(live.quote, live.hl);
  }

  function setUnlocks(payload) {
    unlocksData = payload || null;
    if (live.quote || live.hl) return render(live.quote, live.hl);
    return null;
  }

  global.SPCXPrice = {
    getSession, formatIn, money, compact, fmtVol, chgClass, chgText,
    fetchHL, tryYahooLive, render, startLive, setQuote, setUnlocks, TZ, ET,
  };
})(window);
