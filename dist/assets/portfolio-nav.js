"use strict";

const legacyNavHoldingsKey = "market-portfolio-valuation-holdings-v1";
const navPointsKey = "market-portfolio-valuation-points-v1";
const navDayMs = 86400000;
const navWeekMs = 7*navDayMs;
const navHistoryDays = 367;
const navArchiveLimit = 1400000;
const navRangeMonths = {month:1,quarter:3,half:6,year:12};
const navView = {range:"month",mode:"line",plot:null,selected:null};
let navBusy = false;
let navQueued = false;
const navRequestedAt = new Map();
const navPriceSeries = new Map();
let navMessage = "";
let navStorageError = false;

const navCutoff = date => Date.parse(date + "T06:00:00+08:00");
const navDate = at => new Date(at + 8 * 3600000).toISOString().slice(0,10);
const navFxSymbol = currency => "USD" + currency + "=X";
const navPriceSources = {hourly:"小时线",close:"日收盘价","carried-close":"沿用最近收盘价","fx-reference":"日度参考汇率"};
const navAxis = new Intl.NumberFormat("zh-CN",{notation:"compact",maximumSignificantDigits:4});

function latestNavCutoff(now) {
  const ready = now - 30*60000;
  const cutoff = navCutoff(navDate(ready));
  return ready >= cutoff ? cutoff : cutoff-navDayMs;
}

function navRangeDates(range, now) {
  const to = navDate(latestNavCutoff(now));
  const today = navDate(now);
  if (range==="mtd") return {from:today.slice(0,7)+"-01",to};
  if (range==="ytd") return {from:today.slice(0,4)+"-01-01",to};
  const [year,month,day] = to.split("-").map(Number);
  const previousMonth = month-1-navRangeMonths[range];
  const monthEnd = new Date(Date.UTC(year,previousMonth+1,0)).getUTCDate();
  const from = navDate(Date.UTC(year,previousMonth,Math.min(day,monthEnd)+1));
  return {from,to};
}

function navHoldings(positions, byAccount = false) {
  const grouped = new Map();
  for (const {kind,symbol,currency,quantity,account} of positions) {
    if (!(quantity > 0)) continue;
    const key = JSON.stringify(byAccount ? [account,kind,symbol,currency] : [kind,symbol,currency]);
    const row = grouped.get(key) ?? {kind,symbol,currency,quantity:0,...(byAccount?{account}:{})};
    row.quantity += quantity;
    grouped.set(key,row);
  }
  return [...grouped.keys()].sort().map(key=>grouped.get(key));
}

function navSnapshot(holdings) {
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,"0")).join("");
  return {id,holdings};
}

function validNavDate(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const cutoff = navCutoff(date);
  return fnum(cutoff) && navDate(cutoff) === date;
}

function normalizeNavHistory(raw) {
  if (!Array.isArray(raw?.snapshots) || raw.snapshots.length > navHistoryDays+3) return null;
  const read = row => {
    if (!/^[0-9a-f]{32}$/.test(row?.id ?? "") || !Array.isArray(row.holdings) || row.holdings.length > 400) return null;
    const valid = item=>item && Object.hasOwn(assetKinds,item.kind) && currencyValid(item.currency)
      && typeof item.symbol === "string" && symbolValid(item.symbol) && fnum(item.quantity) && item.quantity > 0;
    if (!row.holdings.every(valid)) return null;
    const snapshot = {id:row.id,holdings:navHoldings(row.holdings)};
    if (Array.isArray(row.accounts) && row.accounts.length<=400 && row.accounts.every(item=>valid(item)
      && typeof item.account==="string" && item.account.length>0 && item.account.length<=90)) {
      snapshot.accounts = navHoldings(row.accounts,true);
    }
    return snapshot;
  };
  const snapshots = new Map();
  for (const row of raw.snapshots) {
    const snapshot = read(row);
    if (!snapshot || !validNavDate(row.date)) return null;
    snapshots.set(row.date,{...snapshot,date:row.date});
  }
  const reference = read(raw.reference);
  return {reference:reference?.holdings.length ? reference : null,
    snapshots:[...snapshots.values()].sort((a,b)=>a.date.localeCompare(b.date))};
}

