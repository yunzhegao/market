"use strict";

const navHoldingsKey = "market-portfolio-valuation-holdings-v1";
const navPointsKey = "market-portfolio-valuation-points-v1";
const navDayMs = 86400000;
const navDisplayDays = 30;
let navBusy = false;
const navRequestedAt = new Map();
let navMessage = "";
let navStorageError = false;

const navCutoff = date => Date.parse(date + "T06:00:00+08:00");
const navDate = at => new Date(at + 8 * 3600000).toISOString().slice(0,10);
const navFxSymbol = currency => "USD" + currency + "=X";

function latestNavCutoff(now) {
  const ready = now - 30*60000;
  const cutoff = navCutoff(navDate(ready));
  return ready >= cutoff ? cutoff : cutoff-navDayMs;
}

function recordNavHoldings(positions, now = Date.now()) {
  const grouped = new Map();
  for (const {kind,symbol,currency,quantity} of positions) {
    if (!(quantity > 0)) continue;
    const key = [kind,symbol,currency].join("/");
    const row = grouped.get(key) ?? {kind,symbol,currency,quantity:0};
    row.quantity += quantity;
    grouped.set(key,row);
  }
  const holdings = [...grouped.keys()].sort().map(key=>grouped.get(key));
  const schedule = localRead(navHoldingsKey,[]);
  if (!schedule.length && !holdings.length) return;
  if (JSON.stringify(schedule.at(-1)?.holdings) === JSON.stringify(holdings)) return;
  const today = navDate(now);
  const date = now <= navCutoff(today) ? today : navDate(now + navDayMs);
  const oldest = navDate(now - navDisplayDays * navDayMs);
  const anchor = schedule.findLast(row=>row.date<oldest);
  const retained = schedule.filter(row=>row.date>=oldest && row.date<date);
  navStorageError = !localWrite(navHoldingsKey,[...(anchor?[anchor]:[]),...retained,{date,holdings}]);
}

function navPricesNeeded(days, base) {
  const symbols = new Set();
  for (const {holdings} of days) {
    for (const row of holdings) {
      if (row.kind !== "cash") symbols.add(row.symbol);
      if (row.currency === base) continue;
      if (base !== "USD") symbols.add(navFxSymbol(base));
      if (row.currency !== "USD") symbols.add(navFxSymbol(row.currency));
    }
  }
  return [...symbols];
}

function navPoint(date, holdings, base, prices) {
  const rate = currency => {
    if (currency === "USD") return 1;
    const quote = prices.get(navFxSymbol(currency));
    return quote?.currency === currency ? quote.byDate.get(date) : null;
  };
  let total = 0;
  for (const row of holdings) {
    const quote = prices.get(row.symbol);
    const price = row.kind === "cash" ? 1 : quote?.currency === row.currency ? quote.byDate.get(date)
      : row.currency === "GBP" && ["GBp","GBX"].includes(quote?.currency) ? quote.byDate.get(date)/100 : null;
    const currencyRate = row.currency === base ? 1 : rate(row.currency);
    const baseRate = row.currency === base ? 1 : rate(base);
    if (!(price > 0 && currencyRate > 0 && baseRate > 0)) return null;
    total += row.quantity * price * baseRate / currencyRate;
  }
  return holdings.length && fnum(total) ? {date,value:total} : null;
}

function navDays(schedule, existing, now) {
  const end = latestNavCutoff(now);
  const dates = new Set(existing.map(row=>row.date));
  return Array.from({length:navDisplayDays},(_,i)=>navDate(end-(navDisplayDays-1-i)*navDayMs)).flatMap(date=>{
    const holdings = schedule.findLast(row=>row.date<=date)?.holdings;
    return holdings?.length && !dates.has(date) ? [{date,holdings}] : [];
  });
}

