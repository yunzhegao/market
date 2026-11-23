const stocks = new Set(["SPYM", "SPY", "RSP", "IWM", "QQQ", "HYG", "JNK", "KRE"]);
const market = {
  SPYM: "SPYM", VIX: "^VIX", SPY: "SPY", RSP: "RSP", IWM: "IWM", QQQ: "QQQ",
  HYG: "HYG", JNK: "JNK", KRE: "KRE", DXY: "DX-Y.NYB", GOLD: "GC=F", WTI: "CL=F",
};
const fred = {OAS: "BAMLH0A0HYM2", DGS10: "DGS10"};
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

async function upstream(url, type = "json", headers = {}) {
  const response = await fetch(url, {
    headers: {"User-Agent": browserAgent, Accept: type === "json" ? "application/json" : "text/csv", ...headers},
    signal: AbortSignal.timeout(6500),
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

function yahooReading(result, key, interval, detailed) {
  const meta = result.meta;
  const values = result.indicators?.quote?.[0];
  if (!meta || !values) throw new Error("missing chart");
  const rows = (result.timestamp || []).flatMap((seconds, index) => {
    const valuesAtTime = [values.close[index], values.open?.[index], values.high?.[index], values.low?.[index]];
    return finite(seconds) && finite(valuesAtTime[0]) ? [[seconds * 1000, ...valuesAtTime.map(v => finite(v) ? v : null)]] : [];
  });
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
    ...(detailed || key === "SPYM" ? {bars, sessionStart, sessionEnd, interval,
      open: bars[0]?.[2] ?? null, high: meta.regularMarketDayHigh ?? null, low: meta.regularMarketDayLow ?? null,
      volume: meta.regularMarketVolume ?? null} : {}),
  };
}

async function yahooChart(key, hostname, interval, range) {
  const query = new URLSearchParams({interval, range, includePrePost: "false"});
  const url = "https://" + hostname + "/v8/finance/chart/" + encodeURIComponent(market[key]) + "?" + query;
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

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (!url.pathname.endsWith("/api/market")) return new Response("Not found", {status: 404});
    const headers = {"Access-Control-Allow-Origin": "*", "Cache-Control": "no-store", "Content-Type": "application/json"};
    if (request.method !== "GET") return Response.json({error: "method"}, {status: 405, headers});
    const scope = url.searchParams.get("scope");
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
