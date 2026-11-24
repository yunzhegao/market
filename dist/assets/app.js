"use strict";

const byId = id => document.getElementById(id);
const finite = Number.isFinite;
const snapshot = window.MARKET_LIVE_SNAPSHOT;
const state = {data: window.MARKET_DATA, range: "day", mode: "line",
  live: snapshot?.quotes || {}, observations: snapshot?.observations || {}, context: window.MARKET_CONTEXT_SNAPSHOT || {}, checkedAt: null, sourceChecks: {}};
const sourceUrls = {
  investing: "https://www.investing.com/etfs/spdr-russell-1000-historical-data",
  cboe: "https://www.cboe.com/tradable-products/vix/",
  fred: "https://fred.stlouisfed.org/series/",
  cnn: "https://www.cnn.com/markets/fear-and-greed",
  fgscore: "https://fgscore.com/en/markets/sp500",
  edge: "https://edgeconsultancykw.com/us-market-wrap-20-november-2026/",
  treasury: "https://home.treasury.gov/resource-center/data-chart-center/interest-rates",
};
const yahooSymbols = {DXY: "DX-Y.NYB", GOLD: "GC=F", WTI: "CL=F", VIX: "^VIX"};
const required = ["SPYM", "VIX", "FEAR", "RSP", "SPY", "IWM", "OAS", "HYG", "JNK", "KRE", "DGS10", "DXY", "GOLD", "WTI"];
const headerTime = timeZone => new Intl.DateTimeFormat("zh-CN", {
  timeZone, month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

const beijingTime = headerTime("Asia/Shanghai");
const easternHeaderTime = headerTime("America/New_York");

const eastTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const eastDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});
const eastCalendar = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", timeZoneName: "short",
});
const scopes = {
  spym: ["SPYM"], indices: ["VIX", "SPY", "RSP", "IWM", "QQQ"],
  cross: ["HYG", "JNK", "KRE", "DXY", "GOLD", "WTI"], observations: ["OAS", "DGS10", "FEAR"],
};

const indicatorNames = {
  SPYM: "SPYM", VIX: "VIX 波动率", SPY: "SPY", RSP: "RSP", IWM: "IWM", QQQ: "QQQ",
  HYG: "HYG", JNK: "JNK", KRE: "KRE", DXY: "美元指数", GOLD: "黄金期货", WTI: "WTI 原油",
  OAS: "信用利差", DGS10: "十年期美债收益率", FEAR: "恐贪指数",
  DRAWDOWN: "52 周回撤", BREADTH50: "站上 50 日线", VIXTERM: "VIX / VIX3M",
};
const sourceGroups = [
  ["FRED", ["OAS", "DGS10"]],
  ["CNN", ["FEAR"]],
  ["市场报价", [...scopes.spym, ...scopes.indices, ...scopes.cross]],
  ["DeanFi", ["BREADTH50"]], ["Cboe", ["VIXTERM"]], ["SPYM 日线", ["DRAWDOWN"]],
];

function failuresLabel() {
  return sourceGroups.flatMap(([name, keys]) => {
    const missing = keys.filter(key => state.sourceChecks[key] === "failed");
    return missing.length ? [name + "（" + missing.map(key => indicatorNames[key]).join("、") + "）"] : [];
  }).join("；");
}

let spymDailyHistory;
let spymHistoryRequestDate;
const historical = key => {
  const saved = state.data?.series?.[key] || {rows: []};
  return key === "SPYM" && spymDailyHistory && last(spymDailyHistory.rows)[0] >= (last(saved.rows)?.[0] || "")
    ? spymDailyHistory : saved;
};
const series = key => {
  const cached = historical(key);
  const current = state.observations[key];
  if (!current) return cached;
  const day = last(current.rows)?.[0] || "";
  const cachedDay = last(cached.rows)?.[0] || "";
  if (day !== cachedDay) return day > cachedDay ? current : cached;
  const observedTime = item => Date.parse(item.timestamp ?? item.fetchedAt) || 0;
  return observedTime(current) >= observedTime(cached) ? current : cached;
};
const liveQuote = key => {
  const quote = state.live[key];
  return quote && quote.date >= (last(historical(key).rows)?.[0] || "") ? quote : null;
};
const last = rows => rows.at(-1);
const close = rows => last(rows)?.[1];
const pct = (now, before) => finite(now) && finite(before) && before !== 0 ? (now / before - 1) * 100 : NaN;
const direction = value => value > 0 ? "up" : value < 0 ? "down" : "";
const decimal = (value, digits = 2) => finite(value) ? value.toLocaleString("en-US", {minimumFractionDigits: digits, maximumFractionDigits: digits}) : "—";
const signed = (value, digits = 2, unit = "") => finite(value) ? (value > 0 ? "+" : value < 0 ? "−" : "") + decimal(Math.abs(value), digits) + unit : "—";
const percentage = value => signed(value, 2, "%");
const percentPoints = n => signed(n, 2, " 个百分点");
const shortDate = value => value ? value.slice(5).replace("-", "/") : "—";
const previous = rows => rows.at(-2)?.[1];
const change = data => finite(data.change) ? data.change : pct(close(data.rows), previous(data.rows));
const htmlText = (id, value) => { byId(id).textContent = value; };

function sourceURL(key) {
  const source = liveQuote(key)?.source || series(key).source;
  if (source === "nasdaq") return "https://www.nasdaq.com/market-activity/etf/" + key.toLowerCase();
  if (source === "fred") return sourceUrls.fred + (key === "OAS" ? "BAMLH0A0HYM2" : key);
  if (source === "stooq") return "https://stooq.com/q/?s=" + encodeURIComponent(key.toLowerCase() + ".us");
  return sourceUrls[source] || "https://finance.yahoo.com/quote/" + encodeURIComponent(yahooSymbols[key] || key) + (liveQuote(key) ? "/" : "/history/");
}

function updateLink(id, key) {
  byId(id).href = sourceURL(key);
}

function ageInDays(earlier, later) {
  return (Date.parse(later) - Date.parse(earlier)) / 86400000;
}

