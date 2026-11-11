(function (global) {
  const axis = {
    ticks: { color: "rgba(240,240,250,0.6)", font: { size: 11 } },
    grid: { color: "rgba(240,240,250,0.08)" },
    border: { color: "rgba(240,240,250,0.15)" },
  };
  const legend = { labels: { color: "rgba(240,240,250,0.85)", boxWidth: 12, font: { size: 11 } } };
  const pal = {
    space: "rgba(240,240,250,0.35)",
    conn: "rgba(240,240,250,0.65)",
    si: "rgba(240,240,250,0.95)",
    line: "rgba(240,240,250,0.95)",
    line2: "rgba(61,214,140,0.9)",
    muted: "rgba(240,240,250,0.4)",
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
      card("c-rev", "Revenue by segment ($M)", "SpaceX Q2 and Q3 2026 earnings releases; Q4 2025 is total only (FY minus 9M)."),
      card("c-subs", "Starlink consumer subscribers (M) and stated ARPU", "Company disclosures, period-end. ARPU is the official figure, not the model’s realized yield."),
      card("c-connmix", "Connectivity revenue: consumer vs enterprise &amp; government ($M)", "Q2 / Q3 2026 earnings releases."),
      card("c-gw", "Nameplate AI compute (GW)", "Period-end nameplate. Q3 2026 release and Q2 call; YE 2026/27 guides shown as markers in the note."),
      card("c-earn", "Adjusted EBITDA and net income ($M)", "Where reported in the Q2 and Q3 2026 releases. Gaps are left blank."),
      card("c-capex", "Capital expenditure ($M)", "Total and SI capex from Q2 / Q3 2026 releases."),
      card("c-sats", "Starlink satellites", "Company figures from the Q2 call and prospectus; McDowell independent count as of 9 Nov 2026."),
      card("c-backlog", "Backlog ($B)", "Q2 $47.5B and Q3 $63B (of which $42B expected in 12 months)."),
    ].join("");

    const space = q.map((x) => (x.revenue && x.revenue.space) ?? null);
    const conn = q.map((x) => (x.revenue && x.revenue.connectivity) ?? null);
    const si = q.map((x) => (x.revenue && x.revenue.si) ?? null);
    new Chart(document.getElementById("c-rev"), {
      type: "bar",
      data: { labels, datasets: [
        { label: "Space", data: space, backgroundColor: pal.space, stack: "r" },
        { label: "Connectivity", data: conn, backgroundColor: pal.conn, stack: "r" },
        { label: "SI / AI", data: si, backgroundColor: pal.si, stack: "r" },
      ] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend },
        scales: { x: { stacked: true, ...axis, grid: { display: false } }, y: { stacked: true, ...axis } } },
    });

    new Chart(document.getElementById("c-subs"), {
      type: "line",
      data: { labels, datasets: [
        { label: "Consumer subs (M)", data: q.map((x) => x.starlinkConsumerSubsM ?? null), yAxisID: "y", borderColor: pal.line, backgroundColor: "transparent", spanGaps: false, tension: 0.15, pointRadius: 3 },
        { label: "Stated ARPU ($)", data: q.map((x) => x.starlinkConsumerArpu ?? null), yAxisID: "y2", borderColor: pal.line2, backgroundColor: "transparent", spanGaps: false, tension: 0.15, pointRadius: 3, borderDash: [4, 4] },
      ] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend },
        scales: { x: { ...axis, grid: { display: false } }, y: { ...axis, title: { display: true, text: "Subs (M)", color: "rgba(240,240,250,0.5)" } }, y2: { ...axis, position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "ARPU $", color: "rgba(240,240,250,0.5)" } } } },
    });

    new Chart(document.getElementById("c-connmix"), {
      type: "bar",
      data: { labels, datasets: [
        { label: "Consumer", data: q.map((x) => x.consumerRevenue ?? null), backgroundColor: pal.conn, stack: "c" },
        { label: "Enterprise & government", data: q.map((x) => x.enterpriseGovRevenue ?? null), backgroundColor: pal.si, stack: "c" },
      ] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend },
        scales: { x: { stacked: true, ...axis, grid: { display: false } }, y: { stacked: true, ...axis } } },
    });

    new Chart(document.getElementById("c-gw"), {
      type: "line",
      data: { labels, datasets: [{ label: "Nameplate GW", data: q.map((x) => x.nameplateComputeGW ?? null), borderColor: pal.line, backgroundColor: "rgba(240,240,250,0.1)", fill: true, tension: 0.15, pointRadius: 3, spanGaps: false }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
        scales: { x: { ...axis, grid: { display: false } }, y: { ...axis, beginAtZero: true } } },
    });
    const gwNote = document.querySelector("#c-gw").closest(".chart-card").querySelector(".source");
    if (gwNote && kpis.guidance) {
      const g = kpis.guidance;
      gwNote.innerHTML += " Official targets: YE2026 " + g.ye2026_nameplate_gw.low + "–" + g.ye2026_nameplate_gw.high + " GW; YE2027 about " + g.ye2027_nameplate_gw.value + " GW (Musk, Q3 call).";
    }

    new Chart(document.getElementById("c-earn"), {
      type: "bar",
      data: { labels, datasets: [
        { label: "Adj. EBITDA", data: q.map((x) => x.adjustedEbitda ?? null), backgroundColor: pal.conn },
        { label: "Net income", data: q.map((x) => x.netIncome ?? null), backgroundColor: pal.si },
      ] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend },
        scales: { x: { ...axis, grid: { display: false } }, y: { ...axis } } },
    });

    new Chart(document.getElementById("c-capex"), {
      type: "bar",
      data: { labels, datasets: [
        { label: "Total capex", data: q.map((x) => x.capex ?? null), backgroundColor: pal.muted },
        { label: "SI capex", data: q.map((x) => (x.segmentCapex && x.segmentCapex.si) ?? null), backgroundColor: pal.si },
      ] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend },
        scales: { x: { ...axis, grid: { display: false } }, y: { ...axis } } },
    });

    // Satellites: sparse company points + McDowell current as a last category
    const satLabels = [];
    const companyOp = [];
    const mcdowell = [];
    q.forEach((x) => {
      if (x.satellites && x.satellites.companyOperationalApprox) {
        satLabels.push(x.label);
        companyOp.push(x.satellites.companyOperationalApprox);
        mcdowell.push(null);
      }
    });
    if (kpis.satellitesTracker) {
      satLabels.push("9 Nov 2026");
      companyOp.push(null);
      mcdowell.push(kpis.satellitesTracker.inOrbit);
    }
    new Chart(document.getElementById("c-sats"), {
      type: "bar",
      data: { labels: satLabels, datasets: [
        { label: "Company operational (approx.)", data: companyOp, backgroundColor: pal.conn },
        { label: "McDowell in orbit", data: mcdowell, backgroundColor: pal.si },
      ] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend },
        scales: { x: { ...axis, grid: { display: false } }, y: { ...axis, beginAtZero: true } } },
    });
    const satSrc = document.querySelector("#c-sats").closest(".chart-card").querySelector(".source");
    if (satSrc && kpis.satellitesTracker) {
      const t = kpis.satellitesTracker;
      satSrc.innerHTML = "McDowell as of 9 Nov 2026: " + t.inOrbit.toLocaleString() + " in orbit, " + t.working.toLocaleString() + " working, " + t.operationalOrbit.toLocaleString() + " in operational orbit, " + t.launched.toLocaleString() + " launched. <a href='" + t.source.url + "' target='_blank' rel='noopener'>" + t.source.label + "</a>. Company: ~9,600 as of 31 Mar 2026 (prospectus); ~10,200 operational at 30 Jun 2026 (Q2 call). Definitions differ.";
    }

    new Chart(document.getElementById("c-backlog"), {
      type: "bar",
      data: { labels, datasets: [{ label: "Backlog ($M)", data: q.map((x) => x.backlog ?? null), backgroundColor: pal.si }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
        scales: { x: { ...axis, grid: { display: false } }, y: { ...axis } } },
    });
  }

  global.SPCXCharts = { mount };
})(window);
