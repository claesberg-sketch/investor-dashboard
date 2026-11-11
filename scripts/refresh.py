#!/usr/bin/env python3
"""Refresh server-side JSON for the investor dashboard.

Intended to run in GitHub Actions every 20 minutes (and on push), and locally.
Fetches Yahoo Finance chart data (incl. pre/post), Hyperliquid xyz:SPCX snapshot,
Google News RSS, and SEC company submissions. Merges with static press releases.

Does not refresh X posts (Actions cannot call the X connector). See README.
"""
from __future__ import annotations

import html
import json
import re
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "spacex"
USER_AGENT = "ClaesBerg-InvestorDashboard/1.0 (contact: claesberg-sketch@users.noreply.github.com)"
YAHOO_UA = "Mozilla/5.0 (compatible; InvestorDashboard/1.0; +https://github.com/claesberg-sketch/investor-dashboard)"


INDEX = ROOT / "index.html"
ASSET_TAG_RE = re.compile(
    r'((?:href|src)=")((?:css|js)/[^"?]+)(?:\?v=[^"]*)?(")',
    re.I,
)


def asset_version() -> str:
    sha = ""
    try:
        sha = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=ROOT,
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except Exception:
        sha = ""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    return f"{sha}-{stamp}" if sha else stamp


def bump_asset_version(version: str | None = None) -> str:
    """Rewrite ?v= on local JS/CSS tags in index.html so Pages clients fetch fresh assets."""
    version = version or asset_version()
    html = INDEX.read_text()
    new, n = ASSET_TAG_RE.subn(rf"\1\2?v={version}\3", html)
    if n == 0:
        raise RuntimeError("no local js/css tags found in index.html")
    if new != html:
        INDEX.write_text(new)
    print(f"bumped {n} asset tags in index.html to v={version}")
    return version




def utc_now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def stockholm_now():
    # Actions runners are UTC; we only store ISO instants and label in the UI.
    return utc_now()