function markMeta(id, data, suffix = "") {
  const date = last(data.rows)?.[0];
  const target = byId(id);
  target.textContent = date ? shortDate(date) + (suffix ? " · " + suffix : "") : "暂无数据";
  target.title = date ? date + (data.timestamp ? " · " + beijingTime.format(new Date(data.timestamp)) + " 北京时间" : "") : "";
}

function observationFallback(key, date) {
  if (state.sourceChecks[key] !== "failed") return "";
  return date ? "沿用 " + shortDate(date) + " 数据" : "暂无数据";
}

function chip(id, label, tone = "") {
  htmlText(id, label);
  byId(id).dataset.tone = tone;
}

function highlight(id, label, value) {
  const node = byId(id);
  node.textContent = label;
  node.classList.toggle("up", value > 0);
  node.classList.toggle("down", value < 0);
}

function monthRows(rows) {
  const end = last(rows)?.[0];
  return end ? rows.filter(r => ageInDays(r[0], end) <= 30) : [];
}

function marketChange(key) {
  const quote = liveQuote(key);
  if (!quote) return change(series(key));
  return pct(quote.price, previousClose(key, quote));
}

function previousClose(key, quote) {
  if (finite(quote.previous) && quote.previous > 0) return quote.previous;
  return last(historical(key).rows.filter(row => row[0] < quote.date))?.[1];
}

function easternTimestamp(time, compact = false) {
  const {year, month, day, timeZoneName} = Object.fromEntries(eastCalendar.formatToParts(time)
    .map(({type, value}) => [type, value]));
  const date = compact ? month + "/" + day : year + "-" + month + "-" + day;
  return date + " " + eastTime.format(time) + " " + timeZoneName;
}

const oneDay = 86400000;

function observedAt(date, time) {
  if (finite(time) && time > 0) return String(time);
  return /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date : "";
}

