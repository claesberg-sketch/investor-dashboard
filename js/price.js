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

  let hlTrail = [];
  let chart;

  function paintChart(quote, hlPrice) {
    const el = document.getElementById("intraday-chart");
    if (!el || !global.Chart) return;
    const series = (quote && quote.intraday) || [];
    const labels = series.map((p) => p.t * 1000);
    const data = series.map((p) => p.c);
    const last = data[data.length - 1];
    const up = hlPrice != null ? hlPrice >= (quote.yahoo.previousClose || last) : (last >= (data[0] || last));
    const color = up ? "rgba(61,214,140,1)" : "rgba(255,90,90,1)";
    const fill = up ? "rgba(61,214,140,0.12)" : "rgba(255,90,90,0.12)";
    if (chart) {
      chart.data.labels = labels;
      chart.data.datasets[0].data = data;
      chart.data.datasets[0].borderColor = color;
      chart.data.datasets[0].backgroundColor = fill;
      chart.update("none");
      return;
    }
    chart = new Chart(el, {
      type: "line",
      data: {
        labels,
        datasets: [{
          data, borderColor: color, backgroundColor: fill, fill: true,
          borderWidth: 1.25, pointRadius: 0, tension: 0.15,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: {
          mode: "index", intersect: false,
          callbacks: {
            title: (items) => items[0] ? formatIn(items[0].parsed.x, TZ) : "",
            label: (i) => " " + money(i.parsed.y),
          },
        } },
        scales: {
          x: { type: "time", display: false, time: { unit: "hour" } },
          y: {
            ticks: { color: "rgba(240,240,250,0.45)", font: { size: 10 }, callback: (v) => "$" + v },
            grid: { color: "rgba(240,240,250,0.08)" },
            border: { display: false },
          },
        },
      },
    });
  }

  // Chart.js time scale may be missing without adapter. Use category-less linear by index if needed.
  function paintChartSafe(quote, hlPrice) {
    const el = document.getElementById("intraday-chart");
    if (!el || !global.Chart) return;
    const series = (quote && quote.intraday) || [];
    // Use last regular + post session (~780 pts) or last 500
    const slice = series.length > 800 ? series.slice(-800) : series;
    const labels = slice.map((p) => formatIn(p.t, ET).replace(" U.S. Eastern", ""));
    const data = slice.map((p) => p.c);
    const prev = quote.yahoo && quote.yahoo.previousClose;
    const last = data[data.length - 1];
    const up = (hlPrice != null ? hlPrice : last) >= (prev || data[0] || last);
    const color = up ? "rgba(61,214,140,1)" : "rgba(255,90,90,1)";
    const fill = up ? "rgba(61,214,140,0.12)" : "rgba(255,90,90,0.12)";
    const cfg = {
      type: "line",
      data: { labels, datasets: [{ data, borderColor: color, backgroundColor: fill, fill: true, borderWidth: 1.25, pointRadius: 0, tension: 0.15 }] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false }, tooltip: { mode: "index", intersect: false,
          callbacks: { label: (i) => " " + money(i.parsed.y) } } },
        scales: {
          x: { ticks: { display: false }, grid: { display: false }, border: { display: false } },
          y: { ticks: { color: "rgba(240,240,250,0.45)", font: { size: 10 }, callback: (v) => "$" + v },
            grid: { color: "rgba(240,240,250,0.08)" }, border: { display: false } },
        },
      },
    };
    if (chart) { chart.data = cfg.data; chart.options = cfg.options; chart.update("none"); }
    else chart = new Chart(el, cfg);
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
