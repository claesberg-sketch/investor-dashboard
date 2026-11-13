# Investor Dashboard

Unofficial personal investor dashboard for **Claes Berg**. It starts with **SpaceX (Nasdaq: SPCX)** and is structured so Tesla and NVIDIA can be added later.

This is **not** an official SpaceX site, is not affiliated with Space Exploration Technologies Corp., and is not investment advice. The visual language is inspired by the public look of [spacex.com](https://www.spacex.com) (black background, wide-tracked sans typography, thin rules, ghost buttons). Official logos and trademarked artwork are not used. A footer on the site states: *Unofficial – personal investor dashboard*.

Live site (GitHub Pages): **https://claesberg-sketch.github.io/investor-dashboard/**

## What’s on the SpaceX page

1. **Live price and hero chart** — the headline price and the top chart are the Hyperliquid **`xyz:SPCX`** mid, 24/7, labelled “Hyperliquid xyz:SPCX perp – 24/7.” The chart is 5-minute candles from `candleSnapshot` (last 24 hours) plus a live point at the current time in CET/CEST, kept in sync by a 5-second poll and a WebSocket candle / mid subscription (`wss://api.hyperliquid.xyz/ws`). The last chart point is the same price as the ticker. Under the live price, two tiles show the latest Nasdaq/Yahoo **Regular close** (price, % change, date and time in CET/CEST) and **After hours** (price, change versus that session’s regular close in $ and %, date and time in CET/CEST). If today’s U.S. after-hours session has data it is shown as it comes; otherwise the tiles use the latest completed after-hours session. The official regular-session line is overlaid on the chart as a dashed series. Yahoo itself is a server-side file (browser CORS is blocked) and updates only when `scripts/refresh.py` is run and pushed.
2. **News** — one chronological feed (newest first) of official press/IR, SEC filings, Google News RSS, and X posts from @elonmusk, @SpaceX, @Starlink, @Gwynne_Shotwell, @SpaceXSI, and @nextbigfuture (Brian Wang). Filters: All, Press, Filings, Media, X. Every item shows its publish date and time in Europe/Stockholm (CET or CEST); if a source has only a date, the row says “time n/a” rather than inventing a clock time. Each row also has a two-sentence plain-English summary of the article, filing, release, or post, written from the source (or, if a page could not be fetched, from the headline/snippet only, and labelled as such).
3. **Base-case revenue model** — next 18 months (quarterly through Q2 2028) and FY2026–FY2029. Drivers and sources are on the page; sliders recompute client-side.
4. **KPI charts** — segment revenue, Starlink subscribers, Starlink satellites in orbit by generation (V1 / V2 / V3, Jonathan McDowell), compute GW, earnings, capex, backlog.
5. **Share unlock schedule** — lock-up expiries and staged releases from the Form 424(b)(4), later 8-Ks and the 10-Q, with the nearest unlock and a cumulative chart. The catalyst calendar also flags the nearest unlock.
6. **Calendar, valuation, lock-ups, risks.**

Every datapoint is sourced or marked as an estimate. If a figure was not disclosed, it is not invented as fact.

## Repository layout

```
index.html              # static page
css/style.css
js/                     # vanilla JS, Chart.js vendored in js/vendor/
fonts/                  # Barlow (OFL), bundled
data/companies.json     # company switcher config
data/spacex/            # all SpaceX datasets (JSON), including summaries.json
scripts/refresh.py      # server-side refresh (Actions + local)
.github/workflows/      # scheduled refresh + Pages deploy
```

No build step. Serve the repo root as a static site.

## How to add a company (Tesla, NVIDIA, …)

1. Add an entry to `data/companies.json`. Use `"status": "active"` when the page is ready; until then `"coming_soon"` keeps the ticker visible but disabled in the header switcher.
2. Create `data/<id>/` next to `data/spacex/` with the same files: `company.json`, `quote.json`, `news.json`, `news-static.json`, `kpis.json`, `calendar.json`, `unlocks.json`, `x-posts.json`.
3. Point the page at that folder (today `js/app.js` loads the active SpaceX set). A later iteration can switch `dataDir` from the query string or the switcher without changing the layout.
4. Extend `scripts/refresh.py` with the new ticker, CIK, news query, and (if it exists) Hyperliquid symbol.

## How data refreshes

| Data | How it updates |
| --- | --- |
| Yahoo SPCX quote, pre/after prints, intraday & daily series | `scripts/refresh.py`, written to `data/spacex/quote.json`. The browser re-fetches this file every 30 seconds. Automatic Actions refresh is not enabled yet (see the note below). |
| Hyperliquid `xyz:SPCX` mid, mark, and 5-minute candles | Live in the browser: `POST https://api.hyperliquid.xyz/info` (`metaAndAssetCtxs` / `candleSnapshot`, `dex=xyz` / `coin=xyz:SPCX`), polled every 5 seconds, with a WebSocket at `wss://api.hyperliquid.xyz/ws`. Also snapshotted in `quote.json` for a first paint. |
| Google News RSS | Action, merged into `data/spacex/news.json`. |
| SEC EDGAR | Action tries `data.sec.gov/submissions/CIK0001181412.json`. If the runner is blocked (SEC 403), the page falls back to `data/spacex/filings-static.json`. |
| Official press releases | Curated in `data/spacex/news-static.json` (IR has no reliable public RSS). |
| X posts | Pulled via the author’s X connector into `data/spacex/x-posts.json` and merged into the single news feed in the browser. Actions cannot call that connector, so the file updates when someone re-exports posts and commits. The feed has a last-updated line. |
| Item summaries | Hand-written two-sentence summaries, stored on each item and in `data/spacex/summaries.json`. They are written by the dashboard author (an assistant reading the source) when the feed is refreshed locally. GitHub Actions cannot generate them. `scripts/refresh.py` keeps any summary already stored (matched by id, URL, or title) and lists new items that still need one in `refresh-status.json`. Until a summary is written, the page falls back to the source’s own snippet, truncated to two sentences. |

| Starlink satellites in orbit (KPI chart) | Not fetched by `scripts/refresh.py`. Counts live in `data/spacex/kpis.json` under `satellitesByQuarter` (total, V1, V2, V2 DTC subset, V3) with method and sources in `satellitesMeta`. They come from Jonathan McDowell’s GCAT payload catalogs (`satcat.tsv` + `satcat100k.tsv`) plus the daily in-orbit log at [planet4589.org/space/con/star](https://planet4589.org/space/con/star/stats.html). In orbit = launched on or before the date and not yet reentered. V1 is v1.0/v1.5; V2 Mini includes Direct-to-Cell; V3 is only the 26 satellites from Starship Flight 14 (28 Sep 2026) — put 0 if none have reached orbit. Company “operational” figures are a footnote only, not a second series. To refresh: re-download the catalogs, recompute each quarter-end (31 Mar / 30 Jun / 30 Sep / 31 Dec) and a current/latest point on McDowell’s last update date, then commit. The earnings KPI routine should add a new quarter-end point the same way when a quarter closes; do not invent V3 or other generation counts. |

Run a refresh locally:

```bash
python3 scripts/refresh.py
```

`refresh.py` also rewrites a `?v=` query string on every local JS/CSS tag in `index.html` (short git hash plus a UTC timestamp). GitHub Pages caches assets for about ten minutes (`max-age=600`), so that bump makes the next HTML load fetch fresh scripts and styles. For a JS/CSS-only change you can bump without a data refresh:

```bash
python3 scripts/refresh.py --bump-assets
```

Run that (or a full refresh) before pushing so clients do not keep a stale overview. JSON files are fetched in the browser with `cache: "no-store"` and a timestamp query.

**GitHub Actions note:** The scheduled workflow lives in `scripts/github-actions-refresh.yml` (copy it to `.github/workflows/refresh.yml`). It could not be committed under `.github/workflows/` from this environment because the logged-in `gh` token has `repo` scope but not the `workflow` scope GitHub requires to create workflow files. Until that file is added with a token that has `workflow` scope, Pages is served from the `main` branch and Yahoo/news JSON update when someone runs `scripts/refresh.py` and pushes. Hyperliquid prices still update live in the browser.

## Price session rules

The headline price and hero chart always use Hyperliquid `xyz:SPCX` (a trade.xyz HIP-3 perpetual that references one SpaceX Class A share, cash-settled in USDC). It is price exposure, not share ownership, and it can trade slightly above or below the stock because of funding.

Two official Nasdaq / Yahoo tiles sit under the live perp, from a server-side snapshot:

- **Regular close** — the last completed U.S. regular session (9:30 a.m.–4:00 p.m. ET), with its % change and the close time in CET or CEST (for example `10 Nov 2026, 22:00 CET`).
- **After hours** — the after-hours session of the current U.S. day (4:00–8:00 p.m. ET) if that session has data; otherwise the latest completed after-hours session. Change is versus that session’s regular close, in $ and %.

## Licence and fonts

Site code may be reused. Company names and marks remain their owners’. Barlow is licensed under the SIL Open Font License.
