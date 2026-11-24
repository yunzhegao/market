#!/usr/bin/env python3
"""Update public ETF holdings snapshots for the portfolio look-through."""

import argparse
from datetime import date, datetime, timedelta
from html.parser import HTMLParser
from io import BytesIO
import json
from pathlib import Path
import re
from urllib.request import Request, urlopen
from xml.etree import ElementTree as ET
from zipfile import ZipFile


SPDR = "https://www.ssga.com/library-content/products/fund-data/etfs/us/holdings-daily-us-en-spym.xlsx"
SCHWAB = "https://www.schwabassetmanagement.com/allholdings/schd"
INVESCO = "https://dng-api.invesco.com/cache/v1/accounts/en_US/shareclasses/46138G649/holdings/fund"
OUTPUT = Path(__file__).resolve().parents[1] / "dist/assets/etf-holdings.json"
XML = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
DATE_TEXT = re.compile(r"\b(?:20\d{2}-\d{2}-\d{2}|\d{1,2}/\d{1,2}/(?:20\d{2}|\d{2})|[A-Za-z]{3,9}\s+\d{1,2},?\s+20\d{2}|\d{1,2}-[A-Za-z]{3}-20\d{2})(?!\d)")


def download(url):
    request = Request(url, headers={"User-Agent": "Market Observation holdings updater (+https://yunzhegao.github.io/market/)"})
    with urlopen(request, timeout=18) as response:
        content = response.read(4_000_001)
    if len(content) > 4_000_000:
        raise ValueError("holdings disclosure unexpectedly large")
    return content


def reading_date(value):
    match = DATE_TEXT.search(str(value).strip())
    if match:
        text = match[0].replace(",", "")
        for pattern in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%b %d %Y", "%B %d %Y", "%d-%b-%Y"):
            try:
                return datetime.strptime(text, pattern).date().isoformat()
            except ValueError:
                continue
    elif re.fullmatch(r"(?:4|5)\d{4}(?:\.0+)?", str(value)):
        return (date(1899, 12, 30) + timedelta(days=int(float(value)))).isoformat()
    return None


def key(text):
    return re.sub(r"[^a-z0-9]", "", str(text).lower())


def member_symbol(text):
    symbol = re.sub(r" US(?: EQUITY)?$", "", str(text or "").strip().upper())
    symbol = re.sub(r"[./ ]([A-Z])$", r"-\1", symbol)
    if symbol not in {"USD", "CASH", "NAN", "NONE", "NA"} and re.fullmatch(r"[A-Z][A-Z0-9-]{0,14}", symbol):
        return symbol
    return None


def snapshot(stamp, entries, minimum):
    positions = {}
    for raw_symbol, raw_weight in entries:
        symbol = member_symbol(raw_symbol)
        try:
            weight = float(str(raw_weight).strip().replace(",", "").removesuffix("%"))
        except ValueError:
            continue
        if symbol and 0 < weight <= 100:
            positions[symbol] = positions.get(symbol, 0) + weight
    total = sum(positions.values())
    scale = 100 if .9 <= total <= 1.05 else 1
    if not stamp or not "2000-01-01" <= stamp <= date.today().isoformat():
        raise ValueError("missing disclosure date")
    if len(positions) < minimum or not 90 <= total*scale <= 101:
        raise ValueError("holdings list may be incomplete")
    scale = min(scale, 100/total)
    return {"date": stamp, "rows": [[symbol, round(weight*scale, 8)] for symbol, weight in sorted(positions.items())]}


def xlsx_rows(content):
    with ZipFile(BytesIO(content)) as book:
        def xml(name):
            if book.getinfo(name).file_size > 8_000_000:
                raise ValueError("XLSX entry unexpectedly large")
            return ET.fromstring(book.read(name))

        def cell_text(node):
            return "".join(item.text or "" for item in node.iter(XML + "t"))

        shared = [cell_text(item) for item in xml("xl/sharedStrings.xml")] if "xl/sharedStrings.xml" in book.namelist() else []
        for row in xml("xl/worksheets/sheet1.xml").iter(XML + "row"):
            fields = {}
            for cell in row.findall(XML + "c"):
                column = re.match(r"[A-Z]+", cell.get("r", ""))
                if not column:
                    continue
                content = cell.findtext(XML + "v", "")
                if cell.get("t") == "s":
                    content = shared[int(content)]
                elif cell.get("t") == "inlineStr":
                    content = cell_text(cell)
                fields[column[0]] = content
            yield fields


def read_spdr(content):
    rows = list(xlsx_rows(content))
    for index, row in enumerate(rows):
        columns = {key(value): name for name, value in row.items()}
        ticker = columns.get("ticker") or columns.get("symbol")
        weight = next((name for label, name in columns.items() if "weight" in label or label == "percentofassets"), None)
        if ticker and weight:
            stamps = [reading_date(value) for row in rows[:index] for value in row.values()]
            return snapshot(next((stamp for stamp in stamps if stamp), None),
                            [(row.get(ticker), row.get(weight)) for row in rows[index+1:]], 480)
    raise ValueError("XLSX holdings columns unavailable")


