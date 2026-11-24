"use strict";

const performancePrices = new Map();
const performanceRequests = new Map();
const performanceView = {range:"month",mode:"total",plot:null,selected:null,rows:[],comparisons:{},visible:new Set(Object.keys(performanceBenchmarks))};
const riskView = {range:"year",report:null};
const rollingRiskView = {plot:null,selected:null};
let performanceLoading = false;
let performanceQueued = false;
let performanceForceQueued = false;
let performanceLastMessage = "";

const performanceRiskMetrics = [
  ["volatility","年化波动率",true,"每日收益的样本标准差乘以 √252。数值越高，收益起伏越大。"],
  ["maximum","最大回撤",true,"区间内从累计收益高点到后续低点的最大跌幅。"],
  ["sharpe","夏普比率",false,"每期超额收益的均值除以其样本标准差，再乘以 √252。用当前显示币种的年化无风险率按实际日数折算。"],
  ["sortino","索提诺比率",false,"每期平均超额收益除以相对最低目标收益的下行偏差，再乘以 √252。最低目标沿用同币种无风险率。"],
  ["beta","Beta",false,"组合和所选基准每日收益的协方差，除以基准收益方差。1 表示对基准的平均敏感度为一倍。"],
  ["correlation","基准相关性",false,"对齐日期后的组合与基准日收益 Pearson 相关系数，范围 −1 至 +1。"],
  ["calmar","卡玛比率",false,"区间收益按日历天数几何年化，再除以最大回撤的绝对值。至少覆盖 90 个日历日。"],
  ["var","单期 VaR 95%",true,"把观察到的单期收益排序，取最差 5% 样本中最轻的损失。"],
  ["cvar","单期 CVaR 95%",true,"最差 5% 样本的平均损失。"],
  ["upside","上行捕获率",true,"只取基准上涨期，组合的几何年化收益除以基准收益。"],
  ["downside","下行捕获率",true,"只取基准下跌期，组合的几何年化收益除以基准收益。当两者都下跌时，低于 100% 表示组合跌得更少。"],
];
const performanceRiskDefinitions = [
  ...performanceRiskMetrics.map(([,label,,meaning])=>[label,meaning]),
  ["持仓波动风险贡献","单项持仓每期收益贡献与组合收益的协方差，除以组合收益方差。合计约 100%，负值表示该项在此区间分散了部分波动。"],
  ["持仓相关性矩阵","按平均权重列出最多 12 项资产。每对使用两项同时持有且有报价的日收益计算 Pearson 相关系数。"],
];
const performancePp = value => fnum(value) ? plus(value*100)+" pp" : "—";
const performancePercent = value => fnum(value) ? fmt(value*100)+"%" : "—";
const performanceSigned = value => fnum(value) ? '<span class="'+tone(value)+'">'+pctText(value*100)+'</span>' : "—";
const performanceScope = () => by("performance-account").value==="all" ? null : by("performance-account").value.slice(8);
const performanceReference = () => by("performance-benchmark").value;

function performanceAccounts(state) {
  const names = new Set(state.positions.map(row=>row.account));
  for (const snapshot of state.navHistory?.snapshots ?? []) {
    for (const row of snapshot.accounts ?? []) names.add(row.account);
  }
  return [...names].sort((a,b)=>a.localeCompare(b,"zh-CN"));
}

function updatePerformanceAccounts(accounts) {
  const select = by("performance-account");
  const selected = select.value;
  const markup = '<option value="all">全部账户</option>'+accounts.map(name=>'<option value="account:'+esc(name)+'">'+esc(name)+'</option>').join("");
  if (select.innerHTML===markup) return;
  select.innerHTML = markup;
  select.value = [...select.options].some(option=>option.value===selected) ? selected : "all";
}

function performanceSymbols(state,from,to) {
  const symbols = new Set(performanceBenchmarkSymbols);
  if (state.base!=="USD") symbols.add(navFxSymbol(state.base));
  const simulated = by("simulation-risk").open ? simulationAnalysis?.after?.values ?? [] : [];
  const positions = [...state.positions,...simulated,...performanceSchedule(state,from,to).flatMap(row=>row.holdings)];
  for (const row of positions) {
    if (!(row.quantity>0)) continue;
    if (row.kind!=="cash") symbols.add(row.symbol);
    if (row.currency!=="USD" && row.currency!==state.base) symbols.add(navFxSymbol(row.currency));
  }
  return [...symbols];
}

