"use strict";

const concentrationLimitsKey = "market-concentration-limits-v1";
const analysisRateKey = "market-risk-reference-rates-v1";
const analysisRates = localRead(analysisRateKey,{});
const concentrationFields = {
  largest:{label:"最大个股敞口",defaultLimit:7},
  topThree:{label:"前三大个股敞口",defaultLimit:20},
  financial:{label:"金融行业敞口",defaultLimit:25},
};
const analysisLimits = Object.fromEntries(Object.entries(concentrationFields).map(([key,{defaultLimit}])=>{
  const stored = localRead(concentrationLimitsKey,{})[key];
  return [key,fnum(stored) && stored>=0 && stored<=100 ? stored : defaultLimit];
}));
const analysisAnnualRate = base => {
  const value = analysisRates[base];
  return fnum(value) && value>-100 && value<=100 ? value/100 : null;
};

function concentrationSnapshot(report,sectors) {
  const valued = report.values.some(row=>row.quantity>0 && !fnum(row.marketValue));
  const top = report.underlying.filter(row=>row.total>0).slice(0,3);
  const financial = sectors.entries.find(([key])=>key==="financials")?.[1] ?? [];
  const unknown = sectors.entries.find(([key])=>key==="unknown")?.[1] ?? [];
  const hasUnknownStocks = valued || (fnum(report.coverage) && report.coverage<99.95);
  const hasUnknownSectors = valued || unknown.some(value=>value>0);
  return {
    largest:{value:navWeight(top[0]?.total ?? 0,report.nav),names:top.slice(0,1).map(row=>row.symbol),partial:hasUnknownStocks},
    topThree:{value:navWeight(sum(top,"total"),report.nav),names:top.map(row=>row.symbol),partial:hasUnknownStocks},
    financial:{value:navWeight(financial.reduce((total,value)=>total+value,0),report.nav),names:[],partial:hasUnknownSectors},
  };
}

function concentrationStatus(item,limit) {
  if (!fnum(item?.value)) return "缺少估值";
  if (item.value>limit) return "已超上限";
  return item.partial ? "已知值未超 · 有缺项" : "未超上限";
}

function renderConcentration(snapshot) {
  if (!snapshot) return;
  for (const [key] of Object.entries(concentrationFields)) {
    const row = snapshot[key], status = concentrationStatus(row,analysisLimits[key]);
    by("concentration-"+key).textContent = ratio(row.value);
    by("concentration-"+key+"-status").textContent = [row.names.join("、"),status].filter(Boolean).join(" · ");
    by("concentration-"+key+"-status").classList.toggle("down",status==="已超上限");
  }
}

let simulationAnalysis = null;
let simulationRequestTimer;
const simulationRiskFields = [
  ["volatility","年化波动率",true],["maximum","模拟最大回撤",true],
  ["beta","Beta",false],["correlation","与基准相关性",false],
];

function updateSimulationAnalysis(before,after,beforeConcentration,afterConcentration,stress,errors) {
  simulationAnalysis = {before,after,beforeConcentration,afterConcentration,stress,errors};
  by("simulation-risk").hidden = !after;
  renderConcentration(beforeConcentration);
}

