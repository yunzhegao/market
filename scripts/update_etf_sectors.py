#!/usr/bin/env python3
"""Refresh dated sector weights from issuer disclosures."""

import json
from datetime import date
from pathlib import Path
import re
import subprocess

from update_etf_holdings import download, HoldingTable, key, reading_date


SPYM = "https://www.ssga.com/us/en/institutional/etfs/state-street-spdr-portfolio-sp-500-etf-spym"
SCHD = "https://www.schwabassetmanagement.com/products/schd"
QQQM = ("https://www.invesco.com/content/dam/invesco/us/en/product-documents/etf/"
        "fact-sheet/qqqm-invesco-nasdaq-100-etf-fact-sheet.pdf")
OUTPUT = Path(__file__).resolve().parents[1] / "dist/assets/etf-sectors.json"
SECTORS = {
    "Information Technology": "technology", "Technology": "technology", "Financials": "financials",
    "Communication Services": "communication", "Telecommunications": "communication",
    "Health Care": "health", "Consumer Discretionary": "discretionary", "Industrials": "industrial",
    "Consumer Staples": "staples", "Energy": "energy", "Utilities": "utilities",
    "Real Estate": "realestate", "Materials": "materials", "Basic Materials": "materials",
}


def table_weights(content, header, stop):
    document = HoldingTable(content.decode()).text
    text = re.sub(r"\s+", " ", " ".join(document))
    begin = re.search(header, text, re.I)
    if not begin:
        raise ValueError("fund sector heading missing")
    fragment = re.split(stop, text[begin.end():], maxsplit=1, flags=re.I)[0][:3500]
    rows = {}
    for label, sector in SECTORS.items():
        found = re.search(r"\b" + re.escape(label) + r"\b\s+(\d{1,2}(?:\.\d+)?)\s*%", fragment)
        if found:
            rows.setdefault(sector, float(found[1]))
    return reading_date(fragment), rows


def pdf_weights(text):
    stamp = re.search(r"\bAs\s+of\s+([A-Za-z]+\s+\d{1,2},\s+20\d{2})", text)
    heading = re.search(r"\bSector\s+allocation\s*\(%\)", text, re.I)
    if not stamp or not heading:
        raise ValueError("fund fact sheet sector heading or date missing")
    fragment = text[heading.end():heading.end()+2600]
    rows = {}
    # The factsheet places the percentage inside a two-line sector name in some layouts.
    labels = sorted(SECTORS, key=len, reverse=True)
    pattern = re.compile(r"(?im)^\s*[\u25a0\uf06e\u2022]?\s*("
                         + "|".join(r"\s+".join(label.split()) for label in labels)
                         + r")\s+(\d{1,2}\.\d{1,2})\s*%?\s*$")
    normalized = re.sub(r"(?i)Consumer\s+(\d{1,2}\.\d+)\s+(Discretionary|Staples)", r"Consumer \2 \1", fragment)
    sector_keys = {key(label): sector for label, sector in SECTORS.items()}
    for match in pattern.finditer(normalized):
        rows.setdefault(sector_keys[key(match[1])], float(match[2]))
    return reading_date(stamp[1]), rows


def update(output=OUTPUT):
    current = json.loads(output.read_text()) if output.exists() else {}
    extract_pdf = lambda: subprocess.run(["pdftotext", "-raw", "-", "-"], input=download(QQQM),
                                         capture_output=True, check=True, timeout=15).stdout.decode()
    feeds = {
        "SPYM": ("State Street", SPYM, lambda: table_weights(download(SPYM),
                 r"Fund Sector Breakdown\s+as of", r"\bIndex Sector Breakdown\b|\bDownload\b")),
        "SCHD": ("Schwab", SCHD, lambda: table_weights(download(SCHD),
                 r"\bSectors\s*(?=\d{1,2}/\d{1,2}/20\d{2})", r"\bAsset Allocation\b")),
        "QQQM": ("Invesco", QQQM, lambda: pdf_weights(extract_pdf())),
    }
    for ticker, (source, url, read) in feeds.items():
        try:
            stamp, rows = read()
            if not stamp or stamp > date.today().isoformat() or len(rows)<7 or not 97<=sum(rows.values())<=101:
                raise ValueError("incomplete sector disclosure")
            if stamp >= current.get(ticker, {}).get("date", ""):
                current[ticker] = {"date": stamp, "source": source, "url": url, "rows": rows}
            print(f"{ticker}: sector weights {stamp}")
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            print(f"{ticker}: retaining existing sector weights ({error})")
    temporary = output.with_suffix(".tmp")
    temporary.write_text(json.dumps(current, ensure_ascii=False, separators=(",", ":"))+"\n")
    temporary.replace(output)


if __name__ == "__main__":
    update()
