import "../dist/assets/adr-reference.js";

const stocks = new Set(["SPYM", "SPY", "RSP", "IWM", "QQQ", "HYG", "JNK", "KRE"]);
const market = {
  SPYM: "SPYM", VIX: "^VIX", SPY: "SPY", RSP: "RSP", IWM: "IWM", QQQ: "QQQ",
  HYG: "HYG", JNK: "JNK", KRE: "KRE", DXY: "DX-Y.NYB", GOLD: "GC=F", WTI: "CL=F",
};
const fred = {OAS: "BAMLH0A0HYM2", DGS2: "DGS2", DGS5: "DGS5", DGS10: "DGS10", DGS30: "DGS30"};
const eastDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});
const eastParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "numeric", day: "numeric",
  hourCycle: "h23", hour: "numeric", minute: "numeric", second: "numeric",
});
const finite = Number.isFinite;
const price = value => typeof value === "string" ? Number(value.replace(/[^\d.+-]/g, "")) : value;
const last = rows => rows.at(-1);
const browserAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36";

async function upstream(url, type = "json", headers = {}, timeout = 6500) {
  const response = await fetch(url, {
    headers: {"User-Agent": browserAgent, Accept: type === "json" ? "application/json" : "text/csv", ...headers},
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error("HTTP " + response.status);
  return type === "json" ? response.json() : response.text();
}

function dayOf(stamp) {
  return eastDate.format(new Date(stamp));
}

function changeBase(meta, priceNow) {
  const base = meta.previousClose ?? meta.chartPreviousClose;
  if (finite(base) && base > 0 && (!finite(meta.regularMarketChangePercent) || Math.abs((priceNow / base - 1) * 100 - meta.regularMarketChangePercent) < 0.03)) return base;
  if (priceNow !== 0 && finite(meta.regularMarketChangePercent) && meta.regularMarketChangePercent > -100) {
    const base = priceNow / (1 + meta.regularMarketChangePercent / 100);
    return Math.round(base * 10000) / 10000;
  }
  return finite(base) && base > 0 ? base : null;
}

function yahooRows(result) {
  const values = result.indicators?.quote?.[0];
  if (!values) throw new Error("missing chart");
  return (result.timestamp || []).flatMap((seconds, index) => {
    const valuesAtTime = [values.close[index], values.open?.[index], values.high?.[index], values.low?.[index]];
    return finite(seconds) && finite(valuesAtTime[0]) ? [[seconds * 1000, ...valuesAtTime.map(v => finite(v) ? v : null)]] : [];
  });
}

function yahooReading(result, key, interval, detailed) {
  const meta = result.meta;
  if (!meta) throw new Error("missing chart metadata");
  const rows = yahooRows(result);
  const shares = stocks.has(key);
  const regular = meta.currentTradingPeriod?.regular;
  const stamp = meta.regularMarketTime * 1000;
  const regularDay = finite(stamp) ? dayOf(stamp) : null;
  const selected = shares && regularDay ? rows.filter(row => dayOf(row[0]) === regularDay) : rows;
  const sample = last(selected);
  const time = finite(stamp) && (!sample || stamp >= sample[0]) ? stamp : sample?.[0];
  const value = time === stamp && finite(meta.regularMarketPrice) ? meta.regularMarketPrice : sample?.[1];
  if (!finite(value) || !finite(time)) throw new Error("quote unavailable");
  const sameSession = finite(regular?.start) && regularDay === dayOf(regular.start * 1000);
  const sessionStart = sameSession ? regular.start * 1000 : selected[0]?.[0];
  const sessionEnd = sameSession ? regular.end * 1000 : null;
  const bars = shares && sameSession
    ? selected.filter(row => row[0] >= sessionStart && row[0] <= sessionEnd)
    : selected;
  const fromMeta = finite(meta.regularMarketPrice) ? changeBase(meta, meta.regularMarketPrice) : null;
  return {
    price: value, time, date: dayOf(time), source: "yahoo", previous: fromMeta,
    open: bars[0]?.[2] ?? null, high: meta.regularMarketDayHigh ?? null, low: meta.regularMarketDayLow ?? null,
    ...(detailed || key === "SPYM" ? {bars, sessionStart, sessionEnd, interval, volume: meta.regularMarketVolume ?? null} : {}),
  };
}

async function yahooChart(key, hostname, interval, range) {
  return yahooSymbolChart(market[key], hostname, interval, range);
}

async function yahooSymbolChart(symbol, hostname, interval, range, includePrePost = false) {
  const bounds = typeof range === "string" ? {range} : range;
  const query = new URLSearchParams({interval, ...bounds, includePrePost: String(includePrePost)});
  const url = "https://" + hostname + "/v8/finance/chart/" + encodeURIComponent(symbol) + "?" + query;
  const data = await upstream(url);
  const result = data.chart?.result?.[0];
  if (!result) throw new Error("missing chart");
  return result;
}

const yahooHosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];

async function fromYahoo(key, hostname, detailed) {
  const interval = key === "SPYM" ? 1 : 5;
  const result = await yahooChart(key, hostname, interval + "m", "1d");
  return yahooReading(result, key, interval, detailed);
}

const fiveMinute = 5 * 60 * 1000;

function fiveDayRows(result, key) {
  const raw = yahooRows(result);
  const slots = new Map();
  for (const [at, end, open, high, low] of raw) {
    const slot = Math.floor(at / fiveMinute) * fiveMinute;
    const previous = slots.get(slot);
    const [start, peak, floor] = previous?.slice(2, 5) ?? [open, high, low];
    const range = previous && [start, peak, floor].every(finite)
      ? [start, Math.max(peak, high ?? end, end), Math.min(floor, low ?? end, end)]
      : [open, high, low];
    slots.set(slot, [slot, end, ...range]);
  }
  const rows = [...slots.values()].sort((a, b) => a[0] - b[0]);
  const lastAt = last(raw)?.[0];
  const newest = last(rows);
  if (newest && lastAt !== newest[0]) newest[5] = lastAt;
  const offset = key === "GOLD" || key === "WTI" ? 6 * 3600000 : 0;
  const sessions = [...new Set(rows.map(row => dayOf(row[0] + offset)))].slice(-5);
  return {
    asOf: lastAt,
    rows: rows.filter(row => sessions.includes(dayOf(row[0] + offset))),
  };
}

async function getFiveDays(key) {
  if (key === "BREADTH") {
    const [rsp, spy] = await Promise.all(["RSP", "SPY"].map(getFiveDays));
    if (!rsp || !spy) return null;
    const spyByTime = new Map(spy.rows.map(row => [row[0], row[1]]));
    const rows = rsp.rows.flatMap(row => spyByTime.get(row[0]) > 0
      ? [[row[0], row[1] / spyByTime.get(row[0])]] : []);
    return rows.length ? {asOf: Math.min(rsp.asOf, spy.asOf), rows} : null;
  }
  for (const host of yahooHosts) {
    try {
      const history = fiveDayRows(await yahooChart(key, host, "5m", "5d"), key);
      if (history.rows.length) return history;
    } catch {
      // Try the other feed before reporting unavailable data.
    }
  }
  return null;
}

function dailyRows(chart, key, latest) {
  const values = chart.indicators?.quote?.[0];
  if (!values) return [];
  const contract = key === "GOLD" || key === "WTI";
  const today = dayOf(Date.now());
  const start = chart.meta.currentTradingPeriod?.regular?.start;
  const end = chart.meta.currentTradingPeriod?.regular?.end;
  const incomplete = finite(start) && finite(end) && dayOf(start * 1000) <= today && Date.now() < end * 1000;
  const byDate = new Map();
  for (const [i, timestamp] of (chart.timestamp || []).entries()) {
    const stamp = timestamp * 1000;
    const date = dayOf(stamp + (contract ? 6 * 3600000 : 0));
    const value = values.close?.[i];
    if (!finite(value) || date > today || (incomplete && date === today)) continue;
    if (latest?.date === date && finite(latest.sessionEnd) && latest.time < latest.sessionEnd - 60000) continue;
    const extra = [values.open?.[i], values.high?.[i], values.low?.[i]];
    byDate.set(date, extra.every(finite) ? [date, value, ...extra] : [date, value]);
  }
  return Array.from(byDate.values()).sort((a, b) => a[0].localeCompare(b[0]));
}

async function getHistory(key, latest) {
  for (const host of yahooHosts) {
    try {
      const result = await yahooChart(key, host, "1d", "3mo");
      const rows = dailyRows(result, key, latest);
      if (rows.length) return {source: "yahoo", rows};
    } catch {
      // Try the other feed before retaining the local history.
    }
  }
  return null;
}

function eastWallTime(stamp) {
  let guess = stamp;
  for (let attempt = 0; attempt < 2; attempt++) {
    const p = Object.fromEntries(eastParts.formatToParts(guess).map(piece => [piece.type, piece.value]));
    const at = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess += stamp - at;
  }
  return guess;
}

async function fromNasdaq(key) {
  const resource = key === "SPYM" ? "chart" : "info";
  const url = "https://api.nasdaq.com/api/quote/" + key + "/" + resource + "?assetclass=etf";
  const {data} = await upstream(url, "json", {Referer: "https://www.nasdaq.com/"});
  if (key === "SPYM") {
    const points = (data?.chart ?? []).filter(p => finite(p.x) && finite(p.y) && p.y > 0);
    const endpoint = last(points);
    if (!endpoint) throw new Error("Nasdaq chart unavailable");
    const date = new Date(endpoint.x).toISOString().slice(0, 10);
    const wallDay = Date.parse(date + "T00:00:00Z");
    const sessionStart = eastWallTime(wallDay + 570 * 60000);
    const time = eastWallTime(endpoint.x);
    const bars = points.filter(p => p.x >= wallDay + 570 * 60000 && p.x <= wallDay + 960 * 60000)
      .map(p => [eastWallTime(p.x), p.y]);
    if (!bars.length) throw new Error("regular-session data unavailable");
    const prices = bars.map(row => row[1]);
    return {price: last(bars)[1], date, time: Math.min(time, last(bars)[0]), previous: price(data.previousClose),
      source: "nasdaq", bars, sessionStart, sessionEnd: eastWallTime(wallDay + 960 * 60000), interval: 1,
      open: bars[0][1], high: Math.max(...prices), low: Math.min(...prices), volume: price(data.volume)};
  }
  const quote = data?.primaryData;
  const match = quote?.lastTradeTimestamp?.match(/^([A-Za-z]{3}) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2}) (AM|PM) ET$/);
  const current = price(quote?.lastSalePrice);
  const pct = price(quote?.percentageChange);
  if (!match || !finite(current) || current <= 0) throw new Error("Nasdaq quote unavailable");
  const [, month, day, year, hour, minute, half] = match;
  const wall = Date.parse(month + " " + day + " " + year + " 00:00:00 GMT") + ((Number(hour) % 12 + (half === "PM" ? 12 : 0)) * 60 + Number(minute)) * 60000;
  const time = eastWallTime(wall);
  return {price: current, date: dayOf(time), time, previous: finite(pct) && pct > -100 ? current / (1 + pct / 100) : null, source: "nasdaq"};
}