function dataAge(value, now = Date.now()) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const today = easternTimestamp(now).slice(0, 10);
    const days = Math.floor((Date.parse(today) - Date.parse(value)) / oneDay);
    if (!finite(days) || days < 0) return "日期待核对";
    return days === 0 ? "今日观测" : days + " 天前";
  }
  const elapsed = now - Number(value);
  if (!finite(elapsed) || elapsed < -60000) return "时间待核对";
  const minutes = Math.max(0, Math.floor(elapsed / 60000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return minutes + " 分钟前";
  if (minutes < 1440) {
    const rest = minutes % 60;
    return Math.floor(minutes / 60) + " 小时" + (rest ? " " + rest + " 分钟" : "") + "前";
  }
  const hours = Math.floor(minutes / 60) % 24;
  return Math.floor(minutes / 1440) + " 天" + (hours ? " " + hours + " 小时" : "") + "前";
}

function setAge(node, date, time) {
  const observed = observedAt(date, time);
  node.dataset.observed = observed;
  node.textContent = dataAge(observed);
  node.hidden = !observed;
}

function refreshAges() {
  const now = Date.now();
  for (const node of document.querySelectorAll("[data-observed]")) {
    const age = dataAge(node.dataset.observed, now);
    if (node.textContent !== age) node.textContent = age;
  }
}

function quoteTime(quote) {
  return easternTimestamp(quote.time, true);
}

function renderQuote() {
  const data = historical("SPYM");
  const {rows} = data;
  const point = last(rows);
  const quote = liveQuote("SPYM");
  const latest = quote?.price ?? point?.[1];
  const before = quote ? previousClose("SPYM", quote) : previous(rows);
  byId("spym-price").innerHTML = finite(latest) ? '<span class="currency">$</span>' + decimal(latest) : "—";
  const daily = marketChange("SPYM");
  const delta = latest - before;
  highlight("spym-move", finite(daily) ? percentage(daily) + (finite(delta) ? "（" + signed(delta, 2) + "）" : "") : "—", daily);
  const stage = quote && finite(quote.sessionEnd) && quote.time >= quote.sessionEnd - 60000 ? "收盘" : "报价";
  htmlText("spym-date", quote ? easternTimestamp(quote.time) + " · " + stage
    : point ? point[0] + " 美东收盘" : "暂无报价");
  setAge(byId("spym-age"), quote?.date ?? point?.[0], quote?.time);
  htmlText("spym-prev", decimal(before));
  htmlText("spym-open", decimal(quote ? quote.open : point?.[2]));
  const high = quote ? quote.high : point?.[3];
  const low = quote ? quote.low : point?.[4];
  htmlText("spym-span", finite(low) && finite(high) ? decimal(low) + " / " + decimal(high) : "—");
  const month = monthRows(withDailyQuote(rows, quote));
  const monthly = month.length > 1 ? pct(latest, month[0][1]) : NaN;
  highlight("spym-month", percentage(monthly), monthly);
  updateLink("spym-link", "SPYM");
}

function rollingHigh(rows, date) {
  const cutoff = new Date(Date.parse(date) - 364 * 86400000).toISOString().slice(0, 10);
  if (ageInDays(cutoff, rows[0][0]) > 7) return null;
  return rows.reduce((high, row) => row[0] >= cutoff && row[0] <= date && (!high || row[1] >= high[1]) ? row : high, null);
}

function spymDrawdown() {
  const rows = state.context.DRAWDOWN?.rows || [];
  if (!rows.length) return {rows, value: NaN};
  const settled = last(rows);
  const quote = liveQuote("SPYM");
  const live = quote && (quote.date > settled[0] || (quote.date === settled[0] && finite(quote.sessionEnd) && quote.time >= quote.sessionEnd - 60000))
    ? quote : null;
  const date = live?.date ?? settled[0];
  const price = live?.price ?? settled[1];
  const high = rollingHigh(rows, date);
  return {rows, date, price, high, time: live?.time, value: high ? Math.min(0, pct(price, high[1])) : NaN};
}

function renderContext() {
  const {value} = spymDrawdown();
  highlight("spym-drawdown", percentage(value), value);
  const breadth = state.context.BREADTH50?.rows || [];
  const current = last(breadth);
  const move = current?.[1] - breadth.at(-6)?.[1];
  htmlText("breadth50-value", finite(current?.[1]) ? decimal(current[1]) + "%" : "—");
  highlight("breadth50-move", finite(move) ? "5 日 " + percentPoints(move) : "", move);
  htmlText("breadth50-date", current ? shortDate(current[0]) : "");

  const term = last(state.context.VIXTERM?.rows || []);
  htmlText("vix-term-value", decimal(term?.[1], 3));
  htmlText("vix-term-date", term ? shortDate(term[0]) + " 收盘" : "");
}

let contextRequestedAt = -Infinity;

async function refreshContext(force) {
  const now = Date.now();
  if (!force && now - contextRequestedAt < 300000) return;
  contextRequestedAt = now;
  const values = await (async () => {
    const response = await fetch(api + "/api/market?scope=context", {cache: "no-store", signal: AbortSignal.timeout(25000)});
    return response.ok ? (await response.json()).context : null;
  })().catch(() => null);
  for (const key of ["DRAWDOWN", "BREADTH50", "VIXTERM"]) {
    const next = values?.[key];
    const saved = state.context[key];
    const end = last(next?.rows || []);
    const valid = end && /^\d{4}-\d{2}-\d{2}$/.test(end[0]) && finite(end[1]);
    const savedDate = last(saved?.rows || [])?.[0] || "";
    const hasNewerTimestamp = !saved?.timestamp || Date.parse(next?.timestamp) >= Date.parse(saved.timestamp);
    if (valid && (end[0] > savedDate || (end[0] === savedDate && hasNewerTimestamp))) {
      state.context[key] = next;
      state.sourceChecks[key] = "ok";
    } else {
      state.sourceChecks[key] = valid && end[0] === savedDate ? "ok" : "failed";
    }
  }
  renderContext();
  renderStatus();
}

function withDailyQuote(rows, quote) {
  const latest = last(rows);
  if (!quote || !finite(quote.price) || !finite(quote.time) || quote.date < (latest?.[0] || "")) return rows;
  if (latest?.[0] === quote.date && finite(quote.sessionEnd)
      && quote.time < quote.sessionEnd - 60000 && Date.now() >= quote.sessionEnd) return rows;
  const today = latest?.[0] === quote.date ? latest : [];
  const trades = (quote.bars || []).filter(row => eastDay.format(row[0]) === quote.date);
  const prices = trades.flatMap(row => row.slice(1, 5).filter(finite));
  const open = quote.open ?? trades[0]?.[2] ?? today[2];
  const highs = [quote.high, today[3], ...prices].filter(finite);
  const lows = [quote.low, today[4], ...prices].filter(finite);
  const row = [quote.date, quote.price, open ?? null,
    highs.length ? Math.max(quote.price, open ?? quote.price, ...highs) : null,
    lows.length ? Math.min(quote.price, open ?? quote.price, ...lows) : null, quote.time];
  return [...rows.filter(item => item[0] < quote.date), row];
}

const fiveDayData = new Map();
const fiveDayRequests = new Map();

const sessionOffset = key => key === "GOLD" || key === "WTI" ? 6 * 3600000 : 0;

function mergedFiveDayRows(key, quote) {
  const chart = fiveDayData.get(key);
  if (!chart) return [];
  if (!quote || !finite(quote.time) || !finite(quote.price) || quote.time < chart.asOf) return chart.rows;
  const span = 300000;
  const bucket = Math.floor(quote.time / span) * span;
  const lastBar = last(chart.rows);
  if (bucket < lastBar[0]) return chart.rows;
  const bars = (quote.bars || []).filter(row => row[0] >= bucket && row[0] <= quote.time && hasOHLC(row));
  if (bucket === lastBar[0] && hasOHLC(lastBar)) bars.unshift(lastBar);
  const samples = bars.flatMap(row => row.slice(1, 5));
  const bar = bars.length
    ? [bucket, quote.price, bars[0][2], Math.max(quote.price, ...samples), Math.min(quote.price, ...samples), quote.time]
    : [bucket, quote.price, null, null, null, quote.time];
  const rows = [...chart.rows.filter(row => row[0] < bucket), bar];
  const days = rows.map(row => eastDay.format(row[0] + sessionOffset(key)));
  const start = [...new Set(days)].slice(-5)[0];
  return rows.slice(days.indexOf(start));
}

function fetchFiveDays(key) {
  if (!canFetchMarket) return Promise.resolve();
  const pending = fiveDayRequests.get(key);
  if (pending) return pending;
  const request = (async () => {
    const response = await fetch(api + "/api/market?scope=chart5&key=" + encodeURIComponent(key),
      {cache: "no-store", signal: AbortSignal.timeout(20000)});
    if (!response.ok) return;
    const {chart} = await response.json();
    if (!Array.isArray(chart?.rows) || !chart.rows.length || !finite(chart.asOf)
        || !chart.rows.every(row => Array.isArray(row) && finite(row[0]) && finite(row[1]))) return;
    if (chart.asOf >= (fiveDayData.get(key)?.asOf || 0)) fiveDayData.set(key, chart);
  })().catch(() => {}).finally(() => fiveDayRequests.delete(key));
  fiveDayRequests.set(key, request);
  return request;
}

async function refreshFiveDayChart() {
  const request = fetchFiveDays("SPYM");
  if (state.range === "5") renderChart();
  await request;
  if (state.range === "5") renderChart();
}

async function refreshSpymHistory() {
  const date = liveQuote("SPYM")?.date ?? eastDay.format(Date.now());
  if (!canFetchMarket || spymHistoryRequestDate === date) return;
  spymHistoryRequestDate = date;
  try {
    const response = await fetch(api + "/api/market?scope=detail&key=SPYM",
      {cache: "no-store", signal: AbortSignal.timeout(20000)});
    if (!response.ok) throw new Error("日线请求失败");
    const {detail} = await response.json();
    const history = detail?.history;
    if (!Array.isArray(history?.rows) || !history.rows.length) throw new Error("日线暂不可用");
    if (last(history.rows)[0] >= (last(spymDailyHistory?.rows || [])?.[0] || "")) spymDailyHistory = history;
    if (acceptQuote(detail?.quote)) recordCheck("SPYM", detail.quote, null, new Date().toISOString());
    render();
  } catch {
    if (spymHistoryRequestDate === date) spymHistoryRequestDate = null;
  }
}

const axisStyle = 'fill="var(--muted)" font-size="11"';

function dateLabel(row) {
  return typeof row[0] === "number" ? eastTime.format(row[0]) : shortDate(row[0]);
}

function pointTimestamp(row, dailyLabel = "美东交易日") {
  const time = finite(row[5]) ? row[5] : row[0];
  if (finite(time)) return easternTimestamp(time);
  return row[0] + " · " + dailyLabel;
}

function priceScale(values, top, bottom) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max((max - min) * .11, Math.abs(max) * .002, .0001);
  const low = min - pad;
  const high = max + pad;
  const y = value => bottom - (value - low) / (high - low) * (bottom - top);
  return {low, high, y};
}

