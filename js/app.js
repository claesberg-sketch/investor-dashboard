(function () {
  const DATA = "data";

  async function loadJSON(path) {
    const res = await fetch(path + "?t=" + Date.now());
    if (!res.ok) throw new Error(path + " " + res.status);
    return res.json();
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  const TZ = "Europe/Stockholm";

  function formatDate(iso) {
    if (!iso) return "";
    const d = new Date(iso.length === 10 ? iso + "T12:00:00+01:00" : iso);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" }).format(d);
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

  function hasClockTime(item) {
    const iso = (item && (item.datetime || item.created_at)) || "";
    if (!iso || (iso.length === 10 && iso.indexOf("T") === -1)) return false;
    const d = new Date(iso);
    return !Number.isNaN(d.getTime());
  }

  function formatPublished(itemOrIso) {
    const iso = typeof itemOrIso === "string" ? itemOrIso : (itemOrIso && (itemOrIso.datetime || itemOrIso.created_at || itemOrIso.date)) || "";
    const timed = typeof itemOrIso === "string" ? !(!iso || (iso.length === 10 && iso.indexOf("T") === -1)) : hasClockTime(itemOrIso);
    if (!iso) return "";
    if (!timed) {
      const day = formatDate(iso);
      return day ? day + ", time n/a" : "";
    }
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const body = new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
      hour12: false, hourCycle: "h23",
    }).format(d);
    return body + " " + zoneAbbrev(d);
  }

  function relativeAge(iso) {
    if (!iso || (iso.length === 10 && iso.indexOf("T") === -1)) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const sec = Math.round((Date.now() - d.getTime()) / 1000);
    const abs = Math.abs(sec);
    const suffix = sec >= 0 ? " ago" : " from now";
    if (abs < 45) return "just now";
    const min = Math.round(abs / 60);
    if (min < 60) return min + "m" + suffix;
    const hr = Math.round(min / 60);
    if (hr < 48) return hr + "h" + suffix;
    const day = Math.round(hr / 24);
    if (day < 21) return day + "d" + suffix;
    return "";
  }

  function fallbackSnippet(text) {
    if (!text) return "";
    const clean = String(text).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!clean) return "";
    const parts = clean.split(/(?<=[.!?])\s+/);
    return parts.filter(Boolean).slice(0, 2).join(" ").trim();
  }

  function itemSummary(i) {
    if (i.summary) return i.summary;
    return fallbackSnippet(i.snippet || i.description || "");
  }

  function feedSortKey(item) {
    if (item.datetime) return item.datetime;
    if (item.date && item.date.length === 10) return item.date + "T12:00:00+01:00";
    return item.date || "";
  }

  function topicBadges(topics, highlight) {
    return (topics || []).map((t) => '<span class="badge' + (highlight ? " hl" : "") + '">' + esc(t) + "</span>").join("");
  }

  function renderSwitcher(companies) {
    const el = document.getElementById("company-switcher");
    if (!el) return;
    el.innerHTML = (companies.companies || []).map((c) => {
      if (c.status === "active") return '<button class="active" type="button" data-id="' + c.id + '">' + esc(c.ticker) + "</button>";
      return '<button class="soon" type="button" data-id="' + c.id + '" title="Coming later">' + esc(c.ticker) + "</button>";
    }).join("");
    el.addEventListener("click", (e) => {
      const b = e.target.closest("button.soon");
      if (b) alert("Tesla and NVIDIA dashboards will be added later. The data layout is already company-scoped.");
    });
  }


  function renderNews(news, xdata) {
    const filters = document.getElementById("news-filters");
    const list = document.getElementById("news-list");
    const updated = document.getElementById("news-updated");
    const items = (news.items || []).slice();
    const posts = (xdata && xdata.posts) || [];
    const xItems = posts.map((p) => ({
      type: "x", date: p.created_at.slice(0, 10), datetime: p.created_at,
      title: p.text, source: "@" + p.username, url: p.url, topics: p.topics, highlight: p.highlight,
      summary: p.summary, snippet: p.snippet,
    }));
    const all = items.concat(xItems).sort((a, b) => feedSortKey(b).localeCompare(feedSortKey(a)));

    const types = [
      { id: "all", label: "All" },
      { id: "press", label: "Press" },
      { id: "filing", label: "Filings" },
      { id: "media", label: "Media" },
      { id: "x", label: "X" },
    ];
    let current = "all";
    function paint() {
      const shown = current === "all" ? all : all.filter((i) => i.type === current);
      const cap = window.__newsCap || 20;
      list.innerHTML = shown.slice(0, cap).map((i) => {
        const when = formatPublished(i);
        const ago = relativeAge(i.datetime);
        return '<article class="news-item"><div class="meta">' +
          '<div class="feed-type">' + esc(i.type) + '</div>' +
          (i.source ? '<div class="src">' + esc(i.source) + '</div>' : '') +
          '<div class="when">' + esc(when) + '</div>' +
          (ago ? '<div class="ago">' + esc(ago) + '</div>' : '') +
          '</div><div>' +
          topicBadges(i.topics, i.highlight) +
          '<h3>' + (i.url ? '<a href="' + esc(i.url) + '" target="_blank" rel="noopener">' + esc(i.title.length > 220 ? i.title.slice(0, 220) + '…' : i.title) + '</a>' : esc(i.title)) + '</h3>' +
          (itemSummary(i) ? '<p class="summary">' + esc(itemSummary(i)) + '</p>' : '') +
          '</div></article>';
      }).join('') || "<p class='muted'>Nothing in this filter yet.</p>";

      if (shown.length > cap) {
        list.innerHTML += '<button class="ghost" type="button" id="news-more" style="margin-top:16px">Show more (' + (shown.length - cap) + " remaining)</button>";
        const more = document.getElementById("news-more");
        if (more) more.addEventListener("click", () => { window.__newsCap = cap + 20; paint(); });
      }
    }
    if (filters) {
      filters.innerHTML = types.map((t) => '<button type="button" data-id="' + t.id + '"' + (t.id === "all" ? " class='active'" : "") + ">" + t.label + "</button>").join("");
      filters.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-id]");
        if (!b) return;
        current = b.dataset.id;
        filters.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
        paint();
      });
    }
    if (updated) {
      const candidates = [news.updated, xdata && xdata.updated].filter(Boolean);
      let latest = "";
      candidates.forEach((c) => { if (!latest || new Date(c) > new Date(latest)) latest = c; });
      const bits = ["Last updated " + (latest ? formatPublished(latest) : "—")];
      if (news.feeds && news.feeds.filings && news.feeds.filings.ok === false) {
        bits.push("Live EDGAR refresh was blocked (403); filings are from the copy stored in this repo, with acceptance times from the official filing indexes.");
      }
      updated.textContent = bits.join(" · ");
    }
    paint();
  }

  function renderTopics(xdata) {
    const counter = document.getElementById("topic-counter");
    if (!counter) return;
    const counts = {};
    ((xdata && xdata.posts) || []).forEach((p) => (p.topics || []).forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
    const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    counter.innerHTML = rows.length
      ? "<table><thead><tr><th>Topic</th><th>Posts</th></tr></thead><tbody>" +
        rows.map(([k, v]) => "<tr><td>" + esc(k) + "</td><td>" + v + "</td></tr>").join("") + "</tbody></table>"
      : "<p class='muted'>No topic tags.</p>";
  }

  function renderCalendar(cal) {
    const el = document.getElementById("calendar-list");
    if (el) {
      const events = (cal.events || []).slice().sort((a, b) => (b.highlight ? 1 : 0) - (a.highlight ? 1 : 0));
      el.innerHTML = events.map((e) =>
        '<article class="event' + (e.highlight ? " highlight" : "") + '"><div class="d">' + esc(e.dateLabel || formatDate(e.date)) + (e.tentative ? " · tentative" : "") + " · " + esc(e.type) + "</div>" +
        "<h4>" + (e.url ? '<a href="' + esc(e.url) + '" target="_blank" rel="noopener">' + esc(e.title) + "</a>" : esc(e.title)) + "</h4>" +
        (e.window ? '<p class="tiny">' + esc(e.window) + "</p>" : "") +
        "<p>" + esc(e.detail) + "</p>" +
        (e.source ? '<div class="source">' + esc(e.source) + "</div>" : "") +
        "</article>"
      ).join("");
    }
    const risks = document.getElementById("risk-list");
    if (risks) {
      risks.innerHTML = (cal.risks || []).map((r) => "<li><strong>" + esc(r.title) + "</strong> — " + esc(r.detail) + "</li>").join("");
    }
  }

  function renderValuation(quote, kpis, company, priceState) {
    const el = document.getElementById("valuation-body");
    const lock = document.getElementById("lockup-body");
    const display = priceState && priceState.display;
    const mkt = priceState && priceState.mkt;
    const ev = priceState && priceState.ev;
    const street = kpis.street || {};
    const fy26s = street.revenueFY2026 && street.revenueFY2026.avg * 1e6;
    const fy27s = street.revenueFY2027 && street.revenueFY2027.avg * 1e6;
    const evs26 = ev && fy26s ? (ev / fy26s).toFixed(1) + "×" : "—";
    const evs27 = ev && fy27s ? (ev / fy27s).toFixed(1) + "×" : "—";
    if (el) {
      el.innerHTML =
        '<p>Displayed price <strong>' + SPCXPrice.money(display) + "</strong>. Traditional market cap (all 13.581B shares at that price) <strong>" + SPCXPrice.compact(mkt) + "</strong>. Enterprise value <strong>" + SPCXPrice.compact(ev) + "</strong> after net cash of about $52.0B on the 30 Sep 2026 10-Q.</p>" +
        "<p style='margin-top:10px'>EV / street FY2026 sales (" + SPCXPrice.compact(fy26s) + "): <strong>" + evs26 + "</strong>. EV / street FY2027 sales (" + SPCXPrice.compact(fy27s) + "): <strong>" + evs27 + "</strong>. Circulating / FloatCap value is much lower (~$0.60T at a stale $135 reference on FloatCap) because only about 33% of shares can trade.</p>" +
        "<p style='margin-top:10px'>Street (S&amp;P Global, 40 analysts, 10 Nov 2026): consensus rating <strong>" + esc(street.rating || "—") + "</strong>, average target <strong>" + SPCXPrice.money(street.priceTarget && street.priceTarget.average) + "</strong> (median " + SPCXPrice.money(street.priceTarget && street.priceTarget.median) + ", range " + SPCXPrice.money(street.priceTarget && street.priceTarget.low) + "–" + SPCXPrice.money(street.priceTarget && street.priceTarget.high) + "). Mix: 24 Strong Buy, 8 Buy, 6 Hold, 2 Strong Sell. Recent: BofA maintains Buy (10 Nov); Stifel $190; Deutsche Bank $250; Barclays $300; Needham $250.</p>" +
        '<p class="source"><a href="' + (street.source && street.source.url) + '" target="_blank" rel="noopener">' + esc(street.source && street.source.label) + "</a></p>";
    }
    if (lock) {
      lock.innerHTML =
        "<p>Shares outstanding <strong>13,581,063,709</strong> as of 15 Oct 2026 (8.247B Class A, 5.335B Class B). Estimated circulating supply ~4.45B (32.7%). Musk voting power was 82.3% at the IPO.</p>" +
        "<p style='margin-top:10px'><strong>8 Dec 2026</strong> — remaining 180-day lock-up, about 797.6M shares. <strong>16 Feb 2027</strong> — earliest Rule 144 day for ~391M Cursor shares (a separate lock-up may still apply). <strong>12–14 Jun 2027</strong> — Musk 366-day lock-up (0.85B Class A + 3.92B Class B, the latter must convert to trade), plus a 20% extended-group slice.</p>" +
        '<p class="source"><a href="https://www.sec.gov/Archives/edgar/data/1181412/000162828026066880/spcx-20260930.htm" target="_blank" rel="noopener">10-Q cover, 15 Oct 2026</a> · <a href="https://floatcap.app/stocks/SPCX" target="_blank" rel="noopener">FloatCap compilation of the 424(b)(4)</a></p>';
    }
  }

  async function boot() {
    const toggle = document.getElementById("menu-toggle");
    const nav = document.getElementById("site-nav");
    if (toggle && nav) toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    const [companies, company, quote, news, xposts, forecast, kpis, calendar, unlocks] = await Promise.all([
      loadJSON(DATA + "/companies.json"),
      loadJSON(DATA + "/spacex/company.json"),
      loadJSON(DATA + "/spacex/quote.json"),
      loadJSON(DATA + "/spacex/news.json"),
      loadJSON(DATA + "/spacex/x-posts.json"),
      loadJSON(DATA + "/spacex/forecast.json"),
      loadJSON(DATA + "/spacex/kpis.json"),
      loadJSON(DATA + "/spacex/calendar.json"),
      loadJSON(DATA + "/spacex/unlocks.json"),
    ]);

    renderSwitcher(companies);
    document.getElementById("hero-ticker").textContent = company.ticker;
    document.getElementById("hero-name").textContent = company.name;

    let state = { display: null };
    function onPrice(next) {
      state = next;
      renderValuation(quote, kpis, company, state);
      if (window.SPCXUnlocks) SPCXUnlocks.updatePrice(state && state.display);
    }
    renderNews(news, xposts);
    renderTopics(xposts);
    SPCXForecast.mount(forecast);
    SPCXCharts.mount(kpis);
    if (window.SPCXUnlocks) SPCXUnlocks.mount(unlocks, state && state.display);
    renderCalendar(calendar);
    renderValuation(quote, kpis, company, state);
    SPCXPrice.startLive(quote, onPrice);

    // Re-fetch the Yahoo snapshot file periodically (live Yahoo is CORS-blocked in the browser).
    async function tickQuote() {
      try {
        const q = await loadJSON(DATA + "/spacex/quote.json");
        Object.assign(quote, q);
        state = SPCXPrice.setQuote(quote) || state;
        renderValuation(quote, kpis, company, state);
        if (window.SPCXUnlocks) SPCXUnlocks.updatePrice(state && state.display);
      } catch (e) { console.warn("quote refresh failed", e); }
      try { await SPCXPrice.tryYahooLive(); }
      catch (e) { /* expected: Yahoo blocks browser CORS */ }
    }
    setInterval(tickQuote, 30000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => boot().catch(console.error));
  else boot().catch(console.error);
})();
