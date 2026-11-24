"use strict";

const concentrationLimitsKey = "market-concentration-limits-v1";
const analysisRateKey = "market-risk-reference-rates-v1";
const analysisPreferencesKey = "market-portfolio-analysis-preferences-v1";
const analysisPreferences = localRead(analysisPreferencesKey,{});
function saveAnalysisPreference(key,value) {
  analysisPreferences[key] = value;
  localWrite(analysisPreferencesKey,{...localRead(analysisPreferencesKey,{}),[key]:value});
}
const analysisRates = localRead(analysisRateKey,{});
const concentrationFields = {
  largest:{label:"最大个股敞口",defaultLimit:7},
  topThree:{label:"前三大个股敞口",defaultLimit:20},
  largestIndustry:{label:"最高单一行业敞口",defaultLimit:25},
};
function readConcentrationLimits() {
  const saved = localRead(concentrationLimitsKey,{});
  return {...saved,largestIndustry:saved.largestIndustry ?? saved.financial};
}
const analysisLimits = Object.fromEntries(Object.entries(concentrationFields).map(([key,{defaultLimit}])=>{
  const stored = readConcentrationLimits()[key];
  return [key,fnum(stored) && stored>=0 && stored<=100 ? stored : defaultLimit];
}));
const analysisAnnualRate = base => {
  const value = analysisRates[base];
  return fnum(value) && value>-100 && value<=100 ? value/100 : null;
};

function concentrationSnapshot(report,sectors) {
  const valued = report.values.some(row=>row.quantity>0 && !fnum(row.marketValue));
  const top = report.underlying.filter(row=>row.total>0).slice(0,3);
  const industry = sectors.entries.filter(([key])=>Object.hasOwn(equitySectorNames,key))
    .map(([key,[direct,indirect]])=>({key,total:direct+indirect})).sort((a,b)=>b.total-a.total)[0];
  const unknown = sectors.entries.find(([key])=>key==="unknown")?.[1] ?? [];
  const hasUnknownStocks = valued || (fnum(report.coverage) && report.coverage<99.95);
  const hasUnknownSectors = valued || unknown.some(value=>value>0);
  return {
    largest:{value:navWeight(top[0]?.total ?? 0,report.nav),names:top.slice(0,1).map(row=>row.symbol),partial:hasUnknownStocks},
    topThree:{value:navWeight(sum(top,"total"),report.nav),names:top.map(row=>row.symbol),partial:hasUnknownStocks},
    largestIndustry:{value:!industry && hasUnknownSectors ? null : navWeight(industry?.total??0,report.nav),
      names:industry ? [equitySectorNames[industry.key]] : [],partial:hasUnknownSectors},
  };
}

function concentrationStatus(item,limit) {
  if (!fnum(item?.value)) return item?.partial ? "敞口待核对" : "缺少估值";
  if (item.value>limit) return "已超上限";
  return item.partial ? "已知值未超 · 有缺项" : "未超上限";
}