const hasOHLC = row => row.slice(2, 5).length === 3 && row.slice(2, 5).every(finite);
const spymChart = {plot: null, selected: null};

function drawPlot(target, rows, {candle = false, base, history = rows, dailyLabel, sessions = false, dayOffset = 0, axisFormat = n => decimal(n, 1), axisWidth = 38} = {}) {
  const points = candle ? rows.filter(hasOHLC) : rows;
  if (!points.length) {
    target.replaceChildren();
    return null;
  }
  const width = Math.max(200, target.clientWidth || 600);
  const height = Math.max(62, target.clientHeight || 160);
  const left = 7, right = width - axisWidth, top = 7, bottom = height - 17;
  const step = (right - left) / points.length;
  const startTime = points[0][0];
  const endTime = last(points)[0];
  const timeSpan = typeof startTime === "number" ? endTime - startTime : 0;
  const x = !sessions && timeSpan > 0
    ? index => left + step * .5 + (points[index][0] - startTime) / timeSpan * (right - left - step)
    : index => left + step * (index + .5);
  const values = points.flatMap(r => candle ? [r[3], r[4]] : [r[1]]);
  if (finite(base)) values.push(base);
  const {low, high, y} = priceScale(values, top, bottom);
  const grid = Array.from({length: height < 110 ? 3 : 5}, (_, i) => {
    const intervals = height < 110 ? 2 : 4;
    const level = high - i * (high - low) / intervals;
    const pos = y(level).toFixed(2);
    return '<line x1="' + left + '" x2="' + right + '" y1="' + pos + '" y2="' + pos + '" stroke="var(--line)"/><text x="' + (right + 6) + '" y="' + (Number(pos) + 4) + '" ' + axisStyle + '>' + axisFormat(level) + '</text>';
  }).join("");
  const reference = finite(base) ? '<line x1="' + left + '" x2="' + right + '" y1="' + y(base) + '" y2="' + y(base) + '" stroke="var(--chart-guide)" stroke-dasharray="4 3"/>' : "";
  const sessionDays = sessions ? points.map(row => eastDay.format(row[0] + dayOffset)) : [];
  const starts = sessionDays.flatMap((day, i) => i === 0 || day !== sessionDays[i - 1] ? [i] : []);
  const separators = starts.slice(1).map(index => {
    const pos = (x(index - 1) + x(index)) / 2;
    return '<line x1="' + pos + '" x2="' + pos + '" y1="' + top + '" y2="' + bottom
      + '" stroke="var(--line)" stroke-dasharray="3 3"/>';
  }).join("");
  const count = Math.min(width < 400 ? 4 : 5, points.length);
  const tickPositions = sessions
    ? starts.map((start, i) => ({index: Math.floor((start + (starts[i + 1] ?? points.length) - 1) / 2), label: shortDate(sessionDays[start])}))
    : Array.from({length: count}, (_, i) => {
      const index = count === 1 ? 0 : Math.round(i * (points.length - 1) / (count - 1));
      return {index, label: dateLabel(points[index])};
    });
  const dateTicks = tickPositions.map(({index, label}) => {
    const pos = Math.max(25, Math.min(right - 7, x(index)));
    return '<text x="' + pos + '" y="' + (height - 2) + '" text-anchor="middle" ' + axisStyle + '>' + label + '</text>';
  }).join("");
  let graphics;
  if (candle) {
    const bodyWidth = Math.min(26, step * .58);
    graphics = points.map(([, end, start, highPrice, lowPrice], i) => {
      const pos = x(i);
      const color = end >= start ? "var(--up)" : "var(--down)";
      return '<line x1="' + pos + '" x2="' + pos + '" y1="' + y(highPrice) + '" y2="' + y(lowPrice) + '" stroke="' + color + '" stroke-width="1.5"/><rect x="' + (pos - bodyWidth / 2) + '" y="' + y(Math.max(start, end)) + '" width="' + bodyWidth + '" height="' + Math.max(2, Math.abs(y(start) - y(end))) + '" rx="1" fill="' + color + '"/>';
    }).join("");
  } else {
    const groups = sessions ? starts : [0];
    graphics = '<defs><linearGradient id="' + target.id + '-area" x2="0" y2="1"><stop stop-color="var(--chart-line)" stop-opacity=".18"/><stop offset="1" stop-color="var(--chart-line)" stop-opacity=".02"/></linearGradient></defs>'
      + groups.map((start, group) => {
        const end = groups[group + 1] ?? points.length;
        const path = points.slice(start, end).map((r, i) => (i === 0 ? "M" : "L") + x(start + i) + "," + y(r[1])).join(" ");
        return '<path fill="url(#' + target.id + '-area)" d="' + path + ' L' + x(end - 1) + ',' + bottom + ' L' + x(start) + ',' + bottom + ' Z"/>'
          + '<path fill="none" stroke="var(--chart-line)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="' + path + '"/>';
      }).join("");
  }
  target.innerHTML = '<svg viewBox="0 0 ' + width + ' ' + height + '" aria-hidden="true">' + grid + separators + reference + graphics + dateTicks
    + '<line data-guide stroke="var(--chart-guide)" stroke-opacity=".75" stroke-dasharray="4 3"/><circle data-cursor r="4.1" fill="var(--chart-line)" stroke="var(--page)" stroke-width="1.6"/></svg>';
  const tip = document.createElement("div");
  tip.className = "chart-point-tip";
  tip.hidden = true;
  tip.setAttribute("aria-hidden", "true");
  const tipTime = document.createElement("span");
  const tipValue = document.createElement("strong");
  tip.append(tipTime, tipValue);
  target.append(tip);
  const previousValues = new Map(history.map((row, i) => [row[0], history[i - 1]?.[1]]));
  return {points, x, y, top, bottom, width, height, candle, base, previousValues, dailyLabel,
    guide: target.querySelector("[data-guide]"), cursor: target.querySelector("[data-cursor]"),
    tip, tipTime, tipValue};
}