async function refreshPerformance(force=false) {
  if (!navInitialized || demo || !hasApi || !livePortfolio || (!portfolio.positions.length && !portfolio.navHistory)) return;
  if (performanceLoading) {
    performanceQueued = true;
    performanceForceQueued ||= force;
    return;
  }
  const now = Date.now();
  const {from,to} = navRangeDates("year",now);
  const symbols = performanceSymbols(portfolio,from,to).filter(symbol=>{
    const request = performanceRequests.get(symbol);
    return force || request?.date!==to || (!request.full && now-request.time>=15*60000);
  });
  if (!symbols.length) return;
  performanceLoading = true;
  performanceLastMessage = "";
  renderPerformance();
  try {
    let unsupported = false, failed = false;
    for (let i=0;i<symbols.length && !unsupported;i+=12) {
      const batches = [i,i+4,i+8].map(start=>symbols.slice(start,start+4)).filter(batch=>batch.length);
      const results = await Promise.allSettled(batches.map(batch=>requestMarket("performance",{symbols:batch.join(","),from,to},35000)));
      for (const [index,result] of results.entries()) {
        const batch = batches[index];
        if (result.status==="rejected") {
          failed = true;
          unsupported ||= result.reason?.code==="scope" || result.reason?.status===404;
        }
        for (const symbol of batch) {
          const quote = result.status==="fulfilled" ? result.value.prices?.[symbol] : null;
          const byDate = new Map();
          if (typeof quote?.currency==="string" && Array.isArray(quote.rows)) {
            for (const row of quote.rows) {
              if (!Array.isArray(row) || !validNavDate(row[0]) || !(row[1]>0) || !fnum(row[1])) continue;
              const fx = /^USD[A-Z]{3}=X$/.test(symbol);
              const close = fx ? row[1] : row[3];
              if (fnum(close) && close>0) byDate.set(row[0],{price:row[1],close,splitClose:row[4]});
            }
            if (byDate.size) performancePrices.set(symbol,{currency:quote.currency,byDate});
          }
          const expected = (navCutoff(to)-navCutoff(from))/navDayMs+1;
          performanceRequests.set(symbol,{date:to,time:now,full:byDate.size>=expected-2});
        }
      }
      // Back off the entire request when the deployed Worker still serves the older API.
      if (unsupported) {
        for (const symbol of symbols) performanceRequests.set(symbol,{date:to,time:now,full:false});
      }
    }
    performanceLastMessage = unsupported ? "历史收益需要部署新版行情 Worker。"
      : failed ? "部分历史行情请求失败，将在下次刷新时重试。" : "";
  } finally {
    performanceLoading = false;
    renderPerformance();
    if (performanceQueued) {
      const force = performanceForceQueued;
      performanceQueued = false;
      performanceForceQueued = false;
      refreshPerformance(force);
    }
  }
}

function showPerformancePoint() {
  const {rows,comparisons,visible,selected,plot,mode} = performanceView;
  const index = Math.min(selected ?? rows.length-1,rows.length-1);
  const point = rows[index];
  if (!point || !plot) return;
  const readings = [{label:"组合",color:"var(--chart-line)",value:point.value-1}];
  for (const [key,series] of Object.entries(comparisons)) {
    if ((mode==="excess" ? key===performanceReference() : visible.has(key)) && series) {
      readings.push({...performanceBenchmarks[key],value:series[index].value-1});
    }
  }
  const format = (value,relative) => relative ? performancePp(value) : pctText(value*100);
  if (mode==="excess") readings.push({label:"超额收益",color:"var(--chart-line)",value:readings[0].value-readings[1].value,relative:true});
  const active = selected!==null;
  const x = plot.x(index);
  const y = plot.y(plot.points[index][1]);
  plot.guide.setAttribute("x1",x);
  plot.guide.setAttribute("x2",x);
  plot.guide.setAttribute("y1",plot.top);
  plot.guide.setAttribute("y2",plot.bottom);
  plot.guide.style.opacity = active ? "1" : "0";
  plot.cursor.setAttribute("cx",x);
  plot.cursor.setAttribute("cy",y);
  plot.cursor.style.opacity = active ? "1" : "0";
  plot.tip.hidden = !active;
  if (active) {
    plot.tipTime.textContent = point.date + (mode==="excess" ? "" : " · 累计收益");
    plot.tipValue.innerHTML = readings.map(({label,color,value,relative})=>
      '<span class="performance-tip-row"><i style="--series-color:'+color+'"></i><span>'+esc(label)+'</span><b class="'+tone(value)+'">'+esc(format(value,relative))+'</b></span>'
    ).join("");
    placePlotTip(plot,x,y);
  }
  by("performance-readout").innerHTML = '<span>'+esc(point.date)+'</span>'
    +readings.map(({label,value,relative})=>'<span>'+esc(label)+' <strong class="'+tone(value)+'">'+esc(format(value,relative))+'</strong></span>').join("");
}