def fetch(url: str, ua: str | None = None, timeout: int = 25, method: str = "GET", body: bytes | None = None, headers: dict | None = None):
    h = {"User-Agent": ua or USER_AGENT, "Accept": "*/*"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, data=body, headers=h, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.status, res.read(), dict(res.headers)


def fetch_json(url: str, **kw):
    status, raw, headers = fetch(url, **kw)
    return status, json.loads(raw.decode("utf-8", "replace")), headers


def yahoo_chart(symbol: str, interval: str, range_: str, include_prepost: bool = True):
    q = urllib.parse.urlencode(
        {
            "interval": interval,
            "range": range_,
            "includePrePost": "true" if include_prepost else "false",
        }
    )
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?{q}"
    try:
        status, data, _ = fetch_json(url, ua=YAHOO_UA)
    except Exception as e:
        # fallback query2
        url2 = f"https://query2.finance.yahoo.com/v8/finance/chart/{symbol}?{q}"
        try:
            status, data, _ = fetch_json(url2, ua=YAHOO_UA)
        except Exception as e2:
            return {"ok": False, "error": f"{e} / {e2}"}
    err = (data.get("chart") or {}).get("error")
    result = ((data.get("chart") or {}).get("result") or [None])[0]
    if not result:
        return {"ok": False, "error": err or "no result"}
    meta = result.get("meta") or {}
    ts = result.get("timestamp") or []
    ind = (result.get("indicators") or {}).get("quote") or [{}]
    q0 = ind[0] if ind else {}
    closes = q0.get("close") or []
    volumes = q0.get("volume") or []
    series = []
    for i, t in enumerate(ts):
        c = closes[i] if i < len(closes) else None
        if c is None:
            continue
        series.append({"t": t, "c": c, "v": volumes[i] if i < len(volumes) else None})
    out = {
        "ok": True,
        "symbol": meta.get("symbol"),
        "currency": meta.get("currency"),
        "exchangeName": meta.get("exchangeName"),
        "instrumentType": meta.get("instrumentType"),
        "shortName": meta.get("shortName"),
        "longName": meta.get("longName"),
        "regularMarketPrice": meta.get("regularMarketPrice"),
        "regularMarketTime": meta.get("regularMarketTime"),
        "regularMarketChangePercent": meta.get("regularMarketChangePercent"),
        "regularMarketDayHigh": meta.get("regularMarketDayHigh"),
        "regularMarketDayLow": meta.get("regularMarketDayLow"),
        "regularMarketVolume": meta.get("regularMarketVolume"),
        "previousClose": meta.get("previousClose") or meta.get("chartPreviousClose"),
        "chartPreviousClose": meta.get("chartPreviousClose"),
        "fiftyTwoWeekHigh": meta.get("fiftyTwoWeekHigh"),
        "fiftyTwoWeekLow": meta.get("fiftyTwoWeekLow"),
        "fulldayPrice": meta.get("fulldayPrice"),
        "fulldayChange": meta.get("fulldayChange"),
        "fulldayChangePercent": meta.get("fulldayChangePercent"),
        "hasPrePostMarketData": meta.get("hasPrePostMarketData"),
        "timezone": meta.get("timezone"),
        "gmtoffset": meta.get("gmtoffset"),
        "exchangeTimezoneName": meta.get("exchangeTimezoneName"),
        "currentTradingPeriod": meta.get("currentTradingPeriod"),
        "firstTradeDate": meta.get("firstTradeDate"),
        "series": series,
        "gmtoffset": meta.get("gmtoffset"),
        "interval": interval,
        "range": range_,
    }
    return out


def parse_pre_post(day_chart: dict, regular_market_time=None):
    """Infer last pre-market and after-hours prints from 1m includePrePost series.

    Yahoo's currentTradingPeriod is *today's* session, which is useless overnight
    when we need yesterday's after-hours close. We instead split around the last
    regular-session close (4:00 p.m. ET) and the 4:00 a.m. / 9:30 a.m. ET bounds
    of that same U.S. equity day (EST/EDT via gmtoffset when present, else UTC-5).
    """
    series = day_chart.get("series") or []
    if not series:
        return {"preMarket": None, "postMarket": None}
    offset = day_chart.get("gmtoffset")
    if offset is None:
        offset = -5 * 3600
    rmt = regular_market_time or day_chart.get("regularMarketTime")
    if not rmt:
        # last weekday 16:00 local
        rmt = series[-1]["t"]
    # Regular session of that close: 09:30–16:00 ET. Pre: 04:00–09:30. Post: 16:00–20:00.
    # Compute midnight ET of that trading day, then add seconds.
    # rmt should be 16:00 ET.
    close_et_midnight = rmt - (16 * 3600)  # if rmt is exactly 16:00 ET
    # Be robust: take the calendar day in the exchange zone
    close_local = rmt + offset  # unix-like shifted so gmtime is ET
    import time as _time
    lt = _time.gmtime(close_local)
    # midnight ET as unix
    midnight_et = rmt + offset - (lt.tm_hour * 3600 + lt.tm_min * 60 + lt.tm_sec)
    midnight = midnight_et - offset
    pre_start, pre_end = midnight + 4 * 3600, midnight + int(9.5 * 3600)
    post_start, post_end = midnight + 16 * 3600, midnight + 20 * 3600

    def last_in(start, end):
        pts = [p for p in series if start <= p["t"] < end]
        return pts[-1] if pts else None

    pre_px = last_in(pre_start, pre_end)
    # Prefer the current U.S. day's after-hours if that session has prints;
    # otherwise keep the latest completed after-hours session in the series.
    post_px = last_in(post_start, post_end)
    if not post_px:
        def is_after_hours(p):
            local = p["t"] + offset
            lt = _time.gmtime(local)
            dow = lt.tm_wday  # Mon=0
            if dow >= 5:
                return False
            mins = lt.tm_hour * 60 + lt.tm_min
            return 16 * 60 <= mins < 20 * 60

        after_pts = [p for p in series if is_after_hours(p)]
        post_px = after_pts[-1] if after_pts else None
    return {
        "preMarket": None if not pre_px else {"price": pre_px["c"], "time": pre_px["t"]},
        "postMarket": None if not post_px else {"price": post_px["c"], "time": post_px["t"]},
        "sessionBoundsUnix": {
            "preStart": pre_start, "preEnd": pre_end,
            "postStart": post_start, "postEnd": post_end,
            "regularClose": rmt, "offset": offset,
        },
    }


def hyperliquid_spcx():
    body = json.dumps({"type": "metaAndAssetCtxs", "dex": "xyz"}).encode()
    try:
        status, data, headers = fetch_json(
            "https://api.hyperliquid.xyz/info",
            method="POST",
            body=body,
            headers={"Content-Type": "application/json"},
        )
    except Exception as e:
        return {"ok": False, "error": str(e)}
    if not isinstance(data, list) or len(data) < 2:
        return {"ok": False, "error": "unexpected HL payload"}
    meta, ctxs = data[0], data[1]
    universe = meta.get("universe") or []
    idx = next((i for i, u in enumerate(universe) if (u.get("name") or "") == "xyz:SPCX"), None)
    if idx is None:
        return {"ok": False, "error": "xyz:SPCX not in universe"}
    ctx = ctxs[idx] if idx < len(ctxs) else {}
    return {
        "ok": True,
        "symbol": "xyz:SPCX",
        "dex": "xyz",
        "midPx": _num(ctx.get("midPx")),
        "markPx": _num(ctx.get("markPx")),
        "oraclePx": _num(ctx.get("oraclePx")),
        "prevDayPx": _num(ctx.get("prevDayPx")),
        "funding": ctx.get("funding"),
        "dayNtlVlm": _num(ctx.get("dayNtlVlm")),
        "premium": ctx.get("premium"),
        "cors": "access-control-allow-origin: * (browser fetch works)",
    }


def _num(x):
    if x is None or x == "":
        return None
    try:
        return float(x)
    except (TypeError, ValueError):
        return x


def google_news():
    url = (
        "https://news.google.com/rss/search?"
        + urllib.parse.urlencode(
            {"q": "SpaceX OR Starlink OR SPCX when:14d", "hl": "en-US", "gl": "US", "ceid": "US:en"}
        )
    )
    try:
        status, raw, _ = fetch(url, ua=YAHOO_UA)
        root = ET.fromstring(raw)
    except Exception as e:
        return {"ok": False, "error": str(e), "items": []}
    items = []
    for it in root.findall(".//item")[:40]:
        title = (it.findtext("title") or "").strip()
        link = (it.findtext("link") or "").strip()
        pub = it.findtext("pubDate")
        source = it.findtext("source") or ""
        iso = None
        if pub:
            try:
                iso = parsedate_to_datetime(pub).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            except Exception:
                iso = pub
        raw_desc = it.findtext("description") or ""
        snippet = re.sub(r"<[^>]+>", " ", html.unescape(raw_desc))
        snippet = re.sub(r"\s+", " ", snippet).strip()
        if snippet == title or snippet.startswith(title + " "):
            # RSS descriptions are often just "Title  Source", not a real lede.
            snippet = ""
        items.append(
            {
                "id": "media-" + str(len(items) + 1),
                "type": "media",
                "date": (iso or "")[:10],
                "datetime": iso,
                "title": title,
                "source": source or "Google News",
                "url": link,
                "snippet": snippet,
                "topics": _topics(title),
            }
        )
    return {"ok": True, "items": items}


def _topics(title: str):
    t = title.lower()
    tags = []
    mapping = [
        ("Starship", ["starship"]),
        ("Starlink", ["starlink"]),
        ("AI compute", ["compute", "colossus", "data center", "gigawatt", " gw", "super intelligence", "starmind"]),
        ("Grok", ["grok"]),
        ("Cursor", ["cursor"]),
        ("Earnings", ["earnings", "revenue", "guidance"]),
        ("Launch", ["launch", "falcon", "ussf"]),
        ("Lock-up", ["lock-up", "lockup", "unlock"]),
        ("Direct-to-cell", ["direct-to-cell", "direct to cell", "starlink mobile", "qualcomm"]),
        ("IPO", ["ipo"]),
    ]
    for label, keys in mapping:
        if any(k in t for k in keys):
            tags.append(label)
    return tags


def _acceptance_to_utc(val):
    """Convert an EDGAR acceptance datetime to UTC ISO.

    submissions JSON usually gives ISO with an Eastern offset. Compact
    ACCEPTANCE-DATETIME values (YYYYMMDDHHMMSS) are Eastern local time
    with no zone and are converted with America/New_York (EDT/EST).
    """
    if not val:
        return None
    s = str(val).strip()
    try:
        if s.isdigit() and len(s) >= 14:
            y, m, d = int(s[0:4]), int(s[4:6]), int(s[6:8])
            H, M, S = int(s[8:10]), int(s[10:12]), int(s[12:14])
            local = datetime(y, m, d, H, M, S, tzinfo=ZoneInfo("America/New_York"))
            return local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        iso = s.replace("Z", "+00:00")
        dt = datetime.fromisoformat(iso)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=ZoneInfo("America/New_York"))
        return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        return None


