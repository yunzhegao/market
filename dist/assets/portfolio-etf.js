"use strict";

let etfDisclosures = {};
let lastEtfRequest = 0;
let loadingEtfDisclosures = false;

const etfDisclosureSites = {
  SPYM:{url:"https://www.ssga.com/us/en/individual/etfs/state-street-spdr-portfolio-sp-500-etf-spym",reference:"SPY"},
  SPY:{url:"https://www.ssga.com/us/en/intermediary/etfs/state-street-spdr-sp-500-etf-trust-spy"},
  QQQM:{url:"https://www.invesco.com/us/en/financial-products/etfs/invesco-nasdaq-100-etf.html",reference:"QQQ"},
  QQQ:{url:"https://www.invesco.com/us/en/financial-products/etfs/invesco-qqq-trust-series-1.html"},
  SCHD:{url:"https://www.schwabassetmanagement.com/allholdings/schd"},
};

function etfSnapshot(snapshot) {
  if (!validNavDate(snapshot?.date) || !Array.isArray(snapshot.rows)) return null;
  const rows = snapshot.rows.filter(row=>Array.isArray(row) && typeof row[0]==="string" && symbolValid(row[0])
    && fnum(row[1]) && row[1]>0 && row[1]<=100);
  return rows.length ? {date:snapshot.date,rows} : null;
}

async function refreshEtfDisclosures(force=false) {
  if (browserFile || loadingEtfDisclosures || (!force && Date.now()-lastEtfRequest<3600000)) return false;
  loadingEtfDisclosures = true;
  lastEtfRequest = Date.now();
  try {
    const response = await fetch("./assets/etf-holdings.json",{cache:"no-cache",signal:AbortSignal.timeout(8000)});
    if (!response.ok) return false;
    const {funds} = await response.json();
    const incoming = Object.fromEntries(Object.entries(funds ?? {}).flatMap(([symbol,record])=>{
      if (!symbolValid(symbol) || !record || typeof record.source!=="string") return [];
      const current = etfSnapshot(record.current), previous = etfSnapshot(record.previous);
      const url = typeof record.url==="string" && /^https:\/\//.test(record.url) ? record.url : "";
      return [[symbol,{source:record.source,url,current,previous:previous?.date<current?.date?previous:null,unavailable:record.unavailable===true}]];
    }));
    if (JSON.stringify(incoming)===JSON.stringify(etfDisclosures)) return false;
    etfDisclosures = incoming;
    return true;
  } catch {return false;}
  finally {loadingEtfDisclosures=false;}
}

function etfWeightSource(fund, weights, disclosures) {
  const direct = Object.hasOwn(disclosures,fund) ? disclosures[fund] : null;
  const reference = etfDisclosureSites[fund]?.reference;
  const proxy = reference ? disclosures[reference] : null;
  const useProxy = Boolean(proxy?.current && (!direct?.current || (direct.unavailable && proxy.current.date>direct.current.date)));
  const automatic = useProxy ? proxy : direct;
  const manual = weights.filter(row=>row.fund===fund);
  const newerManual = manual.some(row=>validNavDate(row.date) && row.date>automatic?.current?.date);
  return {automatic,manual,reference:useProxy?reference:null,useAutomatic:Boolean(automatic?.current && !newerManual)};
}

function effectiveEtfWeights(weights, disclosures) {
  const funds = new Set([...weights.map(row=>row.fund),...Object.keys(disclosures),...Object.keys(etfDisclosureSites)]);
  return [...funds].flatMap(fund=>{
    const {automatic,manual,reference,useAutomatic} = etfWeightSource(fund,weights,disclosures);
    return useAutomatic ? automatic.current.rows.map(([member,weight])=>({fund,member,weight,date:automatic.current.date,
      source:reference?automatic.source+" · "+reference+" 同指数参考":automatic.source,...(reference?{referenceFund:reference}:{})})) : manual;
  });
}

