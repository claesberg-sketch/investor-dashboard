/* Nasdaq-100 weight vs unlocked float — data/spacex/nasdaq-index.json + unlocks.json. */
(function (global) {
  let chart = null;
  const C = {
    floatPast: "rgba(74,144,255,0.55)",
    floatNext: "rgba(74,144,255,0.9)",
    weight: "rgba(61,214,140,0.95)",
    proforma: "rgba(232,195,106,0.95)",
    low: "rgba(255,153,51,0.9)",
    threshold: "rgba(255,92,108,0.85)",
    tick: "rgba(240,240,250,0.55)",
    grid: "rgba(240,240,250,0.08)",
  };
  const compact = () => window.matchMedia("(max-width: 900px), (max-height: 500px)").matches;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function link(src) {
    if (!src) return "";
    return src.url ? '<a href="' + esc(src.url) + '" target="_blank" rel="noopener">' + esc(src.label) + "</a>" : esc(src.label);
  }
  function fmtDay(iso) {
    return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", day: "numeric", month: "short", year: "numeric" }).format(new Date(iso + "T12:00:00Z"));
  }

  /** Shares eligible to trade on a date: IPO primary + dated releases on or before it (excl. Musk, a controlling holder, and undated releases). */
  function eligibleOn(unlocks, iso) {
    let n = (unlocks.ipoPrimaryShares && unlocks.ipoPrimaryShares.shares) || 0;
    (unlocks.events || []).forEach((e) => {
      if (e.status === "did_not_trigger" || !e.date || e.group === "Musk 366-day") return;
      if (e.date <= iso) n += e.shares;
    });
    return n;
  }

  function renderFacts(d) {
    const el = document.getElementById("ndx-facts");
    if (!el) return;
    const n = d.membership.nasdaq100, c = d.membership.composite;
    const etf = n.latestEtf.map((x) => x.weight.toFixed(2) + "% (" + link(x) + ")").join(", ");
    const pf = d.proforma.inputs;
    el.innerHTML =
      '<div class="ndx-tiles">' +
      '<div class="stat"><div class="k">Nasdaq-100 · official</div><div class="v">' + n.latestOfficial.weight.toFixed(2) + '%</div><div class="tiny">' + esc(fmtDay(n.latestOfficial.date)) + " · in the index since " + esc(fmtDay(n.since)) + "</div></div>" +
      '<div class="stat"><div class="k">Pro-forma from 21 Dec</div><div class="v">~' + pf.floatCapWeight.toFixed(1) + "–" + pf.fullWeight.toFixed(1) + '%</div><div class="tiny">Estimate at 10 Nov prices; then flat as more shares unlock</div></div>' +
      '<div class="stat"><div class="k">Nasdaq Composite · est.</div><div class="v">~' + c.weightEst.toFixed(1) + '%</div><div class="tiny">Full market cap, not float — unlocks do not change it</div></div>' +
      "</div>" +
      '<p class="ndx-rule">The Nasdaq-100 counts a stock’s full value only once its free float is above 33.3%; below that it counts 3× the float. SpaceX’s eligible float crossed about a third in late October, so the 21 Dec review should lift it to (or near) full weight — after that, more unlocks, including Musk’s in June 2027, no longer raise the weight. Only the price does.</p>' +
      '<p class="tiny">ETF holdings on 12 Nov: ' + etf + ". ETF weights drift with prices between reviews.</p>";
  }

  function paint(d, unlocks) {
    const el = document.getElementById("ndx-chart");
    if (!el || !global.Chart) return;
    const pts = d.points;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Stockholm" }).format(new Date());
    const total = unlocks.sharesOutstanding;
    const floatPct = pts.map((p) => +((eligibleOn(unlocks, p.floatRef) / total) * 100).toFixed(1));
    const reported = pts.map((p) => (p.kind === "proforma" ? null : p.weight));
    const lastRep = reported.reduce((a, v, i) => (v != null ? i : a), -1);
    const pf = pts.map((p, i) => (p.kind === "proforma" ? p.weight : i === lastRep ? p.weight : null));
    const pfLow = pts.map((p, i) => (p.kind === "proforma" ? p.weightLow : i === lastRep ? p.weight : null));
    const small = compact();
    const labels = pts.map((p) => (small ? p.label.replace(/ · .*/, "") : p.label));
    const cfg = {
      type: "bar",
      data: {
        labels,
        datasets: [
          { type: "bar", label: "Eligible float, % of shares", data: floatPct, yAxisID: "y", order: 3,
            backgroundColor: pts.map((p) => (p.floatRef <= today ? C.floatPast : C.floatNext)), barPercentage: 0.7, categoryPercentage: 0.8 },
          { type: "line", label: "33.3% float threshold", data: pts.map(() => 33.3), yAxisID: "y", order: 2,
            borderColor: C.threshold, borderDash: [4, 4], borderWidth: 1.2, pointRadius: 0, fill: false },
          { type: "line", label: "Nasdaq-100 weight (reported)", data: reported, yAxisID: "y2", order: 0,
            borderColor: C.weight, backgroundColor: C.weight, borderWidth: 2.2, pointRadius: 4, tension: 0, spanGaps: false },
          { type: "line", label: "Pro-forma weight (est.)", data: pf, yAxisID: "y2", order: 1,
            borderColor: C.proforma, backgroundColor: C.proforma, borderDash: [6, 4], borderWidth: 2, pointRadius: 3, tension: 0 },
          { type: "line", label: "Low case: FloatCap float 31.9%", data: pfLow, yAxisID: "y2", order: 1,
            borderColor: C.low, backgroundColor: C.low, borderDash: [2, 3], borderWidth: 1.5, pointRadius: 2, tension: 0 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { labels: { color: "rgba(240,240,250,0.8)", boxWidth: 10, font: { size: small ? 10 : 11 }, padding: 8 } },
          tooltip: {
            titleFont: { size: 13 }, bodyFont: { size: 12 }, padding: 10,
            filter: (item) => item.datasetIndex !== 1 && item.parsed.y != null,
            callbacks: {
              title(items) { return pts[items[0].dataIndex].label; },
              label(ctx) {
                const p = pts[ctx.dataIndex];
                if (ctx.datasetIndex === 0) return " Eligible float " + ctx.parsed.y.toFixed(1) + "% (as of " + fmtDay(p.floatRef) + ")";
                if (ctx.datasetIndex === 2) return " Weight " + ctx.parsed.y.toFixed(2) + "% (" + (p.kind === "official" ? "Nasdaq file" : "reported") + ")";
                if (ctx.datasetIndex === 3 && p.kind === "proforma") return " Pro-forma " + ctx.parsed.y.toFixed(2) + "% (float above 33.3%)";
                if (ctx.datasetIndex === 4 && p.kind === "proforma" && p.weightLow !== p.weight) return " Low case " + ctx.parsed.y.toFixed(2) + "% (float 31.9%)";
                return null;
              },
            },
          },
        },
        scales: {
          x: { ticks: { color: C.tick, font: { size: small ? 9 : 10 }, autoSkip: false, maxRotation: small ? 50 : 0, minRotation: small ? 40 : 0 }, grid: { display: false }, border: { display: false } },
          y: { beginAtZero: true, max: 60, position: "left",
               title: { display: true, text: "Eligible float (% of 13.58B)", color: "rgba(240,240,250,0.45)", font: { size: 10 } },
               ticks: { color: C.tick, font: { size: 10 }, callback: (v) => v + "%" }, grid: { color: C.grid }, border: { display: false } },
          y2: { beginAtZero: true, max: 4, position: "right",
                title: { display: true, text: "Nasdaq-100 weight", color: "rgba(240,240,250,0.45)", font: { size: 10 } },
                ticks: { color: C.tick, font: { size: 10 }, callback: (v) => v + "%" }, grid: { display: false }, border: { display: false } },
        },
      },
    };
    if (chart) chart.destroy();
    chart = new Chart(el, cfg);

    const src = document.getElementById("ndx-source");
    if (src) {
      src.innerHTML =
        "<strong>Illustrative estimate, not a Nasdaq figure.</strong> Bars are shares eligible to trade at each review’s float reference date under the lock-up schedule above, as a share of 13.58B outstanding (Musk’s 4.77B and undated extended releases excluded). Green is reported weight; the dashed lines are pro-forma at constant 10 Nov prices." +
        '<details class="ndx-how"><summary>How this is estimated</summary><p>' + esc(d.rule.summary) + " " + link(d.rule.source) + ".</p><p>" + esc(d.proforma.method) + "</p><ul>" +
        d.proforma.caveats.map((c) => "<li>" + esc(c) + "</li>").join("") + "</ul><p>Sources: " + d.sources.map(link).join(" · ") + " · " + link(d.proforma.inputsSource) + ".</p></details>";
    }
  }

  function mount(d, unlocks) {
    if (!d || !unlocks) return;
    renderFacts(d);
    paint(d, unlocks);
  }

  global.SPCXIndexWeight = { mount, eligibleOn };
})(window);