def _feed_sort_key(it):
    dt = it.get("datetime") or ""
    if dt:
        return dt
    d = it.get("date") or ""
    # Date-only items sort as midday Europe/Stockholm so they do not
    # leap ahead of timed items on the same calendar day. Display still
    # shows "time n/a" when no clock time is known.
    if len(d) == 10:
        return d + "T12:00:00+01:00"
    return d


def sec_filings():
    url = "https://data.sec.gov/submissions/CIK0001181412.json"
    try:
        status, data, _ = fetch_json(url)
    except Exception as e:
        return {"ok": False, "error": str(e), "items": []}
    rec = (data.get("filings") or {}).get("recent") or {}
    forms = rec.get("form") or []
    dates = rec.get("filingDate") or []
    acc = rec.get("accessionNumber") or []
    prim = rec.get("primaryDocument") or []
    desc = rec.get("primaryDocDescription") or []
    accepted = rec.get("acceptanceDateTime") or []
    items = []
    for i, form in enumerate(forms[:25]):
        accession = acc[i].replace("-", "") if i < len(acc) else ""
        doc = prim[i] if i < len(prim) else ""
        href = (
            f"https://www.sec.gov/Archives/edgar/data/1181412/{accession}/{doc}"
            if accession and doc
            else f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001181412"
        )
        iso = _acceptance_to_utc(accepted[i] if i < len(accepted) else None)
        filing_date = dates[i] if i < len(dates) else ""
        items.append(
            {
                "id": f"filing-{acc[i] if i < len(acc) else i}",
                "type": "filing",
                "date": (iso[:10] if iso else filing_date),
                "datetime": iso,
                "title": f"{form} — {desc[i] if i < len(desc) and desc[i] else form}",
                "source": "SEC EDGAR",
                "form": form,
                "url": href,
                "topics": ["Filings"],
                **({"timeSource": "SEC submissions acceptanceDateTime"} if iso else {}),
            }
        )
    return {
        "ok": True,
        "name": data.get("name"),
        "tickers": data.get("tickers"),
        "items": items,
    }



