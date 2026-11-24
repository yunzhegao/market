"use strict";

const indicatorDefinitions = {
  DRAWDOWN: ["SPYM · 52 周回撤", "用最新报价除以前 52 周内的最高日收盘价。达到或超过这个收盘高点时，回撤为 0%。", "%"],
  BREADTH50: ["标普 500 · 站上 50 日均线的比例", "DeanFi 统计收盘价站上各自 50 日均线的标普 500 成分股比例。盘中读数以数据源最近一批更新为准。", "%"],
  VIXTERM: ["VIX / VIX3M · 波动率期限结构", "Cboe 同一交易日的 VIX 收盘值除以 VIX3M 收盘值。高于 1 表示 30 天隐含波动率高于 3 个月。", "倍"],
  SPYM: ["SPYM · 标普 500 ETF", "道富发行的 ETF，跟踪市值加权的标普 500 指数。", "USD"],
  VIX: ["VIX 波动率", "由标普 500 指数期权价格推算未来 30 天的预期波动率。数值上升表示隐含波动率抬高。", "点"],
  FEAR: ["CNN 恐惧与贪婪指数", "综合股票动量、波动率等七项市场指标。分数越低，市场情绪越偏恐惧。", "分"],
  BREADTH: ["市场广度 · RSP / SPY", "用等权重标普 500 ETF 除以市值加权标普 500 ETF 的价格。比率上升表示等权相对跑赢。", "比率"],
  OAS: ["美国高收益债信用利差", "美国高收益公司债相对于基准国债曲线的期权调整后利差。100 个基点等于 1 个百分点。", "bp"],
  RSP: ["RSP · 标普 500 等权 ETF", "跟踪标普 500 等权指数，成分股在定期再平衡时采用相同权重。", "USD"],
  SPY: ["SPY · 标普 500 ETF", "跟踪市值加权的标普 500 指数，反映美国大盘股的整体表现。", "USD"],
  IWM: ["IWM · 罗素 2000 ETF", "跟踪罗素 2000 指数，用来观察美国小盘股。", "USD"],
  QQQ: ["QQQ · 纳斯达克 100 ETF", "跟踪纳斯达克 100 指数，覆盖纳斯达克上市的大型非金融公司。", "USD"],
  HYG: ["HYG · 高收益公司债 ETF", "跟踪美元计价高收益公司债。基金价格同时受到利率和信用风险变化影响。", "USD"],
  JNK: ["JNK · 高收益债 ETF", "跟踪美元高收益公司债指数，可与 HYG 一起观察高收益债价格。", "USD"],
  KRE: ["KRE · 美国区域银行 ETF", "跟踪美国区域银行板块。可作为观察区域银行股票表现的参考。", "USD"],
  DGS10: ["美国 10 年期国债收益率", "美国 10 年期恒定期限国债收益率，按 FRED 公布的日度观测值展示。", "%"],
  DXY: ["美元指数 · DXY", "衡量美元相对一篮子主要货币的强弱。指数上升意味着美元相对该篮子走强。", "点"],
  GOLD: ["黄金期货 · COMEX", "黄金期货连续合约报价，单位为美元／金衡盎司，换月可能影响价格序列。", "USD"],
  WTI: ["WTI 原油期货", "西得州中质原油期货连续合约报价，单位为美元／桶，换月可能影响价格序列。", "USD"],
};
const contextKeys = new Set(["DRAWDOWN", "BREADTH50", "VIXTERM"]);
const observationKeys = new Set(["FEAR", "OAS", "DGS10", ...contextKeys]);
const detailDialog = byId("indicator-detail");
const detailChart = byId("indicator-chart");
const detailView = {key: null, range: "month", mode: "line", plot: null, selected: null, controller: null};
const rangeButtons = [...detailDialog.querySelectorAll("[data-detail-range]")];
const modeButtons = [...detailDialog.querySelectorAll("[data-detail-mode]")];
const keyTip = byId("indicator-tip");

