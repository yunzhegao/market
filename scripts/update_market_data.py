#!/usr/bin/env python3
"""Refresh GitHub Pages' public end-of-day snapshot with independent sources."""

import argparse
import csv
import json
import math
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "dist" / "assets" / "market-data.json"
ET = ZoneInfo("America/New_York")
TICKERS = {
    "SPYM": "SPYM", "SPY": "SPY", "RSP": "RSP", "IWM": "IWM", "QQQ": "QQQ",
    "HYG": "HYG", "JNK": "JNK", "KRE": "KRE", "VIX": "^VIX",
    "DXY": "DX-Y.NYB", "GOLD": "GC=F", "WTI": "CL=F",
}
FUTURES = {"GOLD", "WTI"}
FRED = {"OAS": "BAMLH0A0HYM2", "DGS10": "DGS10"}


def request(url, **headers):
    request_headers = {
        "User-Agent": "Mozilla/5.0 (compatible; USMarketMonitor/1.0)",
        "Accept": "*/*",
        **headers,
    }
    with urlopen(Request(url, headers=request_headers), timeout=12) as response:
        return response.read().decode("utf-8-sig")


def number(raw):
    try:
        value = float(raw)
        return round(value, 6) if math.isfinite(value) else None
    except (ValueError, TypeError):
        return None


def date_key(raw):
    return date.fromisoformat(raw).isoformat()


def csv_rows(content, header, parse):
    reader = csv.DictReader(content.splitlines())
    if not reader.fieldnames or header not in reader.fieldnames:
        raise ValueError("unexpected CSV layout")
    rows = []
    for fields in reader:
        try:
            row = parse(fields)
        except (TypeError, ValueError):
            continue
        if row is not None:
            rows.append(row)
    return rows


def final_daily_date(day, now):
    if day > now.date():
        return False
    if day < now.date():
        return True
    return now.time() >= time(16, 20)


def trading_date(stamp, key, zone):
    local = datetime.fromtimestamp(stamp, tz=zone)
    day = local.date()
    if key in FUTURES and local.hour >= 17:
        day += timedelta(days=1)
    return day


def yahoo_once(key, now, endpoint):
    ticker = quote(TICKERS[key], safe="")
    params = urlencode({"interval": "1d", "range": "3mo", "includePrePost": "false"})
    payload = json.loads(request(f"https://{endpoint}/v8/finance/chart/{ticker}?{params}"))
    result = payload["chart"]["result"][0]
    metadata = result["meta"]
    zone = ZoneInfo(metadata["exchangeTimezoneName"])
    bars = result["indicators"]["quote"][0]
    rows = []
    for i, timestamp in enumerate(result["timestamp"]):
        day = trading_date(timestamp, key, zone)
        if not final_daily_date(day, now):
            continue
        values = [number(bars[field][i]) for field in ("close", "open", "high", "low")]
        if values[0] is None:
            continue
        if any(value is None for value in values[1:]):
            rows.append([day.isoformat(), values[0]])
        else:
            rows.append([day.isoformat(), *values])
    return rows


def stooq(key, now):
    after = (now.date() - timedelta(days=100)).strftime("%Y%m%d")
    query = urlencode({"s": key.lower() + ".us", "i": "d", "d1": after})
    content = request("https://stooq.com/q/d/l/?" + query)

    def parse(fields):
        day = date.fromisoformat(fields["Date"])
        close = number(fields.get("Close"))
        return [day.isoformat(), close] if close is not None and final_daily_date(day, now) else None

    # This fallback can use dividend-adjusted values. Preserve the price basis
    # of the SPYM chart and the matched SPY/RSP market breadth series.
    return csv_rows(content, "Date", parse)


def yahoo(key, now):
    for host in ("query1.finance.yahoo.com", "query2.finance.yahoo.com"):
        try:
            rows = yahoo_once(key, now, host)
            if rows:
                return "yahoo", rows, None
        except (OSError, ValueError, KeyError, IndexError, TypeError):
            continue
    if key in {"IWM", "HYG", "JNK", "KRE"}:
        rows = stooq(key, now)
        if rows:
            return "stooq", rows, None
    raise ValueError("Yahoo chart unavailable")


def vix(now):
    try:
        content = request("https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv")
        def parse(fields):
            day = datetime.strptime(fields["DATE"], "%m/%d/%Y").date()
            value = number(fields.get("CLOSE"))
            return [day.isoformat(), value] if value is not None and final_daily_date(day, now) else None
        rows = csv_rows(content, "DATE", parse)
        if rows:
            return "cboe", rows, None
    except (OSError, ValueError):
        pass
    return yahoo("VIX", now)