async function getQuote(key, detailed = false) {
  for (const host of yahooHosts) {
    try {
      const quote = await fromYahoo(key, host, detailed);
      if (key !== "SPYM" || quote.bars.length) return quote;
    } catch {
      // Try another public source.
    }
  }
  if (stocks.has(key)) return fromNasdaq(key);
  throw new Error("quote sources unavailable");
}

async function getFred(key) {
  const start = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
  const url = "https://fred.stlouisfed.org/graph/fredgraph.csv?" + new URLSearchParams({id: fred[key], cosd: start});
  const csv = await upstream(url, "csv");
  const rows = csv.trim().split(/\r?\n/).slice(1).flatMap(line => {
    const [date, raw] = line.split(",");
    const value = Number(raw);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && raw && finite(value) ? [[date, value]] : [];
  });
  if (!rows.length) throw new Error("FRED data unavailable");
  return {source: "fred", rows};
}

async function getFear() {
  const data = await upstream("https://production.dataviz.cnn.io/index/fearandgreed/graphdata", "json",
    {Referer: "https://www.cnn.com/markets/fear-and-greed"});
  const current = data.fear_and_greed;
  const time = Date.parse(current?.timestamp);
  if (!finite(time) || !finite(current?.score) || current.score < 0 || current.score > 100) throw new Error("CNN data unavailable");
  const date = dayOf(time);
  const all = new Map();
  for (const point of data.fear_and_greed_historical?.data ?? []) {
    if (!finite(point.x) || !finite(point.y) || point.y < 0 || point.y > 100) continue;
    const key = new Date(point.x).toISOString().slice(0, 10);
    if (key <= date) all.set(key, [key, point.y]);
  }
  all.set(date, [date, current.score]);
  return {source: "cnn", rows: [...all.values()].sort((a, b) => a[0].localeCompare(b[0])).slice(-90),
    timestamp: new Date(time).toISOString(), previous: finite(current.previous_close) ? current.previous_close : null};
}