function recordNavHoldings(state, previous = state.navHistory, now = Date.now()) {
  const holdings = navHoldings(state.positions);
  const accounts = navHoldings(state.positions,true);
  if (!previous && !holdings.length) return state;
  const schedule = previous?.snapshots ?? [];
  const today = navDate(now);
  const date = now <= navCutoff(today) ? today : navDate(now + navDayMs);
  const oldest = navDate(latestNavCutoff(now)-(navHistoryDays-1)*navDayMs);
  const anchor = schedule.findLast(row=>row.date<oldest);
  let snapshots = schedule.filter(row=>row.date>=oldest || row===anchor);
  const applicable = snapshots.findLast(row=>row.date<=date);
  const sameHoldings = JSON.stringify(applicable?.holdings) === JSON.stringify(holdings);
  if (!sameHoldings || JSON.stringify(applicable?.accounts) !== JSON.stringify(accounts)) {
    const snapshot = sameHoldings ? {id:applicable.id,holdings} : navSnapshot(holdings);
    snapshots = [...snapshots.filter(row=>row.date<date),{...snapshot,accounts,date},...snapshots.filter(row=>row.date>date)];
  }
  const reference = previous?.reference ?? (holdings.length ? {...navSnapshot(holdings),accounts} : null);
  let remaining = navArchiveLimit-JSON.stringify(reference).length;
  let keepFrom = snapshots.length;
  while (keepFrom>0) {
    remaining -= JSON.stringify(snapshots[keepFrom-1]).length+1;
    if (remaining<0) break;
    keepFrom--;
  }
  return {...state,navHistory:{reference,snapshots:snapshots.slice(keepFrom)}};
}

function migrateNavHistory() {
  const rows = localRead(legacyNavHoldingsKey,[]);
  if (!Array.isArray(rows) || !rows.length) return null;
  const history = normalizeNavHistory({snapshots:rows.slice(-(navHistoryDays+2)).filter(row=>validNavDate(row?.date)
    && Array.isArray(row?.holdings)).map(({date,holdings})=>({...navSnapshot(holdings),date}))});
  if (!history?.snapshots.length) return null;
  const book = localRead(navPointsKey,{});
  for (const [base,points] of Object.entries(book)) {
    if (!Array.isArray(points)) continue;
    book[base] = points.map(point=>{
      const snapshot = history.snapshots.findLast(row=>row.date<=point.date);
      return point.basis || !snapshot ? point : {...point,basis:snapshot.id};
    });
  }
  localWrite(navPointsKey,book);
  return history;
}

function navPricesNeeded(days, base) {
  const symbols = new Set();
  for (const {date,holdings} of days) {
    const include = symbol=>{
      if (!navPriceSeries.get(symbol)?.byDate.has(date)) symbols.add(symbol);
    };
    for (const row of holdings) {
      if (row.kind !== "cash") include(row.symbol);
      if (row.currency === base) continue;
      if (base !== "USD") include(navFxSymbol(base));
      if (row.currency !== "USD") include(navFxSymbol(row.currency));
    }
  }
  return [...symbols];
}

