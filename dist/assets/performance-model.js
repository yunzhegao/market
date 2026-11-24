"use strict";

const performanceBenchmarks = {
  SPY:{label:"标普 500（SPY）",color:"var(--benchmark-equity)",mix:{SPY:1}},
  QQQ:{label:"纳指 100（QQQ）",color:"var(--benchmark-nasdaq)",mix:{QQQ:1}},
  spyMix:{label:"60% SPY + 40% BOXX",color:"var(--benchmark-spy-mix)",mix:{SPY:.6,BOXX:.4}},
  qqqMix:{label:"60% QQQ + 40% BOXX",color:"var(--benchmark-qqq-mix)",mix:{QQQ:.6,BOXX:.4}},
};
const performanceBenchmarkSymbols = [...new Set(Object.values(performanceBenchmarks).flatMap(row=>Object.keys(row.mix)))];
const performanceDay = date => new Date(date+"T00:00:00Z").getUTCDay();
const performanceKey = row => row.kind+"/"+row.symbol+"/"+row.currency;
const performanceLabel = row => row.kind==="cash" ? row.currency+" 现金" : row.symbol;
const performanceMean = rows => rows.reduce((sum,value)=>sum+value,0)/rows.length;
const performanceDaysBetween = (start,end) => Math.round((navCutoff(end)-navCutoff(start))/navDayMs);

function performanceSchedule(state,from,to,account=null) {
  const history = state.navHistory;
  const accountHistory = history?.snapshots.filter(row=>row.accounts) ?? [];
  const byAccount = rows=>navHoldings(rows.filter(row=>row.account===account));
  const fallback = account===null ? history?.reference?.holdings ?? navHoldings(state.positions)
    : byAccount(history?.reference?.accounts ?? accountHistory[0]?.accounts ?? state.positions);
  return Array.from({length:Math.max(0,(navCutoff(to)-navCutoff(from))/navDayMs+1)},(_,i)=>navDate(navCutoff(from)+i*navDayMs))
    .filter(date=>performanceDay(date)>=2).map(date=>{
      const saved = account===null ? history?.snapshots.findLast(row=>row.date<=date) : accountHistory.findLast(row=>row.date<=date);
      const holdings = saved ? (account===null ? saved.holdings : byAccount(saved.accounts)) : fallback;
      return {date,holdings,estimated:!saved};
    });
}

function performanceQuote(row,date,base,series) {
  const rate = currency => {
    if (currency==="USD") return 1;
    const quote = series.get(navFxSymbol(currency));
    return quote?.currency===currency ? quote.byDate.get(date)?.price : null;
  };
  const target = row.currency===base ? 1 : rate(base);
  const local = row.currency===base ? 1 : rate(row.currency);
  if (!(target>0 && local>0)) return null;
  if (row.kind==="cash") return {price:1,close:1,splitClose:1,fx:target/local};
  const quote = series.get(row.symbol);
  const pence = row.currency==="GBP" && ["GBp","GBX"].includes(quote?.currency);
  if (!pence && quote?.currency!==row.currency) return null;
  const reading = quote.byDate.get(date);
  if (!reading) return null;
  const unit = pence ? 100 : 1;
  return {price:reading.price/unit,close:reading.close/unit,splitClose:(reading.splitClose ?? reading.close)/unit,fx:target/local};
}

function performanceStep(start,end,base,series) {
  const lots = [];
  const missing = [];
  let value = 0;
  for (const row of start.holdings) {
    const a = performanceQuote(row,start.date,base,series);
    const b = performanceQuote(row,end.date,base,series);
    if (!a || !b || !(a.close>0)) {
      missing.push(performanceLabel(row));
      continue;
    }
    const amount = row.quantity*(start.estimated ? a.splitClose : a.close)*a.fx;
    const priceReturn = b.price/a.price-1;
    const move = (1+priceReturn)*b.fx/a.fx-1;
    value += amount;
    lots.push({key:performanceKey(row),row,amount,move,priceReturn,fxReturn:move-priceReturn});
  }
  if (missing.length || !(value>0)) return {missing};
  const parts = lots.map(({amount,...lot})=>{
    const weight = amount/value;
    return {...lot,weight,price:weight*lot.priceReturn,fx:weight*lot.fxReturn};
  });
  const change = parts.reduce((total,lot)=>total+lot.price+lot.fx,0);
  return {date:end.date,parts,change,estimated:start.estimated};
}

function performanceSeries(schedule,base,prices) {
  let block = [], best = [];
  const missing = new Set();
  for (let i=1;i<schedule.length;i++) {
    const start = schedule[i-1], end = schedule[i];
    const step = performanceStep(start,end,base,prices);
    if (step.missing) {
      for (const symbol of step.missing) missing.add(symbol);
      block = [];
      continue;
    }
    if (!block.length) block.push({date:start.date,value:1});
    block.push({...step,value:block.at(-1).value*(1+step.change)});
    if (block.length>=best.length) best = block;
  }
  const simulated = best.slice(1).filter(row=>row.estimated).length;
  return {rows:best,expected:schedule.length,simulated,missing:[...missing]};
}

function performanceBenchmark(dates,base,prices,mix) {
  const quotes = dates.map(date=>Object.keys(mix).map(symbol=>performanceQuote({symbol,kind:"etf",currency:"USD"},date,base,prices)));
  if (!dates.length || quotes.some(row=>row.some(value=>!value))) return null;
  const weights = Object.values(mix);
  return dates.reduce((rows,date,i)=>{
    const change = i ? quotes[i].reduce((sum,row,j)=>sum+weights[j]*(row.price*row.fx/(quotes[i-1][j].price*quotes[i-1][j].fx)-1),0) : 0;
    rows.push({date,change,value:(rows.at(-1)?.value ?? 1)*(1+change)});
    return rows;
  },[]);
}