function detailValue(key, value) {
  if (!finite(value)) return "—";
  const [, , unit] = indicatorDefinitions[key];
  if (unit === "比率") return decimal(value, 4);
  if (unit === "倍") return decimal(value, 3) + " 倍";
  if (unit === "USD") return "$" + decimal(value);
  if (unit === "%") return decimal(value) + "%";
  if (unit === "bp") return decimal(value * 100, 0) + " bp";
  return decimal(value, key === "FEAR" ? 1 : 2) + " " + unit;
}

function ratioRows(left, right) {
  const rightByTime = new Map();
  for (const row of right) {
    if (!finite(row[1]) || row[1] === 0) continue;
    const stamp = typeof row[0] === "number" ? Math.floor(row[0] / 300000) * 300000 : row[0];
    rightByTime.set(stamp, row[1]);
  }
  const paired = new Map();
  for (const row of left) {
    const stamp = typeof row[0] === "number" ? Math.floor(row[0] / 300000) * 300000 : row[0];
    if (rightByTime.has(stamp) && finite(row[1])) paired.set(stamp, [stamp, row[1] / rightByTime.get(stamp)]);
  }
  return [...paired.values()];
}

function recentQuote(primary, fetched) {
  if (!acceptQuote(fetched)) return primary;
  if (primary && primary.date > fetched.date) return primary;
  if (primary && primary.time > fetched.time) {
    return {...fetched, ...primary};
  }
  return fetched;
}

function historicalRows(key, fetched) {
  const known = series(key).rows;
  const returned = fetched?.rows || [];
  if (!returned.length || (last(known)?.[0] ?? "") > last(returned)[0]) return known;
  return returned;
}

function contextModel(key) {
  if (key === "DRAWDOWN") {
    const latest = spymDrawdown();
    if (!latest.date || !finite(latest.value)) return {rows: [], bars: [], value: NaN};
    const daily = monthRows(latest.rows).flatMap(row => {
      const high = rollingHigh(latest.rows, row[0]);
      return high ? [[row[0], Math.min(0, pct(row[1], high[1]))]] : [];
    });
    const rows = [...daily.filter(row => row[0] < latest.date), [latest.date, latest.value, null, null, null, latest.time]];
    return {...latest, rows, bars: []};
  }
  const data = state.context[key];
  const rows = data?.rows || [];
  const [date, value] = last(rows) || [];
  const before = key === "BREADTH50" ? rows.at(-6)?.[1] : previous(rows);
  return {rows, bars: [], before, value, move: value - before, date,
    time: key === "BREADTH50" ? Date.parse(data?.timestamp) : null};
}

function detailModel(key, returned) {
  if (contextKeys.has(key)) return contextModel(key);
  if (key === "BREADTH") {
    const left = detailModel("RSP", returned?.components?.RSP);
    const right = detailModel("SPY", returned?.components?.SPY);
    const rows = ratioRows(left.rows, right.rows);
    const bars = ratioRows(left.bars, right.bars);
    const matched = left.quote && right.quote && left.quote.date === right.quote.date && Math.abs(left.quote.time - right.quote.time) <= 900000;
    const before = matched ? left.before / right.before : previous(rows);
    const value = matched ? left.value / right.value : close(rows);
    return {rows, bars, before, value, move: pct(value, before),
      date: matched ? left.quote.date : last(rows)?.[0],
      time: matched ? Math.min(left.quote.time, right.quote.time) : null, interval: 5};
  }

  if (observationKeys.has(key)) {
    const base = series(key);
    const observed = returned?.observation;
    const visible = observed && last(observed.rows)?.[0] >= (last(base.rows)?.[0] || "")
      && (!base.timestamp || Date.parse(observed.timestamp) >= Date.parse(base.timestamp)) ? observed : base;
    const rows = visible.rows;
    const value = close(rows);
    const before = visible.previous ?? previous(rows);
    return {rows, bars: [], before, value, move: (value - before) * (key === "FEAR" ? 1 : 100),
      date: last(rows)?.[0], time: Date.parse(visible.timestamp)};
  }

  const rows = historicalRows(key, returned?.history);
  const quote = recentQuote(liveQuote(key), returned?.quote);
  const value = quote?.price ?? close(rows);
  const fallbackClose = quote ? last(rows.filter(row => row[0] < quote.date))?.[1] : previous(rows);
  const before = quote?.previous ?? fallbackClose;
  const move = key === "VIX" ? value - before : pct(value, before);
  return {rows, quote, bars: quote?.bars || [], before, value, move, interval: quote?.interval,
    date: quote?.date ?? last(rows)?.[0], time: quote?.time};
}