function navPoint(date, holdings, base, prices, missing = new Set()) {
  const unit = {price:1};
  const rate = currency => {
    if (currency === "USD") return unit;
    const quote = prices.get(navFxSymbol(currency));
    return quote?.currency === currency ? quote.byDate.get(date) : null;
  };
  const sources = new Set();
  let total = 0;
  let incomplete = false;
  for (const row of holdings) {
    const quote = prices.get(row.symbol);
    const pence = row.currency === "GBP" && ["GBp","GBX"].includes(quote?.currency);
    const matchingCurrency = quote?.currency === row.currency || pence;
    const price = row.kind === "cash" ? unit : matchingCurrency ? quote.byDate.get(date) : null;
    const currencyRate = row.currency === base ? unit : rate(row.currency);
    const baseRate = row.currency === base ? unit : rate(base);
    if (!price) missing.add(row.symbol);
    if (!currencyRate) missing.add("USD/"+row.currency);
    if (!baseRate) missing.add("USD/"+base);
    if (!price || !currencyRate || !baseRate) {
      incomplete = true;
      continue;
    }
    for (const reading of [price,currencyRate,baseRate]) if (reading.source) sources.add(reading.source);
    total += row.quantity * price.price * baseRate.price / currencyRate.price / (pence ? 100 : 1);
  }
  return !incomplete && fnum(total) ? {date,value:total,sources:[...sources]} : null;
}

function navDay(history, date) {
  const saved = history?.snapshots.findLast(row=>row.date<=date);
  const snapshot = saved ?? history?.reference;
  return snapshot ? {date,holdings:snapshot.holdings,basis:snapshot.id,estimated:!saved} : null;
}

function navDays(history, now, range = navView.range) {
  if (!history) return [];
  const {from,to} = navRangeDates(range,now);
  const start = navCutoff(from), end = navCutoff(to);
  return Array.from({length:Math.max(0,(end-start)/navDayMs+1)},(_,i)=>navDay(history,navDate(start+i*navDayMs))).filter(Boolean);
}

function navSavedPoints(base, days) {
  const cached = new Map((localRead(navPointsKey,{})[base] ?? []).map(row=>[row.date,row]));
  return days.flatMap(({date,basis,estimated})=>{
    const point = cached.get(date);
    return point?.basis === basis && fnum(point.value) ? [{...point,estimated}] : [];
  });
}

function navMissingDays(base, days) {
  const existing = new Set(navSavedPoints(base,days).map(row=>row.date));
  return days.filter(row=>!existing.has(row.date));
}

async function loadNavPrices(days, base, failures) {
  const symbols = navPricesNeeded(days,base);
  const from = days[0].date, to = days.at(-1).date;
  const extended = navCutoff(from)<Date.now()-32*navDayMs || navCutoff(to)-navCutoff(from)>31*navDayMs;
  const batchSize = extended ? 1 : 4;
  for (let i=0;i<symbols.length;i+=3*batchSize) {
    const batches = [i,i+batchSize,i+2*batchSize].map(start=>symbols.slice(start,start+batchSize)).filter(batch=>batch.length);
    const results = await Promise.allSettled(batches.map(batch=>requestMarket("valuation",{symbols:batch.join(","),from,to},45000)));
    for (const result of results) {
      if (result.status === "rejected") {
        failures.push({error:result.reason,extended});
        continue;
      }
      for (const [symbol,quote] of Object.entries(result.value.prices ?? {})) {
        if (!Array.isArray(quote?.rows) || typeof quote.currency!=="string") continue;
        const previous = navPriceSeries.get(symbol);
        const byDate = previous?.currency===quote.currency ? previous.byDate : new Map();
        for (const row of quote.rows) {
          if (!Array.isArray(row) || !validNavDate(row[0]) || !fnum(row[1]) || !(row[1]>0)) continue;
          const [date,price,source] = row;
          if (!byDate.has(date)) byDate.set(date,{price,source:Object.hasOwn(navPriceSources,source)?source:null});
        }
        if (byDate.size) navPriceSeries.set(symbol,{currency:quote.currency,byDate});
      }
    }
    if (failures.some(({error})=>error?.code==="scope" || error?.status===404 || (error?.status===400 && error?.code==="valuation"))) break;
  }
}

