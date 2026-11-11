# Investor Dashboard

Unofficial personal investor dashboard for **Claes Berg**. It starts with **SpaceX (Nasdaq: SPCX)** and is structured so Tesla and NVIDIA can be added later.

This is **not** an official SpaceX site, is not affiliated with Space Exploration Technologies Corp., and is not investment advice. The visual language is inspired by the public look of [spacex.com](https://www.spacex.com) (black background, wide-tracked sans typography, thin rules, ghost buttons). Official logos and trademarked artwork are not used. A footer on the site states: *Unofficial – personal investor dashboard*.

Live site (GitHub Pages): **https://claesberg-sketch.github.io/investor-dashboard/**

## What’s on the SpaceX page

1. **Live price** — Nasdaq SPCX from the Yahoo Finance chart API (including pre- and after-hours prints), refreshed on the server about every 20 minutes. In the overnight window after U.S. after-hours (8:00 p.m. ET) and before pre-market (4:00 a.m. ET), and on weekends, the displayed price is the Hyperliquid **`xyz:SPCX`** mark, polled in the browser every few seconds. Hyperliquid CORS allows that. Yahoo does not (browser CORS is blocked), which is why Yahoo is fetched in GitHub Actions.
2. **News** — curated official press/IR, SEC filings, Google News RSS, and a seeded X snapshot from @elonmusk, @SpaceX, @Starlink, @Gwynne_Shotwell, @SpaceXSI, and @nextbigfuture (Brian Wang). Filters: Press, Filings, Media, X.
3. **Base-case revenue model** — next 18 months (quarterly through Q2 2028) and FY2026–FY2029. Drivers and sources are on the page; sliders recompute client-side.
4. **KPI charts** — segment revenue, Starlink subscribers, satellites (company + Jonathan McDowell), compute GW, earnings, capex, backlog.
5. **Calendar, valuation, lock-ups, risks.**

Every datapoint is sourced or marked as an estimate. If a figure was not disclosed, it is not invented as fact.

## Repository layout

```
index.html              # static page
css/style.css
js/                     # vanilla JS, Chart.js vendored in js/vendor/
fonts/                  # Barlow (OFL), bundled
data/companies.json     # company switcher config
data/spacex/            # all SpaceX datasets (JSON)
scripts/refresh.py      # server-side refresh (Actions + local)
.github/workflows/      # scheduled refresh + Pages deploy
```

No build step. Serve the repo root as a static site.

## How to add a company (Tesla, NVIDIA, …)

1. Add an entry to `data/companies.json`. Use `"status": "active"` when the page is ready; until then `"coming_soon"` keeps the ticker visible but disabled in the header switcher.
2. Create `data/<id>/` next to `data/spacex/` with the same files: `company.json`, `quote.json`, `news.json`, `news-static.json`, `kpis.json`, `forecast.json`, `calendar.json`, `x-posts.json`.
3. Point the page at that folder (today `js/app.js` loads the active SpaceX set). A later iteration can switch `dataDir` from the query string or the switcher without changing the layout.
4. Extend `scripts/refresh.py` with the new ticker, CIK, news query, and (if it exists) Hyperliquid symbol.

## How data refreshes

| Data | How it updates |
| --- | --- |
| Yahoo SPCX quote, pre/after prints, intraday & daily series | `scripts/refresh.py` in GitHub Actions every 20 minutes and on push. Written to `data/spacex/quote.json`. The browser re-fetches this file every 30 seconds. |
| Hyperliquid `xyz:SPCX` | Live in the browser (`POST https://api.hyperliquid.xyz/info`, `type=metaAndAssetCtxs`, `dex=xyz`). Also snapshotted during the Action for a first paint. |
| Google News RSS | Action, merged into `data/spacex/news.json`. |
| SEC EDGAR | Action tries `data.sec.gov/submissions/CIK0001181412.json`. If the runner is blocked (SEC 403), the page falls back to `data/spacex/filings-static.json`. |
| Official press releases | Curated in `data/spacex/news-static.json` (IR has no reliable public RSS). |
| X posts | **Seeded only.** Pulled once via the author’s X connector on 11 Nov 2026 into `data/spacex/x-posts.json`. Actions cannot call that connector. The UI shows a last-updated time and links to official X timelines. To refresh, re-export posts into that file and commit. |

Run a refresh locally:

```bash
python3 scripts/refresh.py
```

## Price session rules

U.S. Eastern Time:

- Regular 9:30 a.m.–4:00 p.m. — Yahoo regular print
- Pre-market 4:00–9:30 a.m. — Yahoo pre-market (from the includePrePost chart)
- After-hours 4:00–8:00 p.m. — Yahoo after-hours
- Overnight 8:00 p.m.–4:00 a.m., plus weekends and the U.S. holiday close — Hyperliquid `xyz:SPCX`

`xyz:SPCX` is a trade.xyz HIP-3 perpetual that references one SpaceX Class A share, cash-settled in USDC. It is price exposure, not share ownership.

## Forecast headline (base case, 11 Nov 2026)

- FY2026 revenue **$46.7B** (nine months reported $27.1B + Q4 estimate). Street consensus $48.9B.
- Q1 2027 **$35.3B**, anchored to official guidance of $33–37B.
- FY2027 **$209.5B** (above street $180.7B because the model honors Q1 guidance and then scales with the 13 GW YE2027 compute target, with a declining $/GW).
- Management’s $500B–$1T *year-end 2027 ARR aspiration* is **not** used as FY2027 revenue.

See the assumptions table on the site for sources.

## Licence and fonts

Site code may be reused. Company names and marks remain their owners’. Barlow is licensed under the SIL Open Font License.