const marketContextSources = {
  DRAWDOWN: getSpymCloses,
  BREADTH50: getBreadth50,
  VIXTERM: getVixTerm,
};

function recentTradingDate(hour, minute = 0) {
  const now = Date.now();
  const parts = Object.fromEntries(eastParts.formatToParts(now).map(p => [p.type, p.value]));
  return Number(parts.hour) * 60 + Number(parts.minute) >= hour * 60 + minute
    ? dayOf(now) : dayOf(now - 86400000);
}

function csvDate(date) {
  const match = date?.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (match) return match[3] + "-" + match[1].padStart(2, "0") + "-" + match[2].padStart(2, "0");
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return "";
}

async function getSpymCloses() {
  const today = recentTradingDate(16);
  // Allow a full 52-week window even for the earliest point on the one-month graph.
  const from = new Date(Date.now() - 420 * 86400000).toISOString().slice(0, 10);
  for (const host of yahooHosts) {
    try {
      const chart = await yahooChart("SPYM", host, "1d", "2y");
      const rows = dailyRows(chart, "SPYM").filter(row => row[0] >= from && row[0] <= today).map(row => row.slice(0, 2));
      if (rows.length >= 250 && rows[0][0] <= dayOf(Date.now() - 395 * 86400000)) return {source: "yahoo", rows};
    } catch {
      // Nasdaq historical closes are the fallback.
    }
  }
  const query = new URLSearchParams({assetclass: "etf", fromdate: from, limit: "400"});
  const {data} = await upstream("https://api.nasdaq.com/api/quote/SPYM/historical?" + query, "json",
    {Referer: "https://www.nasdaq.com/"});
  const rows = (data?.tradesTable?.rows || []).flatMap(row => {
    const date = csvDate(row.date);
    const close = price(row.close);
    return date && date <= today && date >= from && finite(close) && close > 0 ? [[date, close]] : [];
  }).sort((a, b) => a[0].localeCompare(b[0]));
  return rows.length >= 250 && rows[0][0] <= dayOf(Date.now() - 395 * 86400000)
    ? {source: "nasdaq", rows} : null;
}

async function getBreadth50() {
  const path = "/advance-decline/ma_percentage_historical.json";
  for (const host of ["https://r2.deanfi.com", "https://raw.githubusercontent.com/DeanFinancials/deanfi-data/main"]) {
    try {
      const {data, metadata} = await upstream(host + path);
      const rows = data.flatMap(({date, ma_50}) => {
        const share = ma_50?.percentage_above;
        return csvDate(date) === date && date <= dayOf(Date.now()) && finite(share) && share >= 0 && share <= 100
          ? [[date, share]] : [];
      }).sort((a, b) => a[0].localeCompare(b[0])).slice(-35);
      if (rows.length >= 6) return {source: "deanfi", rows, timestamp: metadata?.generated_at};
    } catch {
      // The GitHub mirror has the same series when the primary endpoint is unavailable.
    }
  }
  return null;
}

async function cboeCloses(symbol, end) {
  const text = await upstream("https://cdn.cboe.com/api/global/us_indices/daily_prices/" + symbol + "_History.csv", "csv", {}, 11000);
  return text.trim().split(/\r?\n/).slice(-45).flatMap(line => {
    const [rawDate, , , , rawClose] = line.split(",");
    const date = csvDate(rawDate);
    const close = Number(rawClose);
    return date && date <= end && finite(close) && close > 0 ? [[date, close]] : [];
  }).sort((a, b) => a[0].localeCompare(b[0]));
}

async function fredVolatilityCloses(id, end) {
  const cosd = new Date(Date.parse(end) - 70 * 86400000).toISOString().slice(0, 10);
  const text = await upstream("https://fred.stlouisfed.org/graph/fredgraph.csv?" + new URLSearchParams({id, cosd}), "csv");
  return text.trim().split(/\r?\n/).flatMap(line => {
    const [date, raw] = line.split(",");
    const close = Number(raw);
    return csvDate(date) === date && date <= end && finite(close) && close > 0 ? [[date, close]] : [];
  });
}

function divideVolatilityCloses(vix, vix3m, source) {
  const long = new Map(vix3m);
  const paired = vix.filter(([date]) => long.has(date));
  const [date, short] = last(paired) || [];
  const rows = paired.map(([date, short]) => [date, short / long.get(date)]);
  return date ? {source, rows, vix: short, vix3m: long.get(date)} : null;
}

async function getVixTerm() {
  const end = recentTradingDate(16, 15);
  try {
    const pair = await Promise.all(["VIX", "VIX3M"].map(symbol => cboeCloses(symbol, end)));
    const reading = divideVolatilityCloses(...pair, "cboe");
    if (reading) return reading;
  } catch {
    // FRED republishes the same two Cboe index close series.
  }
  const pair = await Promise.all(["VIXCLS", "VXVCLS"].map(id => fredVolatilityCloses(id, end)));
  return divideVolatilityCloses(...pair, "fred");
}

async function gather(keys, get) {
  const entries = await Promise.all(keys.map(async key => {
    try {
      return [key, await get(key)];
    } catch {
      return [key, null];
    }
  }));
  return Object.fromEntries(entries);
}

async function getDetail(key) {
  if (key === "BREADTH") {
    const [rsp, spy] = await Promise.all(["RSP", "SPY"].map(getDetail));
    return {components: {RSP: rsp, SPY: spy}};
  }
  if (key === "FEAR" || Object.hasOwn(fred, key)) {
    const observation = await (key === "FEAR" ? getFear() : getFred(key)).catch(() => null);
    return observation ? {observation} : null;
  }
  const [quote, history] = await Promise.all([
    getQuote(key, true).catch(() => null),
    getHistory(key),
  ]);
  return quote || history ? {quote, history} : null;
}