function saveNavPoints(days, base, missing) {
  const added = days.flatMap(({date,holdings,basis})=>{
    const point = navPoint(date,holdings,base,navPriceSeries,missing);
    return point ? [{...point,basis}] : [];
  });
  if (!added.length) return;
  const book = localRead(navPointsKey,{});
  const merged = new Map((book[base] ?? []).map(row=>[row.date,row]));
  for (const row of added) merged.set(row.date,row);
  book[base] = [...merged.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-navHistoryDays);
  navStorageError = !localWrite(navPointsKey,book);
}

async function refreshNavHistory(state, automatic, isDemo, force = false) {
  if (isDemo) return;
  if (navBusy) {
    navQueued ||= force;
    return;
  }
  const now = Date.now();
  const base = state.base;
  const windowDays = navDays(state.navHistory,now,"year");
  const days = navMissingDays(base,windowDays);
  if (!automatic || !days.length) {
    navMessage = automatic ? "" : "开启自动行情后更新历史估值。";
    return renderNavHistory(base,isDemo);
  }
  const symbols = navPricesNeeded(days,base);
  if (!hasApi && symbols.length) {
    navMessage = "历史估值需要行情接口。";
    return renderNavHistory(base,isDemo);
  }
  if (!force && now-(navRequestedAt.get(base) ?? 0) < 15*60000) return;
  navBusy = true;
  navRequestedAt.set(base,now);
  const covered = count=>"过去一年估值 "+count+" / "+windowDays.length+" 天";
  navMessage = "正在补齐过去一年 · "+covered(windowDays.length-days.length);
  renderNavHistory(base,isDemo);
  try {
    const failures = [];
    const recentStart = navRangeDates("month",now).from;
    const recent = days.filter(row=>row.date>=recentStart);
    if (recent.length && recent.length<days.length) {
      await loadNavPrices(recent,base,failures);
      saveNavPoints(recent,base,new Set());
      navMessage = "正在补齐过去一年 · "+covered(navSavedPoints(base,windowDays).length);
      renderNavHistory(portfolio.base,demo);
    }
    const pending = navMissingDays(base,windowDays);
    const missing = new Set();
    const unavailable = failures.some(({error})=>error?.code==="scope" || error?.status===404);
    if (pending.length && !unavailable) {
      await loadNavPrices(pending,base,failures);
      saveNavPoints(pending,base,missing);
    }
    const count = navSavedPoints(base,windowDays).length;
    const unsupported = failures.some(({error})=>error?.code==="scope" || error?.status===404);
    const rejected = failures.find(({error})=>error?.code==="valuation" && error?.status===400);
    const shown = [...missing].slice(0,5).join("、")+(missing.size>5?" 等 "+missing.size+" 项":"");
    navMessage = unsupported ? "当前行情接口未提供历史估值，请更新行情 Worker。"
      : rejected ? covered(count)+(rejected.extended ? " · 一年回算需要新版行情 Worker。" : " · 行情接口拒绝了估值日期。")
      : count===windowDays.length ? ""
      : covered(count)+(shown?" · 缺少 "+shown:failures.length?" · 行情请求失败":"");
  } finally {
    navBusy = false;
    renderNavHistory(portfolio.base,demo);
    if (navQueued) {
      navQueued = false;
      refreshNavHistory(portfolio,livePortfolio,demo,true);
    }
  }
}

function navWeekStart(date) {
  const weekday = new Date(Date.parse(date)).getUTCDay();
  return navCutoff(date)-(weekday+6)%7*navDayMs;
}

