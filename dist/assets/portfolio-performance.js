"use strict";

const performancePrices = new Map();
const performanceRequests = new Map();
const performanceView = {plot:null,selected:null,rows:[],comparisons:{},visible:new Set(Object.keys(performanceBenchmarks))};
let performanceLoading = false;
let performanceQueued = false;
let performanceLastMessage = "";

const performanceRiskMetrics = [
  ["volatility","年化波动率",true,"每日收益的样本标准差乘以 √252。数值越高，收益起伏越大。"],
  ["maximum","最大回撤",true,"区间内从累计收益高点到后续低点的最大跌幅。"],
  ["sharpe","夏普比率",false,"每日平均超额收益除以每日收益波动率，再乘以 √252。此处无风险利率取 0%。"],
  ["sortino","索提诺比率",false,"每日平均超额收益除以相对目标收益的下行偏差，再乘以 √252。目标收益取 0%，高于目标的日收益不计入下行偏差。"],
  ["beta","Beta",false,"组合和所选基准每日收益的协方差，除以基准收益方差。1 表示对基准的平均敏感度为一倍。"],
  ["calmar","卡玛比率",false,"区间收益按日历天数几何年化，再除以最大回撤的绝对值。至少覆盖 90 个日历日。"],
  ["var","单期 VaR 95%",true,"把观察到的单期收益排序，取最差 5% 样本中最轻的损失。至少需要 40 期。"],
  ["cvar","单期 CVaR 95%",true,"最差 5% 样本的平均损失。与 VaR 一起显示历史尾部损失，至少需要 40 期。"],
  ["upside","上行捕获率",true,"只取基准上涨期，组合的几何年化收益除以基准收益。至少需要 5 个上涨期。"],
  ["downside","下行捕获率",true,"只取基准下跌期，组合的几何年化收益除以基准收益。当两者都下跌时，低于 100% 表示组合跌得更少。至少需要 5 个下跌期。"],
];
const performanceRiskDefinitions = [
  ...performanceRiskMetrics.map(([,label,,meaning])=>[label,meaning]),
  ["持仓波动风险贡献","单项持仓每期收益贡献与组合收益的协方差，除以组合收益方差。合计约 100%，负值表示该项在此区间分散了部分波动。"],
  ["持仓相关性矩阵","按平均权重列出最多 12 项资产。每对使用两项同时持有且有报价的收益计算 Pearson 相关系数。+1 同向、−1 反向，至少需要 15 对观察值。"],
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
  const positions = [...state.positions,...performanceSchedule(state,from,to).flatMap(row=>row.holdings)];
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
    performanceQueued ||= force;
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
      performanceQueued = false;
      refreshPerformance(true);
    }
  }
}

function showPerformancePoint() {
  const {rows,comparisons,visible,selected} = performanceView;
  const point = rows[Math.min(selected ?? rows.length-1,rows.length-1)];
  if (!point) return;
  const {plot} = performanceView;
  if (plot) {
    const index = rows.indexOf(point);
    const x = plot.x(index);
    const y = plot.y((point.value-1)*100);
    plot.guide.setAttribute("x1",x);
    plot.guide.setAttribute("x2",x);
    plot.guide.setAttribute("y1",plot.top);
    plot.guide.setAttribute("y2",plot.bottom);
    plot.guide.style.opacity = selected===null ? "0" : "1";
    plot.cursor.setAttribute("cx",x);
    plot.cursor.setAttribute("cy",y);
    plot.cursor.style.opacity = selected===null ? "0" : "1";
  }
  by("performance-readout").innerHTML = '<span>'+esc(point.date)+'</span><span>组合 '+performanceSigned(point.value-1)+'</span>'
    +Object.entries(comparisons).filter(([key,series])=>visible.has(key)&&series).map(([key,series])=>
      '<span>'+esc(performanceBenchmarks[key].label)+' '+performanceSigned(series[rows.indexOf(point)].value-1)+'</span>').join("");
}

function drawPerformancePlot() {
  const {rows,comparisons,visible} = performanceView;
  if (!rows.length) return;
  const target = by("performance-chart");
  performanceView.plot = drawMarketPlot(target,rows.map(row=>[navCutoff(row.date),(row.value-1)*100]),{
    base:0,quietCursor:true,axisWidth:55,axisFormat:value=>fmt(value,1)+"%",
    axisLabel:row=>navDate(row[0]).slice(5).replace("-","/"),
    overlays:Object.entries(comparisons).filter(([key,series])=>visible.has(key)&&series).map(([key,series])=>({
      color:performanceBenchmarks[key].color,values:series.map(row=>(row.value-1)*100),
    })),
  });
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
    const volatility = performanceRisk(rows,null,drawdown)?.volatility;
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
}