const worldSymbol = /^\^?[A-Z0-9][A-Z0-9.=^\-]{0,18}$/;
const conversionCurrencies = ["EUR", "GBP", "JPY", "SGD", "HKD", "CNY", "AUD", "CAD", "CHF", "KRW", "TWD", "CNH"];
const worldCache = new Map();

function equitySession(meta, stamp) {
  if (meta.exchangeTimezoneName !== "America/New_York" || !["EQUITY","ETF"].includes(meta.instrumentType)) return null;
  const parts = eastParts.formatToParts(stamp);
  const hour = Number(parts.find(part => part.type === "hour")?.value);
  const minute = Number(parts.find(part => part.type === "minute")?.value);
  const clock = hour * 60 + minute;
  const periods = meta.currentTradingPeriod || {};
  if (stamp >= periods.regular?.start * 1000 && stamp <= periods.regular?.end * 1000) return "regular";
  for (const [key,label] of [["pre","pre"],["post","post"]]) {
    if (stamp >= periods[key]?.start * 1000 && stamp <= periods[key]?.end * 1000) return label;
  }
  return clock < 570 ? "pre" : clock > 960 ? "post" : "regular";
}

const adrTicker = /^[A-Z][A-Z0-9.-]{0,14}$/;
const isinFormat = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;
const adrPrograms = new Map();
const ordinaryListings = new Map();
const issuerAdrReferences = globalThis.MARKET_ADR_REFERENCE;
const adrReferenceLifetime = 24 * 60 * 60 * 1000;
const secondaryTradingMarkets = new Set(["GR","GY","SW","MM","AV","SM"]);

// Bloomberg exchange codes in the depositary directory and OpenFIGI.
// Some venue codes aggregate unlisted foreign trading. Accept those only when the directory identifies the home listing.
const ordinaryExchanges = {
  LN:["GB","L"], HK:["HK","HK",4], TT:["TW","TW"], TWO:["TW","TWO"], JP:["JP","T"], JT:["JP","T"],
  KS:["KR","KS",6], KQ:["KR","KQ",6], CH:["CN","SS",6], CG:["CN","SZ",6], CS:["CN","SZ",6],
  SP:["SG","SI"], AU:["AU","AX"], NZ:["NZ","NZ"], IN:["IN","NS"], IB:["IN","BO"],
  IJ:["ID","JK"], MK:["MY","KL"], TB:["TH","BK"], PM:["PH","PS"], VN:["VN","VN"],
  AB:["SA","SR"], IT:["IL","TA"], SJ:["ZA","JO"], CN:["CA","TO"], CT:["CA","TO"], CV:["CA","V"],
  MM:["MX","MX"], BZ:["BR","SA"], AR:["AR","BA"], CI:["CL","SN"], PE:["PE","LM"],
  FP:["FR","PA"], NA:["NL","AS"], BB:["BE","BR"], SW:["CH","SW"], IM:["IT","MI"],
  SM:["ES","MC"], DC:["DK","CO"], SS:["SE","ST"], NO:["NO","OL"], FH:["FI","HE"],
  ID:["IE","IR"], AV:["AT","VI"], PL:["PT","LS"], PW:["PL","WA"], GA:["GR","AT"], TI:["TR","IS"],
  GR:["DE","DE"], GY:["DE","DE"], BH:["BM","BH"],
};

function ordinaryListing(ticker, venue) {
  const market = ordinaryExchanges[venue?.split(" ")[0]];
  if (!market || !/^[A-Z0-9-]{1,14}$/.test(ticker ?? "")) return null;
  const [country, marketSuffix, digits] = market;
  const suffix = country==="CN" ? /^6/.test(ticker)?"SS":/^[03]/.test(ticker)?"SZ":"BJ" : marketSuffix;
  let local = digits && /^\d+$/.test(ticker) ? ticker.padStart(digits,"0") : ticker;
  // The directory compacts Danish share classes; Yahoo separates the class with a hyphen.
  if (country==="DK" && /^[A-Z]{4,}[AB]$/.test(local)) local=local.slice(0,-1)+"-"+local.at(-1);
  return {country,symbol:local+"."+suffix};
}

function keepAdrReference(cache,key,result) {
  if (cache.size >= 512) cache.delete(cache.keys().next().value);
  cache.set(key,{result,savedAt:Date.now()});
  return result;
}