def first_sentences(text: str, n: int = 2) -> str:
    """Keep at most n sentences of a source snippet for a fallback blurb."""
    text = re.sub(r"<[^>]+>", " ", html.unescape(text or ""))
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return ""
    parts = re.split(r"(?<=[.!?])\s+", text)
    out = " ".join(p for p in parts[:n] if p).strip()
    return out[:600]


def _norm_url(u: str) -> str:
    return (u or "").split("?")[0].rstrip("/")


def load_summary_store() -> dict:
    path = DATA / "summaries.json"
    if not path.exists():
        return {"byId": {}, "byUrl": {}, "byTitle": {}}
    try:
        return json.loads(path.read_text())
    except Exception:
        return {"byId": {}, "byUrl": {}, "byTitle": {}}


def lookup_prior_items():
    """Previously saved items, used so a refresh does not drop written summaries."""
    prior = []
    for name in ("news.json", "news-static.json", "filings-static.json"):
        path = DATA / name
        if path.exists():
            try:
                prior.extend(json.loads(path.read_text()).get("items") or [])
            except Exception:
                pass
    return prior


def attach_summaries(items: list[dict], store: dict | None = None, prior: list | None = None):
    """Copy a hand-written summary onto each item, or fall back to a source snippet.

    Full summaries are written by the dashboard author (an assistant reading the
    source) at refresh time. GitHub Actions cannot generate them. Existing
    summaries are kept by id, URL, or title. New items without one get a
    truncated source snippet when the feed provided one, and are listed so
    they can be summarised properly on the next manual refresh.
    """
    store = store or load_summary_store()
    prior = prior if prior is not None else lookup_prior_items()
    prior_by_id = {it.get("id"): it for it in prior if it.get("id")}
    prior_by_url = {_norm_url(it.get("url")): it for it in prior if it.get("url")}
    prior_by_title = {(it.get("title") or "").strip(): it for it in prior if it.get("title")}
    missing = []
    for it in items:
        existing = (it.get("summary") or "").strip()
        if existing and not it.get("summaryFallback"):
            continue
        # media-N ids are assigned by RSS order and are not stable, so they
        # must not be used as lookup keys (that would attach the wrong summary).
        def _stable_id(i):
            k = i or ""
            if k.startswith("media-"):
                return ""
            return k

        found = None
        for bucket, key in (
            (store.get("byUrl") or {}, _norm_url(it.get("url") or "")),
            (store.get("byTitle") or {}, (it.get("title") or "").strip()),
            (store.get("byId") or {}, _stable_id(it.get("id"))),
        ):
            if key and bucket.get(key):
                found = bucket[key]
                break
        if not found:
            prev = (
                prior_by_url.get(_norm_url(it.get("url") or ""))
                or prior_by_title.get((it.get("title") or "").strip())
                or (prior_by_id.get(_stable_id(it.get("id"))) if _stable_id(it.get("id")) else None)
            )
            if prev and (prev.get("summary") or "").strip() and not prev.get("summaryFallback"):
                found = prev["summary"]
        if found:
            it["summary"] = found
            it.pop("summaryFallback", None)
            continue
        fb = first_sentences(it.get("snippet") or it.get("description") or "")
        if fb:
            it["summary"] = fb
            it["summaryFallback"] = True
        else:
            it.pop("summary", None)
            it.pop("summaryFallback", None)
            missing.append({"id": it.get("id"), "type": it.get("type"), "title": it.get("title"), "url": it.get("url")})
    return missing