def fred(key, now):
    code = FRED[key]
    after = now.date() - timedelta(days=100)
    params = urlencode({"id": code, "cosd": after.isoformat()})
    content = request("https://fred.stlouisfed.org/graph/fredgraph.csv?" + params)

    def parse(fields):
        value = number(fields.get(code))
        if value is None:
            return None
        day = date_key(fields.get("observation_date") or fields.get("DATE"))
        return [day, value] if day <= now.date().isoformat() else None

    return "fred", csv_rows(content, code, parse), None


def cnn(now):
    payload = json.loads(request(
        "https://production.dataviz.cnn.io/index/fearandgreed/graphdata",
        Referer="https://www.cnn.com/markets/fear-and-greed",
        Accept="application/json",
    ))
    reading = payload["fear_and_greed"]
    value = number(reading["score"])
    timestamp = datetime.fromisoformat(reading["timestamp"].replace("Z", "+00:00"))
    if value is None or not 0 <= value <= 100 or timestamp > now + timedelta(minutes=5):
        raise ValueError("invalid CNN reading")
    day = timestamp.astimezone(ET).date().isoformat()
    rows = []
    for point in payload.get("fear_and_greed_historical", {}).get("data", []):
        score = number(point.get("y"))
        stamp = number(point.get("x"))
        if score is None or stamp is None or not 0 <= score <= 100:
            continue
        observed = datetime.fromtimestamp(stamp / 1000, timezone.utc).date().isoformat()
        if observed <= day:
            rows.append([observed, score])
    rows.append([day, value])
    return "cnn", rows, timestamp.astimezone(timezone.utc).isoformat()


def pull(key, now):
    if key == "VIX":
        return vix(now)
    if key in FRED:
        return fred(key, now)
    if key == "FEAR":
        return cnn(now)
    return yahoo(key, now)


def merge(existing, results, now):
    if results is None:
        return {**existing, "status": "retained"}
    source, rows, timestamp = results
    if not rows:
        return {**existing, "status": "retained"}
    previous = existing.get("rows", [])
    newest = max(row[0] for row in rows)
    if previous and newest < previous[-1][0]:
        return {**existing, "status": "retained"}
    if timestamp and existing.get("timestamp"):
        if datetime.fromisoformat(timestamp.replace("Z", "+00:00")) < datetime.fromisoformat(existing["timestamp"].replace("Z", "+00:00")):
            return {**existing, "status": "retained"}
    matching_basis = source == existing.get("source") or source == "yahoo" and existing.get("source") == "investing"
    combined = {row[0]: row for row in previous} if matching_basis else {}
    combined.update({row[0]: row for row in rows})
    updated = {
        "source": source,
        "status": "fetched",
        "rows": [combined[day] for day in sorted(combined)[-90:]],
        "fetchedAt": now.astimezone(timezone.utc).isoformat(),
    }
    if timestamp:
        updated["timestamp"] = timestamp
    return updated


def write_snapshot(data):
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    for path, text in ((DATA, payload + "\n"), (DATA.with_name("initial-data.js"), "window.MARKET_DATA = " + payload + ";\n")):
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(text, encoding="utf-8")
        temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check-only", action="store_true", help="check sources without writing the snapshot")
    args = parser.parse_args()
    now = datetime.now(ET).replace(microsecond=0)
    data = json.loads(DATA.read_text(encoding="utf-8"))
    errors = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        pending = {pool.submit(pull, key, now): key for key in data["series"]}
        for future in as_completed(pending):
            key = pending[future]
            try:
                results = future.result()
            except (OSError, ValueError, KeyError, IndexError, TypeError) as exc:
                print(f"{key}: {type(exc).__name__}: {exc}")
                results = None
            data["series"][key] = merge(data["series"][key], results, now)
            status = data["series"][key]["status"]
            if status == "retained":
                errors.append(key)
            print(f"{key}: {status} {data['series'][key]['rows'][-1][0] if data['series'][key]['rows'] else '—'}")
    data["checkedAt"] = now.astimezone(timezone.utc).isoformat()
    if not args.check_only:
        write_snapshot(data)
    if len(errors) == len(data["series"]):
        raise SystemExit("No source supplied a usable observation.")
    if errors:
        print("Retained: " + ", ".join(sorted(errors)))


if __name__ == "__main__":
    main()