function programFields(html) {
  const fields = new Map();
  const plain = value => value.replace(/<[^>]*>/g," ").replace(/&(?:nbsp|#160|#xA0);/gi," ")
    .replace(/&amp;/gi,"&").replace(/\s+/g," ").trim();
  for (const [,row] of html.matchAll(/<tr\b[^>]*>((?:(?!<\/?tr\b)[\s\S])*)<\/tr>/gi)) {
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(([,value])=>plain(value));
    if (cells.length===2) fields.set(cells[0].replace(/:$/, "").trim().toUpperCase(),cells[1]);
  }
  return fields;
}

function programCusip(html,fields) {
  const cusip = fields.get("CUSIP")?.match(/^[A-Z0-9]{9}\b/i)?.[0];
  if (cusip) return cusip.toUpperCase();
  const links = html.replace(/&(?:amp|#38|#x26);/gi,"&");
  const directory = links.match(/pgm_d\.aspx\?(?:[^\s"'<>]*&)?cusip=([A-Z0-9]{9})(?=[&\s"'<>]|$)/i);
  // FactSet also carries the program CUSIP in its quote and news links.
  return (directory?.[1] ?? links.match(/[?&]cusip=([A-Z0-9]{9})(?=[&\s"'<>]|$)/i)?.[1])?.toUpperCase();
}

async function readAdrProgram(symbol) {
  const saved = adrPrograms.get(symbol);
  if (saved && Date.now()-saved.savedAt < adrReferenceLifetime) return saved.result;
  const factset = new URL("https://citiadr.factsetdigitalsolutions.com/stocks/profile.idms");
  factset.searchParams.set("SYMBOL_US",symbol);
  const html = await upstream(factset,"text",{Accept:"text/html"},9500);
  let fields = programFields(html);
  if (!fields.get("DR TICKER")) {
    const cusip = programCusip(html,fields);
    if (!cusip) throw new Error("DR directory response unavailable");
    const source = new URL("https://depositaryreceipts.citi.com/adr/guides/pgm_d.aspx");
    source.search = new URLSearchParams({cusip,pageId:"16",subpageID:"104",typeDisplay:"A"}).toString();
    fields = programFields(await upstream(source,"text",{Accept:"text/html"},9500));
  }
  const ticker = fields.get("DR TICKER"), type = fields.get("DR TYPE");
  if (ticker?.toUpperCase()!==symbol || !type) throw new Error("DR program response unavailable");
  if (!/\b(?:ADR|ADS)\b/i.test(type) || /\d/.test(fields.get("INACTIVE DATE") ?? "")) {
    return keepAdrReference(adrPrograms,symbol,null);
  }
  const isin = fields.get("ORD ISIN")?.toUpperCase();
  const [ordinary, venue] = (fields.get("ORD TICKER") ?? "").toUpperCase().split(/\s+/);
  if (!isinFormat.test(isin ?? "") && !ordinaryListing(ordinary,venue)) throw new Error("DR original security unavailable");
  return keepAdrReference(adrPrograms,symbol,{isin,ordinary,venue,issuer:fields.get("COMPANY NAME")});
}

async function lookupOrdinaryIsins(issuers) {
  const pending = [...issuers.keys()].filter(isin=>Date.now()-(ordinaryListings.get(isin)?.savedAt ?? 0)>=adrReferenceLifetime);
  if (!pending.length) return ordinaryListings;

  const figi = async () => {
    const response = await fetch("https://api.openfigi.com/v3/mapping",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify(pending.map(idValue=>({idType:"ID_ISIN",idValue,marketSecDes:"Equity"}))),
      signal:AbortSignal.timeout(7000),
    });
    if (!response.ok) throw new Error("OpenFIGI HTTP "+response.status);
    return response.json();
  };
  const yahooSymbols = async query => {
    const params=new URLSearchParams({q:query,quotesCount:"10",newsCount:"0"});
    for (const host of yahooHosts) {
      try {
        const data=await upstream("https://"+host+"/v1/finance/search?"+params,"json",{},3800);
        return (data.quotes??[]).filter(row=>row.quoteType==="EQUITY").map(row=>row.symbol);
      } catch {}
    }
    return [];
  };
  const yahoo = async isin => {
    const values=await yahooSymbols(isin).catch(()=>[]);
    if (values.length) return {values,exact:true};
    const issuer=issuers.get(isin);
    return issuer?{values:await yahooSymbols(issuer),exact:false}:null;
  };
  const [result, aliases] = await Promise.all([figi().catch(()=>null),gather(pending,yahoo)]);
  pending.forEach((isin,i)=>{
    const item=result?.[i];
    if (Array.isArray(item?.data)) keepAdrReference(ordinaryListings,isin,{rows:item.data,aliases:aliases[isin]});
    else if (/no identifier found/i.test(item?.warning ?? "")) {
      keepAdrReference(ordinaryListings,isin,{rows:[],aliases:aliases[isin]});
    }
  });
  return ordinaryListings;
}

function yahooOrdinarySymbol(symbol,aliases) {
  // Yahoo inserts punctuation into some share classes, such as the space before a B share.
  const canonical=value=>value.replace(/[- ]/g,"");
  const suffix=symbol.slice(symbol.lastIndexOf("."));
  const sameExchange=[...new Set((aliases?.values??[]).filter(value=>typeof value==="string"&&worldSymbol.test(value)&&value.endsWith(suffix)))];
  return sameExchange.find(value=>canonical(value)===canonical(symbol))??(aliases?.exact&&sameExchange.length===1?sameExchange[0]:symbol);
}

async function adrListings(symbols) {
  const listed = symbols.filter(symbol=>Object.hasOwn(issuerAdrReferences,symbol));
  const programs = await gather(symbols.filter(symbol=>!Object.hasOwn(issuerAdrReferences,symbol)),
    async symbol=>({program:await readAdrProgram(symbol)}));
  const issuers = new Map(Object.values(programs).flatMap(found=>{
    const program=found?.program;
    return isinFormat.test(program?.isin??"")?[[program.isin,program.issuer]]:[];
  }));
  const matches = await lookupOrdinaryIsins(issuers);
  const resolved = Object.entries(programs).flatMap(([symbol,found])=>{
    if (!found) return [];
    if (!found.program) return [[symbol,{isAdr:false,markets:[],complete:true}]];
    const {isin,ordinary,venue} = found.program;
    const primary = ordinaryListing(ordinary,venue);
    const exact = matches.get(isin);
    const markets = new Map(primary ? [[primary.country,primary]] : []);
    for (const row of exact?.result.rows ?? []) {
      if (row.marketSector!=="Equity" || /ADR|GDR|Depositary/i.test(row.securityType ?? "") || secondaryTradingMarkets.has(row.exchCode)) continue;
      const local=ordinaryListing(row.ticker,row.exchCode);
      if (local&&!markets.has(local.country)) markets.set(local.country,local);
    }
    const listings=[...markets.values()].map(listing=>({...listing,symbol:yahooOrdinarySymbol(listing.symbol,exact?.result.aliases)}));
    const complete = listings.length>0 && (!isinFormat.test(isin ?? "")||Boolean(exact&&Date.now()-exact.savedAt<adrReferenceLifetime));
    return [[symbol,{isAdr:true,markets:listings,complete}]];
  });
  return Object.fromEntries(resolved.concat(listed.map(symbol=>[symbol,{isAdr:true,complete:true,...issuerAdrReferences[symbol]}])));
}

async function moexReading() {
  const from = new Date(Date.now()-28*86400000).toISOString().slice(0,10);
  const url = "https://iss.moex.com/iss/history/engines/stock/markets/index/boards/SNDX/securities/IMOEX.json?"
    + new URLSearchParams({from,"iss.meta":"off","iss.only":"history","history.columns":"TRADEDATE,CLOSE"});
  const {history} = await upstream(url);
  const dateColumn = history.columns.indexOf("TRADEDATE"), closeColumn = history.columns.indexOf("CLOSE");
  const rows = history.data.filter(row=>/^\d{4}-\d{2}-\d{2}$/.test(row[dateColumn])&&finite(row[closeColumn]))
    .sort((a,b)=>a[dateColumn].localeCompare(b[dateColumn]));
  if (rows.length<2) return null;
  const observationDate = last(rows)[dateColumn];
  return {price:last(rows)[closeColumn],previous:rows.at(-2)[closeColumn],observationDate,
    time:Date.parse(observationDate+"T00:00:00+03:00"),spark:rows.map(row=>row[closeColumn]),
    source:"moex",timezone:"Europe/Moscow",currency:"RUB"};
}

async function worldReading(symbol) {
  const cached = worldCache.get(symbol);
  const lifetime = symbol==="IMOEX" ? 300000 : 55000;
  if (cached && Date.now() - cached.received < lifetime) return cached.quote;
  if (symbol==="IMOEX") {
    const quote = await moexReading().catch(()=>null);
    worldCache.set(symbol,{received:Date.now(),quote});
    return quote;
  }
  for (const host of yahooHosts) {
    try {
      const chart = await yahooSymbolChart(symbol, host, "5m", "1d", !symbol.startsWith("^") && !symbol.includes("="));
      const meta = chart.meta ?? {};
      const rows = yahooRows(chart);
      const lastBar = last(rows);
      const tradeTime = meta.regularMarketTime * 1000;
      const useMeta = finite(meta.regularMarketPrice) && finite(tradeTime) && (!lastBar || tradeTime >= lastBar[0]);
      const current = useMeta ? meta.regularMarketPrice : lastBar?.[1];
      const time = useMeta ? tradeTime : lastBar?.[0];
      if (!finite(current) || !finite(time)) continue;
      const step = Math.max(1, Math.ceil(rows.length / 32));
      const spark = rows.filter((_, i) => i % step === 0).map(row => row[1]);
      if (last(spark) !== current) spark.push(current);
      const regular = meta.currentTradingPeriod?.regular;
      const quote = {
        price: current, previous: changeBase(meta, meta.regularMarketPrice ?? current), time, spark, source: "yahoo",
        timezone: meta.exchangeTimezoneName, currency: meta.currency,
        session: equitySession(meta,time),
        delayMinutes: symbol.endsWith(".SI") ? 20 : /\.HK$|^\^HS/.test(symbol) ? 15 : null,
        sessionStart: finite(regular?.start) ? regular.start * 1000 : null,
        sessionEnd: finite(regular?.end) ? regular.end * 1000 : null,
      };
      if (worldCache.size >= 256) worldCache.delete(worldCache.keys().next().value);
      worldCache.set(symbol, {received: Date.now(), quote});
      return quote;
    } catch {
      // Try the other quote host.
    }
  }
  return null;
}

async function latestFx() {
  const records = await gather(conversionCurrencies, currency => worldReading("USD" + currency + "=X"));
  const rates = {USD: {now: 1, prev: 1, time: Date.now()}};
  for (const [currency, quote] of Object.entries(records)) {
    if (!quote || !(quote.price > 0)) continue;
    rates[currency] = {now: quote.price, prev: quote.previous > 0 ? quote.previous : null, time: quote.time};
  }
  return rates;
}

const dayMs = 86400000;
const valuationMaxAge = 4 * dayMs;
const valuationFxCurrency = symbol => /^USD([A-Z]{3})=X$/.exec(symbol)?.[1];

function valuationDate(cutoff) {
  return new Date(cutoff + 8 * 3600000).toISOString().slice(0,10);
}

function valuationCutoffs(from, to, now = Date.now()) {
  const parse = date => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return NaN;
    const at = Date.parse(date + "T06:00:00+08:00");
    return finite(at) && valuationDate(at) === date ? at : NaN;
  };
  const first = parse(from), last = parse(to);
  if (!finite(first) || !finite(last) || first > last || last > now-30*60000 || first < now-31*dayMs) return [];
  return Array.from({length:(last-first)/dayMs+1}, (_,i)=>first+i*dayMs);
}

function completedValuationBars(chart, cutoffs, barMs) {
  const bars = yahooRows(chart).filter(row=>row[1]>0).sort((a,b)=>a[0]-b[0]);
  let index = 0;
  if (barMs) return cutoffs.flatMap(cutoff=>{
    while (index < bars.length && bars[index][0]+barMs <= cutoff) index++;
    const bar = bars[index-1];
    return bar && bar[0]+barMs >= cutoff-valuationMaxAge
      ? [[valuationDate(cutoff),bar[1],barMs===3600000?"hourly":null]] : [];
  });

  // Daily bars are dated at the trading session. Use the exchange's local close
  // to decide when a close could have been known, including across DST changes.
  const {exchangeTimezoneName:timeZone,currentTradingPeriod} = chart.meta;
  if (!timeZone) return [];
  const formatter = new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
  const local = at => {
    const {year,month,day,hour,minute,second} = Object.fromEntries(formatter.formatToParts(at).map(({type,value})=>[type,value]));
    return year+"-"+month+"-"+day+"T"+hour+":"+minute+":"+second;
  };
  const asOf = value => value > 0 ? local(value*1000) : "";
  const session = currentTradingPeriod?.regular;
  const open = asOf(session?.start), close = asOf(session?.end);
  const closeTime = open && open.slice(0,10)===close.slice(0,10) && close > open ? close.slice(10) : null;
  const daily = bars.map(([at,value])=>{
    const date = local(at).slice(0,10);
    const eligible = closeTime ? date+closeTime : new Date(Date.parse(date)+dayMs).toISOString().slice(0,19);
    return {at,value,eligible};
  });
  return cutoffs.flatMap(cutoff=>{
    const at = local(cutoff);
    while (index < daily.length && daily[index].at<=cutoff && daily[index].eligible<=at) index++;
    const bar = daily[index-1];
    return bar && bar.at >= cutoff-valuationMaxAge ? [[valuationDate(cutoff),bar.value,"close"]] : [];
  });
}

async function valuationPrices(symbol, cutoffs) {
  const bounds = {period1:(cutoffs[0]-valuationMaxAge)/1000, period2:cutoffs.at(-1)/1000};
  const fx = valuationFxCurrency(symbol);
  const [main,alternate] = yahooHosts;
  const attempts = [[symbol,main,"15m",900000],[symbol,alternate,"15m",900000],
    [symbol,main,"60m",3600000],[symbol,alternate,"60m",3600000]];
  if (fx) attempts.push([fx+"=X",main,"60m",3600000]);
  else attempts.push([symbol,main,"1d",0],[symbol,alternate,"1d",0]);
  const rows = new Map();
  let currency;
  for (const [ticker,host,interval,barMs] of attempts) {
    try {
      const chart = await yahooSymbolChart(ticker,host,interval,bounds);
      const code = chart.meta?.currency;
      if (!code || (fx && code!==fx) || (currency && code!==currency)) continue;
      const pending = cutoffs.filter(at=>!rows.has(valuationDate(at)));
      for (const row of completedValuationBars(chart,pending,barMs)) {
        rows.set(row[0],row);
        currency = code;
      }
      if (rows.size === cutoffs.length) break;
    } catch {}
  }
  return rows.size ? {currency,rows:[...rows.values()].sort((a,b)=>a[0].localeCompare(b[0]))} : null;
}

async function completeValuationFx(prices, cutoffs) {
  const targets = Object.entries(prices).flatMap(([symbol,quote])=>{
    const currency = valuationFxCurrency(symbol);
    return conversionCurrencies.includes(currency) && !["CNH","TWD"].includes(currency) && (quote?.rows.length ?? 0)<cutoffs.length
      ? [{symbol,currency,rows:new Map(quote?.rows.map(row=>[row[0],row]))}] : [];
  });
  if (!targets.length) return;
  const utcDay = at => new Date(at).toISOString().slice(0,10);
  const from = utcDay(cutoffs[0]-valuationMaxAge), to = utcDay(cutoffs.at(-1));
  const params = new URLSearchParams({base:"USD",symbols:targets.map(row=>row.currency).join(",")});
  const {rates} = await upstream("https://api.frankfurter.dev/v1/"+from+".."+to+"?"+params);
  const published = Object.entries(rates ?? {}).map(([date,values])=>({at:Date.parse(date+"T19:00:00Z"),values}))
    .filter(row=>finite(row.at)).sort((a,b)=>a.at-b.at);
  for (const {symbol,currency,rows} of targets) {
    for (const cutoff of cutoffs) {
      const day = valuationDate(cutoff);
      if (rows.has(day)) continue;
      const latest = published.findLast(row=>row.at<=cutoff && row.at>=cutoff-valuationMaxAge
        && finite(row.values?.[currency]) && row.values[currency]>0);
      if (latest) rows.set(day,[day,latest.values[currency],"fx-reference"]);
    }
    if (rows.size) prices[symbol] = {currency,rows:[...rows.values()].sort((a,b)=>a[0].localeCompare(b[0]))};
  }
}

const treasuryTerms = {DGS2:"2 Yr", DGS5:"5 Yr", DGS10:"10 Yr", DGS30:"30 Yr"};

async function worldTreasury() {
  const year = dayOf(Date.now()).slice(0,4);
  try {
    const url = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/"
      + year + "/all?type=daily_treasury_yield_curve&field_tdr_date_value=" + year + "&_format=csv";
    const csv = await upstream(url,"csv",{},9000);
    const [head,...lines] = csv.trim().split(/\r?\n/);
    const columns = head.replaceAll('"',"").split(",");
    const series = Object.fromEntries(Object.entries(treasuryTerms).map(([key,term])=>{
      const column = columns.indexOf(term);
      const rows = lines.flatMap(line=>{
        const row = line.split(",");
        const date = csvDate(row[0]);
        const value = row[column] ? Number(row[column]) : NaN;
        return date && finite(value) ? [[date,value]] : [];
      }).sort((a,b)=>a[0].localeCompare(b[0])).slice(-35);
      return [key,{source:"treasury",rows}];
    }));
    if (Object.values(series).every(item=>item.rows.length>=2)) return series;
  } catch {
    // FRED republishes the Treasury constant-maturity series.
  }
  return gather(Object.keys(treasuryTerms),getFred);
}

const portfolioHeaders = {"Content-Type":"application/json", "Cache-Control":"no-store"};

function safePublicPortfolio(positions) {
  if (!Array.isArray(positions) || positions.length > 400) return null;
  const rows = new Map();
  for (const row of positions) {
    if (!worldSymbol.test(row?.symbol || "") || !["stock","etf"].includes(row.kind)) return null;
    const weight = row.weight;
    if (!finite(weight) || weight < 0 || weight > 100) return null;
    rows.set(row.symbol, {
      symbol:row.symbol, kind:row.kind, name:String(row.name || "").slice(0,90), weight,
    });
  }
  return [...rows.values()];
}

async function portfolioRoute(request, env, ownerSite) {
  const url = new URL(request.url);
  const isPublic = url.pathname.endsWith("/public");
  const reply = (payload,status = 200) => Response.json(payload,{status,
    headers:isPublic ? {...portfolioHeaders,"Access-Control-Allow-Origin":"*"} : portfolioHeaders});
  if (!env?.DB) return reply({error:"数据库暂不可用"},503);
  if (isPublic) {
    if (request.method !== "GET") return reply({error:"请求方法无效"},405);
    const row = await env.DB.prepare("SELECT public_json, published_at FROM portfolio_book WHERE id=1").first();
    return reply({positions:row?.public_json ? JSON.parse(row.public_json) : [], publishedAt:row?.published_at ?? null});
  }
  const key = env.PORTFOLIO_ADMIN_KEY;
  if (!ownerSite && (!key || request.headers.get("Authorization") !== "Bearer " + key)) return reply({error:"需要管理授权"},401);
  if (request.method === "GET") {
    const row = await env.DB.prepare("SELECT * FROM portfolio_book WHERE id=1").first();
    if (!row) return reply({error:"数据库尚未初始化"},503);
    return reply({version:row.version, portfolio:row.draft_json ? JSON.parse(row.draft_json) : null,
      updatedAt:row.updated_at, publishedAt:row.published_at});
  }
  if (request.method !== "PUT") return reply({error:"请求方法无效"},405);
  if (request.headers.has("Origin") && request.headers.get("Origin") !== url.origin) return reply({error:"只允许同站保存"},403);
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) return reply({error:"请求格式无效"},415);
  const body = await request.text();
  const bytes = value => new TextEncoder().encode(value).length;
  if (bytes(body) > 1700000) return reply({error:"持仓文件过大"},413);
  let update;
  try {update = JSON.parse(body);} catch {return reply({error:"请求格式无效"},400);}
  if (!Number.isSafeInteger(update?.version) || update.version < 0) return reply({error:"版本号无效"},400);
  const now = new Date().toISOString();
  let command;
  if (update.mode === "save") {
    const data = update.portfolio;
    if (!Array.isArray(data?.positions) || data.positions.length > 400 || data.positions.some(row=>!row || typeof row !== "object")) {
      return reply({error:"持仓格式无效"},400);
    }
    const {navHistory,...draft} = data;
    if (bytes(JSON.stringify({...update,portfolio:draft})) > 200000) return reply({error:"持仓文件过大"},413);
    command = env.DB.prepare("UPDATE portfolio_book SET draft_json=?, updated_at=?, version=version+1 WHERE id=1 AND version=?")
      .bind(JSON.stringify(data),now,update.version);
  } else if (update.mode === "publish" || update.mode === "unpublish") {
    if (bytes(body) > 200000) return reply({error:"持仓文件过大"},413);
    const snapshot = update.mode === "publish" ? safePublicPortfolio(update.positions) : [];
    if (!snapshot) return reply({error:"持仓展示数据格式无效"},400);
    command = env.DB.prepare("UPDATE portfolio_book SET public_json=?, published_at=?, version=version+1 WHERE id=1 AND version=?")
      .bind(snapshot.length ? JSON.stringify(snapshot) : null,snapshot.length ? now : null,update.version);
  } else {
    return reply({error:"请求格式无效"},400);
  }
  const result = await command.run();
  if (!result.meta.changes) return reply({error:"组合已在其他地方更新。请先刷新页面，再提交修改。"},409);
  return reply({version:update.version+1, time:now});
}

export default {
  async fetch(request, env, _ctx, ownerSite = false) {
    const url = new URL(request.url);
    if (["/api/portfolio","/api/portfolio/public"].includes(url.pathname)) {
      return portfolioRoute(request,env,ownerSite);
    }
    if (!url.pathname.endsWith("/api/market")) return new Response("Not found", {status: 404});
    const headers = {"Access-Control-Allow-Origin": "*", "Cache-Control": "no-store", "Content-Type": "application/json"};
    if (request.method !== "GET") return Response.json({error: "method"}, {status: 405, headers});
    const scope = url.searchParams.get("scope");
    if (scope === "world") {
      const symbols = [...new Set((url.searchParams.get("symbols") || "").split(","))];
      if (symbols.length > 8 || !symbols.every(symbol => worldSymbol.test(symbol))) {
        return Response.json({error: "symbols"}, {status: 400, headers});
      }
      const quotes = await gather(symbols, worldReading);
      return Response.json({quotes}, {status: Object.values(quotes).some(Boolean) ? 200 : 503, headers});
    }
    if (scope === "adr") {
      const symbols = [...new Set((url.searchParams.get("symbols") || "").split(","))];
      if (symbols.length > 8 || !symbols.every(symbol => adrTicker.test(symbol))) {
        return Response.json({error:"symbols"},{status:400,headers});
      }
      return Response.json({listings:await adrListings(symbols)},{headers});
    }
    if (scope === "world-yields") {
      const observations = await worldTreasury();
      return Response.json({observations}, {status: Object.values(observations).some(Boolean) ? 200 : 503, headers});
    }
    if (scope === "fx") {
      const rates = await latestFx();
      return Response.json({rates}, {status: Object.keys(rates).length > 1 ? 200 : 503, headers});
    }
    if (scope === "valuation") {
      const symbols = [...new Set((url.searchParams.get("symbols") || "").split(","))];
      const cutoffs = valuationCutoffs(url.searchParams.get("from"),url.searchParams.get("to"));
      if (!cutoffs.length || symbols.length > 8 || !symbols.every(symbol=>worldSymbol.test(symbol))) {
        return Response.json({error:"valuation"},{status:400,headers});
      }
      const prices = await gather(symbols,symbol=>valuationPrices(symbol,cutoffs));
      await completeValuationFx(prices,cutoffs).catch(()=>{});
      return Response.json({prices},{headers});
    }
    if (scope === "context") {
      const context = await gather(Object.keys(marketContextSources), key => marketContextSources[key]());
      return Response.json({context}, {status: Object.values(context).some(Boolean) ? 200 : 503, headers});
    }
    if (scope === "chart5") {
      const key = url.searchParams.get("key");
      if (!Object.hasOwn(market, key) && key !== "BREADTH") {
        return Response.json({error: "indicator"}, {status: 400, headers});
      }
      const chart = await getFiveDays(key);
      return Response.json({key, chart}, {status: chart ? 200 : 503, headers});
    }
    if (scope === "detail") {
      const key = url.searchParams.get("key");
      if (!Object.hasOwn(market, key) && !Object.hasOwn(fred, key) && !["BREADTH", "FEAR"].includes(key)) {
        return Response.json({error: "indicator"}, {status: 400, headers});
      }
      const detail = await getDetail(key);
      return Response.json({key, detail}, {status: detail ? 200 : 503, headers});
    }
    let quotes = {}, observations = {};
    if (scope === "spym") quotes = await gather(["SPYM"], getQuote);
    else if (scope === "indices") quotes = await gather(["VIX", "SPY", "RSP", "IWM", "QQQ"], getQuote);
    else if (scope === "cross") quotes = await gather(["HYG", "JNK", "KRE", "DXY", "GOLD", "WTI"], getQuote);
    else if (scope === "observations") observations = await gather(["OAS", "DGS10", "FEAR"], key => key === "FEAR" ? getFear() : getFred(key));
    else return Response.json({error: "scope"}, {status: 400, headers});
    const any = [...Object.values(quotes), ...Object.values(observations)].some(Boolean);
    return Response.json({checkedAt: new Date().toISOString(), quotes, observations}, {status: any ? 200 : 503, headers});
  },
};