function renderPerformanceRisk(result,bench,drawdown,account,status) {
  const risk = result.rows.length>=2 ? performanceRisk(result.rows,bench,drawdown) : null;
  by("risk-account").textContent = account ?? "全部账户";
  by("risk-status").textContent = risk ? result.rows[0].date+" – "+result.rows.at(-1).date+" · "+risk.observations+" 期"
    +" · "+performanceProvenance(result)+(bench?" · 基准 "+performanceBenchmarks[performanceReference()].label:" · 所选基准缺少报价")
    : result.rows.length>=2 ? "当前有效收益样本 "+(result.rows.length-1)+" 期，风险指标至少需要 15 期。"
    : status;
  by("risk-data").hidden = !risk;
  if (!risk) return;
  by("risk-metrics").innerHTML = performanceRiskMetrics.map(([key,label,pct])=>
    '<div><dt>'+esc(label)+'</dt><dd>'+(pct?performancePercent(risk[key]):fmt(risk[key]))+'</dd></div>').join("");
  table("risk-contribution",["持仓","平均权重","风险占比"],risk.assets.map(row=>[
    td(esc(row.label)),td(performancePercent(row.weight)),td(performancePercent(row.risk)),
  ]));
  table("risk-correlation",["持仓",...risk.top.map(row=>row.label)],risk.matrix.map((row,i)=>[
    td(esc(risk.top[i].label)),...row.map(value=>td(fmt(value),value>.65?"risk-aligned":value<-.45?"risk-inverse":"")),
  ]));
}

function renderPerformance() {
  const now = Date.now();
  const {from,to} = navRangeDates(navView.range,now);
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
  const availability = demo ? "演示持仓未载入历史行情。" : !hasApi ? "历史分析需要配置行情接口。"
    : !livePortfolio ? "开启自动行情后更新历史分析。" : performanceLoading ? "正在获取区间历史行情与汇率…"
    : performanceLastMessage || "此区间暂无连续的有效收益样本。";
  const requested = rows.length<result.expected ? " · 有效估值 "+rows.length+" / "+result.expected+" 个时点" : "";
  const missing = result.missing?.length ? " · 缺少 "+result.missing.slice(0,5).join("、")+(result.missing.length>5?" 等报价或汇率":" 的报价或汇率") : "";
  const status = rows.length<2 ? availability+missing
    : rows[0].date+" – "+rows.at(-1).date+" · "+base+" · "+performanceProvenance(result)+requested
      +(benchmarkMissing.length ? " · 基准缺项："+benchmarkMissing.join("、") : "")+missing
      +(performanceLastMessage ? " · "+performanceLastMessage : "");
  by("performance-status").textContent = status;
  by("performance-data").hidden = rows.length<2;
  renderPerformanceRisk(result,benchmark,drawdown,account,status);
  if (rows.length<2) {
    performanceView.rows = [];
    performanceView.plot = null;
    return;
  }
  Object.assign(performanceView,{rows,comparisons});
  renderPerformanceLegend();
  drawPerformancePlot();
  renderPerformanceAttribution(result,drawdown,benchmark,base);
  renderPerformanceAccounts(accounts,from,to,base);
}

function initPerformance() {
  by("performance-benchmark").innerHTML = Object.entries(performanceBenchmarks).map(([key,row])=>'<option value="'+key+'">'+esc(row.label)+'</option>').join("");
  by("performance-benchmark").value = "mix";
  for (const id of ["performance-account","performance-benchmark"]) by(id).addEventListener("change",()=>{
    performanceView.selected = null;
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
    +'<div><dt>样本与年化</dt><dd>沿用历史表现所选账户和区间，至少使用 15 期，按每年 252 期折算。样本不足或计算无有效分母时显示「—」。</dd></div>';
  const chart = by("performance-chart");
  bindPlot(chart,performanceView,showPerformancePoint);
  new ResizeObserver(()=>{
    if (performanceView.plot && chart.clientWidth!==performanceView.plot.width) drawPerformancePlot();
  }).observe(chart);
}
