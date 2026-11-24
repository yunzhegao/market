"use strict";

let etfDisclosures = {};
let lastEtfRequest = 0;
let loadingEtfDisclosures = false;

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
  const automatic = Object.hasOwn(disclosures,fund) ? disclosures[fund] : null;
  const manual = weights.filter(row=>row.fund===fund);
  const newerManual = manual.some(row=>validNavDate(row.date) && row.date>automatic?.current?.date);
  return {automatic,manual,useAutomatic:Boolean(automatic?.current && !newerManual)};
}

function effectiveEtfWeights(weights, disclosures) {
  const funds = new Set([...weights.map(row=>row.fund),...Object.keys(disclosures)]);
  return [...funds].flatMap(fund=>{
    const {automatic,manual,useAutomatic} = etfWeightSource(fund,weights,disclosures);
    return useAutomatic ? automatic.current.rows.map(([member,weight])=>({fund,member,weight,date:automatic.current.date,source:automatic.source})) : manual;
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
  table("etf-disclosure-table",["ETF","成分日期与来源","披露持仓变化"],funds.map(fund=>{
    const {automatic,manual,useAutomatic} = etfWeightSource(fund,weights,disclosures);
    if (!useAutomatic) {
      const manualDate = manual.map(row=>row.date).filter(validNavDate).sort().at(-1);
      const manualLabel = manual.length ? (manualDate?manualDate+" · ":"")+"手动成分" : "—";
      return [td(esc(fund)),td(esc(manualLabel)),
        td(automatic?.unavailable?"发布方数据暂不可用":automatic?.current?"采用更新的手动成分":"暂无自动成分数据")];
    }
    const {source,url,current,previous,unavailable} = automatic;
    const link = url ? '<a class="text-button" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(source)+'</a>' : esc(source);
    const date = current.date+(unavailable?" · 沿用":"");
    return [td(esc(fund)),td(esc(date)+" · "+link),td(esc((previous?previous.date+" → "+current.date+" · ":"")
      +etfChanges(current,previous)))];
  }));
}