function moveLabel(key, move) {
  if (key === "BREADTH50") return finite(move) ? "5 日 " + percentPoints(move) : "—";
  if (key === "VIXTERM") return signed(move, 3);
  if (key === "DRAWDOWN") return "";
  if (key === "VIX" || key === "FEAR") return signed(move, key === "VIX" ? 2 : 1, " 点");
  if (key === "OAS" || key === "DGS10") return signed(move, 0, " bp");
  return percentage(move);
}

function modelTime(key, model) {
  if (!model.date) return "暂无观测时间";
  if (key === "BREADTH50") return model.date + " 美东交易日";
  if (key === "VIXTERM") return model.date + " 美东收盘";
  if (finite(model.time)) return easternTimestamp(model.time);
  return model.date + (observationKeys.has(key) ? " 观测值" : "");
}

function sourceLinks(key) {
  if (key === "DRAWDOWN") return state.context.DRAWDOWN?.source === "nasdaq"
    ? [["Nasdaq · SPYM 历史行情", "https://www.nasdaq.com/market-activity/etf/spym/historical"]]
    : [["Yahoo Finance · SPYM 历史行情", "https://finance.yahoo.com/quote/SPYM/history/"]];
  if (key === "BREADTH50") return [
    ["DeanFi · 历史数据", "https://github.com/DeanFinancials/deanfi-data/blob/main/advance-decline/ma_percentage_historical.json"],
    ["StockCharts · 指标说明", "https://chartschool.stockcharts.com/table-of-contents/market-indicators/percent-above-moving-average"],
  ];
  if (key === "VIXTERM" && state.context.VIXTERM?.source === "fred") return [
    ["FRED · VIX", sourceUrls.fred + "VIXCLS"],
    ["FRED · VIX3M", sourceUrls.fred + "VXVCLS"],
  ];
  if (key === "VIXTERM") return [
    ["Cboe · VIX", "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv"],
    ["Cboe · VIX3M", "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX3M_History.csv"],
  ];
  if (key === "BREADTH") return [
    ["RSP 行情", sourceURL("RSP")], ["SPY 行情", sourceURL("SPY")],
    ["标普 500 成分股热力图", "https://finviz.com/map.ashx?t=sec"],
  ];
  if (key === "FEAR") return [["CNN 恐惧与贪婪指数", sourceUrls.cnn]];
  if (key === "OAS" || key === "DGS10") return [["FRED 原始数据", sourceURL(key)]];
  if (key === "VIX") return [["Cboe VIX 指数", sourceUrls.cboe], ["VIX 行情", sourceURL(key)]];
  return [[key + " 源网站", sourceURL(key)]];
}