function drawPerformancePlot() {
  const {rows,comparisons,visible,mode} = performanceView;
  if (!rows.length) return;
  const target = by("performance-chart");
  const excess = mode==="excess", benchmark = comparisons[performanceReference()];
  by("performance-legend").hidden = excess;
  target.hidden = excess && !benchmark;
  by("performance-readout").hidden = target.hidden;
  by("performance-excess-note").hidden = !excess;
  by("performance-excess-note").textContent = target.hidden ? "所选基准缺少同区间行情，无法显示超额收益。"
    : "组合累计收益减去 "+performanceBenchmarks[performanceReference()].label+" 的累计收益，单位为百分点。";
  if (target.hidden) {performanceView.plot=null;return;}
  const points = rows.map((row,i)=>[navCutoff(row.date),(row.value-(excess?benchmark[i].value:1))*100]);
  performanceView.plot = drawMarketPlot(target,points,{
    base:0,quietCursor:true,axisWidth:60,axisFormat:value=>fmt(value,1)+(excess?" pp":"%"),
    axisLabel:row=>navDate(row[0]).slice(5).replace("-","/"),
    overlays:excess ? [] : Object.entries(comparisons).filter(([key,series])=>visible.has(key)&&series).map(([key,series])=>({
      color:performanceBenchmarks[key].color,values:series.map(row=>(row.value-1)*100),
    })),
  });
  performanceView.plot.tip.classList.add("performance-tip");
  showPerformancePoint();
}

function renderPerformanceLegend() {
  const item = (key,label,color)=>'<label class="quote-switch performance-benchmark"><input type="checkbox" value="'+esc(key)+'"'
    +(performanceView.visible.has(key)?" checked":"")+(!performanceView.comparisons[key]?" disabled":"")
    +'><i style="--series-color:'+color+'"></i>'+esc(label)+'</label>';
  by("performance-legend").innerHTML = '<span class="performance-benchmark"><i style="--series-color:var(--chart-line)"></i>组合</span>'
    +Object.entries(performanceBenchmarks).map(([key,{label,color}])=>item(key,label,color)).join("");
}

function performanceProvenance(result) {
  if (!result.rows.length || !result.simulated) return "按历史持仓快照估算";
  return result.simulated===result.rows.length-1 ? "固定持仓模拟" : "含固定持仓模拟："+result.simulated+" 期";
}

function renderPerformanceAccounts(accounts,from,to,base) {
  const details = by("performance-accounts");
  details.hidden = accounts.length<2;
  if (details.hidden || !details.open) return;
  const data = accounts.map(name=>({name,result:performanceSeries(performanceSchedule(portfolio,from,to,name),base,performancePrices)}));
  const ready = data.filter(row=>row.result.rows.length>=2);
  const start = ready.map(row=>row.result.rows[0].date).sort().at(-1);
  const end = ready.map(row=>row.result.rows.at(-1).date).sort()[0];
  const comparable = ready.length>=2 && start<end;
  by("performance-account-data").hidden = !comparable;
  by("performance-account-status").textContent = comparable ? start+" – "+end+" · "+base+" · 各账户使用同一有效区间。"
    : "至少两个账户需要有重合的有效估值区间。";
  if (!comparable) return;
  table("performance-account-table",["账户","区间收益","最大回撤","年化波动率","持仓依据"],data.map(({name,result})=>{
    const rows = result.rows.filter(row=>row.date>=start && row.date<=end);
    if (rows.length<2) return [td(esc(name)),td("—"),td("—"),td("—"),td("缺少有效区间")];
    const change = rows.at(-1).value/rows[0].value-1;
    const drawdown = performanceDrawdown(rows);
    const history = {rows,simulated:rows.slice(1).filter(row=>row.estimated).length};
    const volatility = performanceRisk(rows,null,drawdown,null,{matrix:false})?.volatility;
    return [td(esc(name)),td(performanceSigned(change)),td(performancePercent(drawdown?.decline)),td(performancePercent(volatility)),td(esc(performanceProvenance(history)))];
  }));
}