function navPlotRows(rows, mode, prior) {
  if (mode!=="week") {
    const point = row=>[navCutoff(row.date),row.value,null,null,null,row];
    const points = rows.map(point);
    if (mode==="line") return points;
    const firstPrevious = prior ? point(prior) : null;
    return points.flatMap((row,i)=>{
      const previous = points[i-1] ?? firstPrevious;
      if (!previous || navPointBreak(previous,row)) return [];
      const opening = previous[1], closing = row[1];
      return [[row[0],closing,opening,Math.max(opening,closing),Math.min(opening,closing),row[5]]];
    });
  }
  const weeks = [];
  for (const row of rows) {
    const monday = navWeekStart(row.date);
    let week = weeks.at(-1);
    if (week?.monday!==monday) {
      week = {monday,rows:[]};
      weeks.push(week);
    }
    week.rows.push(row);
  }
  return weeks.map(({monday,rows:group})=>{
    const last = group.at(-1);
    const values = group.map(row=>row.value);
    const estimated = group.some(row=>row.estimated);
    const mixed = estimated && group.some(row=>!row.estimated);
    return [monday+navWeekMs/2,last.value,values[0],Math.max(...values),Math.min(...values),
      {date:last.date,first:group[0].date,estimated,mixed}];
  });
}

function navPointBreak(previous,row) {
  return previous[5].estimated!==row[5].estimated || row[0]-previous[0]!==navDayMs;
}

function navDelta(value,before) {
  const delta = value-before;
  return plus(delta)+(before>0 ? " ("+pctText(delta/before*100)+")" : "");
}

function showNavPoint() {
  plotPoint(navView,by("nav-history-readout"),fmt);
}

function navWeekAxis(from, to, dateLabel) {
  const start = navWeekStart(from), end = navWeekStart(to)+navWeekMs;
  const weeks = (end-start)/navWeekMs;
  return {timeDomain:[start,end],timeLabel:at=>dateLabel(at-navWeekMs/2),timeTicks:limit=>{
    const count = Math.min(limit,weeks);
    return Array.from({length:count},(_,i)=>{
      const week = count===1 ? 0 : Math.round(i*(weeks-1)/(count-1));
      return start+(week+.5)*navWeekMs;
    });
  }};
}

function drawNavPlot(rows, from, to, base) {
  const {mode} = navView;
  const candle = mode!=="line", weekly = mode==="week";
  const target = by("nav-history-chart");
  const dateLabel = at => navDate(at).slice(5).replace("-","/");
  const timeAxis = weekly ? navWeekAxis(from,to,dateLabel) : {timeDomain:[navCutoff(from),navCutoff(to)],timeLabel:dateLabel};
  const previousDay = mode==="day" ? navDay(portfolio.navHistory,navDate(navCutoff(from)-navDayMs)) : null;
  const prior = previousDay ? navSavedPoints(base,[previousDay])[0] : null;
  target.hidden = false;
  navView.plot = drawMarketPlot(target,navPlotRows(rows,mode,prior),{
    ...timeAxis,candle,candleSlot:weekly?navWeekMs:navDayMs,
    axisLabel:row=>dateLabel(row[0]),axisFormat:value=>navAxis.format(value),axisWidth:62,
    estimated:row=>row[5].estimated,breakLine:navPointBreak,quietCursor:true,
    pointLabel:row=>{
      const info = row[5];
      const period = weekly && info.first!==info.date ? info.first+" – "+info.date : info.date;
      return period+(info.mixed?" · 部分回算":info.estimated?" · 回算":"");
    },
    comparison:(row,previous)=>candle ? row[2] : previous && !navPointBreak(previous,row) ? previous[1] : null,
    formatDelta:navDelta,
  });
  target.hidden = !navView.plot;
  by("nav-history-chart-empty").hidden = Boolean(navView.plot);
  showNavPoint();
}