function renderDetailStats(key, model) {
  const {quote, before, rows} = model;
  const [, value, open, high, low] = last(rows) || [];
  const stats = [];
  if (finite(before)) stats.push([key === "BREADTH50" ? "5 个交易日前" : observationKeys.has(key) ? "上一读数" : "前一收盘", detailValue(key, before)]);
  if (key === "BREADTH50" && finite(model.time)) stats.push(["来源更新时间", easternTimestamp(model.time)]);
  if (key === "DRAWDOWN" && model.high) {
    stats.push(["52 周收盘高点", "$" + decimal(model.high[1]) + " · " + model.high[0]]);
    stats.push(["用于计算的价格", "$" + decimal(model.price)]);
  }
  const vol = state.context.VIXTERM;
  if (key === "VIXTERM" && finite(vol?.vix) && finite(vol?.vix3m)) {
    stats.push(["VIX 收盘", decimal(vol.vix)], ["VIX3M 收盘", decimal(vol.vix3m)]);
  }
  if (quote && finite(quote.open)) stats.push(["开盘", detailValue(key, quote.open)]);
  if (!quote && finite(open)) stats.push(["开盘", detailValue(key, open)]);
  const bounds = quote ? [quote.low, quote.high] : [low, high];
  if (bounds.every(finite)) stats.push(["区间低 / 高", bounds.map(x => detailValue(key, x)).join(" / ")]);
  if (key === "BREADTH") stats.push(["比率日变动", moveLabel(key, model.move)]);
  if (key === "OAS" && rows.length >= 5) stats.push(["近 5 个观测点", signed((value - rows.at(-5)[1]) * 100, 0, " bp")]);
  const target = byId("indicator-stats");
  target.hidden = !stats.length;
  target.replaceChildren(...stats.map(([label, amount]) => {
    const item = document.createElement("div");
    const term = document.createElement("dt");
    const definition = document.createElement("dd");
    term.textContent = label;
    definition.textContent = amount;
    item.append(term, definition);
    return item;
  }));
}

function detailPoint() {
  if (detailView.key) plotPoint(detailView, byId("indicator-readout"), n => detailValue(detailView.key, n));
}

function renderDetail() {
  if (!detailDialog.open) return;
  const {key, range, returned} = detailView;
  const [title, description, unit] = indicatorDefinitions[key];
  const model = detailModel(key, returned);
  htmlText("indicator-title", title);
  htmlText("indicator-description", description);
  htmlText("indicator-value", detailValue(key, model.value));
  highlight("indicator-change", moveLabel(key, model.move), model.move);
  const meta = byId("indicator-meta");
  meta.textContent = modelTime(key, model);
  const age = document.createElement("span");
  age.className = "data-age";
  setAge(age, model.date, model.time);
  meta.append(age);
  renderDetailStats(key, model);
  const observed = observationKeys.has(key);
  const sessions = range === "5" && !observed;
  const loadingFiveDays = sessions && fiveDayRequests.has(key);
  const live = model.quote ?? (key === "BREADTH" && finite(model.time)
    ? {date: model.date, price: model.value, time: model.time, bars: model.bars} : null);
  const dailyRows = observed ? model.rows : withDailyQuote(model.rows, live);
  const active = range === "day" ? model.bars : sessions ? mergedFiveDayRows(key, live)
    : range === "5" ? dailyRows.slice(-5) : monthRows(dailyRows);
  const canCandle = active.some(hasOHLC);
  if (!canCandle && !loadingFiveDays) detailView.mode = "line";
  for (const button of rangeButtons) {
    button.hidden = button.dataset.detailRange === "day" && observationKeys.has(key);
    button.disabled = button.dataset.detailRange === "day" && !model.bars.length;
    button.setAttribute("aria-pressed", String(button.dataset.detailRange === range));
  }
  byId("detail-mode-group").hidden = !canCandle;
  for (const button of modeButtons) button.setAttribute("aria-pressed", String(button.dataset.detailMode === detailView.mode));
  const base = range === "day" && !observed ? model.before : null;
  const dailyLabel = observationKeys.has(key) ? "观测日" : "美东交易日";
  detailView.plot = drawPlot(detailChart, active, {candle: detailView.mode === "candle", base, dailyLabel, sessions,
    dayOffset: sessionOffset(key), history: range === "day" || sessions ? active : dailyRows, axisWidth: unit === "比率" ? 49 : 45,
    axisFormat: value => decimal(unit === "bp" ? value * 100 : value, unit === "比率" ? 4 : unit === "bp" || unit === "分" ? 0 : 2)});
  const format = unit === "比率" ? "RSP / SPY 价格比" : key === "GOLD" ? "USD／金衡盎司" : key === "WTI" ? "USD／桶" : unit;
  const period = key === "DRAWDOWN" ? "日线回撤 · 当前点随 SPYM 更新"
    : key === "VIXTERM" ? "同日收盘" : range === "day" ? "美东分时" + (finite(model.interval) ? " · " + model.interval + " 分钟" : "")
    : sessions ? "最近 5 个交易日 · 5 分钟" : observed ? "日度观测" : "日线 · 当日点位随报价更新";
  htmlText("indicator-legend", period + " · " + format + (finite(base) ? " · 颜色对比前收，虚线为前收" : " · 颜色对比前一观测值"));
  htmlText("indicator-empty", detailView.loading || loadingFiveDays ? "正在请求图表数据…"
    : sessions ? "5 日分时暂不可用。" : "这个区间暂无可用数据。");
  byId("indicator-empty").hidden = Boolean(detailView.plot);
  detailPoint();
  byId("indicator-sources").replaceChildren(...sourceLinks(key).map(([label, url]) => {
    const anchor = document.createElement("a");
    anchor.className = "text-button";
    anchor.href = url;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.textContent = label;
    return anchor;
  }));
}

