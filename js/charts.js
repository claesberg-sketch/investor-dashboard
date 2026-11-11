(function (global) {
  const compact = () => window.matchMedia("(max-width: 900px), (max-height: 500px)").matches;
  const axis = {
    ticks: { color: "rgba(240,240,250,0.6)", font: { size: 11 }, autoSkip: true, maxRotation: 40, maxTicksLimit: 6 },
    grid: { color: "rgba(240,240,250,0.08)" },
    border: { color: "rgba(240,240,250,0.15)" },
  };
  // Show every quarter label so a filled quarter (e.g. Q4 2025) is never skipped off the axis.
  const xTicksAll = { ...axis.ticks, autoSkip: false, maxTicksLimit: 8, maxRotation: 45, minRotation: 0 };
  const xAxis = { ...axis, grid: { display: false }, ticks: xTicksAll };
  const legend = { labels: { color: "rgba(240,240,250,0.85)", boxWidth: 12, font: { size: 11 }, padding: 8 } };
  const tip = { titleFont: { size: 13 }, bodyFont: { size: 13 }, padding: 10 };
  const interact = { mode: "index", intersect: false };
  const pal = {
    space: "rgba(240,240,250,0.35)",
    conn: "rgba(240,240,250,0.65)",
    si: "rgba(240,240,250,0.95)",
    line: "rgba(240,240,250,0.95)",
    line2: "rgba(61,214,140,0.9)",
    muted: "rgba(240,240,250,0.4)",
    undisclosed: "rgba(240,200,80,0.85)",
    blue: "rgba(74,144,255,0.9)",
    teal: "rgba(38,208,206,0.9)",
    violet: "rgba(167,112,255,0.92)",
    green: "rgba(61,214,140,0.9)",
    orange: "rgba(255,153,51,0.92)",
    red: "rgba(255,92,108,0.92)",
    pink: "rgba(255,110,199,0.9)",
  };

  function hatchPattern(color, bg) {
    const c = document.createElement("canvas");
    c.width = 8;
    c.height = 8;
    const ctx = c.getContext("2d");
    ctx.fillStyle = bg || "rgba(240,200,80,0.18)";
    ctx.fillRect(0, 0, 8, 8);
    ctx.strokeStyle = color || pal.undisclosed;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-2, 6);
    ctx.lineTo(6, -2);
    ctx.moveTo(0, 10);
    ctx.lineTo(10, 0);
    ctx.moveTo(2, 12);
    ctx.lineTo(12, 2);
    ctx.stroke();
    return ctx.createPattern(c, "repeat");
  }

  function hasSegmentSplit(x) {
    const r = x.revenue || {};
    return r.space != null || r.connectivity != null || r.si != null;
  }

  function totalOnlyValues(q) {
    return q.map((x) => {
      const r = x.revenue || {};
      if (!hasSegmentSplit(x) && r.total != null) return r.total;
      return null;
    });
  }


  const barTotalLabels = {
    id: "barTotalLabels",
    afterDatasetsDraw: function (chart) {
      const totals = chart.$barTotals;
      if (!totals || !totals.length) return;
      const { ctx, scales: { x, y } } = chart;
      if (!x || !y) return;
      const compact = window.matchMedia("(max-width: 900px), (max-height: 500px)").matches;
      ctx.save();
      ctx.fillStyle = "rgba(240,240,250,0.88)";
      ctx.font = (compact ? "10px" : "11px") + ' Barlow, "Helvetica Neue", sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      totals.forEach(function (tot, i) {
        if (tot == null) return;
        const px = x.getPixelForValue(i);
        const py = y.getPixelForValue(tot);
        ctx.fillText(Number(tot).toLocaleString("en-US"), px, py - 2);
      });
      ctx.restore();
    },
  };

  function card(id, title, sourceHtml) {
    return '<article class="chart-card"><h3>' + title + '</h3><div class="box"><canvas id="' + id + '"></canvas></div><div class="source">' + (sourceHtml || "") + "</div></article>";
  }

  function mount(kpis) {
    const grid = document.getElementById("kpi-grid");
    if (!grid || !global.Chart) return;
    const q = kpis.quarters || [];
    const labels = q.map((x) => x.label);
    grid.innerHTML = [
      card("c-rev", "Revenue by segment ($M)", "SpaceX Q2 and Q3 2026 earnings releases and prospectus. Q4 2025 segment figures are derived as FY2025 minus nine-month 2025. If a quarter has only a consolidated total, a hatched “Total (segments not disclosed)” bar is shown."),
      card("c-subs", "Starlink consumer subscribers (M)", "Company disclosures, period-end. Q4 2025 shows 8.9M subscribers at year-end."),
      card("c-connmix", "Connectivity revenue: consumer vs enterprise &amp; government ($M)", "Q2 / Q3 2026 earnings releases; Q4 2025 derived as FY2025 minus nine-month 2025 from the prospectus and 10-Q."),
      card("c-gw", "Nameplate AI compute (GW)", "Period-end nameplate, including 0.8 GW at 31 Dec 2025 from the prospectus. Q3 2026 release and Q2 call; YE 2026/27 guides shown as markers in the note."),
      card("c-earn", "Adjusted EBITDA and net income ($M)", "Q2 and Q3 2026 releases; Q4 2025 derived as FY2025 minus nine-month 2025. Gaps remain where a quarter was not disclosed."),
      card("c-capex", "Capital expenditure ($M)", "Total and SI capex from Q2 / Q3 2026 releases; Q4 2025 derived as FY2025 minus nine-month 2025."),
      card("c-sats", "Starlink satellites in orbit by generation", "Jonathan McDowell, in orbit at each quarter-end and 9 Nov 2026. V2 includes Direct-to-Cell; V3 is the 26 Starship Flight 14 satellites (0 before then). Company operational figures are not plotted."),
      card("c-backlog", "Backlog ($B)", "YE2025 $28.4B (prospectus), Q2 2026 $47.5B, and Q3 2026 $63B (of which $42B expected in 12 months)."),
    ].join("");

    const space = q.map((x) => (x.revenue && x.revenue.space) ?? null);
    const conn = q.map((x) => (x.revenue && x.revenue.connectivity) ?? null);
    const si = q.map((x) => (x.revenue && x.revenue.si) ?? null);
    const totalOnly = totalOnlyValues(q);
    const revDatasets = [
      { label: "Space", data: space, backgroundColor: pal.blue, stack: "r" },
      { label: "Connectivity", data: conn, backgroundColor: pal.teal, stack: "r" },
      { label: "SI / AI", data: si, backgroundColor: pal.violet, stack: "r" },
    ];
    if (totalOnly.some((v) => v != null)) {
      revDatasets.push({
        label: "Total (segments not disclosed)",
        data: totalOnly,
        backgroundColor: hatchPattern(),
        borderColor: pal.undisclosed,
        borderWidth: 1,
        stack: "r",
      });
    }
    new Chart(document.getElementById("c-rev"), {
      type: "bar",
      data: { labels, datasets: revDatasets },
      options: { responsive: true, maintainAspectRatio: false, interaction: interact, plugins: { legend, tooltip: tip },
        scales: { x: { stacked: true, ...xAxis }, y: { stacked: true, ...axis } } },
    });

    new Chart(document.getElementById("c-subs"), {
      type: "line",
      data: { labels, datasets: [
        { label: "Consumer subs (M)", data: q.map((x) => x.starlinkConsumerSubsM ?? null), borderColor: pal.teal, backgroundColor: "transparent", spanGaps: false, tension: 0.15, pointRadius: 4, pointBackgroundColor: pal.teal, borderWidth: 3 },
      ] },
      options: { responsive: true, maintainAspectRatio: false, interaction: interact, plugins: { legend: { display: false }, tooltip: tip },
        scales: { x: { ...axis, grid: { display: false } }, y: { ...axis, beginAtZero: true, title: { display: true, text: "Subs (M)", color: "rgba(240,240,250,0.5)" } } } },
    });

    new Chart(document.getElementById("c-connmix"), {
      type: "bar",
      data: { labels, datasets: [
        { label: "Consumer", data: q.map((x) => x.consumerRevenue ?? null), backgroundColor: pal.teal, stack: "c" },
        { label: "Enterprise & government", data: q.map((x) => x.enterpriseGovRevenue ?? null), backgroundColor: pal.orange, stack: "c" },
      ] },
      options: { responsive: true, maintainAspectRatio: false, interaction: interact, plugins: { legend, tooltip: tip },
        scales: { x: { stacked: true, ...xAxis }, y: { stacked: true, ...axis } } },
    });

    new Chart(document.getElementById("c-gw"), {
      type: "bar",
      data: { labels, datasets: [{ label: "Nameplate GW", data: q.map((x) => x.nameplateComputeGW ?? null), backgroundColor: pal.green }] },
      options: { responsive: true, maintainAspectRatio: false, interaction: interact, plugins: { legend: { display: false }, tooltip: tip },
        scales: { x: { ...xAxis }, y: { ...axis, beginAtZero: true } } },
    });
    const gwNote = document.querySelector("#c-gw").closest(".chart-card").querySelector(".source");
    if (gwNote && kpis.guidance) {
      const g = kpis.guidance;
      gwNote.innerHTML += " Official targets: YE2026 " + g.ye2026_nameplate_gw.low + "–" + g.ye2026_nameplate_gw.high + " GW; YE2027 about " + g.ye2027_nameplate_gw.value + " GW (Musk, Q3 call).";
    }

    new Chart(document.getElementById("c-earn"), {
      type: "bar",
      data: { labels, datasets: [
        { label: "Adj. EBITDA", data: q.map((x) => x.adjustedEbitda ?? null), backgroundColor: pal.green },
        { label: "Net income", data: q.map((x) => x.netIncome ?? null), backgroundColor: pal.red },
      ] },
      options: { responsive: true, maintainAspectRatio: false, interaction: interact, plugins: { legend, tooltip: tip },
        scales: { x: { ...xAxis }, y: { ...axis } } },
    });

    new Chart(document.getElementById("c-capex"), {
      type: "bar",
      data: { labels, datasets: [
        { label: "Total capex", data: q.map((x) => x.capex ?? null), backgroundColor: pal.blue },
        { label: "SI capex", data: q.map((x) => (x.segmentCapex && x.segmentCapex.si) ?? null), backgroundColor: pal.violet },
      ] },
      options: { responsive: true, maintainAspectRatio: false, interaction: interact, plugins: { legend, tooltip: tip },
        scales: { x: { ...xAxis }, y: { ...axis } } },
    });

    const satRows = kpis.satellitesByQuarter || [];
    const satLabels = satRows.map((x) => x.label);
    const satV1 = satRows.map((x) => x.v1 ?? null);
    const satV2 = satRows.map((x) => x.v2 ?? null);
    const satV3 = satRows.map((x) => x.v3 ?? null);
    const satTotals = satRows.map((x) => (x.total != null ? x.total : ((x.v1 || 0) + (x.v2 || 0) + (x.v3 || 0))));
    const satMax = satTotals.reduce((m, n) => Math.max(m, n || 0), 0);
    const satChart = new Chart(document.getElementById("c-sats"), {
      type: "bar",
      data: { labels: satLabels, datasets: [
        { label: "V1 (v1.0 / v1.5)", data: satV1, backgroundColor: pal.blue, stack: "s" },
        { label: "V2 Mini (incl. DTC)", data: satV2, backgroundColor: pal.teal, stack: "s" },
        { label: "V3", data: satV3, backgroundColor: pal.orange, stack: "s" },
      ] },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: interact,
        layout: { padding: { top: 16 } },
        plugins: {
          legend,
          tooltip: {
            ...tip,
            callbacks: {
              footer: function (items) {
                if (!items.length) return "";
                const i = items[0].dataIndex;
                const row = satRows[i] || {};
                const tot = satTotals[i];
                let line = "Total in orbit  " + (tot != null ? Number(tot).toLocaleString("en-US") : "—");
                if (row.v2Dtc) line += "  ·  of which V2 DTC  " + Number(row.v2Dtc).toLocaleString("en-US");
                return line;
              },
            },
          },
        },
        scales: {
          x: { stacked: true, ...xAxis },
          y: { stacked: true, ...axis, beginAtZero: true, suggestedMax: satMax ? Math.ceil(satMax * 1.12 / 500) * 500 : undefined },
        },
      },
      plugins: [barTotalLabels],
    });
    satChart.$barTotals = satTotals;
    const satSrc = document.querySelector("#c-sats").closest(".chart-card").querySelector(".source");
    if (satSrc) {
      const meta = kpis.satellitesMeta || {};
      const src = meta.source || (kpis.satellitesTracker && kpis.satellitesTracker.source) || {};
      const href = (src.urls && src.urls[2]) || (src.url) || "https://planet4589.org/space/con/star/stats.html";
      satSrc.innerHTML = "In orbit at quarter-end (and 9 Nov 2026), from Jonathan McDowell's GCAT: launched and not yet reentered. V1 = v1.0/v1.5; V2 Mini includes Direct-to-Cell (the tooltip shows the DTC subset) and V2 Mini/Opt; V3 = 26 satellites deployed on Starship Flight 14 (28 Sep 2026), zero before that. Company figures are not plotted: prospectus ~9,600 as of 31 Mar 2026 vs 10,156 here; Q2 call ~10,200 operational as of 30 Jun 2026 vs 10,723 here (definitions differ). Latest catalog date is 9 Nov 2026. <a href='" + href + "' target='_blank' rel='noopener'>" + (src.label || "Jonathan McDowell") + "</a>.";
    }

    new Chart(document.getElementById("c-backlog"), {
      type: "bar",
      data: { labels, datasets: [{ label: "Backlog ($M)", data: q.map((x) => x.backlog ?? null), backgroundColor: pal.pink }] },
      options: { responsive: true, maintainAspectRatio: false, interaction: interact, plugins: { legend: { display: false }, tooltip: tip },
        scales: { x: { ...xAxis }, y: { ...axis } } },
    });
  }

  global.SPCXCharts = { mount };
})(window);