class HoldingTable(HTMLParser):
    def __init__(self, content):
        super().__init__()
        self.rows, self.text = [], []
        self.row, self.cell = None, None
        self.feed(content)

    def handle_starttag(self, name, _attrs):
        if name == "tr":
            self.row = []
        if self.row is not None and name in {"td", "th"}:
            self.cell = []

    def handle_endtag(self, name):
        if self.cell is not None and name in {"td", "th"}:
            self.row.append("".join(self.cell).strip())
            self.cell = None
        if name == "tr" and self.row is not None:
            self.rows.append(self.row)
            self.row = None

    def handle_data(self, text):
        self.text.append(text.strip())
        if self.cell is not None:
            self.cell.append(text)


def read_schwab():
    entries, stamp = [], None
    for page in range(5):
        table = HoldingTable(download(SCHWAB + f"?page={page}").decode())
        heading = re.search(r"As of\s+(\d+/\d+/\d+)\s+Displaying\s+(\d+)\s*-\s*(\d+)\s+of\s+(\d+)",
                            " ".join(table.text), re.I)
        if not heading:
            raise ValueError("Schwab holdings date or page count unavailable")
        current = reading_date(heading[1])
        if stamp and stamp != current:
            raise ValueError("Schwab disclosure changed during download")
        stamp = current
        count = len(entries)
        for row in table.rows:
            if len(row) >= 6 and re.fullmatch(r"[A-Z0-9]{9}", row[1]):
                entries.append((row[2], row[4]))
        if len(entries)-count != int(heading[3])-int(heading[2])+1:
            raise ValueError("Schwab holdings page incomplete")
        if int(heading[3]) == int(heading[4]):
            return snapshot(stamp, entries, 90)
    raise ValueError("Schwab holdings page limit exceeded")


def read_invesco(content):
    candidates = []

    def collect(node, stamp=None):
        if isinstance(node, dict):
            fields = {key(label): value for label, value in node.items()}
            stamp = next((stamp_value for label, value in fields.items()
                          if ("date" in label or "asof" in label) and (stamp_value := reading_date(value))), stamp)
            for value in node.values():
                if isinstance(value, (dict, list)):
                    collect(value, stamp)
        elif isinstance(node, list):
            entries, row_dates = [], set()
            for item in node:
                if not isinstance(item, dict):
                    continue
                fields = {key(label): value for label, value in item.items()}
                row_stamp = next((reading_date(fields[label]) for label in ("asofdate", "effectivedate", "holdingdate", "date")
                                  if label in fields), None)
                if row_stamp:
                    row_dates.add(row_stamp)
                for label in ("security", "instrument"):
                    if isinstance(fields.get(label), dict):
                        fields.update({key(name): value for name, value in fields[label].items()})
                symbol = next((fields[label] for label in ("ticker", "tickersymbol", "securityticker", "holdingticker", "symbol") if fields.get(label)), None)
                weight = next((value for label, value in fields.items() if ("weight" in label or label in
                               {"pctofnetassets", "percentofnetassets", "percentofassets", "percentoftotal", "marketvaluepercent", "netassetpercentage", "netassetspercent", "pctnetassets", "marketvaluepct"})
                               and isinstance(value, (int, float, str))), None)
                currency = fields.get("currency") or fields.get("currencycode") or fields.get("localcurrency")
                if symbol and weight is not None and (not currency or currency == "USD"):
                    entries.append((symbol, weight))
                collect(item, stamp)
            if len(entries) >= 90 and len(row_dates) <= 1:
                candidates.append((next(iter(row_dates), stamp), entries))

    collect(json.loads(content))
    for stamp, entries in sorted(candidates, key=lambda item: (item[0] or "", len(item[1])), reverse=True):
        try:
            return snapshot(stamp, entries, 90)
        except ValueError:
            continue
    raise ValueError("Invesco holdings columns or disclosure date unavailable")


def update(output):
    funds = json.loads(output.read_text()).get("funds", {}) if output.exists() else {}
    sources = {
        "SPYM": ("State Street", "https://www.ssga.com/us/en/individual/etfs/state-street-spdr-portfolio-sp-500-etf-spym", lambda: read_spdr(download(SPDR))),
        "SCHD": ("Schwab", SCHWAB, read_schwab),
        "QQQM": ("Invesco", "https://www.invesco.com/us/en/financial-products/etfs/invesco-nasdaq-100-etf.html", lambda: read_invesco(download(INVESCO))),
    }
    for ticker, (source, url, read) in sources.items():
        old = funds.get(ticker, {})
        current = old.get("current")
        try:
            incoming = read()
        except (OSError, ValueError, KeyError, IndexError, ET.ParseError) as error:
            print(f"{ticker}: {error}")
            funds[ticker] = {**old, "source": source, "url": url, "unavailable": True}
            continue
        if current and incoming["date"] < current["date"]:
            continue
        previous = current if current and incoming["date"] > current["date"] else old.get("previous")
        funds[ticker] = {"source": source, "url": url, "current": incoming, "previous": previous}
        print(f"{ticker}: {incoming['date']} ({len(incoming['rows'])} securities)")
    temporary = output.with_suffix(".tmp")
    temporary.write_text(json.dumps({"funds": funds}, ensure_ascii=False, separators=(",", ":")) + "\n")
    temporary.replace(output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=OUTPUT)
    update(parser.parse_args().out)
