/* Share unlock schedule — figures from unlocks.json; values use the live displayed price. */
(function (global) {
  let data = null;
  let lastPrice = null;
  let chart = null;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function fmtShares(n) {
    if (n == null || Number.isNaN(+n)) return "—";
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(3).replace(/0+$/, "").replace(/\.$/, "") + "B";
    if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    return Number(n).toLocaleString("en-US");
  }

  function pct(shares, den, digits) {
    if (shares == null || !den) return "—";
    const p = (shares / den) * 100;
    return p.toFixed(digits == null ? 2 : digits) + "%";
  }

  function valueAt(shares, price) {
    if (shares == null || price == null || Number.isNaN(+price)) return "—";
    return SPCXPrice.compact(shares * price) + " est.";
  }

  function sourceLink(src) {
    if (!src) return "";
    if (src.url) return '<a href="' + esc(src.url) + '" target="_blank" rel="noopener">' + esc(src.label || "Source") + "</a>";
    return esc(src.label || "");
  }

  function statusLabel(st) {
    if (st === "released") return "Released";
    if (st === "upcoming") return "Upcoming";
    if (st === "did_not_trigger") return "Did not trigger";
    return st || "";
  }

  function chartEvents(d) {
    return (d.events || []).filter((e) => e.status !== "did_not_trigger");
  }

  function sortKey(e) {
    return e.date || e.dateSort || "9999-99-99";
  }

  function shortLabel(e) {
    const dateBit = e.date
      ? new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "2-digit" }).format(new Date(e.date + "T12:00:00Z"))
      : (e.group === "extended" && !e.date ? e.dateLabel.replace(/^Second full trading day after /, "After ").replace(/ \(date not set; not before [^)]+\)/, "") : e.dateLabel);
    const tag = e.group === "Musk 366-day" ? "Musk"
      : e.group === "extended" ? "Ext."
      : e.group === "Rule 144" ? "144"
      : e.group === "180-day affiliates" ? "Aff."
      : "";
    const compact = dateBit.length > 22 ? dateBit.slice(0, 20) + "…" : dateBit;
    return tag ? compact + " · " + tag : compact;
  }

  function paintChart(d, price) {
    const el = document.getElementById("unlock-chart");
    if (!el || !global.Chart) return;
    const rows = chartEvents(d).slice().sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    const labels = rows.map(shortLabel);
    const bar = rows.map((e) => e.shares / 1e9);
    const colors = rows.map((e) => e.status === "released" ? "rgba(240,240,250,0.28)" : "rgba(232,195,106,0.85)");
    const start = (d.ipoPrimaryShares && d.ipoPrimaryShares.shares) || 0;
    let run = start / 1e9;
    const cum = rows.map((e) => { run += e.shares / 1e9; return +run.toFixed(4); });
    const cfg = {
      type: "bar",
      data: {
        labels,
        datasets: [
          { type: "bar", label: "Tranche (bn shares, up to)", data: bar, backgroundColor: colors, yAxisID: "y", order: 2, barPercentage: 0.7, categoryPercentage: 0.8 },
          { type: "line", label: "Cumulative eligible (bn, incl. IPO primary)", data: cum, borderColor: "rgba(240,240,250,0.9)", backgroundColor: "transparent", yAxisID: "y2", order: 1, pointRadius: 2, borderWidth: 1.5, tension: 0.15 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: {
          legend: { display: true, labels: { color: "rgba(240,240,250,0.65)", font: { size: 10, family: "Barlow, sans-serif" }, boxWidth: 10 } },
          tooltip: {
            callbacks: {
              label(ctx) {
                const e = rows[ctx.dataIndex];
                if (ctx.datasetIndex === 0) {
                  return " " + (e.sharesLabel || fmtShares(e.shares)) + (price != null ? "  ·  " + valueAt(e.shares, price) : "");
                }
                return " Cumulative “up to” " + ctx.parsed.y.toFixed(2) + "B shares (incl. 638.9M IPO primary)";
              },
            },
          },
        },
        scales: {
          x: {
            ticks: { color: "rgba(240,240,250,0.5)", font: { size: 9, family: "Barlow, sans-serif" }, maxRotation: 70, minRotation: 50, autoSkip: false },
            grid: { display: false },
            border: { display: false },
          },
          y: {
            title: { display: true, text: "Tranche (bn)", color: "rgba(240,240,250,0.45)", font: { size: 10 } },
            ticks: { color: "rgba(240,240,250,0.45)", font: { size: 10 } },
            grid: { color: "rgba(240,240,250,0.08)" },
            border: { display: false },
            beginAtZero: true,
          },
          y2: {
            position: "right",
            title: { display: true, text: "Cumulative (bn)", color: "rgba(240,240,250,0.45)", font: { size: 10 } },
            ticks: { color: "rgba(240,240,250,0.45)", font: { size: 10 } },
            grid: { display: false },
            border: { display: false },
            beginAtZero: true,
          },
        },
      },
    };
    if (chart) { chart.destroy(); chart = null; }
    chart = new Chart(el, cfg);
  }

  function todayStockholm() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  }

  function formatUnlockDay(iso) {
    if (!iso) return "";
    // Date-only unlock days; noon UTC keeps the same calendar date in CET/CEST.
    const d = new Date(iso.length === 10 ? iso + "T12:00:00Z" : iso);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", day: "numeric", month: "short", year: "numeric" }).format(d);
  }

  function shortUndated(e) {
    const label = e && e.dateLabel ? e.dateLabel : "Date not set";
    return label
      .replace(/^Second full trading day after /, "After ")
      .replace(/ \(date not set; not before [^)]+\)/, "")
      .replace(/ \(date not set[^)]*\)/, "");
  }

  function compactShares(e) {
    if (!e || e.shares == null) return (e && e.sharesLabel) || "";
    const n = fmtShares(e.shares) + " shares";
    const label = e.sharesLabel || "";
    if (/^up to/i.test(label) || /\(up to\)/i.test(label)) return "up to " + n;
    if (/^about/i.test(label) || e.sharesKind === "estimate") return "about " + n;
    return n;
  }

  /**
   * Nearest future unlock relative to today in Europe/Stockholm.
   * Skips released / did-not-trigger / already-past events. Prefers a dated
   * upcoming event; only falls back to an undated one (sorted by dateSort
   * “not before”) when no fixed date remains.
   */
  function nearestUpcoming(d) {
    const today = todayStockholm();
    const events = (d && d.events) || [];
    const dated = events.filter((e) => e.status === "upcoming" && e.date && e.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (dated[0]) return dated[0];
    const undated = events.filter((e) => e.status === "upcoming" && !e.date)
      .sort((a, b) => (a.dateSort || "9999-99-99").localeCompare(b.dateSort || "9999-99-99"));
    return undated[0] || null;
  }

  function overviewStat(d) {
    const ev = nearestUpcoming(d);
    if (!ev) return { k: "Next share unlock", v: "—", s: "" };
    const dateBit = ev.date ? formatUnlockDay(ev.date) : shortUndated(ev);
    const shareBit = compactShares(ev);
    const parts = [];
    if (shareBit) parts.push(shareBit);
    if (ev.shares != null && d && d.sharesOutstanding) parts.push(pct(ev.shares, d.sharesOutstanding) + " of outstanding");
    if (!ev.date && ev.dateSort) parts.push("not before " + formatUnlockDay(ev.dateSort));
    return { k: "Next share unlock", v: dateBit || "Date not set", s: parts.join(" · ") };
  }

  function renderCallout(d, price) {
    const ev = nearestUpcoming(d);
    const htmlFor = (el) => {
      if (!el || !ev) return;
      el.innerHTML =
        '<div class="k">Nearest unlock</div>' +
        "<h3>" + esc(ev.dateLabel) + " — " + esc(ev.sharesLabel) + "</h3>" +
        "<p>" + esc(ev.trigger) + (price != null ? " Approximate value at the displayed price: " + valueAt(ev.shares, price) + " (" + pct(ev.shares, d.sharesOutstanding) + " of 13.581B outstanding; " + pct(ev.shares, d.freeFloatEstimate) + " of estimated free float).</p>" : "</p>") +
        '<p class="source">' + sourceLink(ev.source) + (ev.sharesNote ? " · " + esc(ev.sharesNote) : "") + ' · <a href="#unlocks">Full schedule</a></p>';
    };
    htmlFor(document.getElementById("unlock-next"));
    const cal = document.getElementById("calendar-unlock-next");
    htmlFor(cal);
  }

  function renderTable(d, price) {
    const el = document.getElementById("unlock-table");
    if (!el) return;
    const so = d.sharesOutstanding;
    const ff = d.freeFloatEstimate;
    const rows = (d.events || []).slice().sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    const head = "<thead><tr>" +
      "<th>Date</th><th>Trigger / condition</th><th>Who</th><th>Shares unlocking</th>" +
      "<th>% of 13.581B outstanding</th><th>% of est. free float</th><th>Approx. value at current price</th><th>Source</th>" +
      "</tr></thead>";
    const body = rows.map((e) => {
      const skipped = e.status === "did_not_trigger";
      return "<tr>" +
        "<td>" + esc(e.dateLabel) + "<br><span class='status-pill " + esc(e.status) + "'>" + esc(statusLabel(e.status)) + "</span></td>" +
        "<td>" + esc(e.trigger) + "</td>" +
        "<td>" + esc(e.holders) + "</td>" +
        "<td>" + esc(e.sharesLabel) + (e.sharesNote ? "<br><span class='tiny'>" + esc(e.sharesNote) + "</span>" : "") + "</td>" +
        "<td>" + (skipped ? "—" : pct(e.shares, so)) + "</td>" +
        "<td>" + (skipped ? "—" : pct(e.shares, ff) + " est.") + "</td>" +
        "<td>" + (skipped ? "—" : valueAt(e.shares, price)) + "</td>" +
        "<td>" + sourceLink(e.source) + "</td>" +
        "</tr>";
    }).join("");
    el.innerHTML = "<table>" + head + "<tbody>" + body + "</tbody></table>";
  }

  function renderNotes(d) {
    const el = document.getElementById("unlock-notes");
    if (!el) return;
    const pt = d.priceTrigger || {};
    const musk = d.muskHoldings424b4 || {};
    const ipo = d.ipoPrimaryShares || {};
    el.innerHTML =
      "<details open><summary>How to read these figures</summary><div class='row'>" + esc(d.disclaimer) + "</div></details>" +
      "<details open><summary>August 2026 price test (Additional Release Shares)</summary><div class='row'>" +
      esc(pt.condition) + " " + esc(pt.firstEarningsReleaseDate) + " " + esc(pt.outcomeNote) +
      (pt.closesWindow ? " Yahoo regular-session closes in the relevant windows ranged from $" + pt.closesWindow.low.toFixed(2) + " to $" + pt.closesWindow.high.toFixed(2) + "." : "") +
      "</div><div class='row source'>" + (pt.sources || []).map(sourceLink).join(" · ") + "</div></details>" +
      "<details><summary>Who is locked, and what Elon Musk holds</summary><div class='row'>" +
      (d.holders || []).map((h) => "<p style='margin-bottom:8px'><strong>" + esc(h.group) + ".</strong> " + esc(h.who) + " <span class='source'>" + esc(h.source) + "</span></p>").join("") +
      "<p>Prospectus beneficial ownership as of 1 May 2026, compiled by FloatCap: " +
      fmtShares(musk.classA) + " Class A and " + fmtShares(musk.classBExUnvested) + " Class B excluding unvested awards (together " + fmtShares(musk.classA + musk.classBExUnvested) + "). A further " +
      fmtShares(musk.unvestedRestrictedClassB) + " unvested restricted Class B remain subject to market-cap and operational milestones (1.000B SpaceX CEO Award; 302.1M AI CEO Award) after the 366-day lock-up ends and are not treated as unlocking on 14 Jun 2027. Voting power at the IPO was " +
      esc(musk.votingPowerAtIpo) + ". " + esc(musk.note) + "</p>" +
      '<p class="source">' + sourceLink(musk.source) + "</p></div></details>" +
      "<details><summary>Free float, IPO primary shares, and outstanding share count</summary><div class='row'>" +
      "<p>Shares outstanding: <strong>13,581,063,709</strong> as of " + esc(d.sharesOutstandingAsOf) + ". " + sourceLink(d.sharesOutstandingSource) + "</p>" +
      "<p>" + esc(d.freeFloatNote) + " " + sourceLink(d.freeFloatSource) + "</p>" +
      "<p>" + esc(ipo.note) + " " + sourceLink(ipo.source) + "</p>" +
      '<p class="source">Lock-up table: ' + sourceLink(d.prospectus) + "</p></div></details>";
  }

  function paint(price) {
    if (!data) return;
    lastPrice = price;
    renderCallout(data, price);
    renderTable(data, price);
    paintChart(data, price);
    renderNotes(data);
  }

  function mount(payload, price) {
    data = payload;
    paint(price);
  }

  function updatePrice(price) {
    if (price == null || price === lastPrice) return;
    lastPrice = price;
    if (!data) return;
    renderCallout(data, price);
    renderTable(data, price);
    // Chart tooltips use price; no need to rebuild axes every 5s.
  }

  global.SPCXUnlocks = { mount, updatePrice, nearestUpcoming, overviewStat };
})(window);
