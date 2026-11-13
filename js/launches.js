/* Launch counter — figures from data/spacex/launches.json. */
(function (global) {
  const charts = {};
  const compact = () => window.matchMedia("(max-width: 900px), (max-height: 500px)").matches;
  const C = {
    starlink: "rgba(74,144,255,0.9)",
    f9other: "rgba(38,208,206,0.9)",
    fh: "rgba(255,153,51,0.92)",
    starship: "rgba(167,112,255,0.95)",
    y2025: "rgba(240,240,250,0.35)",
    y2026: "rgba(61,214,140,0.9)",
    partial: "rgba(61,214,140,0.35)",
    tick: "rgba(240,240,250,0.6)",
    grid: "rgba(240,240,250,0.08)",
  };

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function link(src) {
    if (!src) return "";
    return src.url ? '<a href="' + esc(src.url) + '" target="_blank" rel="noopener">' + esc(src.label) + "</a>" : esc(src.label);
  }
  function fmtDay(iso) {
    if (!iso) return "";
    return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", day: "numeric", month: "short", year: "numeric" }).format(new Date(iso + "T12:00:00Z"));
  }

  function baseOpts(stacked) {
    const small = compact();
    return {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { color: "rgba(240,240,250,0.85)", boxWidth: 12, font: { size: small ? 10 : 11 }, padding: 8 } },
        tooltip: { titleFont: { size: 13 }, bodyFont: { size: 13 }, padding: 10 },
      },
      scales: {
        x: { stacked, ticks: { color: C.tick, font: { size: small ? 10 : 11 }, autoSkip: false, maxRotation: 0 }, grid: { display: false }, border: { color: "rgba(240,240,250,0.15)" } },
        y: { stacked, beginAtZero: true, ticks: { color: C.tick, font: { size: 11 }, precision: 0 }, grid: { color: C.grid }, border: { display: false },
             title: { display: true, text: "Launches", color: "rgba(240,240,250,0.45)", font: { size: 10 } } },
      },
    };
  }

  function renderStats(d) {
    const y = d.ytd;
    const el = document.getElementById("launch-stats");
    if (!el) return;
    const fy25 = d.quarterly && d.quarterly.fy2025;
    const tiles = [
      { k: "2026 launches", v: y.total, s: y.orbital + " orbital · " + y.failures + " failures" },
      { k: "Falcon 9", v: y.falcon9, s: y.falcon9Starlink + " were Starlink missions" },
      { k: "Falcon Heavy", v: y.falconHeavy, s: "ViaSat-3 F3 · Roman · NROL-97" },
      { k: "Starship", v: y.starship, s: "Flights 12–14 · " + y.starshipOrbital + " reached orbit" },
    ];
    el.innerHTML = tiles.map((t) => '<div class="stat"><div class="k">' + esc(t.k) + '</div><div class="v">' + esc(t.v) + '</div><div class="tiny">' + esc(t.s) + "</div></div>").join("");
    const lede = document.getElementById("launch-lede");
    if (lede) lede.textContent = "Every SpaceX launch in 2026, counted in UTC, including Starship flight tests — the same basis SpaceX uses for its quarterly launch counts. Counted through " + d.countedThroughLabel + "." + (fy25 ? " Full-year 2025: " + fy25 + " launches." : "");
  }

  function renderMonthly(d) {
    const el = document.getElementById("launch-monthly");
    if (!el || !global.Chart) return;
    const m = d.monthly;
    const cfg = {
      type: "bar",
      data: {
        labels: m.map((x) => x.label),
        datasets: [
          { label: "Falcon 9 · Starlink", data: m.map((x) => x.f9Starlink), backgroundColor: C.starlink, stack: "s" },
          { label: "Falcon 9 · other", data: m.map((x) => x.f9 - x.f9Starlink), backgroundColor: C.f9other, stack: "s" },
          { label: "Falcon Heavy", data: m.map((x) => x.fh), backgroundColor: C.fh, stack: "s" },
          { label: "Starship", data: m.map((x) => x.starship), backgroundColor: C.starship, stack: "s" },
        ],
      },
      options: baseOpts(true),
    };
    cfg.options.plugins.tooltip.callbacks = {
      footer(items) {
        const i = items[0].dataIndex;
        const x = m[i];
        return "Total " + (x.f9 + x.fh + x.starship) + (x.partial ? " (month to date)" : "");
      },
    };
    if (charts.monthly) charts.monthly.destroy();
    charts.monthly = new Chart(el, cfg);
    const src = document.getElementById("launch-monthly-src");
    if (src) src.innerHTML = "Months in UTC. *November is month to date. Falcon counts by month and Starlink missions are tallied from " + link(d.sources[0]) + "; totals cross-check with " + link(d.sources[1]) + ". Starship Flights 12 (May) and 13 (Jul) were suborbital tests.";
  }

  function renderQuarterly(d) {
    const el = document.getElementById("launch-quarterly");
    if (!el || !global.Chart) return;
    const r = d.quarterly.rows;
    const cfg = {
      type: "bar",
      data: {
        labels: r.map((x) => x.q),
        datasets: [
          { label: "2025", data: r.map((x) => x.y2025), backgroundColor: C.y2025 },
          { label: "2026", data: r.map((x) => x.y2026), backgroundColor: r.map((x) => (x.y2026Partial ? C.partial : C.y2026)), borderColor: C.y2026, borderWidth: r.map((x) => (x.y2026Partial ? 1 : 0)) },
        ],
      },
      options: baseOpts(false),
    };
    cfg.options.plugins.tooltip.callbacks = {
      label(ctx) {
        const x = r[ctx.dataIndex];
        const partial = ctx.datasetIndex === 1 && x.y2026Partial;
        return " " + ctx.dataset.label + ": " + ctx.parsed.y + (partial ? " (quarter to date, through 12 Nov)" : "");
      },
    };
    if (charts.quarterly) charts.quarterly.destroy();
    charts.quarterly = new Chart(el, cfg);
    const src = document.getElementById("launch-quarterly-src");
    if (src) src.innerHTML = "Company-reported totals, Falcon plus Starship tests: 2025 from the " + link(d.sources[4]) + " and prospectus (FY 170); Q2 2026 from the " + link(d.sources[3]) + ". The faded Q4 2026 bar is quarter to date (Oct 11 + Nov 2) from public launch logs, not a company figure.";
  }

  function renderMilestones(d) {
    const el = document.getElementById("launch-milestones");
    if (!el) return;
    const ship = d.starship.map((s) => '<li><span class="ms-date">Flight ' + s.flight + " · " + esc(fmtDay(s.date)) + "</span>" + esc(s.result) + "</li>").join("");
    const ms = d.milestones.map((m) =>
      '<div class="ms ms-' + esc(m.status) + '"><div class="k">' + (m.status === "next" ? "Next" : m.status === "tentative" ? "Tentative" : "Target") + "</div>" +
      "<h4>" + esc(m.title) + "</h4><p class=\"ms-when\">" + esc(m.when) + "</p><p>" + esc(m.detail) + '</p><p class="source">' + link(m.source) + "</p></div>").join("");
    el.innerHTML = '<div class="ms-grid">' + ms + '</div><h4 class="ms-sub">Starship flights in 2026</h4><ul class="ms-list">' + ship + "</ul>";
    const s = document.getElementById("launch-sources");
    if (s) s.innerHTML = "Counts as of " + esc(fmtDay(d.asOf)) + ". Sources: " + d.sources.map(link).join(" · ") + ".";
  }

  function mount(d) {
    if (!d) return;
    renderStats(d);
    renderMonthly(d);
    renderQuarterly(d);
    renderMilestones(d);
  }

  global.SPCXLaunches = { mount };
})(window);