function renderPerformanceAttribution(result,drawdown,benchmark,base) {
  const {rows} = result;
  const last = rows.at(-1);
  const available = drawdown?.decline<0;
  const summary = [];
  if (available) {
    const peak = rows[drawdown.start].date, trough = rows[drawdown.trough].date;
    const recovery = drawdown.recovery>=0 ? rows[drawdown.recovery].date : null;
    summary.push("最大回撤 "+performancePercent(drawdown.decline)+"（"+peak+" → "+trough+"，"+performanceDaysBetween(peak,trough)+" 天）");
    summary.push(recovery ? "已于 "+recovery+" 恢复（共 "+performanceDaysBetween(peak,recovery)+" 天）"
      : "尚未恢复（"+performanceDaysBetween(peak,last.date)+" 天）· 已收复 "+performancePercent(drawdown.progress));
  } else summary.push("此区间未出现回撤");
  if (benchmark) summary.push("较 "+performanceBenchmarks[performanceReference()].label+" 超额 "+performancePp(last.value-benchmark.at(-1).value));
  const sectors = createSectorLookup(portfolio,demo);
  const total = performanceAttribution(rows,0,rows.length-1,sectors);
  const loss = available ? performanceAttribution(rows,drawdown.start,drawdown.trough,sectors) : null;
  by("performance-drawdown").textContent = summary.join(" · ")+" · "+base+" · "+performanceProvenance(result);
  const assetMap = new Map(total.assets.map(row=>[row.key,row]));
  for (const drop of loss?.assets ?? []) assetMap.set(drop.key,{...assetMap.get(drop.key),drop:drop.price+drop.fx});
  const items = [...assetMap.values()].sort((a,b)=>Math.abs(b.drop??b.price+b.fx)-Math.abs(a.drop??a.price+a.fx));
  table("performance-asset-attribution",["持仓","区间贡献","回撤贡献"],items.map(row=>[
    td(esc(row.label)),td(performancePp(row.price+row.fx)),td(performancePp(loss ? row.drop??0 : null)),
  ]));
  const group = new Map(loss?.industries);
  table("performance-sector-attribution",["行业／资产类别","区间贡献","回撤贡献"],[
    ...total.industries.map(([sector,value])=>[td(esc(sectorNames[sector])),td(performancePp(value)),td(performancePp(loss ? group.get(sector)??0 : null))]),
    [td("汇率影响"),td(performancePp(total.fx)),td(performancePp(loss?.fx))],
  ]);
  return {total,loss};
}

function riskMetricMissing(key,risk,bench,rate,rows) {
  const min = performanceMinimum;
  const required = key==="volatility" ? min.volatility : ["var","cvar"].includes(key) ? min.tail : min.ratios;
  if (risk.observations<required) return "至少 "+required+" 期";
  if (["sharpe","sortino"].includes(key) && rate===null) return "请填同币种无风险率";
  if (key==="calmar" && performanceDaysBetween(rows[0].date,rows.at(-1).date)<90) return "至少 90 个日历日";
  if (["beta","correlation","upside","downside"].includes(key) && !bench) return "缺少基准报价";
  const direction = key==="upside" ? 1 : key==="downside" ? -1 : 0;
  if (direction && bench.slice(1).filter(row=>row.change*direction>0).length<min.capture) {
    return "至少 "+min.capture+" 个基准"+(direction>0?"上涨":"下跌")+"期";
  }
  return "分母无有效波动或回撤";
}

function historicalAvailability() {
  return demo ? "演示持仓未载入历史行情。" : !hasApi ? "历史分析需要配置行情接口。"
    : !livePortfolio ? "开启自动行情后更新历史分析。" : performanceLoading ? "正在获取区间历史行情与汇率…"
    : performanceLastMessage || "此区间暂无连续的有效收益样本。";
}