function plotPoint(view, readout, format) {
  if (!view.plot) {
    readout.textContent = "";
    return;
  }
  const {points, x, y, top, bottom, width, height, candle, base, previousValues, dailyLabel,
    guide, cursor, tip, tipTime, tipValue} = view.plot;
  const index = Math.min(view.selected ?? points.length - 1, points.length - 1);
  const row = points[index];
  const stamp = pointTimestamp(row, dailyLabel);
  const [, closeValue, open, high, low] = row;
  const before = finite(base) ? base : previousValues.get(row[0]) ?? points[index - 1]?.[1];
  const tone = direction(closeValue - before);
  const value = document.createElement("strong");
  value.className = tone;
  value.textContent = candle ? "开 " + format(open) + " 高 " + format(high) + " 低 " + format(low) + " 收 " + format(closeValue) : format(closeValue);
  readout.textContent = stamp + "  ";
  readout.append(value);
  const pos = x(index);
  const level = y(closeValue);
  const selected = view.selected !== null;
  guide.setAttribute("x1", pos);
  guide.setAttribute("x2", pos);
  guide.setAttribute("y1", top);
  guide.setAttribute("y2", bottom);
  guide.style.opacity = selected ? "1" : "0";
  cursor.setAttribute("cx", pos);
  cursor.setAttribute("cy", level);
  cursor.style.opacity = candle && !selected ? "0" : "1";
  tip.hidden = !selected;
  if (selected) {
    tipTime.textContent = stamp;
    tipValue.textContent = candle ? "收 " + format(closeValue) : format(closeValue);
    tipValue.className = tone;
    const side = pos + tip.offsetWidth + 10 < width ? pos + 10 : pos - tip.offsetWidth - 10;
    const vertical = level - tip.offsetHeight - 9 >= 0 ? level - tip.offsetHeight - 9 : level + 10;
    tip.style.left = Math.max(4, Math.min(width - tip.offsetWidth - 4, side)) + "px";
    tip.style.top = Math.max(0, Math.min(height - tip.offsetHeight, vertical)) + "px";
  }
}

function pointIndex(view, x) {
  const {points, x: at} = view.plot;
  let index = 0;
  while (index + 1 < points.length && x >= (at(index) + at(index + 1)) / 2) index++;
  return index;
}

function bindPlot(target, view, show) {
  function move(event) {
    if (!view.plot) return;
    const index = pointIndex(view, event.clientX - target.getBoundingClientRect().left);
    if (index === view.selected) return;
    view.selected = index;
    show();
  }
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerdown", move);
  target.addEventListener("pointerleave", event => {
    if (event.pointerType !== "mouse") return;
    view.selected = null;
    show();
  });
  target.addEventListener("keydown", event => {
    if (!view.plot) return;
    const next = plotKey(event.key, view.selected, view.plot.points.length);
    if (next === undefined || (next === null && view.selected === null)) return;
    if (next !== null) event.preventDefault();
    view.selected = next;
    show();
  });
}

function plotKey(key, selected, length) {
  const end = length - 1;
  const index = selected ?? end;
  if (key === "Escape") return null;
  if (key === "Home") return 0;
  if (key === "End") return end;
  if (key === "ArrowLeft") return Math.max(0, index - 1);
  if (key === "ArrowRight") return Math.min(end, index + 1);
}

function showSpymPoint() {
  plotPoint(spymChart, byId("chart-readout"), n => "$" + decimal(n));
}

function renderChart() {
  const quote = liveQuote("SPYM");
  const rows = withDailyQuote(historical("SPYM").rows, quote);
  const intraday = state.range === "day";
  const sessions = state.range === "5";
  const active = intraday ? quote?.bars || [] : sessions ? mergedFiveDayRows("SPYM", quote) : monthRows(rows);
  const candleButton = document.querySelector('[data-mode="candle"]');
  const loading = sessions && fiveDayRequests.has("SPYM");
  candleButton.disabled = !loading && !active.some(hasOHLC);
  if (candleButton.disabled && state.mode === "candle") {
    state.mode = "line";
    candleButton.setAttribute("aria-pressed", "false");
    document.querySelector('[data-mode="line"]').setAttribute("aria-pressed", "true");
  }
  const base = intraday && quote ? previousClose("SPYM", quote) : null;
  htmlText("chart-unit", intraday ? "美东时间 · " + (finite(base) ? "颜色对比前收，虚线为前收" : "颜色对比前一观测值")
    : sessions ? "美东时间 · 最近 5 个交易日 · 5 分钟"
    : "USD · 未复权日线 · 当日点位随报价更新");
  htmlText("chart-empty", sessions ? (loading ? "正在读取 5 日分时…" : "5 日分时暂不可用。")
    : intraday ? "分时数据暂不可用，可查看日线。" : "此区间暂无行情。");
  spymChart.plot = drawPlot(byId("price-chart"), active, {
    candle: state.mode === "candle", base, sessions,
    history: intraday || sessions ? active : rows,
  });
  byId("chart-empty").hidden = Boolean(spymChart.plot);
  showSpymPoint();
  renderTable(active);
}