async function openDetail(key) {
  hideTip();
  detailView.controller?.abort();
  const controller = new AbortController();
  const available = detailModel(key).bars.length > 0;
  Object.assign(detailView, {key, mode: "line", range: available ? "day" : "month", selected: null, returned: null,
    controller, loading: canFetchMarket && !contextKeys.has(key), manuallyChangedRange: false});
  detailDialog.showModal();
  renderDetail();
  if (!canFetchMarket || contextKeys.has(key)) return;
  try {
    const response = await fetch(api + "/api/market?scope=detail&key=" + encodeURIComponent(key), {
      cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(23000)]),
    });
    if (!response.ok) return;
    const data = await response.json();
    if (controller.signal.aborted || data.key !== key || !data.detail) return;
    detailView.returned = data.detail;
    if (!detailView.manuallyChangedRange && detailModel(key, data.detail).bars.length) detailView.range = "day";
  } catch {
    // The dashboard still has the last available readings and historical rows.
  } finally {
    if (!controller.signal.aborted) {
      detailView.loading = false;
      renderDetail();
    }
  }
}

detailDialog.addEventListener("close", () => {
  detailView.controller?.abort();
  detailView.plot = null;
  detailView.key = null;
  hideTip();
});
async function refreshDetailChart() {
  if (!detailDialog.open || !detailView.key) return;
  const {key, range} = detailView;
  const request = range === "5" && !observationKeys.has(key) ? fetchFiveDays(key) : null;
  renderDetail();
  if (request) {
    await request;
    if (detailView.key === key && detailView.range === range) renderDetail();
  }
}

document.addEventListener("market-refreshed", refreshDetailChart);
for (const button of rangeButtons) {
  button.addEventListener("click", () => {
    detailView.range = button.dataset.detailRange;
    detailView.selected = null;
    detailView.manuallyChangedRange = true;
    refreshDetailChart();
  });
}
for (const button of modeButtons) {
  button.addEventListener("click", () => {
    detailView.mode = button.dataset.detailMode;
    detailView.selected = null;
    renderDetail();
  });
}
bindPlot(detailChart, detailView, detailPoint);
new ResizeObserver(renderDetail).observe(detailChart);

let tipTrigger = null;
let sparkIndex = null;

function clearSpark(target) {
  target?.querySelector("[data-spark-guide]")?.setAttribute("visibility", "hidden");
  target?.querySelector("[data-spark-dot]")?.setAttribute("visibility", "hidden");
}

function hideTip() {
  clearSpark(tipTrigger);
  tipTrigger?.removeAttribute("aria-describedby");
  tipTrigger = null;
  sparkIndex = null;
  keyTip.hidden = true;
}

function placeTip(trigger, event) {
  const anchor = trigger.getBoundingClientRect();
  const x = event ? event.clientX + 12 : anchor.left;
  const y = event ? event.clientY + 16 : anchor.bottom + 6;
  keyTip.style.left = Math.max(8, Math.min(x, innerWidth - keyTip.offsetWidth - 8)) + "px";
  keyTip.style.top = (y + keyTip.offsetHeight <= innerHeight - 8 ? y
    : Math.max(8, (event?.clientY ?? anchor.top) - keyTip.offsetHeight - 8)) + "px";
}