function renderRiskAnalysis() {
  const base = portfolio.base, account = performanceScope();
  const {from,to} = navRangeDates(riskView.range,Date.now());
  const recordedOnly = by("risk-recorded").checked;
  const result = demo ? {rows:[]} : performanceSeries(performanceSchedule(portfolio,from,to,account),base,performancePrices,{recordedOnly});
  const {rows} = result, benchmark = performanceBenchmarks[performanceReference()];
  const bench = performanceBenchmark(rows.map(row=>row.date),base,performancePrices,benchmark.mix);
  const drawdown = performanceDrawdown(rows), rate = analysisAnnualRate(base);
  const risk = performanceRisk(rows,bench,drawdown,rate);
  riskView.report = {requested:{from,to},recordedOnly,result,bench,drawdown,rate,risk};
  by("risk-account").textContent = account ?? "全部账户";
  by("risk-rate-currency").textContent = base;
  if (document.activeElement!==by("risk-free-rate") || by("risk-free-rate").dataset.currency!==base) {
    by("risk-free-rate").value = rate===null ? "" : +(rate*100).toFixed(6);
    by("risk-free-rate").dataset.currency = base;
  }
  const notes = risk ? [rows[0].date+" – "+rows.at(-1).date,base,risk.observations+" 期",performanceProvenance(result),
    bench?benchmark.label:"所选基准缺少报价",rate===null?"无风险率待填":"无风险率 "+performancePercent(rate)]
    : [recordedOnly && !performanceLoading && result.expected<2 ? "区间内基于持仓记录的估值点不足两个。" : historicalAvailability()];
  if (result.missing?.length) notes.push("缺少 "+result.missing.slice(0,5).join("、"));
  by("risk-status").textContent = notes.join(" · ");
  by("risk-data").hidden = !risk;
  if (!risk) {
    rollingRiskView.plot = null;
    return;
  }
  by("risk-metrics").innerHTML = performanceRiskMetrics.map(([key,label,pct])=>{
    const value = risk[key];
    const why = fnum(value) ? "" : '<small>'+esc(riskMetricMissing(key,risk,bench,rate,rows))+'</small>';
    return '<div><dt>'+esc(label)+'</dt><dd>'+(pct?performancePercent(value):fmt(value))+'</dd>'+why+'</div>';
  }).join("");
  const threshold = performanceMinimum.ratios;
  const enough = risk.observations>=threshold;
  const frame = enough ? "" : "至少需要 "+threshold+" 期。当前 "+risk.observations+" 期。";
  by("risk-contribution-note").textContent = frame;
  by("risk-correlation-note").textContent = frame;
  by("risk-contribution-wrap").hidden = !enough;
  by("risk-correlation-wrap").hidden = !enough;
  if (enough) {
    table("risk-contribution",["持仓","平均资金权重","波动风险占比"],risk.assets.map(row=>[
      td(esc(row.label)),td(performancePercent(row.weight)),td(performancePercent(row.risk)),
    ]));
    table("risk-correlation",["持仓",...risk.top.map(row=>row.label)],risk.matrix.map((row,i)=>[
      td(esc(risk.top[i].label)),...row.map(value=>td(fmt(value),value>.65?"risk-aligned":value<-.45?"risk-inverse":"")),
    ]));
  }
  renderRollingRisk();
}

function showRollingRiskPoint() {
  const format = by("risk-rolling-metric").value==="beta" ? fmt : performancePercent;
  plotPoint(rollingRiskView,by("risk-rolling-readout"),format);
}

function renderRollingRisk() {
  if (!by("risk-rolling").open || !riskView.report?.risk) return;
  const metric = by("risk-rolling-metric").value;
  const target = by("risk-rolling-chart");
  const {result,bench} = riskView.report;
  const values = performanceRolling(result.rows,bench,metric);
  target.hidden = !values.length;
  by("risk-rolling-status").textContent = values.length ? ""
    : metric==="beta" && !bench ? "滚动 Beta 需要同区间基准报价。" : "每个滚动值需要 "+performanceMinimum.rolling+" 期有效样本。";
  rollingRiskView.plot = drawMarketPlot(target,values.map(row=>[navCutoff(row.date),row.value]),{
    quietCursor:true,axisWidth:55,axisFormat:metric==="beta" ? value=>fmt(value,2) : value=>performancePercent(value),
    pointLabel:row=>navDate(row[0]),axisLabel:row=>navDate(row[0]).slice(5).replace("-","/"),
  });
  showRollingRiskPoint();
}