async function refreshNavHistory(state, automatic, isDemo, force = false) {
  if (isDemo || navBusy) return;
  const now = Date.now();
  const base = state.base;
  const existing = localRead(navPointsKey,{})[base] ?? [];
  const schedule = localRead(navHoldingsKey,[]);
  const days = navDays(schedule,existing,now);
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
  navMessage = "正在补齐每日估值…";
  renderNavHistory(base,isDemo);
  try {
    const prices = new Map();
    for (let i=0;i<symbols.length;i+=8) {
      const batch = symbols.slice(i,i+8);
      try {
        const data = await requestMarket("valuation",{symbols:batch.join(","),from:days[0].date,to:days.at(-1).date});
        for (const symbol of batch) {
          const quote = data.prices?.[symbol];
          if (Array.isArray(quote?.rows)) prices.set(symbol,{currency:quote.currency,byDate:new Map(quote.rows)});
        }
      } catch {
        // A missing symbol leaves its affected days open for a later retry.
      }
    }
    const added = days.map(({date,holdings})=>navPoint(date,holdings,base,prices)).filter(Boolean);
    if (added.length) {
      const book = localRead(navPointsKey,{});
      const merged = new Map(added.map(row=>[row.date,row]));
      for (const row of book[base] ?? []) merged.set(row.date,row);
      book[base] = [...merged.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-365);
      navStorageError = !localWrite(navPointsKey,book);
    }
    const missing = days.length-added.length;
    navMessage = missing ? missing + " 天缺少历史报价或汇率，待补齐。" : "";
  } finally {
    navBusy = false;
    renderNavHistory(portfolio.base,demo);
  }
}

function renderNavHistory(base, isDemo) {
  by("nav-history").hidden = isDemo;
  if (isDemo) return;
  const latest = latestNavCutoff(Date.now());
  const firstAllowed = navDate(latest-(navDisplayDays-1)*navDayMs);
  const rows = (localRead(navPointsKey,{})[base] ?? []).filter(row=>row.date>=firstAllowed);
  const first = rows[0], last = rows.at(-1);
  const start = localRead(navHoldingsKey,[]).find(row=>row.holdings.length)?.date;
  by("nav-history-status").textContent = navStorageError ? "浏览器无法保存每日估值。"
    : navMessage || (!first ? (start ? (start>=navDate(latest) ? "首个估值日 " + start : "近 30 天暂无完整估值") : "保存持仓后开始记录") : "");
  by("nav-history-data").hidden = !first;
  if (!first) return;
  let peak = 0, drawdown = 0;
  for (const {value} of rows) {
    peak = Math.max(peak,value);
    if (peak > 0) drawdown = Math.min(drawdown,value/peak-1);
  }
  by("nav-history-summary").textContent = fmt(last.value) + " " + base
    + (rows.length > 1 ? " · 区间变化 " + pctText((last.value/first.value-1)*100) + " · 最大回撤 " + pctText(drawdown*100) : "");
  const floor = Math.min(...rows.map(row=>row.value)), ceiling = peak;
  const width = 720, height = 135, pad = 10;
  const span = Math.max(navCutoff(last.date)-navCutoff(first.date),navDayMs);
  const points = rows.map(row=>({
    ...row,x:pad + (width-2*pad) * (navCutoff(row.date)-navCutoff(first.date))/span,
    y:ceiling===floor ? height/2 : height-pad-(height-2*pad)*(row.value-floor)/(ceiling-floor),
  }));
  const lines = points.map((point,i)=>{
    const previous = points[i-1];
    return previous && navCutoff(point.date)-navCutoff(previous.date)===navDayMs
      ? '<line x1="'+previous.x+'" y1="'+previous.y+'" x2="'+point.x+'" y2="'+point.y+'"/>' : "";
  }).join("");
  by("nav-history-chart").innerHTML = '<svg viewBox="0 0 '+width+' '+height+'" preserveAspectRatio="none" role="img" aria-label="每日固定时点组合净值">'
    +'<g class="nav-history-line">'+lines+'</g>'+points.map(({x,y,date,value})=>
      '<circle cx="'+x+'" cy="'+y+'" r="2.7"><title>'+esc(date+" · "+fmt(value)+" "+base)+'</title></circle>').join("")+'</svg>';
  by("nav-history-dates").textContent = first.date === last.date ? last.date : first.date + " – " + last.date;
  table("nav-history-table",["估值日","净值 · "+base],rows.slice().reverse().map(row=>[td(esc(row.date)),td(fmt(row.value))]));
}