function etfChanges(current, previous) {
  if (!previous) return "待下一期披露后比较";
  const before = new Map(previous.rows), after = new Map(current.rows);
  const added = current.rows.filter(([symbol])=>!before.has(symbol));
  const removed = previous.rows.filter(([symbol])=>!after.has(symbol));
  const describe = rows=>rows.slice().sort((a,b)=>b[1]-a[1]).slice(0,4).map(([symbol])=>symbol).join("、")
    +(rows.length>4?" 等 "+rows.length+" 项":"");
  const moves = current.rows.flatMap(([symbol,weight])=>{
    const delta = weight-before.get(symbol);
    return Math.abs(delta)>=.05 ? [[symbol,delta]] : [];
  }).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1])).slice(0,3);
  const changes = [added.length?"新增 "+describe(added):"",removed.length?"移出 "+describe(removed):"",
    moves.length?"主要权重变化 "+moves.map(([symbol,delta])=>symbol+" "+plus(delta)+" 个百分点").join("、"):""].filter(Boolean);
  return changes.join(" · ") || "成分无新增或移出，未见明显权重变化";
}

function renderEtfDisclosures(funds, weights, disclosures) {
  by("etf-disclosure").hidden = !funds.length;
  if (!funds.length) return;
  const displayed = new Set(funds);
  for (const fund of funds) {
    const reference = etfDisclosureSites[fund]?.reference;
    if (reference) displayed.add(reference);
  }
  table("etf-disclosure-table",["ETF","成分日期与来源","披露持仓变化"],[...displayed].map(fund=>{
    const {automatic,manual,reference,useAutomatic} = etfWeightSource(fund,weights,disclosures);
    const site = etfDisclosureSites[fund];
    const link = (url,label)=>url ? '<a class="text-button" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(label)+'</a>' : esc(label);
    const alternatives = [site?.url ? link(site.url,fund+" 官方披露") : "", site?.reference && !reference
      ? link(etfDisclosureSites[site.reference].url,site.reference+" 同指数参考") : ""].filter(Boolean);
    if (!useAutomatic) {
      const manualDate = manual.map(row=>row.date).filter(validNavDate).sort().at(-1);
      const manualLabel = manual.length ? (manualDate?manualDate+" · ":"")+"手动成分" : "暂无成分快照";
      return [td(esc(fund)),td([esc(manualLabel),...alternatives].join(" · ")),
        td(automatic?.current?"采用更新的手动成分":"待获取发行人披露")];
    }
    const {source,url,current,previous,unavailable} = automatic;
    const origin = link(url,reference?reference+" 同指数参考":source);
    const date = current.date+" · "+current.rows.length+" 项"+(unavailable?" · 沿用":"");
    const otherLinks = reference ? alternatives : alternatives.slice(1);
    return [td(esc(fund)),td([esc(date),origin,...otherLinks].join(" · ")),td(esc((previous?previous.date+" → "+current.date+" · ":"")
      +etfChanges(current,previous)))];
  }));
}

const equitySectorNames = {
  technology:"信息技术",financials:"金融",communication:"通讯服务",health:"医疗保健",
  discretionary:"非必需消费",industrial:"工业",staples:"必需消费",energy:"能源",
  utilities:"公用事业",realestate:"房地产",materials:"原材料",
};
const sectorNames = {
  ...equitySectorNames,gold:"黄金",
  duration:"长久期债券",reserve:"现金替代",cash:"现金",unknown:"行业未分类",
};
const knownStockSectors = {
  AAPL:"technology",NVDA:"technology",MSFT:"technology",TSM:"technology",AVGO:"technology",
  AMD:"technology",QCOM:"technology",TXN:"technology",ORCL:"technology",PLTR:"technology",
  AMZN:"discretionary",TSLA:"discretionary",HD:"discretionary",META:"communication",
  "BRK-B":"financials",GOOG:"communication",GOOGL:"communication",VZ:"communication",
  "O39.SI":"financials","D05.SI":"financials",BAC:"financials",HSBC:"financials",
  IBKR:"financials",SMFG:"financials",JPM:"financials",V:"financials",MA:"financials",
  LLY:"health",MRK:"health",UNH:"health",JNJ:"health",COST:"staples",PG:"staples",KO:"staples",
  XOM:"energy",CVX:"energy",COP:"energy",
};
let etfSectors = {};
let lastSectorRequest = 0;

