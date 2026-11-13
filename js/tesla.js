/* Tesla (TSLA) views: overview tiles, KPI charts, operations tracker, valuation and share structure.
   Every number comes from data/tesla/*.json (Tesla Update decks, 10-Q, 8-Ks, StockAnalysis/S&P Global). */
(function (global) {
  const compact = () => window.matchMedia("(max-width: 900px), (max-height: 500px)").matches;
  const C = {
    auto: "rgba(74,144,255,0.9)",
    energy: "rgba(61,214,140,0.9)",
    services: "rgba(167,112,255,0.92)",
    prod: "rgba(240,240,250,0.9)",
    orange: "rgba(255,153,51,0.92)",
    red: "rgba(255,92,108,0.92)",
    teal: "rgba(38,208,206,0.9)",
    pink: "rgba(255,110,199,0.9)",
    y2025: "rgba(240,240,250,0.35)",
    y2026: "rgba(232,33,39,0.9)",
    tick: "rgba(240,240,250,0.6)",
    grid: "rgba(240,240,250,0.08)",
    border: "rgba(240,240,250,0.15)",
  };
  const charts = [];

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function link(src) {
    if (!src) return "";
    return src.url ? '<a href="' + esc(src.url) + '" target="_blank" rel="noopener">' + esc(src.label) + "</a>" : esc(src.label);
  }
  const P = () => global.SPCXPrice;
  const num = (v, d) => v == null ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: d == null ? 0 : d, minimumFractionDigits: d || 0 });

  function axes(opts) {
    opts = opts || {};
    const small = compact();
    const tick = { color: C.tick, font: { size: small ? 10 : 11 } };
    const s = {
      x: { stacked: !!opts.stacked, ticks: { ...tick, autoSkip: false, maxRotation: 45 }, grid: { display: false }, border: { color: C.border } },
      y: { stacked: !!opts.stacked, beginAtZero: opts.beginAtZero !== false, ticks: { ...tick, maxTicksLimit: 6, callback: opts.yfmt }, grid: { color: C.grid }, border: { color: C.border },
        title: opts.ytitle ? { display: true, text: opts.ytitle, color: C.tick, font: { size: 10 } } : undefined },
    };
    if (opts.y1) {
      s.y1 = { position: "right", beginAtZero: opts.y1.beginAtZero !== false, ticks: { ...tick, maxTicksLimit: 6, callback: opts.y1.fmt }, grid: { display: false }, border: { color: C.border },
        title: opts.y1.title ? { display: true, text: opts.y1.title, color: C.tick, font: { size: 10 } } : undefined };
    }
    return s;
  }
  function baseOpts(opts) {
    const small = compact();
    return {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: "index", intersect: false },
      layout: { padding: { top: opts && opts.padTop ? opts.padTop : 4 } },
      plugins: {
        legend: { display: !(opts && opts.noLegend), labels: { color: "rgba(240,240,250,0.85)", boxWidth: 12, font: { size: small ? 10 : 11 }, padding: 8 } },
        tooltip: { titleFont: { size: 13 }, bodyFont: { size: 13 }, padding: 10, callbacks: opts && opts.tooltip },
      },
      scales: axes(opts),
    };
  }
  const totalsPlugin = {
    id: "tslaTotals",
    afterDatasetsDraw(chart) {
      const totals = chart.$totals;
      if (!totals) return;
      const { ctx, scales: { x, y } } = chart;
      ctx.save();
      ctx.fillStyle = "rgba(240,240,250,0.88)";
      ctx.font = (compact() ? "9px" : "11px") + ' Barlow, "Helvetica Neue", sans-serif';
      ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      totals.forEach((t, i) => { if (t != null) ctx.fillText(chart.$totalFmt ? chart.$totalFmt(t) : Number(t).toLocaleString("en-US"), x.getPixelForValue(i), y.getPixelForValue(t) - 2); });
      ctx.restore();
    },
  };
  function card(id, title, src, tall) {
    return '<article class="chart-card"><h3>' + title + '</h3><div class="box"' + (tall ? ' style="height:' + tall + 'px"' : "") + '><canvas id="' + id + '"></canvas></div><div class="source">' + (src || "") + "</div></article>";
  }
  function make(id, cfg) {
    const el = document.getElementById(id);
    if (!el || !global.Chart) return null;
    const c = new Chart(el, cfg);
    charts.push(c);
    return c;
  }

  /* ---------- Overview tiles (8) ---------- */
  function overviewStats(ctx, company, calendar) {
    const { q, y, off, officialOn, display, shares, cash, debt, mkt, ev, money, compact: cmp, fmtVol } = ctx;
    const events = ((calendar && calendar.events) || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = events.filter((e) => e.date >= today);
    const nextCat = upcoming.find((e) => e.highlight && !e.tentative) || upcoming[0];
    const nextRep = upcoming.find((e) => e.type === "report");
    const fmt = (e) => e ? esc(e.title.replace(/^2026 /, "").replace(" of Shareholders", "")) + " · " + esc(e.dateLabel) : "—";
    const netCash = cash != null && debt != null ? cash - debt : null;
    return [
      { k: "Market cap", v: cmp(mkt), s: shares ? (num(shares / 1e9, 3) + "B shares × " + (officialOn ? "official last sale" : "live Hyperliquid mid")) : "" },
      { k: "Enterprise value", v: cmp(ev), s: "Market cap − cash $45.4B + debt $9.5B (30 Sep 2026)" },
      { k: "52-week range", v: money(y.fiftyTwoWeekLow) + " – " + money(y.fiftyTwoWeekHigh) },
      { k: "Day range (regular)", v: money(officialOn && off.low != null ? off.low : y.regularMarketDayLow) + " – " + money(officialOn && off.high != null ? off.high : y.regularMarketDayHigh) },
      { k: "Volume (regular)", v: fmtVol(officialOn && off.volume != null ? off.volume : y.regularMarketVolume) },
      { k: "Net cash", v: cmp(netCash), s: "Cash &amp; investments $45.4B · debt &amp; finance leases $9.5B · $30B credit lines undrawn" },
      { k: "Next catalyst", v: fmt(nextCat), s: nextCat && nextCat.window ? esc(nextCat.window) : "" },
      { k: "Next report", v: nextRep ? esc(nextRep.title.replace(" production, deliveries & deployments", " deliveries")) : "—", s: nextRep ? esc(nextRep.dateLabel) + (nextRep.tentative ? " · date not confirmed by Tesla" : "") : "" },
    ];
  }

  /* ---------- KPI charts ---------- */
  function mountKpis(kpis) {
    const grid = document.getElementById("kpi-grid");
    if (!grid || !global.Chart) return;
    const q = kpis.quarters || [];
    const labels = q.map((x) => x.label);
    const deck = (q[q.length - 1].sources || [])[0];
    const deckLink = deck ? link({ label: "Q3 2026 Update", url: deck.url }) : "Tesla Update decks";
    grid.innerHTML = [
      card("t-rev", "Revenue by segment ($M)", "Automotive (incl. regulatory credits and leasing), Energy generation &amp; storage, Services &amp; other. Totals above bars. Each quarter from its Update deck (Q4 2024–Q3 2025 from prior-year columns). " + deckLink + "."),
      card("t-deliv", "Vehicle deliveries and production", "Quarterly totals from Tesla’s production &amp; deliveries reports, as restated in the Update decks."),
      card("t-storage", "Energy storage deployed (GWh) and energy gross margin", "Deployments from the Update decks. Margin is computed from reported energy revenue and cost of revenue (Q3 2026: (2,881 − 1,927) / 2,881 = 33.1%), which includes tariff refunds and cell warranty reimbursements."),
      card("t-margins", "Margins (%)", "Total GAAP gross margin, automotive gross margin excluding regulatory credits, and GAAP operating margin, as reported in each Update deck."),
      card("t-fcf", "Free cash flow and capex ($M)", "Free cash flow = operating cash flow − capex, as reported. Capex includes purchases of energy systems from Q1 2025 (prior periods restated). 2026 capex guided to ~$20B (Q3 call)."),
      card("t-fsd", "Active FSD (Supervised) subscriptions (M)", "Tesla’s reported active FSD subscriptions (paid and subscription) at period-end, from the Update decks’ operational summary."),
      card("t-sc", "Supercharger network", "Stations (line, right axis) and connectors (bars) at period-end, from the Update decks."),
      card("t-earn", "Adjusted EBITDA and GAAP net income ($M)", "Net income attributable to common stockholders and adjusted EBITDA, as reported in the Update decks."),
    ].join("");

    const rv = (k) => q.map((x) => (x.revenue && x.revenue[k]) ?? null);
    const revChart = make("t-rev", {
      type: "bar",
      data: { labels, datasets: [
        { label: "Automotive", data: rv("automotive"), backgroundColor: C.auto, stack: "r" },
        { label: "Energy", data: rv("energy"), backgroundColor: C.energy, stack: "r" },
        { label: "Services & other", data: rv("services"), backgroundColor: C.services, stack: "r" },
      ] },
      options: baseOpts({ stacked: true, padTop: 18, tooltip: { footer: (it) => it.length ? "Total  " + num(rv("total")[it[0].dataIndex]) : "" } }),
      plugins: [totalsPlugin],
    });
    if (revChart) { revChart.$totals = rv("total"); revChart.$totalFmt = (t) => compact() ? (t / 1000).toFixed(1) + "B" : num(t); revChart.update(); }

    make("t-deliv", {
      type: "bar",
      data: { labels, datasets: [
        { type: "line", label: "Production", data: q.map((x) => x.production && x.production.total), borderColor: C.prod, backgroundColor: C.prod, pointRadius: 3, tension: 0.25, order: 0 },
        { label: "Deliveries", data: q.map((x) => x.deliveries && x.deliveries.total), backgroundColor: C.y2026, order: 1 },
      ] },
      options: baseOpts({ beginAtZero: true, yfmt: (v) => (v / 1000) + "k" }),
    });

    make("t-storage", {
      type: "bar",
      data: { labels, datasets: [
        { type: "line", label: "Energy gross margin (%)", data: q.map((x) => x.margins && x.margins.energyGross), borderColor: C.orange, backgroundColor: C.orange, yAxisID: "y1", pointRadius: 3, tension: 0.25, order: 0 },
        { label: "Storage deployed (GWh)", data: q.map((x) => x.storageGWh), backgroundColor: C.energy, order: 1 },
      ] },
      options: baseOpts({ y1: { fmt: (v) => v + "%", beginAtZero: true } }),
    });

    const m = (k) => q.map((x) => x.margins && x.margins[k]);
    make("t-margins", {
      type: "line",
      data: { labels, datasets: [
        { label: "Total GAAP gross", data: m("totalGaapGross"), borderColor: C.prod, backgroundColor: C.prod, pointRadius: 3, tension: 0.25 },
        { label: "Auto gross ex-credits", data: m("autoGrossExCredits"), borderColor: C.auto, backgroundColor: C.auto, pointRadius: 3, tension: 0.25 },
        { label: "Operating", data: m("operating"), borderColor: C.red, backgroundColor: C.red, pointRadius: 3, tension: 0.25 },
      ] },
      options: baseOpts({ yfmt: (v) => v + "%" }),
    });

    const fcf = q.map((x) => x.freeCashFlow);
    make("t-fcf", {
      type: "bar",
      data: { labels, datasets: [
        { type: "line", label: "Capex", data: q.map((x) => x.capex), borderColor: C.orange, backgroundColor: C.orange, pointRadius: 3, tension: 0.25, order: 0 },
        { label: "Free cash flow", data: fcf, backgroundColor: fcf.map((v) => v != null && v < 0 ? C.red : C.energy), order: 1 },
      ] },
      options: baseOpts({ beginAtZero: false }),
    });

    make("t-fsd", {
      type: "bar",
      data: { labels, datasets: [{ label: "Active FSD subscriptions (M)", data: q.map((x) => x.activeFsdSubsM), backgroundColor: C.teal }] },
      options: baseOpts({ noLegend: true, yfmt: (v) => v + "M" }),
    });

    make("t-sc", {
      type: "bar",
      data: { labels, datasets: [
        { type: "line", label: "Stations", data: q.map((x) => x.superchargerStations), borderColor: C.prod, backgroundColor: C.prod, yAxisID: "y1", pointRadius: 3, tension: 0.25, order: 0 },
        { label: "Connectors", data: q.map((x) => x.superchargerConnectors), backgroundColor: C.pink, order: 1 },
      ] },
      options: baseOpts({ yfmt: (v) => (v / 1000) + "k", y1: { fmt: (v) => (v / 1000).toFixed(1) + "k", beginAtZero: false } }),
    });

    make("t-earn", {
      type: "bar",
      data: { labels, datasets: [
        { label: "Adjusted EBITDA", data: q.map((x) => x.adjustedEbitda), backgroundColor: C.auto },
        { label: "GAAP net income", data: q.map((x) => x.netIncomeGaap), backgroundColor: C.services },
      ] },
      options: baseOpts({}),
    });
  }

  /* ---------- Deliveries, Energy & Autonomy tracker ---------- */
  function mountOps(ops, kpis) {
    if (!ops) return;
    const y = ops.ytd || {};
    const statsEl = document.getElementById("ops-stats");
    const pct = (a, b) => (a != null && b ? ((a / b - 1) * 100) : null);
    const chg = (v) => v == null ? "" : '<span class="' + (v >= 0 ? "up" : "down") + '">' + (v >= 0 ? "+" : "") + v.toFixed(1) + "% vs 9M 2025</span>";
    const q4Implied = y.streetFY2026Deliveries && y.deliveries2026 ? y.streetFY2026Deliveries - y.deliveries2026 : null;
    if (statsEl) {
      statsEl.innerHTML = [
        { k: "Deliveries 2026 YTD (9M)", v: num(y.deliveries2026), s: chg(pct(y.deliveries2026, y.deliveries2025)) + " · TTM " + num(y.ttmDeliveries) },
        { k: "Storage deployed 2026 YTD", v: num(y.storage2026, 1) + " GWh", s: chg(pct(y.storage2026, y.storage2025)) + " · TTM " + num(y.ttmStorage, 1) + " GWh" },
        { k: "Active FSD subscriptions", v: num(y.activeFsdSubsM, 2) + "M", s: "30 Sep 2026 · &gt;75% of new North American deliveries in Q3 took FSD (Q3 Update)" },
        { k: "Q4 needed for Street FY", v: q4Implied ? "~" + num(Math.round(q4Implied / 1000)) + "k" : "—", s: "Visible Alpha FY2026 ≈ 1.77M deliveries (Reuters) − 9M actual; Q4 2025 was 418,227" },
      ].map((s) => '<div class="stat"><div class="k">' + s.k + '</div><div class="v">' + s.v + '</div><div class="tiny">' + s.s + "</div></div>").join("");
    }
    const qd = ops.quarterly || {};
    const yearDs = (obj, label) => [
      { label: "2025", data: obj["2025"], backgroundColor: C.y2025 },
      { label: "2026", data: obj["2026"], backgroundColor: label === "storage" ? C.energy : C.y2026 },
    ];
    make("ops-deliv", { type: "bar", data: { labels: qd.labels, datasets: yearDs(qd.deliveries || {}) }, options: baseOpts({ yfmt: (v) => (v / 1000) + "k" }) });
    make("ops-storage", { type: "bar", data: { labels: qd.labels, datasets: yearDs(qd.storage || {}, "storage") }, options: baseOpts({ yfmt: (v) => v + " GWh" }) });
    const ds = document.getElementById("ops-deliv-src");
    if (ds) ds.innerHTML = "Quarterly deliveries from Tesla’s P&amp;D reports. Q4 2026 is not reported yet (early Jan 2027). " + link(y.streetSource ? { label: "Street FY estimate: " + y.streetSource.label, url: y.streetSource.url } : null) + ".";
    const ss = document.getElementById("ops-storage-src");
    if (ss) ss.innerHTML = "Energy storage deployments (Megapack + Powerwall) per quarter from the Update decks. Q3 2026 13.7 GWh vs ~15.9 GWh expected (Visible Alpha).";

    const cap = document.getElementById("ops-capacity");
    if (cap) {
      cap.innerHTML = "<table><thead><tr><th>Site</th><th>Product</th><th>Installed capacity</th><th>Status</th></tr></thead><tbody>" +
        (ops.capacity || []).map((r) => "<tr><td>" + esc(r.site) + "</td><td>" + esc(r.product) + "</td><td>" + esc(r.capacity) + "</td><td>" + esc(r.status) + "</td></tr>").join("") +
        "</tbody></table>";
    }
    const ms = document.getElementById("ops-milestones");
    if (ms) {
      ms.innerHTML = '<div class="ms-grid">' + (ops.milestones || []).map((m) =>
        '<div class="ms"><div class="k">' + esc(m.area) + " · " + esc(m.status) + "</div><h4>" + esc(m.title) + "</h4><p>" + esc(m.detail) + '</p><p class="source">' + (m.sources || []).map(link).join(" · ") + "</p></div>"
      ).join("") + "</div>";
    }
    const src = document.getElementById("ops-sources");
    if (src) {
      const comp = kpis && kpis.compute;
      src.innerHTML = "Capacity table and milestones as of 30 Sep 2026 (Q3 2026 Update), updated with company posts and press through 13 Nov 2026." + (comp ? " SI compute: " + esc(comp.detail) : "");
    }
  }

  /* ---------- Valuation & street ---------- */
  function renderValuation(kpis, company, state) {
    const el = document.getElementById("valuation-body");
    if (!el) return;
    const p = P();
    const display = state && state.display;
    const mkt = state && state.mkt;
    const ev = state && state.ev;
    const st = kpis.street || {};
    const pt = st.priceTarget || {};
    const fy26s = st.revenueFY2026 && st.revenueFY2026.avg * 1e6;
    const fy27s = st.revenueFY2027 && st.revenueFY2027.avg * 1e6;
    const r = (a, b) => a && b ? (a / b).toFixed(1) + "×" : "—";
    const pe = (e) => display && e ? Math.round(display / e) + "×" : "—";
    const up = display && pt.average ? ((pt.average / display - 1) * 100) : null;
    const mix = st.mix || {};
    el.innerHTML =
      "<p>Displayed price <strong>" + p.money(display) + "</strong>. Market cap (" + num(company.sharesOutstanding) + " shares at that price) <strong>" + p.compact(mkt) + "</strong>. Enterprise value <strong>" + p.compact(ev) + "</strong> after net cash of about $35.9B (cash &amp; investments $45.4B, debt $9.5B, 30 Sep 2026).</p>" +
      "<p style='margin-top:10px'>EV / Street FY2026 sales (" + p.compact(fy26s) + "): <strong>" + r(ev, fy26s) + "</strong>. EV / FY2027 sales (" + p.compact(fy27s) + "): <strong>" + r(ev, fy27s) + "</strong>. Price / Street non-GAAP EPS: FY2026 ($" + st.epsFY2026 + ") <strong>" + pe(st.epsFY2026) + "</strong>, FY2027 ($" + st.epsFY2027 + ") <strong>" + pe(st.epsFY2027) + "</strong>. Street FY2026 free cash flow about <strong>" + p.compact(st.fcfFY2026 * 1e6) + "</strong>.</p>" +
      "<p style='margin-top:10px'>Street (S&amp;P Global, " + esc(st.analysts) + " analysts, 12 Nov 2026): consensus <strong>" + esc(st.rating || "—") + "</strong>, average target <strong>" + p.money(pt.average) + "</strong>" + (up != null ? " (" + (up >= 0 ? "+" : "") + up.toFixed(1) + "% vs displayed price)" : "") + ", median " + p.money(pt.median) + ", range " + p.money(pt.low) + "–" + p.money(pt.high) + ". Mix: " + mix.strongBuy + " Strong Buy, " + mix.buy + " Buy, " + mix.hold + " Hold, " + mix.sell + " Sell, " + mix.strongSell + " Strong Sell. Recent: " + esc(st.recent) + "</p>" +
      '<p class="source">' + link(st.source) + "</p>";
  }

  /* ---------- Share structure & ownership ---------- */
  function renderShares(company) {
    const el = document.getElementById("lockup-body");
    if (!el) return;
    const w = company.weightedShares || {};
    const cf = company.creditFacilities || {};
    const sx = company.spacexStake || {};
    el.innerHTML =
      "<p>Shares outstanding <strong>" + num(company.sharesOutstanding) + "</strong> as of 15 Oct 2026 (one class of common stock). That count includes about <strong>423.7M</strong> unearned restricted shares under Musk’s 2025 CEO Performance Award (12 tranches of 35.3M, market-cap milestones $2.0T–$8.5T plus operational milestones; they vote but are forfeited if not earned) and about <strong>286.4M</strong> restricted shares from his June 2026 exercise of the 2018 award, vesting 19 Jan 2028. Q3 weighted average: " + num(w.basicQ3_2026M) + "M basic, " + num(w.dilutedQ3_2026M) + "M diluted.</p>" +
      "<p style='margin-top:10px'><strong>Holders:</strong> Elon Musk about 20% (as read from the 2026 proxy by Electrek / Quartz; not re-verified here). BlackRock 196.3M shares, 4.96% (13G/A, 30 Sep 2026). No buyback program.</p>" +
      "<p style='margin-top:10px'><strong>Capital:</strong> cash &amp; investments $45.4B vs debt &amp; finance leases $9.5B (mostly non-recourse). " + esc(cf.detail || "") + " Holds " + num(sx.shares) + " SpaceX shares ($2.0B cost, from the xAI stake).</p>" +
      '<p class="source">' + link(company.sharesSource) + " · " + link({ label: "13G/A (BlackRock)", url: "https://www.sec.gov/Archives/edgar/data/1318605/000201238326003852/primary_doc.xml" }) + " · " + link(cf.source) + "</p>";
  }

  global.TSLAView = { overviewStats, mountKpis, mountOps, renderValuation, renderShares, charts };
})(window);