function renderConcentration(snapshot) {
  if (!snapshot || !by("concentration-largest")) return;
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

const analysisDrawdownLimit = () => {
  const value = analysisPreferences.drawdownLimit;
  return fnum(value) && value>=0 && value<=100 ? value/100 : .15;
};

function renderRiskOverview(data) {
  const {result,bench,risk,drawdown,scenario} = data;
  const last = result.rows.at(-1), budget = drawdownBudget(drawdown?.current,analysisDrawdownLimit());
  const excess = bench && last ? last.value-bench.at(-1).value : null;
  const metrics = [
    ["区间累计收益",last?performanceSigned(last.value-1):"—"],
    ["基准超额收益",performancePp(excess)],
    ["最大回撤",performancePercent(drawdown?.decline)],
    ["当前回撤",performancePercent(drawdown?.current)],
    ["年化波动率",performancePercent(risk?.volatility)],
    ["剩余回撤预算",budget?performancePp(budget.remaining):"—"],
  ];
  by("risk-overview").innerHTML = metrics.map(([label,value])=>'<div><dt>'+esc(label)+'</dt><dd>'+value+'</dd></div>').join("");
  by("risk-overview-period").textContent = last ? result.rows[0].date+" – "+last.date+" · "+(scenario?"模拟换仓":performanceProvenance(result)) : "暂无可用历史区间";
  by("drawdown-distance").textContent = !budget ? "以所选风险区间内的收益高点为基准。"
    : budget.remaining<=0 ? "当前回撤已触及或超过上限。" : "从当前估算净值再下跌约 "+performancePercent(budget.furtherLoss)+" 即触及上限。";
  const bar = by("drawdown-progress"), limit = analysisDrawdownLimit();
  bar.hidden = !budget || limit===0;
  if (!bar.hidden) bar.value = Math.min(100,-drawdown.current/limit*100);
  renderJointStress();
}

function jointStressDataset(current=riskView.report?.drawdown?.current) {
  const selected = selectedStressScenarios().filter(index=>Number.isInteger(index) && portfolio.scenarios[index]);
  if (!simulationAnalysis || !selected.length) return null;
  const {before,after} = simulationAnalysis;
  const scenarios = [...new Set(selected)].map(index=>portfolio.scenarios[index]);
  const assumptions = jointStressScenario(scenarios);
  const evaluate = report=>{
    if (!(report?.nav>0) || report.values.some(row=>row.quantity>0 && !fnum(row.marketValue))) return null;
    const impact = stressResult(report,assumptions,portfolio.base);
    return {impact,return:impact/report.nav,shockedNav:report.nav+impact};
  };
  const data = {scenarios:scenarios.map(row=>row.name),assumptions,before:evaluate(before),after:evaluate(after)};
  const context = simulationRequested && after ? data.after : data.before;
  data.projectedDrawdown = context && fnum(current) && performanceScope()===null ? (1+current)*(1+context.return)-1 : null;
  return data;
}

function selectedStressScenarios() {
  return Array.isArray(analysisPreferences.jointScenarios) ? analysisPreferences.jointScenarios : [];
}

function renderJointStress() {
  const container = by("joint-stress-choices");
  if (!container) return;
  const selected = selectedStressScenarios();
  const markup = portfolio.scenarios.map(({name},index)=>'<label class="quote-switch"><input type="checkbox" value="'+index+'"'
    +(selected.includes(index)?' checked':'')+'>'+esc(name)+'</label>').join("");
  if (container.innerHTML!==markup) container.innerHTML = markup;
  const result = jointStressDataset();
  const format = (label,side)=>side ? label+" "+plus(side.impact)+" "+portfolio.base+"（"+pctText(side.return*100)+"），冲击后市值 "+fmt(side.shockedNav) : "";
  const notes = result ? [format("操作前",result.before),format("操作后",result.after)].filter(Boolean) : [];
  if (fnum(result?.projectedDrawdown)) notes.push("冲击后距所选风险区间高点 "+performancePercent(result.projectedDrawdown));
  by("joint-stress-result").textContent = notes.join(" · ") || (result ? "持仓估值不全，无法计算联合冲击。" : "勾选要同时施加的情景。各类价格冲击与外币冲击按乘积合并。");
}

function updateSimulationAnalysis(before,after,beforeConcentration,afterConcentration,stress,errors) {
  simulationAnalysis = {before,after,beforeConcentration,afterConcentration,stress,errors};
  if (by("simulation-risk")) by("simulation-risk").hidden = !after;
  if (by("view-simulated-risk")) by("view-simulated-risk").hidden = !after || demo;
  if (by("risk-simulation-banner")) {
    by("risk-simulation-banner").hidden = !simulationRequested;
    by("risk-simulation-status").textContent = after ? "模拟持仓视图 · 历史表现按换仓后的参考权重回测，压力测试列出换仓前后。"
      : "没有可用的模拟持仓，当前展示实际持仓。";
  }
  renderConcentration(simulationRequested && after ? afterConcentration : beforeConcentration);
}

function simulationRiskDataset() {
  if (!simulationAnalysis?.after) return null;
  const {before,after} = simulationAnalysis;
  const {from,to} = navRangeDates(riskView.range,Date.now());
  const benchmark = performanceBenchmarks[performanceReference()];
  return demo ? {missing:[]} : performanceCompareTrades(before,after,from,to,portfolio.base,performancePrices,benchmark.mix);
}

function renderSimulationRisk() {
  if (!by("simulation-risk")?.open) return;
  const result = simulationRiskDataset();
  if (!result) return;
  const benchmark = performanceBenchmarks[performanceReference()];
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
  if (simulationAnalysis?.after && by("simulation-risk")?.open) {
    simulationRequestTimer = setTimeout(()=>refreshPerformance(),400);
  }
}

function exportRiskMetrics(risk) {
  if (!risk) return null;
  const {assets,top,matrix,...metrics} = risk;
  return {...metrics,assets:assets.map(({key,label,weight,risk:contribution})=>({key,label,weight,contribution})),
    correlationMatrix:{labels:top.map(row=>row.label),values:matrix}};
}

function exportReturnRows(series,detailed=false) {
  return series?.map(row=>({
    date:row.date,cumulativeReturn:row.value-1,periodReturn:row.change??null,estimated:row.estimated??null,
    ...(detailed&&row.parts ? {contributions:row.parts.map(part=>({
      key:part.key,weight:part.weight,price:part.price,fx:part.fx,return:part.move,
    }))} : {}),
  })) ?? null;
}

function exportPerformanceWindow(range,data,detailed=false) {
  const {result,comparisons,bench,drawdown,requested} = data;
  const {rows} = result;
  const sectors = createSectorLookup(portfolio,demo);
  const attribution = rows.length>1 ? {
    total:performanceAttribution(rows,0,rows.length-1,sectors),
    loss:drawdown?.decline<0 ? performanceAttribution(rows,drawdown.start,drawdown.trough,sectors) : null,
  } : null;
  return {range,requested,recordedOnly:data.recordedOnly,points:exportReturnRows(rows,detailed),drawdown,missing:result.missing??[],
    simulatedPeriods:result.simulated??null,attribution,selectedBenchmark:performanceBenchmarks[performanceReference()].label,
    benchmarks:Object.fromEntries(Object.entries(comparisons).map(([key,series])=>{
      const {label,mix} = performanceBenchmarks[key];
      return [key,{label,mix,points:exportReturnRows(series)}];
    })),
    excess:bench?.map((point,i)=>({date:point.date,returnDifference:rows[i].value-point.value})) ?? [],
  };
}

function exportAnalysis(mode) {
  const now = Date.now(), base = portfolio.base, full = mode==="full";
  const account = performanceScope();
  const risk = analysisDataset(riskView.range,now,{recordedOnly:Boolean(analysisPreferences.recordedOnly)});
  const rate = analysisAnnualRate(base);
  const riskMetrics = performanceRisk(risk.result.rows,risk.bench,risk.drawdown,rate);
  const {before,after,beforeConcentration,afterConcentration,stress,errors} = simulationAnalysis ?? {};
  const comparison = simulationRiskDataset();
  const sectors = before ? sectorExposure(before,portfolio,demo) : null;
  const afterSectors = after ? sectorExposure(after,portfolio,demo) : null;
  const describeExposures = report=>report?.underlying.map(({funds,...row})=>({...row,funds:Object.fromEntries(funds)}));
  const describeSectors = snapshot=>snapshot?.entries.map(([key,[direct,through]])=>({sector:sectorNames[key],direct,through})) ?? [];
  const exportNav = range=>{
    const days = navDays(portfolio.navHistory,now,range);
    return {range,requested:navRangeDates(range,now),expected:days.length,points:navSavedPoints(base,days)};
  };
  const performance = exportPerformanceWindow(performanceView.range,analysisDataset(performanceView.range,now));
  const riskAttribution = exportPerformanceWindow(riskView.range,risk);
  const rollingMetrics = ["volatility","maximum","beta"];
  const historical = full ? Object.fromEntries([...Object.keys(navRangeMonths),"mtd","ytd"].map(range=>{
    const data = analysisDataset(range,now);
    const metrics = performanceRisk(data.result.rows,data.bench,data.drawdown,rate);
    return [range,{nav:exportNav(range),performance:exportPerformanceWindow(range,data,true),
      risk:{metrics:exportRiskMetrics(metrics),drawdown:data.drawdown,
        rolling:Object.fromEntries(rollingMetrics.map(key=>[key,performanceRolling(data.result.rows,data.bench,key)]))}}];
  })) : null;
  const span = navRangeDates("year",now);
  const allNavDates = navDays(portfolio.navHistory,now,"year");
  const relevantSymbols = new Set(full ? performanceSymbols(portfolio,span.from,span.to) : []);
  const journal = !demo ? readPrivateJournal() : emptyJournal();
  downloadPortfolioFile(full?"组合分析完整历史":"组合分析",portfolio.name,{
    schema:2,mode,base,account,demo,simulatedView:risk.scenario,
    units:{money:base,return:"小数（0.01 等于 1%）",concentration:"百分数（1 等于 1%）"},
    holdings:before?.values ?? [],
    journalStatus:{coverage:journal.coverage,entries:journal.entries.length,pending:journal.entries.filter(row=>row.pending).length,
      ...(full && journal.brokerHistory ? {brokerHistory:{currency:"USD",periods:journal.brokerHistory.periods}} : {})},
    nav:exportNav(navView.range),performance,
    risk:{range:riskView.range,requested:risk.requested,recordedOnly:risk.recordedOnly,annualRiskFreeRate:rate,
      minimumSamples:performanceMinimum,points:exportReturnRows(risk.result.rows,full),benchmarkPoints:exportReturnRows(risk.bench),
      missing:risk.result.missing ?? [],drawdown:risk.drawdown,metrics:exportRiskMetrics(riskMetrics),
      attribution:riskAttribution.attribution,benchmarks:riskAttribution.benchmarks,
      weeklyCorrelation:riskMetrics ? performanceWeeklyCorrelation(risk.result.rows,riskMetrics.top) : null,
      drawdownBudget:{limit:analysisDrawdownLimit(),...drawdownBudget(risk.drawdown?.current,analysisDrawdownLimit())},
      rolling:Object.fromEntries(rollingMetrics.map(key=>[key,performanceRolling(risk.result.rows,risk.bench,key)]))},
    ...(full?{history:{windows:historical,loading:performanceLoading||navBusy,missingSymbols:[...relevantSymbols].filter(symbol=>!performancePrices.has(symbol)),
      start:span.from,end:span.to,reference:portfolio.navHistory?.reference??null,snapshots:portfolio.navHistory?.snapshots??[],
      dailyHoldings:allNavDates.map(({date,holdings,estimated,basis})=>({date,holdings,estimated,basis})),
      currentPositions:portfolio.positions,simulatedPositions:after?.values??null,
      effectiveEtfWeights:effectiveEtfWeights(portfolio.weights,demo?{}:etfDisclosures),
      prices:Object.fromEntries([...performancePrices].filter(([symbol])=>relevantSymbols.has(symbol)).map(([symbol,quote])=>{
        const rows = [...quote.byDate].filter(([date])=>date>=span.from && date<=span.to).map(([date,reading])=>({date,...reading}));
        return [symbol,{currency:quote.currency,kind:/^USD[A-Z]{3}=X$/.test(symbol)?"fx":"security",rows}];
      })),
    }}:{}),
    exposure:{stock:describeExposures(before)??[],sector:describeSectors(sectors),coveragePercent:before?.coverage??null,
      sectorSources:[...new Set([...(sectors?.sources??[]),...(afterSectors?.sources??[])])].map(symbol=>{
        const {source,url,date} = etfSectors[symbol];
        return {symbol,source,url,date};
      })},
    concentration:{limits:{...analysisLimits},before:beforeConcentration??null,after:afterConcentration??null},
    simulation:{orders,errors:errors??[],holdingsAfter:after?.values??null,stockExposureAfter:describeExposures(after)??null,
      sectorExposureAfter:describeSectors(afterSectors),
      stress:stress??[],jointStress:jointStressDataset(risk.drawdown?.current),historicalRisk:comparison ? {...comparison,before:exportRiskMetrics(comparison.before),after:exportRiskMetrics(comparison.after)} : null},
    methods:{nav:"每日 06:00 新加坡时间估值，含出入金。",performance:"上一估值时点持仓权重衔接的复权收益估算，每周二至周六取样。",
      benchmarks:"采用相同日期和计价币种，混合基准每期再平衡。",simulation:"参考当前市值权重，每期恢复目标权重，前后使用共同连续样本。",
      riskFree:"年化常数按实际日数折算，使用当前显示币种。",risk:performanceRiskDefinitions},
  });
}

function syncAnalysisRanges() {
  for (const [key,view,attribute] of [["navRange",navView,"data-nav-range"],
    ["performanceRange",performanceView,"data-performance-range"],["riskRange",riskView,"data-risk-range"]]) {
    const range = analysisPreferences[key];
    if (Object.hasOwn(navRangeMonths,range) || ["mtd","ytd"].includes(range)) view.range = range;
    for (const button of document.querySelectorAll("["+attribute+"]")) button.setAttribute("aria-pressed",String(button.getAttribute(attribute)===view.range));
  }
}

function renderExportAvailability() {
  const button = by("export-analysis-full");
  if (!button) return;
  button.disabled = performanceLoading || navBusy;
  by("export-history-status").textContent = button.disabled ? "正在补充历史行情和估值。" : "行情缺项会在导出文件中标记。";
}

function initPortfolioAnalysis() {
  syncAnalysisRanges();
  const dialog = by("analysis-export-dialog");
  by("export-analysis").addEventListener("click",()=>{
    renderExportAvailability();
    dialog.showModal();
  });
  for (const mode of ["current","full"]) by("export-analysis-"+mode).addEventListener("click",()=>{
    exportAnalysis(mode);
    dialog.close();
  });
  for (const [key,{defaultLimit}] of Object.entries(concentrationFields)) {
    const input = by("concentration-"+key+"-limit");
    if (!input) continue;
    input.value = analysisLimits[key];
    input.addEventListener("change",()=>{
      const value = numberFromInput(input.value) ?? defaultLimit;
      analysisLimits[key] = Math.min(100,Math.max(0,value));
      input.value = analysisLimits[key];
      localWrite(concentrationLimitsKey,analysisLimits);
      draw();
    });
  }
  by("simulation-risk")?.addEventListener("toggle",()=>{
    if (!by("simulation-risk").open) return;
    renderSimulationRisk();
    requestSimulationHistory();
  });
  by("risk-free-rate")?.addEventListener("change",event=>{
    const input = event.target;
    const value = numberFromInput(input.value);
    if (fnum(value) && value>-100 && value<=100) analysisRates[portfolio.base] = value;
    else delete analysisRates[portfolio.base];
    input.value = analysisRates[portfolio.base] ?? "";
    localWrite(analysisRateKey,analysisRates);
    renderRiskAnalysis();
  });
  const limit = by("drawdown-limit");
  if (limit) {
    limit.value = +(analysisDrawdownLimit()*100).toFixed(2);
    limit.addEventListener("change",()=>{
      const value = numberFromInput(limit.value);
      saveAnalysisPreference("drawdownLimit",fnum(value)?Math.max(0,Math.min(100,value)):15);
      limit.value = +(analysisDrawdownLimit()*100).toFixed(2);
      if (riskView.report) renderRiskOverview(riskView.report);
    });
  }
  by("joint-stress-choices")?.addEventListener("change",()=>{
    saveAnalysisPreference("jointScenarios",[...by("joint-stress-choices").querySelectorAll("input:checked")].map(input=>Number(input.value)));
    renderJointStress();
  });
}