function renderTable(rows) {
  const entries = [...rows].reverse().map(([date, end, start, high, low, timestamp]) => {
    const cells = [start, high, low, end].map(n => '<td>' + decimal(n) + '</td>').join("");
    const at = finite(timestamp) ? timestamp : date;
    return '<tr><th scope="row">' + (finite(at) ? easternTimestamp(at) : date) + '</th>' + cells + '</tr>';
  }).join("");
  byId("history-table").innerHTML = '<table class="history-table" aria-label="SPYM 行情数据"><thead><tr><th scope="col">美东时间</th><th scope="col">开盘</th><th scope="col">最高</th><th scope="col">最低</th><th scope="col">收盘</th></tr></thead><tbody>'
    + (entries || '<tr><td colspan="5">暂无数据</td></tr>') + '</tbody></table>';
}

const sparkData = new Map();

function spark(id, rows, caption, format, color) {
  const target = byId(id);
  const points = rows.filter(row => finite(row[1])).slice(-20);
  const prior = rows.length > points.length ? rows.at(-points.length - 1)?.[1] : undefined;
  const existing = sparkData.get(target);
  if (existing?.prior === prior && existing?.points.length === points.length && points.every((row, i) =>
    row[0] === existing.points[i][0] && row[1] === existing.points[i][1] && row[5] === existing.points[i][5])) return;
  sparkData.set(target, {points, format, prior});
  if (points.length < 2) {
    target.innerHTML = '<span class="spark-empty">历史点位不足</span>';
    return;
  }
  const values = points.map(row => row[1]);
  const {y} = priceScale(values, 4, 38);
  const coords = values.map((value, i) => [3 + i * 254 / (values.length - 1), y(value)]);
  const profile = coords.map(c => c.map(x => x.toFixed(2)).join(",")).join(" ");
  const [endX, endY] = last(coords);
  target.innerHTML = '<span class="spark-graph"><svg viewBox="0 0 260 43" preserveAspectRatio="none" aria-hidden="true"><path d="M3,38H257" stroke="var(--line)" fill="none"/><polyline points="' + profile + '" stroke="' + color + '" stroke-width="1.8" vector-effect="non-scaling-stroke" fill="none" stroke-linejoin="round"/><circle cx="' + endX + '" cy="' + endY + '" r="2.55" fill="' + color + '"/><line data-spark-guide y1="3" y2="38" stroke="var(--chart-guide)" vector-effect="non-scaling-stroke" stroke-dasharray="3 2" visibility="hidden"/><circle data-spark-dot r="3" fill="' + color + '" stroke="var(--page)" vector-effect="non-scaling-stroke" visibility="hidden"/></svg></span>'
    + '<span class="spark-caption"><span>' + caption + '</span><span>' + shortDate(points[0][0]) + '–' + shortDate(last(points)[0]) + '</span></span>';
  sparkData.get(target).coords = coords;
}

function vixBand(value) {
  if (!finite(value)) return ["暂无数据"];
  if (value >= 40) return ["极端恐慌", "alert"];
  if (value >= 30) return ["恐慌", "alert"];
  if (value >= 25) return ["明显紧张", "warm"];
  if (value >= 18) return ["波动升温", "warm"];
  return ["相对平静", "calm"];
}

function fearBand(value) {
  if (!finite(value)) return ["暂无数据"];
  if (value < 25) return ["极度恐惧", "alert"];
  if (value < 45) return ["恐惧", "warm"];
  if (value <= 55) return ["中性"];
  if (value < 75) return ["贪婪", "calm"];
  return ["极度贪婪", "warm"];
}

const metricMarkup = new Map();

function updateMetricButtons(id, markup) {
  if (metricMarkup.get(id) === markup) return;
  metricMarkup.set(id, markup);
  const target = byId(id);
  const focused = target.contains(document.activeElement) ? document.activeElement.dataset.indicator : null;
  target.innerHTML = markup;
  if (focused) target.querySelector('[data-indicator="' + focused + '"]')?.focus({preventScroll:true});
}

function metricList(id, keys, commonDate) {
  const markup = keys.map(key => {
    const data = series(key);
    const live = liveQuote(key);
    const value = marketChange(key);
    const date = live?.date ?? last(data.rows)?.[0];
    const note = date !== commonDate && date ? " <small>" + (live ? quoteTime(live) : shortDate(date)) + "</small>" : "";
    return '<button class="indicator-trigger metric-button" type="button" data-indicator="' + key + '" aria-haspopup="dialog"><span>' + key + '</span><strong class="' + direction(value) + '">' + percentage(value) + '</strong>' + note + '</button>';
  }).join("");
  updateMetricButtons(id, markup);
}