function renderSimulationRisk(force=false) {
  if (!simulationAnalysis?.after || (!force && !by("simulation-risk").open)) return null;
  const {before,after} = simulationAnalysis;
  const {from,to} = navRangeDates(riskView.range,Date.now());
  const benchmark = performanceBenchmarks[performanceReference()];
  const result = demo ? {missing:[]} : performanceCompareTrades(before,after,from,to,portfolio.base,performancePrices,benchmark.mix);
  const show = value=>fnum(value) ? fmt(value) : "—";
  const observations = result.before?.observations ?? 0;
  const minimum = performanceMinimum;
  const sampleNote = observations<minimum.volatility ? " · 波动率至少需 "+minimum.volatility+" 期，Beta、相关性和风险贡献至少需 "+minimum.ratios+" 期"
    : observations<minimum.ratios ? " · Beta、相关性和风险贡献至少需 "+minimum.ratios+" 期" : "";
  by("simulation-risk-status").textContent = result.before
    ? result.from+" – "+result.to+" · "+result.before.observations+" 期 · "+(result.benchmarkAvailable?benchmark.label:"所选基准缺少报价")
      +sampleNote+(result.missing.length?" · 缺少 "+result.missing.slice(0,5).join("、"):"")
    : demo ? "演示持仓未载入历史行情。" : result.unpriced ? "换仓前后都需要可用市值，才能确定固定权重。"
      : performanceLoading ? "正在获取模拟所需的历史行情。"
      : "暂无共同的连续历史样本。"+(result.missing.length?" 缺少 "+result.missing.slice(0,5).join("、")+"。":"");
  table("simulation-risk-table",["指标","操作前","操作后","变化"],simulationRiskFields.map(([key,label,pct])=>{
    const left = result.before?.[key], right = result.after?.[key];
    const format = pct ? performancePercent : show;
    const delta = fnum(left) && fnum(right) ? (pct ? performancePp(right-left) : plus(right-left)) : "—";
    return [td(esc(label)),td(format(left)),td(format(right)),td(delta)];
  }));
  const left = new Map(result.before?.assets.map(item=>[item.key,item]));
  const right = new Map(result.after?.assets.map(item=>[item.key,item]));
  const keys = [...new Set([...left.keys(),...right.keys()])].sort((a,b)=>
    Math.max(Math.abs(right.get(b)?.risk??0),Math.abs(left.get(b)?.risk??0))-
    Math.max(Math.abs(right.get(a)?.risk??0),Math.abs(left.get(a)?.risk??0)));
  const validBefore = result.before?.assets.some(row=>fnum(row.risk));
  const validAfter = result.after?.assets.some(row=>fnum(row.risk));
  by("simulation-risk-assets").hidden = !validBefore && !validAfter;
  table("simulation-risk-contribution",["持仓","操作前占比","操作后占比","变化"],keys.map(key=>{
    const a = left.get(key), b = right.get(key);
    const first = validBefore ? a?.risk ?? 0 : null, second = validAfter ? b?.risk ?? 0 : null;
    return [td(esc((b??a).label)),td(performancePercent(first)),td(performancePercent(second)),
      td(fnum(first) && fnum(second) ? performancePp(second-first) : "—")];
  }));
  return result;
}

function requestSimulationHistory() {
  clearTimeout(simulationRequestTimer);
  if (simulationAnalysis?.after && by("simulation-risk").open) {
    simulationRequestTimer = setTimeout(()=>refreshPerformance(),400);
  }
}

function exportRiskMetrics(risk) {
  if (!risk) return null;
  const {assets,top,matrix,...metrics} = risk;
  return {...metrics,assets:assets.map(({key,label,weight,risk:contribution})=>({key,label,weight,contribution})),
    correlationMatrix:{labels:top.map(row=>row.label),values:matrix}};
}

