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

  function formatDate(iso) {
    if (!iso) return "";
    const d = new Date(iso.length === 10 ? iso + "T12:00:00Z" : iso);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", day: "2-digit", month: "short", year: "numeric" }).format(d);
  }

  function formatTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return SPCXPrice.formatIn(d, SPCXPrice.TZ);
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

  function renderChanged(news, posts, calendar) {
    const el = document.getElementById("changed-strip");
    if (!el) return;
    const cutoff = Date.now() - 48 * 3600 * 1000;
    const items = [];
    (posts || []).forEach((p) => {
      const t = Date.parse(p.created_at);
      if (t >= cutoff && p.highlight) {
        items.push({ when: p.created_at, title: "@" + p.username + " — " + p.text.slice(0, 140), url: p.url, kind: "X" });
      }
    });
    (news.items || []).forEach((n) => {
      const t = Date.parse(n.datetime || n.date);
      if (t >= cutoff && n.type !== "filing") {
        items.push({ when: n.datetime || n.date, title: n.title, url: n.url, kind: n.type });
      }
    });
    (calendar.events || []).forEach((e) => {
      const t = Date.parse(e.date);
      const days = (t - Date.now()) / 86400000;
      if (days >= -0.5 && days <= 7) {
        items.push({ when: e.date, title: e.title, url: e.url, kind: e.type });
      }
    });
    // Prefer uniqueness and cap at 4
    const seen = new Set();
    const uniq = [];
    for (const it of items.sort((a, b) => Date.parse(b.when) - Date.parse(a.when))) {
      const k = it.title.slice(0, 80);
      if (seen.has(k)) continue;
      seen.add(k);
      uniq.push(it);
      if (uniq.length === 4) break;
    }
    // Fallback curated if thin
    if (uniq.length < 3) {
      uniq.push({ when: "2026-11-13", title: "Starship Flight 15, 13 Nov, 17:45–19:00 ET window", url: "https://www.spacex.com/launches/starship-flight-15", kind: "launch" });
    }
    el.innerHTML = uniq.map((it) =>
      '<article><div class="when">' + esc(it.kind) + " · " + formatDate(it.when) + "</div><h3>" +
      (it.url ? '<a href="' + esc(it.url) + '" target="_blank" rel="noopener">' + esc(it.title) + "</a>" : esc(it.title)) +
      "</h3></article>"
    ).join("");
  }

  function renderNews(news, posts) {
    const filters = document.getElementById("news-filters");
    const list = document.getElementById("news-list");
    const updated = document.getElementById("news-updated");
    const items = (news.items || []).slice();
    const xItems = (posts || []).map((p) => ({
      type: "x", date: p.created_at.slice(0, 10), datetime: p.created_at,
      title: p.text, source: "@" + p.username, url: p.url, topics: p.topics, highlight: p.highlight,
    }));
    const all = items.concat(xItems).sort((a, b) => (b.datetime || b.date || "").localeCompare(a.datetime || a.date || ""));

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
      list.innerHTML = shown.slice(0, 60).map((i) =>
        '<article class="news-item"><div class="meta">' + esc(i.type) + "<br>" + formatDate(i.datetime || i.date) + "<br>" + esc(i.source || "") + "</div><div>" +
        topicBadges(i.topics, i.highlight) +
        "<h3>" + (i.url ? '<a href="' + esc(i.url) + '" target="_blank" rel="noopener">' + esc(i.title.length > 220 ? i.title.slice(0, 220) + "…" : i.title) + "</a>" : esc(i.title)) + "</h3>" +
        (i.summary ? "<p>" + esc(i.summary) + "</p>" : "") +
        "</div></article>"
      ).join("") || "<p class='muted'>Nothing in this filter yet.</p>";
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
      const bits = ["News JSON updated " + (news.updated ? formatTime(news.updated) : "—")];
      if (news.feeds && news.feeds.filings && news.feeds.filings.ok === false) bits.push("Live EDGAR refresh was blocked (403); filings shown from the seeded list.");
      updated.textContent = bits.join(" · ");
    }
    paint();
  }

  function renderX(xdata) {
    const el = document.getElementById("x-feed");
    const note = document.getElementById("x-note");
    const posts = (xdata.posts || []).filter((p) => p.highlight).slice(0, 12);
    if (el) {
      el.innerHTML = posts.map((p) =>
        '<article class="x-card"><div class="who">@' + esc(p.username) + " · " + formatTime(p.created_at) + "</div>" +
        topicBadges(p.topics, true) +
        "<p>" + esc(p.text) + "</p>" +
        '<div class="x-metrics">' + (p.metrics.likes || 0).toLocaleString() + " likes · <a href='" + esc(p.url) + "' target='_blank' rel='noopener'>Open on X</a></div></article>"
      ).join("");
    }
    if (note) {
      note.innerHTML = "Last seeded " + (xdata.updated ? formatTime(xdata.updated) : "—") + ". GitHub Actions cannot use the X connector, so this list is a snapshot. Official timelines: " +
        (xdata.accounts || []).map((a) => '<a href="https://x.com/' + a.username + '" target="_blank" rel="noopener">@' + a.username + "</a>").join(" · ") +
        ". " + (xdata.missing || []).join(" ");
    }
    const counter = document.getElementById("topic-counter");
    if (counter) {
      const counts = {};
      (xdata.posts || []).forEach((p) => (p.topics || []).forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
      const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      counter.innerHTML = rows.length
        ? '<table><thead><tr><th>Topic</th><th>Posts in this snapshot</th></tr></thead><tbody>' +
          rows.map(([k, v]) => "<tr><td>" + esc(k) + "</td><td>" + v + "</td></tr>").join("") + "</tbody></table>"
        : "<p class='muted'>No topic tags.</p>";
    }
  }

  function renderCalendar(cal) {
    const el = document.getElementById("calendar-list");
    if (el) {
      el.innerHTML = (cal.events || []).map((e) =>
        '<article class="event"><div class="d">' + esc(e.dateLabel || formatDate(e.date)) + (e.tentative ? " · tentative" : "") + " · " + esc(e.type) + "</div>" +
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

    const [companies, company, quote, news, xposts, forecast, kpis, calendar] = await Promise.all([
      loadJSON(DATA + "/companies.json"),
      loadJSON(DATA + "/spacex/company.json"),
      loadJSON(DATA + "/spacex/quote.json"),
      loadJSON(DATA + "/spacex/news.json"),
      loadJSON(DATA + "/spacex/x-posts.json"),
      loadJSON(DATA + "/spacex/forecast.json"),
      loadJSON(DATA + "/spacex/kpis.json"),
      loadJSON(DATA + "/spacex/calendar.json"),
    ]);

    renderSwitcher(companies);
    document.getElementById("hero-ticker").textContent = company.ticker;
    document.getElementById("hero-name").textContent = company.name;

    let hl = quote.hyperliquid && quote.hyperliquid.ok ? {
      midPx: quote.hyperliquid.midPx,
      markPx: quote.hyperliquid.markPx,
      prevDayPx: quote.hyperliquid.prevDayPx,
      openInterest: quote.hyperliquid.openInterest,
      asOf: quote.updated,
    } : null;

    let state = SPCXPrice.render(quote, hl, null);
    renderChanged(news, xposts.posts, calendar);
    renderNews(news, xposts.posts);
    renderX(xposts);
    SPCXForecast.mount(forecast);
    SPCXCharts.mount(kpis);
    renderCalendar(calendar);
    renderValuation(quote, kpis, company, state);

    async function tickHL() {
      try {
        hl = await SPCXPrice.fetchHL();
        state = SPCXPrice.render(quote, hl, null);
        renderValuation(quote, kpis, company, state);
      } catch (e) {
        console.warn("Hyperliquid poll failed", e);
      }
    }
    tickHL();
    setInterval(tickHL, 5000);

    // Re-fetch the Action-produced quote periodically (and try Yahoo CORS, which will usually fail).
    async function tickQuote() {
      try {
        const q = await loadJSON(DATA + "/spacex/quote.json");
        Object.assign(quote, q);
        state = SPCXPrice.render(quote, hl, null);
        renderValuation(quote, kpis, company, state);
      } catch (e) { console.warn("quote refresh failed", e); }
      try { await SPCXPrice.tryYahooLive(); }
      catch (e) { /* expected: Yahoo blocks browser CORS */ }
    }
    setInterval(tickQuote, 30000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => boot().catch(console.error));
  else boot().catch(console.error);
})();
