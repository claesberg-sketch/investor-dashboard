/* Live price: Yahoo snapshot from data/spacex/quote.json + Hyperliquid xyz:SPCX in-browser. */
(function (global) {
  const TZ = "Europe/Stockholm";
  const ET = "America/New_York";
  const HL_INFO = "https://api.hyperliquid.xyz/info";

  function pad(n) { return String(n).padStart(2, "0"); }

  function formatIn(ts, zone, withSec) {
    const d = ts instanceof Date ? ts : new Date(typeof ts === "number" && ts < 1e12 ? ts * 1000 : ts);
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      year: "numeric", month: "short", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
      second: withSec ? "2-digit" : undefined,
      hour12: false,
    });
    return fmt.format(d) + " " + (zone === TZ ? "Europe/Stockholm" : zone === ET ? "U.S. Eastern" : zone);
  }

  function etParts(date) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: ET,
      weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(date);
    const get = (t) => parts.find((p) => p.type === t).value;
    return {
      weekday: get("weekday"),
      year: +get("year"), month: +get("month"), day: +get("day"),
      hour: +get("hour") === 24 ? 0 : +get("hour"),
      minute: +get("minute"),
    };
  }

  /** US equity session. Overnight = after 20:00 ET until 04:00 ET (and weekend). */
  function getSession(date) {
    const p = etParts(date);
    const mins = p.hour * 60 + p.minute;
    const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
    // Weekend: Friday after 20:00 through Sunday before 20:00 is broadly "weekend / HL".
    // Pre-market still starts Monday 04:00, so Sunday 20:00–Monday 04:00 is overnight too.
    const isWeekendDay = dow === 0 || dow === 6;
    const fridayAfter = dow === 5 && mins >= 20 * 60;
    const sundayBeforePre = dow === 0; // all of Sunday until Monday 4am is HL (Sun 20:05 external may resume but user asked overnight until pre)
    if (fridayAfter || isWeekendDay) {
      if (dow === 1 && mins >= 4 * 60) { /* won't happen, Monday not weekend */ }
      return { id: "weekend", label: "Weekend / overnight via Hyperliquid", official: false, useHL: true };
    }
    if (mins >= 9 * 60 + 30 && mins < 16 * 60) {
      return { id: "regular", label: "Regular session · Nasdaq", official: true, useHL: false };
    }
    if (mins >= 4 * 60 && mins < 9 * 60 + 30) {
      return { id: "pre", label: "Pre-market", official: true, useHL: false };
    }
    if (mins >= 16 * 60 && mins < 20 * 60) {
      return { id: "after", label: "After-hours", official: true, useHL: false };
    }
    return { id: "overnight", label: "Overnight via Hyperliquid", official: false, useHL: true };
  }

  function money(n, digits) {
    if (n == null || Number.isNaN(+n)) return "—";
    const d = digits == null ? (Math.abs(n) >= 100 ? 2 : 2) : digits;
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

  async function fetchHL() {
    const res = await fetch(HL_INFO, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "metaAndAssetCtxs", dex: "xyz" }),
    });
    if (!res.ok) throw new Error("HL HTTP " + res.status);
    const data = await res.json();
    const uni = (data[0] && data[0].universe) || [];
    const i = uni.findIndex((u) => u.name === "xyz:SPCX");
    if (i < 0) throw new Error("xyz:SPCX not listed");
    const ctx = data[1][i];
    return {
      midPx: +ctx.midPx,
      markPx: +ctx.markPx,
      oraclePx: +ctx.oraclePx,
      prevDayPx: +ctx.prevDayPx,
      funding: ctx.funding,
      openInterest: +ctx.openInterest,
      dayNtlVlm: +ctx.dayNtlVlm,
      asOf: new Date(),
    };
  }

  /* Optional: try Yahoo in the browser (expected to fail CORS). */
  async function tryYahooLive() {
    const url = "https://query1.finance.yahoo.com/v8/finance/chart/SPCX?interval=1m&range=1d&includePrePost=true";
    const res = await fetch(url);
    if (!res.ok) throw new Error("yahoo " + res.status);
    return res.json();
  }

  let chart;
  let chartKey = "";
  let lastPaintArgs = null;
  let resizeTimer = null;
  if (!global.__spacexChartResizeBound) {
    global.__spacexChartResizeBound = true;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!lastPaintArgs) return;
        chartKey = "";
        paintChartSafe(lastPaintArgs[0], lastPaintArgs[1]);
      }, 200);
    });
  }

  function zoneParts(ms, zone) {
    const d = new Date(ms);
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      weekday: "short", year: "numeric", month: "short", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false, hourCycle: "h23",
    }).formatToParts(d);
    const get = (typ) => {
      const f = parts.find((x) => x.type === typ);
      return f ? f.value : "";
    };
    let hour = +get("hour");
    if (hour === 24) hour = 0;
    return { year: +get("year"), month: get("month"), day: get("day"), hour, minute: +get("minute"), weekday: get("weekday") };
  }

  function hmStockholm(ms, withDate) {
    const p = zoneParts(ms, TZ);
    const label = String(p.hour).padStart(2, "0") + ":" + String(p.minute).padStart(2, "0");
    return withDate ? label + " " + p.day + " " + p.month : label;
  }

  function lastCashSession(quote, series) {
    const b = quote && quote.prePostFromChart && quote.prePostFromChart.sessionBoundsUnix;
    if (b && b.preStart && b.postEnd) {
      const pts = (series || []).filter((p) => p.t >= b.preStart && p.t <= b.postEnd && p.c != null);
      if (pts.length > 10) return { pts, bounds: b };
    }
    const src = (series || []).filter((p) => p.c != null);
    if (!src.length) return null;
    const last = src[src.length - 1];
    const lastMs = last.t * 1000;
    const p = etParts(new Date(lastMs));
    const mins = p.hour * 60 + p.minute;
    // If the last print is before 04:00 ET, the cash session ended the prior calendar day.
    let dayOffset = 0;
    if (mins < 4 * 60) dayOffset = -1;
    // Walk back to 04:00 ET of that session and forward to 20:00 ET.
    let preStart = null, preEnd = null, postStart = null, postEnd = null;
    for (const pt of src) {
      const ep = etParts(new Date(pt.t * 1000));
      const sameDay = !dayOffset
        ? (ep.year === p.year && ep.month === p.month && ep.day === p.day)
        : false;
      // When dayOffset, accept the most recent weekday session ending before last.
      if (dayOffset) {
        const lastDay = new Date(Date.UTC(p.year, p.month - 1, p.day) - 86400000);
        // Compare via ET parts of a probe: cheaper to just take points whose ET clock is 04:00–20:00 and whose timestamp is within 20h of a 20:00 close before last.
      }
    }
    // Simpler fallback: take points from the last stretch whose ET time is 04:00–20:00, back to the latest 04:00.
    let i = src.length - 1;
    while (i > 0) {
      const ep = etParts(new Date(src[i].t * 1000));
      if (ep.hour === 4 && ep.minute === 0) break;
      if (ep.hour < 4) { i -= 1; continue; }
      i -= 1;
    }
    const pts = src.slice(Math.max(0, i));
    if (pts.length < 10) return { pts: src.slice(-400), bounds: null };
    const first = pts[0].t;
    const end = pts[pts.length - 1].t;
    // Approximate session bounds from first/last + 9:30/16:00 ET in the window.
    const bounds = { preStart: first, postEnd: end };
    for (const pt of pts) {
      const ep = etParts(new Date(pt.t * 1000));
      const m = ep.hour * 60 + ep.minute;
      if (preEnd == null && m >= 9 * 60 + 30) preEnd = pt.t;
      if (postStart == null && m >= 16 * 60) postStart = pt.t;
    }
    bounds.preEnd = preEnd || first;
    bounds.postStart = postStart || end;
    return { pts, bounds };
  }

  function buildTimeTicks(bounds, mobile) {
    if (!bounds) return [];
    const preS = bounds.preStart * 1000;
    const regS = (bounds.preEnd || bounds.preStart) * 1000;
    const regE = (bounds.postStart || bounds.postEnd) * 1000;
    const postE = bounds.postEnd * 1000;
    if (mobile) {
      const mid = Math.round((regS + regE) / 2);
      return [preS, regS, mid, regE, postE];
    }
    const set = new Set([preS, regS, regE, postE]);
    const step = 15 * 60 * 1000;
    for (let t = preS; t <= postE; t += step) {
      const p = zoneParts(t, TZ);
      if (p.minute !== 0 || p.hour % 2 !== 0) continue;
      const close = [preS, regS, regE, postE].some((b) => Math.abs(b - t) > 0 && Math.abs(b - t) < 40 * 60 * 1000);
      if (!close) set.add(t);
    }
    return Array.from(set).sort((a, b) => a - b);
  }

  function sessionBandsPlugin(bounds) {
    return {
      id: "sessionBands",
      beforeDraw(chart) {
        if (!bounds) return;
        const { ctx, chartArea, scales } = chart;
        if (!chartArea || !scales.x) return;
        const bands = [
          { from: bounds.preStart * 1000, to: bounds.preEnd * 1000, color: "rgba(240,240,250,0.03)", label: "PRE" },
          { from: bounds.preEnd * 1000, to: bounds.postStart * 1000, color: "rgba(240,240,250,0.08)", label: "REGULAR" },
          { from: bounds.postStart * 1000, to: bounds.postEnd * 1000, color: "rgba(240,240,250,0.03)", label: "AFTER" },
        ];
        ctx.save();
        for (const band of bands) {
          const x1 = Math.max(chartArea.left, scales.x.getPixelForValue(band.from));
          const x2 = Math.min(chartArea.right, scales.x.getPixelForValue(band.to));
          if (x2 - x1 < 2) continue;
          ctx.fillStyle = band.color;
          ctx.fillRect(x1, chartArea.top, x2 - x1, chartArea.bottom - chartArea.top);
          ctx.fillStyle = "rgba(240,240,250,0.45)";
          ctx.font = "500 9px Barlow, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.letterSpacing = "0.14em";
          if (x2 - x1 > 36) ctx.fillText(band.label, (x1 + x2) / 2, chartArea.top + 4);
        }
        // Session boundary hairlines
        ctx.strokeStyle = "rgba(240,240,250,0.18)";
        ctx.lineWidth = 1;
        for (const edge of [bounds.preEnd, bounds.postStart]) {
          const x = scales.x.getPixelForValue(edge * 1000);
          if (x < chartArea.left || x > chartArea.right) continue;
          ctx.beginPath();
          ctx.moveTo(x, chartArea.top);
          ctx.lineTo(x, chartArea.bottom);
          ctx.stroke();
        }
        ctx.restore();
      },
    };
  }

  function paintChartSafe(quote, hlPrice) {
    const el = document.getElementById("intraday-chart");
    if (!el || !global.Chart) return;
    lastPaintArgs = [quote, hlPrice];
    const series = (quote && quote.intraday) || [];
    const sess = lastCashSession(quote, series);
    const pts = sess ? sess.pts : [];
    const bounds = sess && sess.bounds;
    const data = pts.map((p) => ({ x: p.t * 1000, y: p.c }));
    const prev = quote && quote.yahoo && quote.yahoo.previousClose;
    const last = data.length ? data[data.length - 1].y : null;
    const up = (hlPrice != null ? hlPrice : last) >= (prev || (data[0] && data[0].y) || last);
    const color = up ? "rgba(61,214,140,1)" : "rgba(255,90,90,1)";
    const fill = up ? "rgba(61,214,140,0.12)" : "rgba(255,90,90,0.12)";
    const mobile = window.matchMedia("(max-width: 720px)").matches;
    const ticks = buildTimeTicks(bounds, mobile);
    const minX = bounds ? bounds.preStart * 1000 : (data[0] && data[0].x);
    const maxX = bounds ? bounds.postEnd * 1000 : (data[data.length - 1] && data[data.length - 1].x);
    const key = [minX, maxX, mobile, ticks.length].join(":");
    const caption = document.getElementById("intraday-caption");
    if (caption) {
      caption.textContent = "Time in Europe/Stockholm. Shaded bands are the U.S. pre-market, regular, and after-hours sessions.";
    }
    const tickLabels = {};
    ticks.forEach((ms, i) => {
      const p = zoneParts(ms, TZ);
      const prevT = i ? zoneParts(ticks[i - 1], TZ) : null;
      const crossed = prevT && (prevT.day !== p.day || prevT.month !== p.month);
      tickLabels[ms] = hmStockholm(ms, crossed || (i === 0 && p.hour < 4));
    });
    const cfg = {
      type: "line",
      data: {
        datasets: [{
          data, borderColor: color, backgroundColor: fill, fill: true,
          borderWidth: 1.25, pointRadius: 0, tension: 0.15,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        parsing: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: "index", intersect: false,
            callbacks: {
              title: (items) => items[0] ? formatIn(items[0].parsed.x, TZ) : "",
              label: (i) => " " + money(i.parsed.y),
            },
          },
        },
        scales: {
          x: {
            type: "linear",
            min: minX,
            max: maxX,
            afterBuildTicks(axis) {
              axis.ticks = ticks.map((v) => ({ value: v }));
            },
            ticks: {
              color: "rgba(240,240,250,0.55)",
              font: { size: 10, family: "Barlow, sans-serif" },
              maxRotation: 0,
              minRotation: 0,
              autoSkip: false,
              callback(val) { return tickLabels[val] || ""; },
            },
            grid: { color: "rgba(240,240,250,0.06)", drawTicks: false },
            border: { display: false },
          },
          y: {
            ticks: { color: "rgba(240,240,250,0.45)", font: { size: 10 }, callback: (v) => "$" + v },
            grid: { color: "rgba(240,240,250,0.08)" },
            border: { display: false },
          },
        },
      },
      plugins: [sessionBandsPlugin(bounds)],
    };
    if (chart && chartKey === key) {
      chart.data.datasets[0].data = data;
      chart.data.datasets[0].borderColor = color;
      chart.data.datasets[0].backgroundColor = fill;
      chart.update("none");
      return;
    }
    if (chart) { chart.destroy(); chart = null; }
    chartKey = key;
    chart = new Chart(el, cfg);
  }

  function render(quote, hl, liveYahoo) {
    const y = (quote && quote.yahoo) || {};
    const pp = (quote && quote.prePostFromChart) || {};
    const now = new Date();
    const session = getSession(now);

    const regular = y.regularMarketPrice;
    const prev = y.previousClose;
    const post = pp.postMarket && pp.postMarket.price;
    const pre = pp.preMarket && pp.preMarket.price;
    const hlPx = hl && (hl.markPx || hl.midPx);

    let display, source, basisPrev, stamp;
    if (session.useHL && hlPx) {
      display = hlPx;
      source = "Hyperliquid xyz:SPCX (mark)";
      basisPrev = prev;
      stamp = hl.asOf || now;
    } else if (session.id === "pre") {
      display = (liveYahoo && liveYahoo.pre) || pre || hlPx || regular;
      source = pre || liveYahoo ? "Yahoo Finance pre-market" : "Last available (Yahoo refresh or Hyperliquid)";
      basisPrev = prev;
      stamp = (pp.preMarket && pp.preMarket.time) || (quote && quote.updated);
    } else if (session.id === "after") {
      display = (liveYahoo && liveYahoo.post) || post || hlPx || regular;
      source = post || liveYahoo ? "Yahoo Finance after-hours" : "Last available (Yahoo refresh or Hyperliquid)";
      basisPrev = regular || prev;
      stamp = (pp.postMarket && pp.postMarket.time) || (quote && quote.updated);
    } else {
      display = (liveYahoo && liveYahoo.regular) || regular;
      source = "Yahoo Finance regular session";
      basisPrev = prev;
      stamp = y.regularMarketTime;
    }

    const delta = display != null && basisPrev != null ? display - basisPrev : null;
    const pct = delta != null && basisPrev ? (delta / basisPrev) * 100 : null;

    const priceEl = document.getElementById("hero-price");
    const chgEl = document.getElementById("hero-chg");
    const badge = document.getElementById("session-badge");
    const label = document.getElementById("session-label");
    const asof = document.getElementById("hero-asof");
    const alt = document.getElementById("session-alt");

    if (priceEl) priceEl.textContent = money(display);
    if (chgEl) {
      chgEl.textContent = chgText(delta, pct);
      chgEl.className = "chg " + chgClass(delta);
    }
    if (badge && label) {
      badge.classList.toggle("closed", session.useHL || session.id !== "regular");
      label.textContent = session.label;
    }
    if (asof) {
      const when = stamp ? formatIn(stamp, TZ, true) : formatIn(now, TZ, true);
      const yUpdated = quote && quote.updated ? formatIn(quote.updated, TZ, true) : "—";
      asof.innerHTML = "Showing " + (source || "—") + " · " + when +
        "<br>Yahoo snapshot last refreshed " + yUpdated + " (server-side file; live Yahoo is blocked by CORS). Hyperliquid is polled live in this browser.";
    }
    if (alt) {
      const bits = [];
      if (regular != null) bits.push("<span>Regular close " + money(regular) + (y.regularMarketChangePercent != null ? "  (" + (y.regularMarketChangePercent > 0 ? "+" : "") + Number(y.regularMarketChangePercent).toFixed(2) + "%)" : "") + (y.regularMarketTime ? " · " + formatIn(y.regularMarketTime, TZ) : "") + "</span>");
      if (post != null) bits.push("<span>After-hours " + money(post) + (pp.postMarket.time ? " · " + formatIn(pp.postMarket.time, TZ) : "") + "</span>");
      if (pre != null) bits.push("<span>Last pre-market " + money(pre) + (pp.preMarket.time ? " · " + formatIn(pp.preMarket.time, TZ) : "") + "</span>");
      if (hlPx != null) bits.push("<span>Hyperliquid xyz:SPCX " + money(hlPx) + (hl.asOf ? " · " + formatIn(hl.asOf, TZ, true) : "") + "</span>");
      if (y.fulldayPrice != null) bits.push("<span>Yahoo full-day " + money(y.fulldayPrice) + (y.fulldayChangePercent != null ? "  (" + (y.fulldayChangePercent > 0 ? "+" : "") + Number(y.fulldayChangePercent).toFixed(2) + "%)" : "") + "</span>");
      alt.innerHTML = bits.join("");
    }

    const shares = quote.fundamentals && quote.fundamentals.sharesOutstanding;
    const cash = quote.fundamentals && quote.fundamentals.cashAndStInvestmentsUsd;
    const debt = quote.fundamentals && quote.fundamentals.totalDebtUsd;
    const mkt = shares && display != null ? shares * display : null;
    const ev = mkt != null && cash != null && debt != null ? mkt - cash + debt : null;

    const stats = [
      { k: "Market cap", v: compact(mkt), s: shares ? "13.581B shares × displayed price" : "" },
      { k: "Enterprise value", v: compact(ev), s: "Net cash $52.0B (30 Sep 2026 10-Q)" },
      { k: "52-week range", v: money(y.fiftyTwoWeekLow) + " – " + money(y.fiftyTwoWeekHigh) },
      { k: "Day range (regular)", v: money(y.regularMarketDayLow) + " – " + money(y.regularMarketDayHigh) },
      { k: "Volume (regular)", v: fmtVol(y.regularMarketVolume) },
      { k: "IPO / first trade", v: "$135.00 · 12 Jun 2026" },
      { k: "Next catalyst", v: "Starship Flight 15 · 13 Nov" },
      { k: "HL open interest", v: hl && hl.openInterest != null ? (hl.openInterest / 1e3).toFixed(0) + "k contracts" : "—" },
    ];
    const box = document.getElementById("key-stats");
    if (box) {
      box.innerHTML = stats.map((s) => '<div class="stat"><div class="k">' + s.k + '</div><div class="v">' + s.v + '</div>' + (s.s ? '<div class="tiny">' + s.s + "</div>" : "") + "</div>").join("");
    }
    paintChartSafe(quote, session.useHL ? hlPx : null);
    return { display, session, mkt, ev, hlPx, regular, prev };
  }

  global.SPCXPrice = {
    getSession, formatIn, money, compact, fmtVol, chgClass, chgText,
    fetchHL, tryYahooLive, render, TZ, ET,
  };
})(window);