function performanceDrawdown(rows) {
  if (rows.length<2) return null;
  let peak=0, start=0, trough=0, decline=0;
  for (let i=1;i<rows.length;i++) {
    if (rows[i].value>=rows[peak].value) peak=i;
    const draw = rows[i].value/rows[peak].value-1;
    if (draw<decline) {
      decline=draw;
      start=peak;
      trough=i;
    }
  }
  if (decline===0) return {decline};
  const recovery = rows.findIndex((row,i)=>i>trough && row.value>=rows[start].value);
  const endValue = rows[recovery<0 ? rows.length-1 : recovery].value;
  const progress = (endValue-rows[trough].value)/(rows[start].value-rows[trough].value);
  return {start,trough,decline,recovery,progress:Math.min(1,Math.max(0,progress))};
}

function performanceAttribution(rows,first,last,sectors) {
  const assets = new Map(), industries = new Map();
  const opening = rows[first].value;
  let fx = 0;
  for (let i=first+1;i<=last;i++) {
    const multiplier = rows[i-1].value/opening;
    for (const part of rows[i].parts) {
      const label = performanceLabel(part.row);
      const contribution = multiplier*part.price;
      const fxContribution = multiplier*part.fx;
      const current = assets.get(part.key) ?? {key:part.key,label,price:0,fx:0};
      current.price += contribution;
      current.fx += fxContribution;
      assets.set(part.key,current);
      for (const [sector,weight] of sectors(part.row)) {
        industries.set(sector,(industries.get(sector) ?? 0)+contribution*weight);
      }
      fx += fxContribution;
    }
  }
  return {assets:[...assets.values()].sort((a,b)=>Math.abs(b.price+b.fx)-Math.abs(a.price+a.fx)),
    industries:[...industries].sort((a,b)=>Math.abs(b[1])-Math.abs(a[1])),fx};
}

function performanceCovariance(a,b) {
  if (a.length<2 || a.length!==b.length) return null;
  const av = performanceMean(a), bv = performanceMean(b);
  return a.reduce((sum,value,i)=>sum+(value-av)*(b[i]-bv),0)/(a.length-1);
}

function performanceCorrelation(a,b) {
  const scale = Math.sqrt(performanceCovariance(a,a)*performanceCovariance(b,b));
  return scale>1e-14 ? Math.min(1,Math.max(-1,performanceCovariance(a,b)/scale)) : null;
}

function performanceRisk(rows,benchmark,drawdown) {
  const changes = rows.slice(1).map(row=>row.change);
  if (changes.length<15) return null;
  const observations = changes.length, annual = Math.sqrt(252);
  const average = performanceMean(changes);
  const variance = performanceCovariance(changes,changes);
  const std = Math.sqrt(variance);
  const downside = Math.sqrt(performanceMean(changes.map(change=>Math.min(0,change)**2)));
  const elapsed = performanceDaysBetween(rows[0].date,rows.at(-1).date);
  const cagr = elapsed>=90 ? rows.at(-1).value**(365.2425/elapsed)-1 : null;
  const market = benchmark?.slice(1).map(row=>row.change);
  const marketVariance = market ? performanceCovariance(market,market) : null;
  const capture = positive=>{
    const pair = market?.flatMap((change,i)=>(positive ? change>0 : change<0) ? [[changes[i],change]] : []);
    if (!pair || pair.length<5) return null;
    const compound = column=>Math.expm1(performanceMean(pair.map(row=>Math.log1p(row[column])))*252);
    const reference = compound(1);
    return Math.abs(reference)>1e-10 ? compound(0)/reference : null;
  };
  const tail = observations>=40 ? changes.slice().sort((a,b)=>a-b).slice(0,Math.ceil(observations*.05)) : [];
  const lots = new Map();
  for (const [i,step] of rows.slice(1).entries()) {
    for (const part of step.parts) {
      if (!lots.has(part.key)) lots.set(part.key,{key:part.key,label:performanceLabel(part.row),weights:0,returns:[],contribution:Array(observations).fill(0)});
      const lot = lots.get(part.key);
      lot.weights += part.weight;
      lot.returns[i] = part.move;
      lot.contribution[i] = part.price+part.fx;
    }
  }
  const assets = [...lots.values()].map(lot=>({...lot,weight:lot.weights/observations,
    risk:variance>1e-14 ? performanceCovariance(lot.contribution,changes)/variance : null}));
  const top = assets.slice().sort((a,b)=>b.weight-a.weight).slice(0,12);
  const matrix = top.map(a=>top.map(b=>{
    const paired = a.returns.flatMap((value,i)=>fnum(b.returns[i]) ? [[value,b.returns[i]]] : []);
    return paired.length>=15 ? performanceCorrelation(paired.map(row=>row[0]),paired.map(row=>row[1])) : null;
  }));
  return {observations,volatility:std*annual,maximum:drawdown?.decline ?? null,
    sharpe:std>1e-7 ? average/std*annual : null,sortino:downside>1e-7 ? average/downside*annual : null,
    beta:marketVariance>1e-14 ? performanceCovariance(changes,market)/marketVariance : null,
    calmar:cagr!==null && drawdown?.decline<0 ? cagr/(-drawdown.decline) : null,
    var:tail.length ? Math.max(0,-tail.at(-1)) : null,cvar:tail.length ? Math.max(0,-performanceMean(tail)) : null,
    upside:capture(true),downside:capture(false),assets:assets.sort((a,b)=>Math.abs(b.risk??0)-Math.abs(a.risk??0)),top,matrix};
}