async function refreshEtfSectors(force) {
  if (browserFile || (!force && Date.now()-lastSectorRequest<3600000)) return false;
  lastSectorRequest = Date.now();
  try {
    const response = await fetch("./assets/etf-sectors.json",{cache:"no-cache",signal:AbortSignal.timeout(8000)});
    if (!response.ok) return false;
    const raw = await response.json();
    const next = Object.fromEntries(Object.entries(raw).flatMap(([symbol,record])=>{
      if (!symbolValid(symbol) || !validNavDate(record?.date) || typeof record.source!=="string"
        || !/^https:\/\//.test(record.url) || !record.rows) return [];
      const rows = Object.entries(record.rows).filter(([sector,weight])=>Object.hasOwn(sectorNames,sector)
        && sector!=="unknown" && fnum(weight) && weight>0 && weight<=100);
      const total = rows.reduce((sum,row)=>sum+row[1],0);
      return total>=85 && total<=101 ? [[symbol,{...record,rows}]] : [];
    }));
    if (JSON.stringify(next)===JSON.stringify(etfSectors)) return false;
    etfSectors = next;
    return true;
  } catch {return false;}
}

function createSectorLookup(state,isDemo) {
  const classes = new Map(state.positions.map(row=>[row.symbol,row.bucket]));
  const disclosures = isDemo ? {} : etfDisclosures;
  const components = effectiveEtfWeights(state.weights,disclosures);
  const stockSector = symbol => Object.hasOwn(knownStockSectors,symbol) ? knownStockSectors[symbol]
    : classes.get(symbol)==="bank" ? "financials" : "unknown";
  const cache = new Map();
  return row=>{
    const bucket = row.bucket ?? classes.get(row.symbol) ?? orderAssets[row.symbol]?.[1];
    const key = [row.kind,row.symbol,bucket].join("/");
    if (cache.has(key)) return cache.get(key);
    let weights;
    if (row.kind==="cash") weights = [["cash",1]];
    else if (row.kind==="stock") weights = [[stockSector(row.symbol),1]];
    else if (["gold","duration","reserve"].includes(bucket)) weights = [[bucket,1]];
    else {
      const disclosure = !isDemo && etfSectors[row.symbol];
      const partial = disclosure ? disclosure.rows : components.filter(member=>member.fund===row.symbol)
        .map(member=>[stockSector(member.member),member.weight]);
      const total = partial.reduce((sum,item)=>sum+item[1],0);
      const scale = disclosure && Math.abs(total-100)<.05 ? total : Math.max(100,total);
      weights = partial.map(([sector,weight])=>[sector,weight/scale]);
      if (total<scale) weights.push(["unknown",(scale-total)/scale]);
    }
    cache.set(key,weights);
    return weights;
  };
}

function sectorExposure(report,state,isDemo) {
  const classify = createSectorLookup(state,isDemo);
  const sectors = new Map();
  const sources = new Set();
  for (const row of report.values) {
    if (!(row.marketValue>0)) continue;
    const column = row.kind==="etf" ? 1 : 0;
    if (!isDemo && row.kind==="etf" && Object.hasOwn(etfSectors,row.symbol)) sources.add(row.symbol);
    for (const [sector,weight] of classify(row)) {
      if (!sectors.has(sector)) sectors.set(sector,[0,0]);
      sectors.get(sector)[column] += weight*row.marketValue;
    }
  }
  return {entries:[...sectors].sort((a,b)=>b[1][0]+b[1][1]-a[1][0]-a[1][1]),sources:[...sources].sort()};
}

function renderSectorExposure(report,{entries,sources}) {
  table("sector-exposure-table",["行业／资产类别","直接持有","ETF 敞口","合计敞口"],entries.map(([sector,[direct,through]])=>[
    td(esc(sectorNames[sector])),td(ratio(navWeight(direct,report.nav))),td(ratio(navWeight(through,report.nav))),
    td("<strong>"+ratio(navWeight(direct+through,report.nav))+"</strong>"),
  ]));
  by("sector-exposure-sources").innerHTML = "权重以已计价组合市值为分母。使用发行人最近披露的行业权重，或已知成分；缺项归入「行业未分类」。"
    + sources.map(symbol=>{
      const record = etfSectors[symbol];
      return ' <a href="'+esc(record.url)+'" target="_blank" rel="noopener noreferrer">'+esc(symbol+" "+record.date+" · "+record.source)+'</a>';
    }).join("");
}