function renderSignals() {
  const vix = series("VIX");
  const vixLive = liveQuote("VIX");
  const volatility = vixLive?.price ?? close(vix.rows);
  const vixMove = volatility - (vixLive ? previousClose("VIX", vixLive) : previous(vix.rows));
  htmlText("vix-value", decimal(volatility));
  chip("vix-band", ...vixBand(volatility));
  const vixSuffix = finite(vixMove) ? signed(vixMove, 2, " 点") : "";
  if (vixLive) htmlText("vix-meta", quoteTime(vixLive) + (vixSuffix ? " · " + vixSuffix : ""));
  else markMeta("vix-meta", vix, vixSuffix);
  setAge(byId("vix-age"), vixLive?.date ?? last(vix.rows)?.[0], vixLive?.time);
  spark("vix-spark", withQuote(vix.rows, vixLive), "VIX · 点", n => decimal(n) + " 点", "var(--down)");

  const fear = series("FEAR");
  const mood = close(fear.rows);
  const fearMove = mood - (fear.previous ?? previous(fear.rows));
  htmlText("fear-value", decimal(mood, 0));
  chip("fear-band", ...fearBand(mood));
  const fearSuffix = finite(fearMove) ? signed(fearMove, 0, " 点") : "";
  if (finite(Date.parse(fear.timestamp))) htmlText("fear-meta", easternTimestamp(Date.parse(fear.timestamp), true) + (fearSuffix ? " · " + fearSuffix : ""));
  else markMeta("fear-meta", fear, fearSuffix);
  const fearTime = Date.parse(fear.timestamp);
  setAge(byId("fear-age"), last(fear.rows)?.[0], fearTime);
  const fearPoints = finite(fearTime) ? withQuote(fear.rows, {date: last(fear.rows)?.[0], price: mood, time: fearTime}) : fear.rows;
  spark("fear-spark", fearPoints, "恐贪 · 0–100", n => decimal(n, 1) + " 分", "var(--down)");

  const rsp = series("RSP");
  const spy = series("SPY");
  const spyByDate = new Map(spy.rows.map(row => [row[0], row[1]]));
  const ratio = rsp.rows.filter(row => spyByDate.get(row[0]) > 0).map(row => [row[0], row[1] / spyByDate.get(row[0])]);
  const rspLive = liveQuote("RSP");
  const spyLive = liveQuote("SPY");
  const matched = rspLive && spyLive && rspLive.date === spyLive.date && Math.abs(rspLive.time - spyLive.time) <= 900000;
  const liveRatio = matched ? {...rspLive, price: rspLive.price / spyLive.price, time: Math.min(rspLive.time, spyLive.time)} : null;
  const before = matched ? previousClose("RSP", rspLive) / previousClose("SPY", spyLive) : null;
  const breadth = matched ? pct(liveRatio.price, before) : pct(close(ratio), previous(ratio));
  highlight("breadth-value", percentage(breadth), breadth);
  chip("breadth-band", !finite(breadth) ? "暂无数据" : breadth > 0 ? "等权跑赢" : breadth < 0 ? "等权落后" : "相对持平");
  if (matched) htmlText("breadth-meta", quoteTime(liveRatio) + " · 比率日变动");
  else markMeta("breadth-meta", {rows: ratio}, "比率日变动");
  setAge(byId("breadth-age"), liveRatio?.date ?? last(ratio)?.[0], liveRatio?.time);
  spark("breadth-spark", withQuote(ratio, liveRatio), "RSP / SPY · 价格比", n => decimal(n, 4), "var(--chart-line)");
  metricList("breadth-rows", ["RSP", "SPY", "IWM"], liveRatio?.date ?? last(ratio)?.[0]);

  const credit = series("OAS");
  const spread = close(credit.rows) * 100;
  const widening = (close(credit.rows) - previous(credit.rows)) * 100;
  const recent = spread - credit.rows.at(-5)?.[1] * 100;
  htmlText("credit-value", decimal(spread, 0));
  chip("credit-band", !finite(widening) ? "暂无变化" : widening > .5 ? "利差扩大" : widening < -.5 ? "利差收窄" : "利差持平", widening > .5 ? "warm" : "");
  markMeta("credit-meta", credit, finite(recent) ? "近 5 点 " + signed(recent, 0, " bp") : "");
  setAge(byId("credit-age"), last(credit.rows)?.[0]);
  const creditFallback = byId("credit-fallback");
  creditFallback.textContent = observationFallback("OAS", last(credit.rows)?.[0]);
  creditFallback.hidden = !creditFallback.textContent;
  spark("credit-spark", credit.rows, "高收益债利差 · bp", n => decimal(n * 100, 0) + " bp", "var(--warm)");
  metricList("credit-rows", ["HYG", "JNK", "KRE"], last(credit.rows)?.[0]);

  renderMarketRows("cross-rows", [["DGS10", "10年美债", "%"], ["DXY", "美元指数", ""], ["GOLD", "黄金期货", ""], ["WTI", "WTI原油", ""]]);
  renderMarketRows("bench-rows", [["SPY", "标普 500", ""], ["QQQ", "纳指 100", ""], ["IWM", "罗素 2000", ""]]);
}

function withQuote(rows, quote) {
  return quote ? [...rows.filter(row => row[0] < quote.date), [quote.date, quote.price, null, null, null, quote.time]] : rows;
}

function renderMarketRows(id, labels) {
  const markup = labels.map(([key, title, unit]) => {
    const data = series(key);
    const live = liveQuote(key);
    const current = live?.price ?? close(data.rows);
    const value = key === "DGS10" ? (current - previous(data.rows)) * 100 : marketChange(key);
    const date = live?.date ?? last(data.rows)?.[0];
    const stamp = live ? quoteTime(live) : shortDate(date);
    const observed = observedAt(date, live?.time);
    const age = observed ? '<small class="data-age" data-observed="' + observed + '">' + dataAge(observed) + '</small>' : "";
    const fallback = key === "DGS10" ? observationFallback(key, date) : "";
    const timing = fallback ? '<small class="observation-fallback" title="' + (date || "") + '">' + fallback + '</small>'
      : '<small>' + stamp + '</small>' + age;
    return '<button class="cross-row indicator-trigger" type="button" data-indicator="' + key + '" aria-haspopup="dialog"><span class="cross-name"><b>' + title + '</b><span class="cross-time">' + timing + '</span></span><strong>' + decimal(current) + (finite(current) ? unit : "") + '</strong><span class="' + direction(value) + '">' + (key === "DGS10" ? signed(value, 0, " bp") : percentage(value)) + '</span></button>';
  }).join("");
  updateMetricButtons(id, markup);
}

function renderStatus() {
  const checked = state.checkedAt ?? snapshot?.checkedAt ?? state.data?.checkedAt;
  const time = byId("sync-time");
  time.hidden = !checked || !finite(Date.parse(checked));
  if (!time.hidden) {
    time.dateTime = checked;
    time.textContent = (state.checkedAt ? "请求 " : filePage && !canFetchMarket ? "离线快照 " : "快照 ") + beijingTime.format(new Date(checked)) + " 北京 · " + easternHeaderTime.format(new Date(checked)) + " 美东";
    time.title = state.checkedAt ? "本次请求时间（北京 / 美东）" : "随网页发布的快照（北京 / 美东）";
  }
  const status = byId("sync-status");
  const failures = failuresLabel();
  status.textContent = missingPagesApi ? "GitHub Pages 尚未配置行情接口 · 显示快照"
    : failures ? "本次核对失败，是否有新值未知 · " + failures : "";
  status.hidden = status.textContent === "";
}