def attach_x_summaries(store: dict | None = None):
    """Re-apply stored summaries onto x-posts.json without changing the posts themselves."""
    path = DATA / "x-posts.json"
    if not path.exists():
        return []
    data = json.loads(path.read_text())
    posts = data.get("posts") or []
    # shape as feed items for reuse
    shaped = []
    for p in posts:
        shaped.append({
            "id": p.get("id"),
            "title": p.get("text"),
            "url": p.get("url"),
            "summary": p.get("summary"),
            "summaryFallback": p.get("summaryFallback"),
        })
    missing = attach_summaries(shaped, store=store, prior=[])
    for p, s in zip(posts, shaped):
        if s.get("summary"):
            p["summary"] = s["summary"]
            if s.get("summaryFallback"):
                p["summaryFallback"] = True
            else:
                p.pop("summaryFallback", None)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    print(f"updated summaries on {path.relative_to(ROOT)} ({len(posts)} posts, {len(missing)} still missing)")
    return missing



def build_quote():
    intra = yahoo_chart("SPCX", "1m", "5d", True)
    daily = yahoo_chart("SPCX", "1d", "6mo", False)
    hl = hyperliquid_spcx()
    prepost = {}
    if intra.get("ok"):
        prepost = parse_pre_post(intra, intra.get("regularMarketTime"))
    company = json.loads((DATA / "company.json").read_text())
    shares = company.get("sharesOutstanding")
    cash = company.get("cashAndStInvestmentsUsd")
    debt = company.get("totalDebtUsd")
    px = intra.get("regularMarketPrice") if intra.get("ok") else None
    mkt = shares * px if shares and px else None
    ev = None
    if mkt is not None and cash is not None and debt is not None:
        ev = mkt - cash + debt
    # compact intraday series for the page (last ~2 sessions, already 5d)
    intra_series = intra.get("series") if intra.get("ok") else []
    daily_series = daily.get("series") if daily.get("ok") else []
    quote = {
        "updated": utc_now(),
        "symbol": "SPCX",
        "yahoo": {k: v for k, v in intra.items() if k != "series"} if intra.get("ok") else intra,
        "prePostFromChart": prepost,
        "intraday": intra_series,
        "daily": daily_series,
        "hyperliquid": hl,
        "fundamentals": {
            "sharesOutstanding": shares,
            "sharesAsOf": company.get("sharesAsOf"),
            "sharesSource": company.get("sharesSource"),
            "marketCapAtRegular": mkt,
            "cashAndStInvestmentsUsd": cash,
            "totalDebtUsd": debt,
            "enterpriseValueAtRegular": ev,
            "balanceSheetAsOf": company.get("balanceSheetAsOf"),
        },
        "sources": {
            "yahoo": "Yahoo Finance chart API v8 (query1/query2), includePrePost=true — fetched server-side because Yahoo blocks browser CORS.",
            "hyperliquid": "POST https://api.hyperliquid.xyz/info  type=metaAndAssetCtxs, dex=xyz  — symbol xyz:SPCX. Browser CORS allowed.",
        },
    }
    return quote