function renderPerformance() {
  const now = Date.now();
  const {from,to} = navRangeDates(performanceView.range,now);
  const accounts = performanceAccounts(portfolio);
  updatePerformanceAccounts(accounts);
  const account = performanceScope(), base = portfolio.base;
  const result = demo ? {rows:[]} : performanceSeries(performanceSchedule(portfolio,from,to,account),base,performancePrices);
  const {rows} = result;
  const benchmarkMissing = [];
  const comparisons = Object.fromEntries(Object.entries(performanceBenchmarks).map(([key,record])=>{
    const series = performanceBenchmark(rows.map(row=>row.date),base,performancePrices,record.mix);
    if (!series) benchmarkMissing.push(record.label);
    return [key,series];
  }));
  const benchmark = comparisons[performanceReference()];
  const drawdown = performanceDrawdown(rows);
  const requested = rows.length<result.expected ? " · 有效估值 "+rows.length+" / "+result.expected+" 个时点" : "";
  const missing = result.missing?.length ? " · 缺少 "+result.missing.slice(0,5).join("、")+(result.missing.length>5?" 等报价或汇率":" 的报价或汇率") : "";
  const status = rows.length<2 ? historicalAvailability()+missing
    : rows[0].date+" – "+rows.at(-1).date+" · "+base+" · "+performanceProvenance(result)+requested
      +(benchmarkMissing.length ? " · 基准缺项："+benchmarkMissing.join("、") : "")+missing
      +(performanceLastMessage ? " · "+performanceLastMessage : "");
  by("performance-status").textContent = status;
  by("performance-data").hidden = rows.length<2;
  renderRiskAnalysis();
  renderSimulationRisk();
  Object.assign(performanceView,{rows,comparisons,result,drawdown,attribution:null,requested:{from,to}});
  if (rows.length<2) {
    performanceView.rows = [];
    performanceView.plot = null;
    return;
  }
  renderPerformanceLegend();
  drawPerformancePlot();
  performanceView.attribution = renderPerformanceAttribution(result,drawdown,benchmark,base);
  renderPerformanceAccounts(accounts,from,to,base);
}

function initPerformance() {
  by("performance-benchmark").innerHTML = Object.entries(performanceBenchmarks).map(([key,row])=>'<option value="'+key+'">'+esc(row.label)+'</option>').join("");
  by("performance-benchmark").value = "spyMix";
  const choices = (attribute,view,field,render)=>{
    const buttons = [...document.querySelectorAll("["+attribute+"]")];
    for (const button of buttons) button.addEventListener("click",()=>{
      const value = button.getAttribute(attribute);
      if (value===view[field]) return;
      view[field] = value;
      for (const option of buttons) option.setAttribute("aria-pressed",String(option===button));
      render();
    });
  };
  choices("data-performance-range",performanceView,"range",()=>{
    performanceView.selected = null;
    renderPerformance();
  });
  choices("data-performance-mode",performanceView,"mode",()=>{
    performanceView.selected = null;
    drawPerformancePlot();
  });
  choices("data-risk-range",riskView,"range",()=>{
    rollingRiskView.selected = null;
    renderRiskAnalysis();
    renderSimulationRisk();
  });
  by("risk-recorded").addEventListener("change",()=>{
    rollingRiskView.selected = null;
    renderRiskAnalysis();
  });
  by("risk-rolling").addEventListener("toggle",()=>{if(by("risk-rolling").open) renderRollingRisk();});
  by("risk-rolling-metric").addEventListener("change",()=>{
    rollingRiskView.selected = null;
    renderRollingRisk();
  });
  const rolling = by("risk-rolling-chart");
  bindPlot(rolling,rollingRiskView,showRollingRiskPoint);
  new ResizeObserver(()=>{
    if (rollingRiskView.plot && (rolling.clientWidth!==rollingRiskView.plot.width || rolling.clientHeight!==rollingRiskView.plot.height)) renderRollingRisk();
  }).observe(rolling);
  for (const id of ["performance-account","performance-benchmark"]) by(id).addEventListener("change",()=>{
    performanceView.selected = null;
    rollingRiskView.selected = null;
    renderPerformance();
  });
  by("performance-accounts").addEventListener("toggle",()=>{
    if (by("performance-accounts").open) renderPerformance();
  });
  by("performance-legend").addEventListener("change",event=>{
    const {value,checked} = event.target;
    if (checked) performanceView.visible.add(value);
    else performanceView.visible.delete(value);
    drawPerformancePlot();
  });
  by("risk-method").innerHTML = performanceRiskDefinitions.map(([label,meaning])=>
    '<div><dt>'+esc(label)+'</dt><dd>'+esc(meaning)+'</dd></div>').join("")
    +'<div><dt>样本与年化</dt><dd>账户和基准沿用历史表现。风险区间单独选择。每年按 252 期折算，样本不足时每项会标注所需期数。</dd></div>';
  const chart = by("performance-chart");
  bindPlot(chart,performanceView,showPerformancePoint);
  new ResizeObserver(()=>{
    if (performanceView.plot && (chart.clientWidth!==performanceView.plot.width || chart.clientHeight!==performanceView.plot.height)) drawPerformancePlot();
  }).observe(chart);
}
