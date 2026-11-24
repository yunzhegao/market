"use strict";

const legacyNavHoldingsKey = "market-portfolio-valuation-holdings-v1";
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

function navHoldings(positions) {
  const grouped = new Map();
  for (const {kind,symbol,currency,quantity} of positions) {
    if (!(quantity > 0)) continue;
    const key = [kind,symbol,currency].join("/");
    const row = grouped.get(key) ?? {kind,symbol,currency,quantity:0};
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
  if (!Array.isArray(raw?.snapshots) || raw.snapshots.length > navDisplayDays+3) return null;
  const read = row => {
    if (!/^[0-9a-f]{32}$/.test(row?.id ?? "") || !Array.isArray(row.holdings) || row.holdings.length > 400) return null;
    if (!row.holdings.every(item=>item && Object.hasOwn(assetKinds,item.kind) && currencyValid(item.currency)
      && typeof item.symbol === "string" && symbolValid(item.symbol) && fnum(item.quantity) && item.quantity > 0)) return null;
    return {id:row.id,holdings:navHoldings(row.holdings)};
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
  if (!previous && !holdings.length) return state;
  const schedule = previous?.snapshots ?? [];
  const today = navDate(now);
  const date = now <= navCutoff(today) ? today : navDate(now + navDayMs);
  const oldest = navDate(latestNavCutoff(now)-(navDisplayDays-1)*navDayMs);
  const anchor = schedule.findLast(row=>row.date<oldest);
  let snapshots = schedule.filter(row=>row.date>=oldest || row===anchor);
  const applicable = snapshots.findLast(row=>row.date<=date);
  if (JSON.stringify(applicable?.holdings) !== JSON.stringify(holdings)) {
    snapshots = [...snapshots.filter(row=>row.date<date),{...navSnapshot(holdings),date},...snapshots.filter(row=>row.date>date)];
  }
  const reference = previous?.reference ?? (holdings.length ? navSnapshot(holdings) : null);
  return {...state,navHistory:{reference,snapshots}};
}

function migrateNavHistory() {
  const rows = localRead(legacyNavHoldingsKey,[]);
  if (!Array.isArray(rows) || !rows.length) return null;
  const history = normalizeNavHistory({snapshots:rows.slice(-(navDisplayDays+2)).filter(row=>validNavDate(row?.date)
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
  return fnum(total) ? {date,value:total} : null;
}

function navDays(history, now) {
  if (!history) return [];
  const end = latestNavCutoff(now);
  return Array.from({length:navDisplayDays},(_,i)=>navDate(end-(navDisplayDays-1-i)*navDayMs)).flatMap(date=>{
    const saved = history.snapshots.findLast(row=>row.date<=date);
    const snapshot = saved ?? history.reference;
    return snapshot ? [{date,holdings:snapshot.holdings,basis:snapshot.id,estimated:!saved}] : [];
  });
}

function navSavedPoints(base, days) {
  const cached = new Map((localRead(navPointsKey,{})[base] ?? []).map(row=>[row.date,row]));
  return days.flatMap(({date,basis,estimated})=>{
    const point = cached.get(date);
    return point?.basis === basis && fnum(point.value) ? [{...point,estimated}] : [];
  });
}

async function refreshNavHistory(state, automatic, isDemo, force = false) {
  if (isDemo || navBusy) return;
  const now = Date.now();
  const base = state.base;
  const windowDays = navDays(state.navHistory,now);
  const existing = new Set(navSavedPoints(base,windowDays).map(row=>row.date));
  const days = windowDays.filter(row=>!existing.has(row.date));
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
    const added = days.flatMap(({date,holdings,basis})=>{
      const point = navPoint(date,holdings,base,prices);
      return point ? [{...point,basis}] : [];
    });
    if (added.length) {
      const book = localRead(navPointsKey,{});
      const merged = new Map((book[base] ?? []).map(row=>[row.date,row]));
      for (const row of added) merged.set(row.date,row);
      book[base] = [...merged.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-navDisplayDays);
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
  const days = navDays(portfolio.navHistory,Date.now());
  const rows = navSavedPoints(base,days);
  const first = rows[0], last = rows.at(-1);
  by("nav-history-status").textContent = navStorageError ? "浏览器无法保存每日估值。"
    : navMessage || (!first ? (days.length ? "近 30 天暂无完整估值" : "保存持仓后开始记录") : "");
  by("nav-history-data").hidden = !first;
  if (!first) return;
  const recorded = rows.filter(row=>!row.estimated);
  const period = recorded.length ? recorded : rows;
  let peak = 0, drawdown = 0;
  for (const {value} of period) {
    peak = Math.max(peak,value);
    if (peak > 0) drawdown = Math.min(drawdown,value/peak-1);
  }
  const change = period.length>1 && period[0].value>0
    ? " · "+(recorded.length ? "记录区间" : "回算区间")+"变动 "+pctText((period.at(-1).value/period[0].value-1)*100)
      +" · 最大回撤 "+pctText(drawdown*100) : "";
  by("nav-history-summary").textContent = fmt(last.value) + " " + base + (last.estimated ? " · 回算" : "") + change;
  const values = rows.map(row=>row.value);
  const floor = Math.min(...values), ceiling = Math.max(...values);
  const width = 720, height = 135, pad = 10;
  const span = Math.max(navCutoff(last.date)-navCutoff(first.date),navDayMs);
  const points = rows.map(row=>({
    ...row,x:pad + (width-2*pad) * (navCutoff(row.date)-navCutoff(first.date))/span,
    y:ceiling===floor ? height/2 : height-pad-(height-2*pad)*(row.value-floor)/(ceiling-floor),
  }));
  const lines = points.map((point,i)=>{
    const previous = points[i-1];
    return previous && previous.estimated===point.estimated && navCutoff(point.date)-navCutoff(previous.date)===navDayMs
      ? '<line'+(point.estimated?' class="nav-estimated"':'')+' x1="'+previous.x+'" y1="'+previous.y+'" x2="'+point.x+'" y2="'+point.y+'"/>' : "";
  }).join("");
  by("nav-history-chart").innerHTML = '<svg viewBox="0 0 '+width+' '+height+'" preserveAspectRatio="none" role="img" aria-label="每日固定时点组合净值">'
    +'<g class="nav-history-line">'+lines+'</g>'+points.map(({x,y,date,value,estimated})=>
      '<circle'+(estimated?' class="nav-estimated"':'')+' cx="'+x+'" cy="'+y+'" r="2.7"><title>'+esc(date+" · "+fmt(value)+" "+base+(estimated?" · 回算":" · 持仓记录"))+'</title></circle>').join("")+'</svg>';
  by("nav-history-dates").textContent = first.date === last.date ? last.date : first.date + " – " + last.date;
  table("nav-history-table",["估值日","净值 · "+base,"持仓依据"],rows.slice().reverse().map(row=>[
    td(esc(row.date)),td(fmt(row.value)),td(row.estimated ? "回算" : "持仓记录"),
  ]));
}