function showTip(trigger, event, observation) {
  const key = trigger.dataset.indicator;
  const [title, description] = indicatorDefinitions[key];
  if (tipTrigger !== trigger) {
    hideTip();
    tipTrigger = trigger;
  }
  const reading = document.createElement("span");
  reading.className = "tip-reading";
  const value = document.createElement("strong");
  const stamp = document.createElement("span");
  const desc = document.createElement("span");
  desc.textContent = description;
  if (observation) {
    const {row, format, before} = observation;
    value.textContent = format(row[1]);
    value.className = direction(row[1] - before);
    stamp.textContent = " · " + pointTimestamp(row, observationKeys.has(key) ? "观测日" : "美东交易日");
  } else {
    const latest = detailModel(key);
    value.textContent = detailValue(key, latest.value)
      + (finite(latest.move) ? " · " + moveLabel(key, latest.move) : "");
    value.className = direction(latest.move);
    stamp.textContent = " · " + modelTime(key, latest);
    if (key === "DRAWDOWN" && latest.high) desc.textContent = "52 周收盘高点 $" + decimal(latest.high[1]) + "（" + latest.high[0] + "）。" + description;
  }
  const name = document.createElement("b");
  name.textContent = title;
  reading.append(value, stamp);
  keyTip.replaceChildren(name, reading, desc);
  trigger.setAttribute("aria-describedby", keyTip.id);
  keyTip.hidden = false;
  placeTip(trigger, event);
}

function sparkPoint(trigger, index, event) {
  const series = sparkData.get(trigger);
  const row = series?.points[index];
  if (!row) return;
  showTip(trigger, event, {row, format: series.format, before: series.points[index - 1]?.[1] ?? series.prior});
  sparkIndex = index;
  const mark = series.coords?.[index];
  if (!mark) return;
  const guide = trigger.querySelector("[data-spark-guide]");
  const dot = trigger.querySelector("[data-spark-dot]");
  guide.setAttribute("x1", mark[0]);
  guide.setAttribute("x2", mark[0]);
  guide.setAttribute("visibility", "visible");
  dot.setAttribute("cx", mark[0]);
  dot.setAttribute("cy", mark[1]);
  dot.setAttribute("visibility", "visible");
}

const marketGrid = document.querySelector(".market-grid");
marketGrid.addEventListener("pointerover", event => {
  if (event.pointerType === "touch") return;
  const trigger = event.target.closest("[data-indicator]");
  if (trigger && !trigger.contains(event.relatedTarget)) showTip(trigger, event);
});
marketGrid.addEventListener("pointermove", event => {
  if (event.pointerType === "touch") return;
  const trigger = event.target.closest(".spark");
  const series = sparkData.get(trigger);
  if (!series?.points.length) return;
  const graph = trigger.querySelector(".spark-graph");
  if (!graph) return;
  const {left, width} = graph.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, ((event.clientX - left) / width * 260 - 3) / 254));
  const index = Math.round(ratio * (series.points.length - 1));
  if (tipTrigger !== trigger || index !== sparkIndex) sparkPoint(trigger, index, event);
});
marketGrid.addEventListener("pointerout", event => {
  if (tipTrigger && !tipTrigger.contains(event.relatedTarget)) hideTip();
});
marketGrid.addEventListener("focusin", event => {
  const trigger = event.target.closest("[data-indicator]");
  if (trigger && trigger.matches(":focus-visible") && !detailDialog.open) showTip(trigger);
});
marketGrid.addEventListener("focusout", hideTip);
marketGrid.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    hideTip();
    return;
  }
  const trigger = event.target.closest(".spark");
  const series = sparkData.get(trigger);
  if (!series?.points.length) return;
  const index = plotKey(event.key, sparkIndex, series.points.length);
  if (index === undefined) return;
  event.preventDefault();
  sparkPoint(trigger, index);
});
marketGrid.addEventListener("click", event => {
  const trigger = event.target.closest("[data-indicator]");
  if (trigger) openDetail(trigger.dataset.indicator);
});
window.addEventListener("scroll", hideTip, {passive:true});
window.addEventListener("resize", hideTip, {passive:true});
