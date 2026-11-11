(function (global) {
  const fmt = (n, d) => {
    if (n == null || Number.isNaN(+n)) return "—";
    const x = Number(n);
    const digits = d != null ? d : (Math.abs(x) >= 100 ? 0 : 1);
    return x.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  };
  const bn = (m) => {
    if (m == null) return "—";
    return "$" + (m / 1000).toFixed(1) + "B";
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function compute(model, overrides) {
    const d0 = model.driversDefault;
    const o = Object.assign({}, d0, overrides || {});
    // Allow slider overrides of a few headline drivers
    const yieldMo = o.realizedConsumerYieldPerMonth;
    let subs = d0.startSubsM;
    let gw = d0.startGWq3;
    let ent = d0.startEntGov;
    const addsScale = o.addsScale != null ? o.addsScale : 1;
    const gwScale = o.gwScale != null ? o.gwScale : 1;
    const dpgwScale = o.dpgwScale != null ? o.dpgwScale : 1;

    const out = [];
    for (const row of model.quarters18m) {
      const id = row.id;
      const adds = (d0.starlinkNetAddsM[id] || 0) * addsScale;
      const startSubs = subs;
      const endSubs = startSubs + adds;
      const avgSubs = (startSubs + endSubs) / 2;
      const consumer = avgSubs * yieldMo * 3;
      const entG = d0.entGovSeqGrowth[id] || 0;
      ent = ent * (1 + entG);
      const conn = consumer + ent;
      const space = d0.spaceRevenue[id];
      const gwEnd = (d0.gwEnd[id] - gw) * gwScale + gw;
      const avgGW = (gw + gwEnd) / 2;
      const dpgw = (d0.infraUsdPerGwBn[id] || 0) * dpgwScale;
      const infra = avgGW * dpgw * 1000;
      const software = d0.siSoftware[id];
      const ads = d0.siAds[id];
      const si = infra + software + ads;
      out.push({
        id, label: row.label, isGuidanceAnchor: row.isGuidanceAnchor,
        revenue: { space, connectivity: conn, si, total: space + conn + si },
        drivers: {
          starlinkSubsStartM: startSubs, starlinkNetAddsM: adds, starlinkSubsEndM: endSubs,
          avgSubsM: avgSubs, realizedConsumerYieldPerMonth: yieldMo,
          consumerRevenue: consumer, entGovRevenue: ent,
          gwStart: gw, gwEnd, avgGW, infraUsdPerGwBn: dpgw,
          siInfra: infra, siSoftware: software, siAds: ads, spaceRevenue: space,
        },
      });
      subs = endSubs;
      gw = gwEnd;
    }
    return out;
  }

  function annualFrom(model, quarters) {
    const by = Object.fromEntries(quarters.map((q) => [q.id, q]));
    const sum = (ids, k) => ids.reduce((s, id) => s + by[id].revenue[k], 0);
    const q4 = by["2026-Q4"];
    const fy26 = {
      space: 3348 + q4.revenue.space,
      connectivity: 12796 + q4.revenue.connectivity,
      si: 10939 + q4.revenue.si,
    };
    fy26.total = fy26.space + fy26.connectivity + fy26.si;
    const y27 = ["2027-Q1", "2027-Q2", "2027-Q3", "2027-Q4"];
    const fy27 = { space: sum(y27, "space"), connectivity: sum(y27, "connectivity"), si: sum(y27, "si") };
    fy27.total = fy27.space + fy27.connectivity + fy27.si;
    // FY28/29 stay at published base unless we also rebuilt extensions; use stored annual for those
    // plus recompute FY28 Q1-Q2 + stored extensions (extensions not in quarters18m)
    const stored = Object.fromEntries((model.annual || []).map((a) => [a.id, a]));
    return [
      { id: "FY2026", label: "FY 2026", revenue: fy26, note: stored.FY2026 && stored.FY2026.includes },
      { id: "FY2027", label: "FY 2027", revenue: fy27, note: stored.FY2027 && stored.FY2027.includes },
      stored.FY2028,
      stored.FY2029,
    ].filter(Boolean);
  }

  let chart, view = "q", lastQuarters, lastAnnual, lastModel;

  function tableQuarterly(rows) {
    const head = "<thead><tr><th></th><th>Space</th><th>Connectivity</th><th>Super Intelligence</th><th>Total</th><th>Subs (end, M)</th><th>GW (end)</th></tr></thead>";
    const body = rows.map((r) => {
      const d = r.drivers;
      const flag = r.isGuidanceAnchor ? ' <span class="kind disclosed">Q1 guide</span>' : "";
      return "<tr><td>" + r.label + flag + "</td><td>" + bn(r.revenue.space) + "</td><td>" + bn(r.revenue.connectivity) + "</td><td>" + bn(r.revenue.si) + "</td><td><strong>" + bn(r.revenue.total) + "</strong></td><td>" + fmt(d.starlinkSubsEndM, 1) + "</td><td>" + fmt(d.gwEnd, 2) + "</td></tr>";
    }).join("");
    return "<table>" + head + "<tbody>" + body + "</tbody></table>";
  }

  function tableAnnual(rows) {
    const head = "<thead><tr><th></th><th>Space</th><th>Connectivity</th><th>Super Intelligence</th><th>Total</th></tr></thead>";
    const body = rows.map((r) => {
      const rev = r.revenue || r;
      return "<tr><td>" + (r.label || r.id) + "</td><td>" + bn(rev.space) + "</td><td>" + bn(rev.connectivity) + "</td><td>" + bn(rev.si) + "</td><td><strong>" + bn(rev.total) + "</strong></td></tr>";
    }).join("");
    return "<table>" + head + "<tbody>" + body + "</tbody></table>";
  }

  function paintChart() {
    const el = document.getElementById("forecast-chart");
    const title = document.getElementById("forecast-chart-title");
    if (!el || !global.Chart) return;
    const labels = view === "q" ? lastQuarters.map((r) => r.label) : lastAnnual.map((r) => r.label || r.id);
    const rows = view === "q" ? lastQuarters : lastAnnual;
    const stack = (k) => rows.map((r) => +(((r.revenue || r)[k]) / 1000).toFixed(2));
    if (title) title.textContent = view === "q" ? "Base case revenue · next 18 months ($B)" : "Base case revenue · FY2026–FY2029 ($B)";
    const cfg = {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: "Space", data: stack("space"), backgroundColor: "rgba(240,240,250,0.35)", stack: "r" },
          { label: "Connectivity", data: stack("connectivity"), backgroundColor: "rgba(240,240,250,0.65)", stack: "r" },
          { label: "Super Intelligence", data: stack("si"), backgroundColor: "rgba(240,240,250,0.95)", stack: "r" },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "rgba(240,240,250,0.8)", boxWidth: 12 } },
          tooltip: { callbacks: { label: (i) => " " + i.dataset.label + ": $" + i.parsed.y.toFixed(1) + "B" } } },
        scales: {
          x: { stacked: true, ticks: { color: "rgba(240,240,250,0.6)" }, grid: { display: false }, border: { color: "rgba(240,240,250,0.15)" } },
          y: { stacked: true, ticks: { color: "rgba(240,240,250,0.6)", callback: (v) => "$" + v + "B" }, grid: { color: "rgba(240,240,250,0.08)" }, border: { display: false } },
        },
      },
    };
    if (chart) { chart.data = cfg.data; chart.options = cfg.options; chart.update(); }
    else chart = new Chart(el, cfg);
  }

  function paint(model, overrides) {
    lastModel = model;
    lastQuarters = compute(model, overrides);
    lastAnnual = annualFrom(model, lastQuarters);
    const table = document.getElementById("forecast-table");
    if (table) table.innerHTML = view === "q" ? tableQuarterly(lastQuarters) : tableAnnual(lastAnnual);
    paintChart();
    return { quarters: lastQuarters, annual: lastAnnual };
  }

  function mount(model) {
    const formEl = document.getElementById("forecast-formulas");
    if (formEl && model.formulas) {
      formEl.innerHTML = "<strong>How the numbers are calculated</strong><br>" +
        Object.entries(model.formulas).map(([k, v]) => "<div style='margin-top:8px'><code>" + k + "</code> — " + v + "</div>").join("");
    }
    const dbox = document.getElementById("forecast-drivers");
    const state = { realizedConsumerYieldPerMonth: model.driversDefault.realizedConsumerYieldPerMonth, addsScale: 1, gwScale: 1, dpgwScale: 1 };
    if (dbox) {
      const sliders = [
        { key: "realizedConsumerYieldPerMonth", label: "Realized consumer yield, $/month", min: 60, max: 95, step: 1, fmt: (v) => "$" + v },
        { key: "addsScale", label: "Starlink net-adds scale vs base", min: 0.6, max: 1.4, step: 0.05, fmt: (v) => Math.round(v * 100) + "% of base adds" },
        { key: "gwScale", label: "Compute additions scale vs base", min: 0.6, max: 1.3, step: 0.05, fmt: (v) => Math.round(v * 100) + "% of GW additions" },
        { key: "dpgwScale", label: "SI infrastructure $/GW scale", min: 0.6, max: 1.3, step: 0.05, fmt: (v) => Math.round(v * 100) + "% of base unit rate" },
      ];
      dbox.innerHTML = sliders.map((s) =>
        '<div class="driver"><label>' + s.label + '</label><input type="range" min="' + s.min + '" max="' + s.max + '" step="' + s.step + '" value="' + state[s.key] + '" data-key="' + s.key + '"><div class="val" data-val="' + s.key + '">' + s.fmt(state[s.key]) + "</div></div>"
      ).join("");
      dbox.querySelectorAll("input").forEach((input) => {
        input.addEventListener("input", () => {
          const k = input.dataset.key;
          state[k] = +input.value;
          const spec = sliders.find((s) => s.key === k);
          dbox.querySelector('[data-val="' + k + '"]').textContent = spec.fmt(state[k]);
          paint(model, state);
        });
      });
    }
    const reset = document.getElementById("forecast-reset");
    if (reset) reset.addEventListener("click", () => {
      state.realizedConsumerYieldPerMonth = model.driversDefault.realizedConsumerYieldPerMonth;
      state.addsScale = 1; state.gwScale = 1; state.dpgwScale = 1;
      if (dbox) dbox.querySelectorAll("input").forEach((input) => {
        input.value = state[input.dataset.key];
        input.dispatchEvent(new Event("input"));
      });
      paint(model, state);
    });
    const tabs = document.getElementById("forecast-tabs");
    if (tabs) tabs.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-view]");
      if (!btn) return;
      view = btn.dataset.view;
      tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
      paint(model, state);
    });
    const ass = document.getElementById("forecast-assumptions");
    if (ass && model.assumptions) {
      ass.innerHTML = "<p class='section-kicker'>Assumptions &amp; sources</p>" +
        model.assumptions.map((a) => {
          const kind = (a.kind || "estimate").toLowerCase();
          const cls = kind.indexOf("disclosed") >= 0 || kind.indexOf("guidance") >= 0 ? "disclosed" : (kind.indexOf("consensus") >= 0 || kind.indexOf("third") >= 0 ? "" : "estimate");
          return '<div class="row"><span class="kind ' + cls + '">' + a.kind + "</span><strong>" + a.input + "</strong><div>" + a.value + "</div><div class='source'><a href='" + a.url + "' target='_blank' rel='noopener'>" + a.source + "</a></div></div>";
        }).join("");
    }
    return paint(model, state);
  }

  global.SPCXForecast = { mount, compute, bn, fmt };
})(window);