function render() {
  renderStatus();
  renderQuote();
  renderSignals();
  renderContext();
  renderChart();
}

function viable(data) {
  return data?.version === 1 && !!data.series && required.every(key => {
    const rows = data.series[key]?.rows;
    return Array.isArray(rows) && rows.every(r => Array.isArray(r) && /^\d{4}-\d{2}-\d{2}$/.test(r[0]) && finite(r[1]));
  });
}

function acceptQuote(quote) {
  return quote && finite(quote.price) && quote.price > 0 && finite(quote.time)
    && /^\d{4}-\d{2}-\d{2}$/.test(quote.date) && ["yahoo", "nasdaq"].includes(quote.source);
}

const configuredApi = window.MARKET_LIVE_CONFIG?.apiBase?.replace(/\/$/, "");
const api = configuredApi || ".";
const filePage = location.protocol === "file:";
const missingPagesApi = /(?:^|\.)github\.io$/i.test(location.hostname || "") && !configuredApi;
const canFetchMarket = filePage ? /^https:\/\//i.test(configuredApi || "") : !missingPagesApi;

function recordCheck(key, quote, observation, fetchedAt) {
  if (acceptQuote(quote)) {
    const saved = liveQuote(key);
    const marketDate = last(historical(key).rows)?.[0] || "";
    if (quote.date < marketDate || (saved && quote.time < saved.time)) return "failed";
    state.live[key] = {...quote, fetchedAt};
    return "ok";
  }
  const sample = Array.isArray(observation?.rows) && last(observation.rows);
  if (!sample || !/^\d{4}-\d{2}-\d{2}$/.test(sample[0]) || !finite(sample[1])) return "failed";
  if (observation.source !== (key === "FEAR" ? "cnn" : "fred")) return "failed";
  const saved = series(key);
  const prior = last(saved.rows);
  const timestamp = observation.timestamp;
  if ((prior && sample[0] < prior[0]) || (saved.timestamp && !(timestamp >= saved.timestamp))) return "failed";
  state.observations[key] = {...observation, fetchedAt};
  return "ok";
}

async function readScope(scope) {
  const response = await fetch(api + "/api/market?scope=" + scope,
    {cache: "no-store", signal: AbortSignal.timeout(25000)});
  if (!response.ok) throw new Error("行情请求失败");
  const payload = await response.json();
  const fetchedAt = finite(Date.parse(payload.checkedAt)) ? payload.checkedAt : new Date().toISOString();
  return Object.fromEntries(scopes[scope].map(key => [
    key, recordCheck(key, payload.quotes?.[key], payload.observations?.[key], fetchedAt),
  ]));
}

async function loadDaily() {
  try {
    const response = await fetch("./assets/market-data.json", {cache: "no-cache"});
    if (!response.ok) return;
    const data = await response.json();
    if (viable(data)) {
      state.data = data;
      render();
    }
  } catch {
    // The embedded historical data is still available.
  }
}

async function refresh(forceContext = false) {
  const button = byId("refresh");
  if (button.disabled) return;
  button.disabled = true;
  state.checkedAt = new Date().toISOString();
  renderStatus();
  try {
    const requests = Object.entries(scopes).map(async ([scope, keys]) => {
      const checks = await readScope(scope).catch(() => Object.fromEntries(keys.map(key => [key, "failed"])));
      Object.assign(state.sourceChecks, checks);
      render();
    });
    requests.push(refreshContext(forceContext));
    if (state.range === "5") requests.push(refreshFiveDayChart());
    await Promise.all(requests);
    if (state.range === "month") await refreshSpymHistory();
    document.dispatchEvent(new Event("market-refreshed"));
  } finally {
    button.disabled = false;
  }
}

for (const type of ["range", "mode"]) {
  const buttons = document.querySelectorAll("[data-" + type + "]");
  for (const button of buttons) {
    button.addEventListener("click", () => {
      state[type] = button.dataset[type];
      spymChart.selected = null;
      for (const peer of buttons) peer.setAttribute("aria-pressed", peer === button ? "true" : "false");
      if (state.range === "5" && type === "range") refreshFiveDayChart();
      else renderChart();
      if (state.range === "month" && type === "range") refreshSpymHistory();
    });
  }
}
const chart = byId("price-chart");

bindPlot(chart, spymChart, showSpymPoint);
new ResizeObserver(() => renderChart()).observe(chart);

const theme = byId("theme");

function applyTheme(mode) {
  const dark = mode === "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  theme.setAttribute("aria-pressed", String(dark));
  theme.title = dark ? "切换到日间模式" : "切换到夜间模式";
  byId("theme-color").setAttribute("content", dark ? "#10141b" : "#ffffff");
}

try {
  applyTheme(localStorage.getItem("market-monitor-theme"));
} catch {
  applyTheme("light");
}

theme.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  try {
    localStorage.setItem("market-monitor-theme", next);
  } catch {
    // Theme still applies for this visit.
  }
});

for (const button of document.querySelectorAll("[data-dialog]")) {
  button.addEventListener("click", () => byId(button.dataset.dialog).showModal());
}

const refreshButton = byId("refresh");
refreshButton.addEventListener("click", () => {
  if (canFetchMarket) {
    refresh(true);
  } else if (missingPagesApi) {
    renderStatus();
  } else {
    const status = byId("sync-status");
    status.textContent = "本地文件仅显示快照。请打开在线版，或用随包的本地服务启动。";
    status.hidden = false;
  }
});

render();
setInterval(refreshAges, 15000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshAges();
});
if (!filePage) loadDaily();
if (canFetchMarket) {
  refresh();
  setInterval(() => {
    if (!document.hidden) refresh();
  }, 60000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
}