function exportAnalysis() {
  const now = Date.now(), base = portfolio.base;
  const benchmark = performanceBenchmarks[performanceReference()];
  const {rows,comparisons,result,drawdown,requested,attribution} = performanceView;
  const risk = riskView.report;
  const {before,after,beforeConcentration,afterConcentration,stress,errors} = simulationAnalysis ?? {};
  const comparison = renderSimulationRisk(true);
  const sectors = before ? sectorExposure(before,portfolio,demo) : null;
  const afterSectors = after ? sectorExposure(after,portfolio,demo) : null;
  const describeExposures = report=>report?.underlying.map(({funds,...row})=>({...row,funds:Object.fromEntries(funds)}));
  const describeSectors = snapshot=>snapshot?.entries.map(([key,[direct,through]])=>({sector:sectorNames[key],direct,through})) ?? [];
  const formatRows = series=>series?.map(({date,value,change,estimated})=>({date,cumulativeReturn:value-1,periodReturn:change??null,estimated:estimated??null}));
  const rollingMetrics = ["volatility","maximum","beta"];
  downloadPortfolioFile("组合分析",portfolio.name,{
    schema:1,base,account:performanceScope(),demo,
    units:{money:base,return:"小数（0.01 等于 1%）",concentration:"百分数（1 等于 1%）"},
    holdings:before?.values ?? [],
    nav:{range:navView.range,requested:navRangeDates(navView.range,now),points:navSavedPoints(base,navDays(portfolio.navHistory,now,navView.range))},
    performance:{range:performanceView.range,requested,points:formatRows(rows),drawdown,missing:result?.missing ?? [],
      simulatedPeriods:result?.simulated??null,attribution,selectedBenchmark:benchmark.label,
      benchmarks:Object.fromEntries(Object.entries(comparisons).map(([key,series])=>{
        const {label,mix} = performanceBenchmarks[key];
        return [key,{label,mix,points:formatRows(series)??null}];
      })),
      excess:comparisons[performanceReference()]?.map((point,i)=>({date:point.date,returnDifference:rows[i].value-point.value})) ?? []},
    risk:risk ? {range:riskView.range,requested:risk.requested,recordedOnly:risk.recordedOnly,annualRiskFreeRate:risk.rate,
      minimumSamples:performanceMinimum,points:formatRows(risk.result.rows),benchmarkPoints:formatRows(risk.bench),
      missing:risk.result.missing ?? [],drawdown:risk.drawdown,metrics:exportRiskMetrics(risk.risk),
      rolling:Object.fromEntries(rollingMetrics.map(key=>[key,performanceRolling(risk.result.rows,risk.bench,key)]))} : null,
    exposure:{stock:describeExposures(before)??[],sector:describeSectors(sectors),coveragePercent:before?.coverage??null,
      sectorSources:[...new Set([...(sectors?.sources??[]),...(afterSectors?.sources??[])])].map(symbol=>{
        const {source,url,date} = etfSectors[symbol];
        return {symbol,source,url,date};
      })},
    concentration:{limits:{...analysisLimits},before:beforeConcentration??null,after:afterConcentration??null},
    simulation:{orders,errors:errors??[],holdingsAfter:after?.values??null,stockExposureAfter:describeExposures(after)??null,
      sectorExposureAfter:describeSectors(afterSectors),
      stress:stress??[],historicalRisk:comparison ? {...comparison,before:exportRiskMetrics(comparison.before),after:exportRiskMetrics(comparison.after)} : null},
    methods:{nav:"每日 06:00 新加坡时间估值，含出入金。",performance:"上一估值时点持仓权重衔接的复权收益估算，每周二至周六取样。",
      benchmarks:"采用相同日期和计价币种，混合基准每期再平衡。",simulation:"参考当前市值权重，每期恢复目标权重，前后使用共同连续样本。",
      riskFree:"年化常数按实际日数折算，使用当前显示币种。",risk:performanceRiskDefinitions},
  });
}

function initPortfolioAnalysis() {
  by("export-analysis").addEventListener("click",exportAnalysis);
  for (const [key,{defaultLimit}] of Object.entries(concentrationFields)) {
    const input = by("concentration-"+key+"-limit");
    input.value = analysisLimits[key];
    input.addEventListener("change",()=>{
      const value = numberFromInput(input.value) ?? defaultLimit;
      analysisLimits[key] = Math.min(100,Math.max(0,value));
      input.value = analysisLimits[key];
      localWrite(concentrationLimitsKey,analysisLimits);
      draw();
    });
  }
  by("simulation-risk").addEventListener("toggle",()=>{
    if (!by("simulation-risk").open) return;
    renderSimulationRisk();
    requestSimulationHistory();
  });
  by("risk-free-rate").addEventListener("change",event=>{
    const input = event.target;
    const value = numberFromInput(input.value);
    if (fnum(value) && value>-100 && value<=100) analysisRates[portfolio.base] = value;
    else delete analysisRates[portfolio.base];
    input.value = analysisRates[portfolio.base] ?? "";
    localWrite(analysisRateKey,analysisRates);
    renderRiskAnalysis();
  });
}