function initNavChart() {
  const chart = by("nav-history-chart");
  if (!chart) return;
  bindPlot(chart,navView,showNavPoint);
  const bindChoices = field => {
    const buttons = [...document.querySelectorAll("[data-nav-"+field+"]")];
    const selectedValue = button=>button.getAttribute("data-nav-"+field);
    for (const button of buttons) button.addEventListener("click",()=>{
      const value = selectedValue(button);
      if (navView[field]===value) return;
      navView[field] = value;
      if (field==="range") saveAnalysisPreference("navRange",value);
      navView.selected = null;
      for (const option of buttons) option.setAttribute("aria-pressed",String(selectedValue(option)===value));
      renderNavHistory(portfolio.base,demo);
    });
  };
  bindChoices("range");
  bindChoices("mode");
  new ResizeObserver(()=>{
    if (navView.plot && (chart.clientWidth!==navView.plot.width || chart.clientHeight!==navView.plot.height)) {
      const now = Date.now();
      const {from,to} = navRangeDates(navView.range,now);
      drawNavPlot(navSavedPoints(portfolio.base,navDays(portfolio.navHistory,now)),from,to,portfolio.base);
    }
  }).observe(chart);
}

function renderNavHistory(base, isDemo) {
  renderExportAvailability();
  if (!by("nav-history")) return;
  by("nav-history").hidden = isDemo;
  if (isDemo) return;
  const now = Date.now();
  const {from,to} = navRangeDates(navView.range,now);
  const days = navDays(portfolio.navHistory,now);
  const rows = navSavedPoints(base,days);
  const last = rows.at(-1);
  by("nav-history-status").textContent = navStorageError ? "浏览器无法保存每日估值。"
    : navMessage || (!last ? (portfolio.navHistory ? "此区间暂无完整估值。" : "保存持仓后开始记录。") : "");
  by("nav-history-data").hidden = !last;
  const {mode} = navView;
  const method = mode==="day" ? "日 K 的开收分别取前一日和当日 06:00 净值，高低取这两个值的范围。浅色标记回算。"
    : mode==="week" ? "周 K 按自然周等宽排列，取该周已有估值的首值、最高值、最低值和末值。浅色标记含回算的周。"
    : "虚线标记回算。缺少行情或汇率的日期留空。";
  by("nav-history-method").textContent = method+" 本图衡量市值变化，含出入金，价格取估值时点前的可用报价。历史表现和风险分析使用复权收盘收益，按持仓快照衔接，并各自采用所选区间。";
  if (!last) {
    navView.plot = null;
    return;
  }
  const recorded = rows.filter(row=>!row.estimated);
  const period = recorded.length ? recorded : rows;
  let peak = 0, drawdown = 0;
  for (const {value} of period) {
    peak = Math.max(peak,value);
    if (peak > 0) drawdown = Math.min(drawdown,value/peak-1);
  }
  const opening = period[0].value, closing = period.at(-1).value;
  const change = period.length>1 ? " · "+(recorded.length ? "记录市值变化" : "回算市值变化")+" "
    +'<span class="'+tone(closing-opening)+'">'+esc(navDelta(closing,opening))+'</span>'
    +" · 市值最大回撤 "+esc(pctText(drawdown*100))+"（"+esc(period[0].date+" – "+period.at(-1).date)+"）" : "";
  by("nav-history-summary").innerHTML = esc(fmt(last.value)+" "+base+(last.estimated?" · 回算":""))+change;
  drawNavPlot(rows,from,to,base);
  const dateLabel = from===to ? to : from+" – "+to;
  const coverage = navView.range==="year" || rows.length<days.length ? " · "+rows.length+" / "+days.length+" 天" : "";
  by("nav-history-dates").textContent = dateLabel+coverage;
  const unit = mode==="day" ? "日 K 线 · 变动较前一日"
    : mode==="week" ? "周 K 线 · 变动较该周首值" : "日净值 · 变动较前一日";
  by("nav-history-unit").textContent = "每日 06:00 新加坡时间 · "+unit;
  table("nav-history-table",["估值日","净值 · "+base,"估值依据"],rows.slice().reverse().map(row=>{
    const sources = (row.sources ?? []).filter(source=>Object.hasOwn(navPriceSources,source)).map(source=>navPriceSources[source]);
    return [td(esc(row.date)),td(fmt(row.value)),td((row.estimated?"回算":"持仓记录")+(sources.length?" · 含"+sources.join("、"):""))];
  }));
}