def build_news():
    static = json.loads((DATA / "news-static.json").read_text())
    media = google_news()
    filings = sec_filings()
    items = list(static.get("items") or [])
    for it in media.get("items") or []:
        items.append(it)
    static_filings = []
    sf_path = DATA / "filings-static.json"
    if sf_path.exists():
        static_filings = (json.loads(sf_path.read_text()).get("items") or [])
    static_by_id = {it.get("id"): it for it in static_filings if it.get("id")}
    if filings.get("ok"):
        for it in filings.get("items") or []:
            # Keep a researched acceptance time if the live feed omitted one.
            src = static_by_id.get(it.get("id")) or {}
            if not it.get("datetime") and src.get("datetime"):
                it["datetime"] = src["datetime"]
                it["date"] = it.get("date") or src.get("date") or src["datetime"][:10]
                if src.get("timeSource"):
                    it["timeSource"] = src["timeSource"]
            items.append(it)
    else:
        for it in static_filings:
            items.append(it)
    # de-dupe by url or title+date
    seen = set()
    uniq = []
    for it in items:
        key = (it.get("url") or "") + "|" + (it.get("title") or "")
        if key in seen:
            continue
        seen.add(key)
        uniq.append(it)
    uniq.sort(key=_feed_sort_key, reverse=True)
    missing_summaries = attach_summaries(uniq)
    news_out = {
        "updated": utc_now(),
        "feeds": {
            "press": {
                "label": "Company / IR press (static, curated from official releases)",
                "updated": static.get("updated"),
            },
            "media": {
                "label": "Google News RSS (SpaceX OR Starlink OR SPCX, 14 days)",
                "ok": media.get("ok"),
                "error": media.get("error"),
            },
            "filings": {
                "label": "SEC EDGAR submissions CIK 0001181412 (data.sec.gov)",
                "ok": filings.get("ok"),
                "error": filings.get("error"),
            },
            "x": {
                "label": "X posts are in x-posts.json (refreshed separately via the X connector; not fetched here)",
                "file": "data/spacex/x-posts.json",
            },
        },
        "items": uniq,
        "missingSummaries": missing_summaries,
    }
    return news_out


def write(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n")
    tmp.replace(path)
    print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size} bytes)")


def main():
    DATA.mkdir(parents=True, exist_ok=True)
    errors = []
    try:
        quote = build_quote()
        write(DATA / "quote.json", quote)
        if not (quote.get("yahoo") or {}).get("regularMarketPrice") and not quote.get("yahoo", {}).get("ok", True):
            errors.append("yahoo failed")
        if not (quote.get("hyperliquid") or {}).get("ok"):
            errors.append("hyperliquid failed: " + str((quote.get("hyperliquid") or {}).get("error")))
    except Exception as e:
        errors.append(f"quote: {e}")
        print("quote error", e, file=sys.stderr)
    missing_x = []
    try:
        news = build_news()
        write(DATA / "news.json", news)
    except Exception as e:
        errors.append(f"news: {e}")
        print("news error", e, file=sys.stderr)
        news = {}
    try:
        missing_x = attach_x_summaries()
    except Exception as e:
        errors.append(f"x summaries: {e}")
        print("x summary error", e, file=sys.stderr)
    missing = list((news or {}).get("missingSummaries") or []) + list(missing_x or [])
    if missing:
        print(f"items still needing a hand-written summary: {len(missing)}")
    status = {
        "updated": utc_now(),
        "ok": not errors,
        "errors": errors,
        "missingSummaries": missing,
    }
    write(DATA / "refresh-status.json", status)
    try:
        bump_asset_version()
    except Exception as e:
        errors.append(f"asset version: {e}")
        print("asset version error", e, file=sys.stderr)
        status["ok"] = not errors
        status["errors"] = errors
        write(DATA / "refresh-status.json", status)
    if errors:
        print("completed with errors:", errors)
        # still exit 0 so a partial refresh is published
    return 0


def parse_args(argv):
    import argparse
    ap = argparse.ArgumentParser(description="Refresh dashboard JSON and bump asset cache-busting versions.")
    ap.add_argument(
        "--bump-assets",
        action="store_true",
        help="Only rewrite ?v= on local JS/CSS tags in index.html, then exit.",
    )
    return ap.parse_args(argv)


if __name__ == "__main__":
    args = parse_args(sys.argv[1:])
    if args.bump_assets:
        bump_asset_version()
        sys.exit(0)
    sys.exit(main())
