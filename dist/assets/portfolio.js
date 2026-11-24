"use strict";

const savedPortfolio = readPortfolioBook();
let portfolio;
try { portfolio = savedPortfolio ? normalizePortfolio(savedPortfolio) : blankPortfolio(); }
catch { portfolio = blankPortfolio(); }
const portfolioFxKey = "market-portfolio-fx-cache-v1";
const portfolioQuoteKey = "market-portfolio-quote-cache-v1";
const savedFx = localRead(portfolioFxKey,{});
let autoRates = savedFx.rates ?? {};
let fxInfo = savedFx.label ?? "";
let fxRequest = 0;
let activeFxDate = savedFx.date;
const portfolioRiskPage = Boolean(by("risk-title"));
const simulationRequested = portfolioRiskPage && new URLSearchParams(location.search).get("simulation")==="1";
const simulationOrdersKey = "market-portfolio-simulation-v1";
const readSimulationOrders = () => {
  const saved = localRead(simulationOrdersKey,[]);
  return Array.isArray(saved) ? saved.filter(row=>row && typeof row==="object") : [];
};
let orders = readSimulationOrders();
const saveSimulationOrders = () => {if (!demo) localWrite(simulationOrdersKey,orders);};
let editor;
let demo = false;
let persistenceWarning = "";
let databaseVersion = null;
let pendingSave = false;
let portfolioQuotes = localRead(portfolioQuoteKey,{});
let quotesLoading = false;
let livePortfolio = localRead("market-observation-live-prices",true);
const formatter = new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"});
const editorDialog = by("portfolio-dialog");

const sampleAccount = "演示账户";
const sample = {
  name:"演示组合", base:"USD", date:"", rates:{}, scenarios:defaultScenarios,
  positions:[
    {account:sampleAccount,symbol:"SPY",name:"标普 500 ETF",kind:"etf",currency:"USD",quantity:12,price:550,previous:544,cost:515,bucket:"core",role:"美股大盘底仓"},
    {account:sampleAccount,symbol:"AAPL",name:"苹果",kind:"stock",currency:"USD",quantity:8,price:190,previous:192,cost:175,bucket:"tech",role:"大型科技股敞口"},
    {account:sampleAccount,symbol:"NVDA",name:"英伟达",kind:"stock",currency:"USD",quantity:10,price:135,previous:131,cost:120,bucket:"tech",role:"半导体成长敞口"},
    {account:sampleAccount,symbol:"TLT",name:"美国长期国债 ETF",kind:"etf",currency:"USD",quantity:15,price:88,previous:87.5,cost:90,bucket:"duration",role:"长久期国债敞口"},
    {account:sampleAccount,symbol:"GLD",name:"黄金 ETF",kind:"etf",currency:"USD",quantity:5,price:235,previous:236,cost:220,bucket:"gold",role:"黄金敞口"},
    {account:sampleAccount,symbol:"USD",kind:"cash",currency:"USD",quantity:1500},
  ],
  weights:[
    {fund:"SPY",member:"AAPL",weight:6,date:"",source:"演示用权重"},
    {fund:"SPY",member:"NVDA",weight:5,date:"",source:"演示用权重"},
  ],
};

const options = (map,value)=>Object.entries(map).map(([key,label])=>'<option value="'+esc(key)+'"'+(key===value?' selected':'')+'>'+esc(label)+'</option>').join("");
const currencyOptions = value => options(Object.fromEntries(currencyList.map(x=>[x,x])),value);
const money = value => fmt(value);
const signedMoney = value => '<span class="'+tone(value)+'">'+plus(value)+'</span>';
const ratio = value => fnum(value) ? fmt(value)+"%" : "—";
const navWeight = (value,nav) => fnum(value) && nav > 0 ? 100*value/nav : null;
const td = (value, cls = "") => '<td'+(cls?' class="'+cls+'"':'')+'>'+value+'</td>';

function table(element, headers, rows, empty = "暂无数据") {
  const head = '<thead><tr>'+headers.map(title=>'<th scope="col">'+esc(title)+'</th>').join("")+'</tr></thead>';
  const body = rows.length ? rows.map(cells=>'<tr>'+cells.join("")+'</tr>').join("") :
    '<tr><td colspan="'+headers.length+'">'+esc(empty)+'</td></tr>';
  by(element).innerHTML = head+'<tbody>'+body+'</tbody>';
}

async function updateDatabase(mode, fields = {}) {
  if (pendingSave) throw new Error("上一项修改正在保存");
  pendingSave = true;
  try {
    const response = await fetch("./api/portfolio",{
      method:"PUT",headers:{"Content-Type":"application/json"},cache:"no-store",
      body:JSON.stringify({mode,version:databaseVersion,...fields}),signal:AbortSignal.timeout(12000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "数据库保存失败");
    databaseVersion = data.version;
    return data;
  } finally {pendingSave=false;}
}

async function writePortfolio(next, restoredHistory = null) {
  const savedHistory = databaseVersion === null ? normalizeNavHistory(readPortfolioBook()?.navHistory) : null;
  const previous = restoredHistory ?? savedHistory
    ?? portfolio.navHistory ?? migrateNavHistory();
  next = recordNavHoldings(next,previous);
  if (databaseVersion !== null) {
    const {journalId,...databasePortfolio} = next;
    await updateDatabase("save",{portfolio:databasePortfolio});
  }
  portfolio = next;
  demo = false;
  const saved = localWrite(storageKeys.portfolio,next);
  navStorageError = !saved;
  persistenceWarning = saved || databaseVersion !== null ? "" : "浏览器未允许本地保存。可用「导出备份」保留修改。";
  if (saved) window.dispatchEvent(new Event(portfolioEvent));
  if (navInitialized) {
    refreshNavHistory(portfolio,livePortfolio,demo);
    refreshPerformance();
  }
}

function portfolioQuote(row) {
  if (!livePortfolio || demo || row.kind === "cash") return null;
  const quote = portfolioQuotes[row.symbol];
  return quote?.price > 0 && quote.currency === row.currency ? quote : null;
}

function portfolioRowsNow() {
  return portfolio.positions.map(row=>{
    const quote = portfolioQuote(row);
    return quote ? {...row,price:quote.price,previous:quote.previous > 0 ? quote.previous : null} : row;
  });
}

function analyzePortfolio(positions,rates) {
  return analyze(positions,portfolio,rates,effectiveEtfWeights(portfolio.weights,demo?{}:etfDisclosures));
}

async function refreshPortfolioQuotes() {
  if (quotesLoading || !livePortfolio || demo) return;
  const symbols = portfolio.positions.filter(row=>row.quantity>0 && row.kind!=="cash").map(row=>row.symbol);
  if (!symbols.length) return;
  quotesLoading = true;
  try {
    const quotes = await latestMarketQuotes(symbols);
    for (const [key,quote] of Object.entries(quotes)) {
      if (!(portfolioQuotes[key]?.time > quote.time)) portfolioQuotes[key] = quote;
    }
    if (Object.keys(quotes).length) {
      localWrite(portfolioQuoteKey,Object.fromEntries(symbols.filter(symbol=>portfolioQuotes[symbol]).map(symbol=>[symbol,portfolioQuotes[symbol]])));
    }
    draw();
  } finally {quotesLoading=false;}
}

function downloadJson(filename, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));
  const link = document.createElement("a");
  link.download = filename;
  link.href = url;
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function publicPositions() {
  const rates = effectiveRates(autoRates,portfolio.rates);
  const report = analyzePortfolio(portfolioRowsNow(),rates);
  if (!report.nav || report.validCount!==report.values.length) return [];
  return mergeAssets(report.values).filter(row=>row.kind!=="cash" && row.marketValue>=0).map(row=>({
    symbol:row.symbol,kind:row.kind,name:row.name,weight:Number(navWeight(row.marketValue,report.nav).toFixed(2)),
  })).sort((a,b)=>b.weight-a.weight);
}

function displayPublicRows(tableId, rows) {
  table(tableId,["证券","类别","占组合"],rows.map(row=>[
    td("<strong>"+esc(row.symbol)+"</strong> "+esc(row.name)),td(esc(assetKinds[row.kind])),td(ratio(row.weight)),
  ]),"暂无可展示的持仓。请检查价格或汇率是否齐全。");
}

async function publicSnapshot() {
  const options = {cache:"no-store",signal:AbortSignal.timeout(8000)};
  for (const url of ["./api/portfolio/public","./portfolio-public.json"]) {
    try {
      const response = await fetch(url,options);
      if (!response.ok) continue;
      const data = await response.json();
      if (!Array.isArray(data.positions)) continue;
      by("portfolio-public-view").hidden = !data.positions.length;
      if (data.positions.length) {
        displayPublicRows("public-holdings",data.positions);
        by("published-time").textContent = data.publishedAt ? "发布 "+timeAt(Date.parse(data.publishedAt),"Asia/Shanghai",true)+" 北京" : "";
      }
      return;
    } catch {}
  }
}

async function openDatabase() {
  try {
    const data = await requestSavedPortfolio();
    if (!data) return;
    if (data.portfolio) {
      const state = normalizePortfolio({...data.portfolio,journalId:undefined});
      const local = readPortfolioBook();
      if (local?.name===state.name && journalIdValid(local.journalId)) state.journalId = local.journalId;
      const stored = recordNavHoldings(state,state.navHistory ?? portfolio.navHistory ?? migrateNavHistory());
      navStorageError = !localWrite(storageKeys.portfolio,stored);
      if (!demo) {
        portfolio = stored;
        by("base-currency").value = portfolio.base;
        refreshPortfolioQuotes();
      }
    }
    databaseVersion = data.version;
    drawOrders();
    draw();
  } catch {}
}

const cashTotal = cash => cash ? cash.book+cash.equivalent : null;
const cashBreakdown = cash => cash ? "账面现金 "+money(cash.book)+" · 现金替代 "+money(cash.equivalent) : "—";
const usableCash = cash => cash ? "可直接用 "+money(cash.available)+" · 可出售 "+money(cash.saleable) : "";

function attributionTimes(report) {
  const markets = new Map();
  const fxCurrencies = new Set();
  let manualPrices = false;
  for (const row of report.values.filter(row=>fnum(row.totalImpact))) {
    if (row.kind !== "cash") {
      const quote = portfolioQuote(row);
      if (quote) {
        const zone = quote.timezone || "UTC";
        if (!markets.has(zone)) markets.set(zone,[]);
        markets.get(zone).push(quote);
      } else manualPrices = true;
    }
    if (row.currency !== portfolio.base) {
      fxCurrencies.add(portfolio.base);
      fxCurrencies.add(row.currency);
    }
  }
  const labels = [...markets].map(([zone,quotes])=>{
    const times = quotes.map(quote=>quote.time);
    const first = timeAt(Math.min(...times),zone);
    const last = timeAt(Math.max(...times),zone);
    const sessions = new Set(quotes.map(quote=>{
      if (quote.session === "pre" || quote.session === "post") return sessionNames[quote.session];
      if (fnum(quote.sessionEnd) && Math.abs(quote.time-quote.sessionEnd)<=60000) return "收盘";
      if (quote.session === "regular" || (quote.time>=quote.sessionStart && quote.time<quote.sessionEnd)) return "盘中";
      return "";
    }));
    const session = sessions.size===1 ? [...sessions][0] : "";
    return marketZoneLabel(zone)+" "+first+(last===first?"":"–"+last)+(session?" "+session:"");
  });
  if (manualPrices) labels.push(demo?"示例价格":portfolio.date?"手动价 "+portfolio.date:"手动价 · 日期未填写");

  const fxTimes = new Map();
  for (const currency of fxCurrencies) {
    if (currency === "USD") continue;
    const manual = portfolio.rates[currency];
    const rate = autoRates[currency];
    const autoStamp = fnum(rate?.time) ? timeAt(rate.time)+" 北京" : rate?.date || "时间未知";
    const stamp = fnum(manual?.now) ? "手动" : autoStamp;
    if (!fxTimes.has(stamp)) fxTimes.set(stamp,[]);
    fxTimes.get(stamp).push(currency);
  }
  for (const [stamp,currencies] of fxTimes) {
    labels.push("汇率 USD/"+currencies.join("、USD/")+" · "+stamp);
  }
  return labels;
}

function showStats(report) {
  const amount = (title, value, detail, sign = false) =>
    '<div class="panel portfolio-kpi"><span>'+esc(title)+'</span><strong class="'+(sign?tone(value):"")+'">'+(sign?plus(value):money(value))
      +'</strong><small>'+esc(detail)+'</small></div>';
  const ret = report.prior > 0 && fnum(report.daily) ? report.daily/report.prior*100 : null;
  const timing = attributionTimes(report).map(label=>'<li>'+esc(label)+'</li>').join("");
  const cash = report.cashAssets;
  by("portfolio-kpis").innerHTML = [
    amount("组合市值 · "+portfolio.base,report.nav,"已计价 "+report.validCount+"/"+report.values.length+" 项"),
    '<div class="panel portfolio-kpi portfolio-market-kpi"><div><span>最新行情变动</span><strong class="'+tone(report.daily)+'">'+plus(report.daily)
      +'</strong><small>'+(fnum(ret)?pctText(ret)+" · ":"")+"已归因 "+report.accountedCount+" 项</small></div>"
      +(timing?'<ul class="portfolio-quote-times" aria-label="各市场与汇率截至时间">'+timing+'</ul>':"")+'</div>',
    amount("汇率影响",report.fxImpact,"基于已完成归因的持仓",true),
    amount("未实现盈亏",report.unrealized,"有成本 "+report.unrealizedCount+" 项",true),
    '<div class="panel portfolio-kpi portfolio-cash-kpi"><dl class="portfolio-cash-values">'
      +'<div><dt>现金及现金替代</dt><dd><strong>'+money(cashTotal(cash))+'</strong></dd></div>'
      +'<div class="portfolio-cash-detail"><dt>账面现金</dt><dd>'+money(cash?.book)+'</dd></div>'
      +'<div class="portfolio-cash-detail"><dt>现金替代</dt><dd>'+money(cash?.equivalent)+'</dd></div></dl></div>',
  ].join("");
}

function showHoldings(report) {
  const rows = mergeAssets(report.values);
  const key = by("holdings-sort").value === "impact" ? "totalImpact" : "marketValue";
  rows.sort((a,b)=>(b[key] ?? -Infinity)-(a[key] ?? -Infinity));
  const cells = rows.map(row=>{
    const quote = portfolioQuote(row);
    return [
      td('<strong>'+esc(row.kind==="cash"?row.currency+" 现金":row.symbol)+'</strong>'+(row.name?'<small>'+esc(row.name)+'</small>':"")+'<small>'+esc((cashClass(row)==="equivalent"?"现金替代 · ":cashClass(row)==="book"?"账面现金 · ":"")+row.accounts.join(" / "))+'</small>'),
      td(esc(row.roles.join(" / "))),
      td(fmt(row.quantity,4)+" "+esc(row.kind==="cash"?row.currency:"")),
      td(row.kind==="cash" ? "—" : money(row.price) + '<small>'+esc(quote?quoteStamp(quote):demo?"示例价":"手动价")+'</small>'),
      td(money(row.marketValue)+(row.incomplete?'<small>有待补数据</small>':"")),
      td(ratio(navWeight(row.marketValue,report.nav))),
      td(signedMoney(row.totalImpact)),
      td(signedMoney(row.priceImpact)),
      td(signedMoney(row.fxImpact)),
    ];
  });
  table("holdings-table",["持仓","组合角色","数量","本币现价","市值","占比","变动贡献","价格","汇率"],cells,"请添加持仓");
  by("account-total").innerHTML = [...report.accounts].map(([name,total])=>'<span>'+esc(name)+' <strong>'+money(total)+'</strong></span>').join("");
}

function showAttribution(report) {
  const rows = mergeAssets(report.values).filter(row=>fnum(row.totalImpact));
  const list = (title,items)=>'<div><h3>'+title+'</h3>'+ (items.length ? items.map(row=>
    '<div class="impact-row"><span>'+esc(row.kind==="cash"?row.currency+" 现金":row.symbol)+'</span>'+signedMoney(row.totalImpact)+'</div>').join("") :
    '<div class="work-note">无</div>')+'</div>';
  by("pnl-label").textContent = "价格 "+plus(report.priceImpact)+" · 汇率 "+plus(report.fxImpact);
  const gain = rows.filter(a=>a.totalImpact>0).sort((a,b)=>b.totalImpact-a.totalImpact).slice(0,5);
  const loss = rows.filter(a=>a.totalImpact<0).sort((a,b)=>a.totalImpact-b.totalImpact).slice(0,5);
  by("portfolio-attribution").innerHTML = list("主要正贡献",gain)+list("主要负贡献",loss);
}

function showExposure(report,sectors) {
  const rows = report.underlying;
  table("lookthrough-table",["标的","直接持有","ETF 间接持有","合计敞口","间接来源"],rows.slice(0,15).map(row=>[
    td(esc(row.symbol)),td(ratio(navWeight(row.direct,report.nav))),
    td(row.indirect>0?ratio(navWeight(row.indirect,report.nav)):'<small>已录入成分未发现</small>'),
    td('<strong>'+ratio(navWeight(row.total,report.nav))+'</strong>'),td(esc([...row.funds.keys()].join(", ")||"—")),
  ]),"暂无可计算的个股或 ETF 成分");
  const funds = [...new Set(report.values.filter(isEquityFund).map(row=>row.symbol))].sort();
  const disclosures = demo ? {} : etfDisclosures;
  const references = funds.flatMap(fund=>{
    const source = etfWeightSource(fund,portfolio.weights,disclosures);
    return source.useAutomatic && source.reference ? [fund+" 参考 "+source.reference] : [];
  });
  by("lookthrough-coverage").textContent = "ETF 成分覆盖 "+ratio(report.coverage);
  by("lookthrough-note").textContent = (fnum(report.coverage)
    ? "覆盖率按已计价股票型 ETF 市值加权。其余成分敞口未知，表中合计为已知值。"
      +(references.length ? " 同指数参考权重为估算（"+references.join("、")+"）。" : "")
    : "暂无可计价的股票型 ETF。");
  renderEtfDisclosures(funds,portfolio.weights,disclosures);
  renderSectorExposure(report,sectors);
}

function compare(before,after,beforeConcentration,afterConcentration) {
  const rows = [
    ["组合市值",before.nav,after?.nav,money],
    ["最大直接个股权重",before.concentration,after?.concentration,ratio,before.largest,after?.largest],
    ["前五大直接个股",before.topFive,after?.topFive,ratio],
    ["重叠敞口（已知）",before.overlap,after?.overlap,ratio],
  ];
  const metrics = rows.map(([label,a,b,format,left,right])=>[
    td(esc(label)),td((left?'<small>'+esc(left)+'</small>':"")+format(a)),
    td((right?'<small>'+esc(right)+'</small>':"")+format(b)),
    td(fnum(a)&&fnum(b)?(format===ratio?plus(b-a)+" pp":signedMoney(b-a)):"—"),
  ]);
  for (const [key,{label}] of Object.entries(concentrationFields)) {
    const first = beforeConcentration[key], last = afterConcentration?.[key];
    const limit = analysisLimits[key];
    const cell = item=>{
      if (!item) return td("—");
      const status = concentrationStatus(item,limit);
      const notes = [item.names.join("、"),status].filter(Boolean).join(" · ");
      const content = ratio(item.value)+'<small>'+esc(notes)+'</small>';
      return td(status==="已超上限" ? '<span class="down">'+content+'</span>' : content);
    };
    metrics.push([td(esc(label)+'<small>上限 '+ratio(limit)+'</small>'),cell(first),cell(last),
      td(fnum(first.value)&&fnum(last?.value) ? plus(last.value-first.value)+" pp" : "—")]);
  }
  const beforeCash = before.cashAssets, afterCash = after?.cashAssets;
  const cashCell = cash => td(money(cashTotal(cash))+(cash
    ? '<small>'+esc(cashBreakdown(cash))+'</small><small>'+esc(usableCash(cash))+'</small>' : ""));
  metrics.push([td("现金"),cashCell(beforeCash),cashCell(afterCash),
    td(beforeCash&&afterCash ? signedMoney(cashTotal(afterCash)-cashTotal(beforeCash)) : "—")]);
  table("simulation-table",["比较指标","操作前","操作后","变化"],metrics);
}

function compareExposure(before,after) {
  by("simulation-overlap").hidden = !after;
  if (!after) return;
  const exposures = new Map();
  for (const [side,report] of [["before",before],["after",after]]) {
    for (const row of report.underlying) {
      if (!exposures.has(row.symbol)) exposures.set(row.symbol,{});
      exposures.get(row.symbol)[side] = row;
    }
  }
  const rows = [...exposures.entries()].filter(([,pair])=>[pair.before,pair.after].some(row=>row?.direct>0&&row?.indirect>0));
  table("simulation-exposure",["标的","直接前 / 后","间接前 / 后","合计权重变化"],rows.map(([symbol,pair])=>{
    const a = pair.before, b = pair.after;
    const beforePct = navWeight(a?.total??0,before.nav), afterPct = navWeight(b?.total??0,after.nav);
    return [td(esc(symbol)),
      td(ratio(navWeight(a?.direct??0,before.nav))+" / "+ratio(navWeight(b?.direct??0,after.nav))),
      td(ratio(navWeight(a?.indirect??0,before.nav))+" / "+ratio(navWeight(b?.indirect??0,after.nav))),
      td(fnum(beforePct)&&fnum(afterPct)?plus(afterPct-beforePct)+" pp":"—")];
  }),"已录入的 ETF 成分中暂无重叠");
}

function showSimulation(report,rates,sectors=sectorExposure(report,portfolio,demo)) {
  const outcome = orders.length ? simulate(portfolioRowsNow(),orders) : null;
  const after = outcome?.positions ? analyzePortfolio(outcome.positions,rates) : null;
  const error = outcome?.errors.join(" ");
  if (by("simulation-error")) by("simulation-error").textContent = error || "";
  const beforeConcentration = concentrationSnapshot(report,sectors);
  const afterConcentration = after ? concentrationSnapshot(after,sectorExposure(after,portfolio,demo)) : null;
  if (by("simulation-table")) {
    compare(report,after,beforeConcentration,afterConcentration);
    compareExposure(report,after);
  }
  const stress = portfolio.scenarios.map(scenario=>({name:scenario.name,assumptions:scenario,
    before:stressResult(report,scenario,portfolio.base),after:after ? stressResult(after,scenario,portfolio.base) : null}));
  if (by("stress-table")) table("stress-table",["情景","操作前影响","操作后影响","变化"],stress.map(({name,before,after:next})=>{
    const display = (value,nav)=>signedMoney(value)+(nav>0&&fnum(value)?'<small>'+pctText(value/nav*100)+'</small>':"");
    return [td(esc(name)),td(display(before,report.nav)),td(display(next,after?.nav)),td(fnum(before)&&fnum(next)?signedMoney(next-before):"—")];
  }),"暂无压力情景");
  updateSimulationAnalysis(report,after,beforeConcentration,afterConcentration,stress,outcome?.errors ?? []);
}

function draw() {
  const rates = effectiveRates(autoRates,portfolio.rates);
  const report = analyzePortfolio(portfolioRowsNow(),rates);
  by("portfolio-empty").hidden = Boolean(report.values.length);
  by("portfolio-results").hidden = !report.values.length && (demo || !portfolio.navHistory);
  if (!portfolioRiskPage) {
    by("portfolio-kpis").hidden = !report.values.length;
    by("portfolio-details").hidden = !report.values.length;
    by("exit-demo").hidden = !demo;
  }
  const status = [
    demo ? "演示数据" : databaseVersion !== null ? "持仓已接入数据库" : "本机持仓",
    livePortfolio && !demo && report.values.some(row=>row.kind!=="cash")
      ? report.values.filter(portfolioQuote).length+" 项使用在线报价"
      : portfolio.date ? "手动价格日期 "+portfolio.date : "",
    fxInfo || "正在获取汇率",
    persistenceWarning,
  ];
  if (report.validCount < report.values.length) status.push((report.values.length-report.validCount)+" 项缺少价格或汇率，其市值未纳入合计");
  const overrides = Object.keys(portfolio.rates).length;
  if (overrides) status.push(overrides+" 个币种使用手动汇率");
  by("portfolio-status").textContent = status.filter(Boolean).join(" · ");
  if (by("public-portfolio")) by("public-portfolio").hidden = demo || !report.values.length;
  by("export-analysis").hidden = !report.values.length && !portfolio.navHistory;
  if (report.values.length) {
    const sectors = sectorExposure(report,portfolio,demo);
    if (!portfolioRiskPage) {
      showStats(report); renderAllocation(report,portfolio.base); showHoldings(report); showAttribution(report); showExposure(report,sectors);
    }
    showSimulation(report,rates,sectors);
  } else simulationAnalysis = null;
  renderNavHistory(portfolio.base,demo);
  renderPerformance();
  renderSimulationRisk();
  renderPortfolioJournal();
}

function orderClassification(value) {
  const classes = {"":"自动识别"};
  for (const [bucket,label] of Object.entries(buckets)) {
    if (bucket === "cash") continue;
    classes[(["core","gold","duration","reserve"].includes(bucket)?"etf":"stock")+"/"+bucket] = label;
  }
  classes["etf/tech"]="科技 ETF";
  classes["etf/bank"]="金融 ETF";
  classes["etf/equity"]="其他股票 ETF";
  return options(classes,value);
}

function drawOrders() {
  if (!by("trade-list")) return;
  const accounts = [...new Set(portfolio.positions.map(row=>row.account))];
  if (!orders.length) {
    by("trade-list").innerHTML = '<p class="work-note">添加买入或卖出，查看换仓后集中度、现金和压力损失。</p>';
    return;
  }
  by("trade-list").innerHTML = orders.map((order,index)=>{
    const field = (text,control)=>'<label>'+text+control+'</label>';
    const select = (name,content)=>'<select data-order-field="'+name+'">'+content+'</select>';
    const entry = (name,value,numeric=false)=>'<input data-order-field="'+name+'" '+(numeric?'type="number" step="any" min="0"':'type="text" placeholder="如 SPYM"')+' value="'+esc(value)+'">';
    return '<div class="trade-entry" data-order="'+index+'"><div class="trade-fields">'
      + field("账户",select("account",options(Object.fromEntries(accounts.map(x=>[x,x])),order.account)))
      + field("方向",select("side",options({sell:"卖出",buy:"买入"},order.side)))
      + field("代码",entry("symbol",order.symbol))
      + field("数量",entry("quantity",order.quantity,true))
      + field("价格",entry("price",order.price,true))
      + field("费用",entry("fee",order.fee,true))
      + '<button type="button" class="compact-button" aria-label="移除此操作" data-remove-order>×</button></div>'
      + '<div class="trade-options">'+field("币种",select("currency",currencyOptions(order.currency)))+
      field("新标的分类",select("classification",orderClassification(order.classification)))+'</div></div>';
  }).join("");
}

by("trade-list")?.addEventListener("click",event=>{
  if (!event.target.closest("[data-remove-order]")) return;
  const index = Number(event.target.closest("[data-order]").dataset.order);
  orders.splice(index,1);
  saveSimulationOrders();
  drawOrders();
  draw();
});
by("trade-list")?.addEventListener("input",event=>{
  const name = event.target.dataset.orderField;
  if (!name) return;
  orders[Number(event.target.closest("[data-order]").dataset.order)][name] = event.target.value;
  saveSimulationOrders();
  const rates = effectiveRates(autoRates,portfolio.rates);
  showSimulation(analyzePortfolio(portfolioRowsNow(),rates),rates);
  renderSimulationRisk();
  requestSimulationHistory();
});
by("add-trade")?.addEventListener("click",()=>{
  const account = portfolio.positions[0]?.account || "";
  orders.push({account,side:"sell",symbol:"",quantity:"",price:"",fee:"0",currency:portfolio.base,classification:""});
  saveSimulationOrders();
  drawOrders();
  by("trade-list").querySelector(".trade-entry:last-child input")?.focus();
});

const positionsFields = [
  ["account","账户","text"],["symbol","代码","text"],["name","名称","text"],["kind","类别","kind"],
  ["currency","币种","currency"],["quantity","数量 / 现金","number"],["price","现价","number"],
  ["previous","前收","number"],["cost","平均成本","number"],["bucket","压力分类","bucket"],
  ["role","组合角色","text"],["available","可动用","check"],
];
const weightsFields = [["fund","ETF","text"],["member","成分代码","text"],["weight","基金内权重 %","number"],["date","日期","date"],["source","来源","text"]];
const stressFields = [["name","情景","text"],...Object.entries(buckets).map(([key,label])=>[key,label,"number"]),["fx","外币均变动 %","number"]];
const rateFields = [["currency","每 1 USD 兑换","readonly"],["now","当期汇率","number"],["prev","前期汇率","number"]];
const modes = {
  positions:{title:"编辑账户与持仓",fields:positionsFields,prompt:"买卖或入出金后，请更新证券数量及现金余额并保存。每日 06:00（新加坡时间）估值使用当时已保存的持仓。"},
  weights:{title:"ETF 成分权重",fields:weightsFields,prompt:"输入有来源的基金成分权重，例如 SPYM、NVDA、5.09。可只填关心的重叠标的。"},
  scenarios:{title:"压力情景设置",fields:stressFields,prompt:"输入百分比变化。负数表示下跌，外币冲击统一相对显示币种。"},
  rates:{title:"汇率设置",fields:rateFields,prompt:"以每 1 USD 兑换多少单位该币种录入。留空使用自动数据。前期汇率缺失时无法拆分该币种的汇率贡献。"},
};
const defaultRow = {
  positions:()=>({account:portfolio.positions[0]?.account||"",symbol:"",name:"",kind:"stock",currency:portfolio.base,quantity:"",price:"",previous:"",cost:"",bucket:"equity",role:"",available:true}),
  weights:()=>({fund:"",member:"",weight:"",date:"",source:""}),
  scenarios:()=>({name:"",...Object.fromEntries(Object.keys(buckets).map(key=>[key,0])),fx:0}),
};

function edit(mode) {
  const rows = mode==="rates" ? currencyList.filter(x=>x!=="USD").map(currency=>({currency,...portfolio.rates[currency]}))
    : structuredClone(portfolio[mode]);
  if (mode==="positions" && !rows.length) rows.push(defaultRow.positions());
  editor = {mode, rows, date:portfolio.date, name:portfolio.name};
  by("editor-title").textContent = modes[mode].title;
  by("editor-error").textContent = "";
  by("editor-add").hidden = mode==="rates";
  by("editor-example").hidden = mode!=="positions";
  by("editor-export").hidden = mode!=="positions";
  renderEditor();
  editorDialog.showModal();
}

function editorField(row, key, label, kind) {
  const value = row[key];
  const attrs = 'data-field="'+key+'" aria-label="'+esc(label)+'"';
  if (kind==="readonly") return esc(value);
  if (kind==="check") return '<input type="checkbox" '+attrs+(value!==false?' checked':'')+'>';
  if (["kind","currency","bucket"].includes(kind)) return '<select '+attrs+'>'+ (kind==="kind"?options(assetKinds,value):kind==="bucket"?options(buckets,value):currencyOptions(value))+'</select>';
  const hint = editor.mode==="rates" && autoRates[row.currency]?.[key] ? ' placeholder="'+fmt(autoRates[row.currency][key],6).replace(/,/g,"")+'"' : "";
  return '<input type="'+kind+'" '+attrs+(kind==="number"?' step="any"':'')+hint+' value="'+esc(value)+'">';
}

function renderEditor() {
  const {mode,rows,date,name} = editor;
  const {prompt,fields} = modes[mode];
  const contents = rows.map((row,i)=>'<tr data-edit-row="'+i+'">'+fields.map(([key,label,kind])=>td(editorField(row,key,label,kind))).join("")
    +(mode==="rates"?"":td('<button type="button" class="compact-button" aria-label="删除这一行" data-delete-row>×</button>'))+'</tr>').join("");
  by("editor-content").innerHTML = '<p class="work-note">'+esc(prompt)+'</p>'
    +(mode==="positions"?'<div class="editor-fields"><label>组合名称<input type="text" id="portfolio-name" maxlength="'+portfolioNameLimit+'" value="'+esc(name)+'"></label>'
      +'<label>价格日期（留空用最新汇率）<input type="date" id="portfolio-date" value="'+esc(date)+'"></label></div>':"")
    +'<div class="work-table-wrap"><table class="work-table editor-table"><thead><tr>'+fields.map(([,label])=>'<th scope="col">'+esc(label)+'</th>').join("")
    +(mode==="rates"?"":'<th scope="col"><span class="visually-hidden">操作</span></th>')+'</tr></thead><tbody>'+contents+'</tbody></table></div>';
}

by("editor-content").addEventListener("input",event=>{
  const input = event.target;
  if (input.id==="portfolio-date") {editor.date=input.value;return;}
  if (input.id==="portfolio-name") {editor.name=input.value;return;}
  const field = input.dataset.field;
  if (!field) return;
  const row = editor.rows[Number(input.closest("[data-edit-row]").dataset.editRow)];
  row[field] = input.type==="checkbox" ? input.checked : input.value;
});
by("editor-content").addEventListener("click",event=>{
  if (!event.target.closest("[data-delete-row]")) return;
  editor.rows.splice(Number(event.target.closest("[data-edit-row]").dataset.editRow),1);
  renderEditor();
});
by("editor-add").addEventListener("click",()=>{
  editor.rows.push(defaultRow[editor.mode]());
  renderEditor();
  by("editor-content").querySelector("tbody tr:last-child input")?.focus();
});
by("editor-form").addEventListener("submit",async event=>{
  event.preventDefault();
  try {
    const {mode,rows,date,name} = editor;
    const draft = {...portfolio};
    draft[mode] = mode==="rates" ? Object.fromEntries(rows.map(row=>[row.currency,row])) : rows;
    if (mode==="positions") {
      draft.date=date;
      draft.name=name;
    }
    const next = normalizePortfolio(draft);
    if (demo) portfolio = next;
    else await writePortfolio(next);
    if (mode==="positions") {orders=[];saveSimulationOrders();}
    editorDialog.close();
    drawOrders();
    draw();
    if (mode==="positions") {loadRates();refreshPortfolioQuotes();}
  } catch (error) {by("editor-error").textContent = error.message;}
});

function downloadPortfolioFile(prefix,rawName,data) {
  const name = normalizePortfolioName(rawName);
  const filenameName = name.replace(/[<>:"/\\|?*]+/g,"-").replace(/^[.\s-]+|[.\s-]+$/g,"") || defaultPortfolioName;
  const formatter = new Intl.DateTimeFormat("en-CA",{year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
  const {year,month,day,hour,minute,second} = Object.fromEntries(formatter.formatToParts(new Date()).map(({type,value})=>[type,value]));
  const date = [year,month,day].join("-");
  const time = [hour,minute,second];
  const exportedAt = date+"T"+time.join(":");
  downloadJson(prefix+"-"+filenameName+"-"+date+"_"+time.join("-")+".json",{name,exportedAt,...data});
}

function exportPortfolio() {
  const {name:savedName,journalId,...data} = portfolio;
  const localJournal = !demo && journalId ? readPrivateJournal(journalId) : null;
  downloadPortfolioFile("组合备份",editor?.mode==="positions" ? editor.name : savedName,{...data,...(localJournal?{localJournal}:{})});
}

async function restorePortfolioBackup(raw) {
  const imported = normalizePortfolio({...raw,journalId:undefined});
  if (raw.navHistory != null && !imported.navHistory) throw new Error("备份中的估值持仓记录格式有误");
  if (raw.localJournal != null) {
    const journal = normalizeJournal(raw.localJournal);
    imported.journalId = newJournalId();
    if (!localWrite(portfolioJournalPrefix+imported.journalId,journal)) throw new Error("浏览器无法恢复流水备份。");
  } else if (imported.name===portfolio.name && portfolio.journalId) {
    imported.journalId = portfolio.journalId;
  }
  try {await writePortfolio(imported,imported.navHistory);}
  catch (error) {
    if (raw.localJournal != null) {
      try {localStorage.removeItem(portfolioJournalPrefix+imported.journalId);} catch {}
    }
    throw error;
  }
  return "已恢复「"+portfolio.name+"」";
}

async function importPortfolioPositions(raw,positions) {
  const saved = readPortfolioBook();
  const current = demo ? (saved ? normalizePortfolio(saved) : blankPortfolio()) : portfolio;
  const defaults = !saved && !current.positions.length ? {name:raw.name,base:raw.base} : {};
  const next = normalizePortfolio({...current,...defaults,positions,date:raw.date ?? ""});
  await writePortfolio(next);
  return "已导入 "+next.positions.length+" 项持仓";
}

function mergePortfolioJournal(source) {
  if (demo) throw new Error("请退出演示后再合并流水。");
  const incoming = normalizeJournal(source);
  const current = readPrivateJournal();
  const ids = new Set(current.entries.map(row=>row.id));
  const checkpoints = new Set(current.entries.filter(row=>row.kind==="equity").map(row=>row.date+"/"+row.currency));
  let skipped = 0;
  const added = incoming.entries.filter(row=>{
    if (ids.has(row.id)) return false;
    if (row.kind==="equity" && checkpoints.has(row.date+"/"+row.currency)) {
      skipped++;
      return false;
    }
    return true;
  });
  if (added.length) savePrivateJournal(book=>({...book,entries:[...book.entries,...added]}));
  const repeated = incoming.entries.length-added.length-skipped;
  return "已追加 "+added.length+" 条流水"+(repeated?" · 跳过 "+repeated+" 条相同编号":"")
    +(skipped?" · 保留 "+skipped+" 条同日同币种的本机净值":"");
}

const importButton = by("import-backup");
const importInput = by("import-portfolio");
const importFeedback = by("portfolio-import-status");
importButton.addEventListener("click",()=>importInput.click());
importInput.addEventListener("change",async ()=>{
  const [file] = importInput.files;
  if (!file) return;
  importButton.disabled = true;
  try {
    if (file.size>50*1024*1024) throw new Error("JSON 文件不能超过 50 MB。");
    const raw = JSON.parse(await file.text());
    await portfolioDatabaseReady;
    const journal = raw?.localJournal ?? raw;
    let type, result;
    if (Array.isArray(raw?.positions)) {
      const backup = ["navHistory","localJournal","rates","weights","scenarios"].some(key=>Object.hasOwn(raw,key));
      type = backup ? "组合备份" : "持仓";
      result = await (backup ? restorePortfolioBackup(raw) : importPortfolioPositions(raw,raw.positions));
    } else if (Array.isArray(raw?.history?.currentPositions)) {
      type = "完整历史分析";
      result = await importPortfolioPositions(raw,raw.history.currentPositions);
    } else if (Array.isArray(journal?.entries)) {
      type = "流水";
      result = mergePortfolioJournal(journal);
    } else if (Array.isArray(raw?.holdings)) {
      throw new Error("识别为分析报表。请使用组合备份或「导出完整历史数据」的 JSON 导入持仓。");
    } else if (raw?.sourcePeriods && raw?.firstradeJournal) {
      const companion = raw.localImportPortfolio;
      const filename = typeof companion==="string" && /^组合备份-[^/\\\r\n]{1,180}\.json$/u.test(companion)
        ? companion : "以「组合备份-」开头的配套 JSON";
      throw new Error("识别为券商对账归档。要恢复持仓和流水，请导入 "+filename+"。");
    } else {
      throw new Error("无法识别。请选择组合备份、持仓、完整历史分析或流水 JSON。");
    }
    if (type!=="流水") {
      orders = [];
      saveSimulationOrders();
      by("base-currency").value = portfolio.base;
      drawOrders();
      loadRates();
      refreshPortfolioQuotes();
    }
    draw();
    importFeedback.textContent = "导入成功 · 识别为"+type+" · "+result;
  } catch(error) {
    const message = error instanceof SyntaxError ? "文件无法读取为 JSON。" : error.message;
    importFeedback.textContent = "导入失败 · "+message;
  } finally {
    importFeedback.hidden = false;
    importInput.value = "";
    importButton.disabled = false;
  }
});

async function referenceRates(date) {
  const end = date || formatter.format(Date.now());
  const start = new Date(Date.parse(end)-9*86400000).toISOString().slice(0,10);
  const query = new URLSearchParams({base:"USD",symbols:currencyList.filter(x=>!["USD","TWD","CNH"].includes(x)).join(",")});
  const request = await fetch("https://api.frankfurter.dev/v1/"+start+".."+end+"?"+query,{signal:AbortSignal.timeout(9000)});
  if (!request.ok) throw new Error("参考汇率不可用");
  const values = await request.json();
  const dates = Object.keys(values.rates || {}).filter(value=>value<=end).sort();
  const currentDate = dates.at(-1);
  const previousDate = dates.at(-2);
  if (!currentDate) throw new Error("参考汇率日期缺失");
  return {rates:Object.fromEntries(Object.entries(values.rates[currentDate]).map(([key,value])=>[key,{now:value,prev:values.rates[previousDate]?.[key],date:currentDate}])),
    label:"Frankfurter 日度汇率 "+currentDate+(previousDate?" / "+previousDate:"")};
}

async function loadRates() {
  const request = ++fxRequest;
  const date = !livePortfolio && portfolio.date && portfolio.date<formatter.format(Date.now()) ? portfolio.date : "";
  if (activeFxDate!==date) autoRates={};
  activeFxDate=date;
  by("refresh").disabled = true;
  try {
    let values;
    if (!date) {
      values = await requestMarket("fx").then(({rates})=>{
        const newest = Math.max(...Object.entries(rates).filter(([key])=>key!=="USD").map(([,row])=>row.time).filter(fnum));
        if (!fnum(newest)) throw new Error("没有报价");
        return {rates,label:"Yahoo 最新汇率 "+timeAt(newest)+" 北京"};
      }).catch(()=>null);
    }
    values ??= await referenceRates(date);
    if (request !== fxRequest) return;
    autoRates = values.rates;
    fxInfo = values.label;
    localWrite(portfolioFxKey,{date,rates:autoRates,label:fxInfo});
    markRequest();
  } catch {
    if (request!==fxRequest) return;
    const snapshot = window.WORLD_SNAPSHOT;
    if (!date && !Object.keys(autoRates).length && Object.keys(snapshot?.fx || {}).length > 1) {
      autoRates = snapshot.fx;
      fxInfo = "汇率快照 "+timeAt(snapshot.capturedAt)+" 北京";
    } else {
      fxInfo = Object.keys(autoRates).length ? "本次汇率更新失败，保留上次读数" : "暂无自动汇率，可手动输入";
    }
  } finally {
    if (request===fxRequest) {
      draw();
      by("refresh").disabled = false;
    }
  }
}

for (const [button,mode] of [["edit-portfolio","positions"],["enter-first","positions"],["edit-exposure","weights"],["edit-rates","rates"],["edit-stress","scenarios"]]) {
  by(button)?.addEventListener("click",()=>edit(mode));
}
by("editor-export").addEventListener("click",exportPortfolio);
for (const id of ["download-example","editor-example"]) {
  by(id)?.addEventListener("click",()=>downloadJson("Market-Portfolio-Example.json",{base:sample.base,positions:sample.positions}));
}
by("exit-demo")?.addEventListener("click",()=>location.reload());
by("base-currency").innerHTML = currencyOptions(portfolio.base);
by("base-currency").addEventListener("change",async event=>{
  const next = {...portfolio,base:event.target.value};
  if (demo) portfolio = next;
  else try {await writePortfolio(next);} catch(error) {
    event.target.value = portfolio.base;
    persistenceWarning = error.message;
  }
  draw();
  refreshNavHistory(portfolio,livePortfolio,demo);
});
by("sample-portfolio")?.addEventListener("click",()=>{
  portfolio = normalizePortfolio(sample);
  demo = true;
  by("base-currency").value = portfolio.base;
  drawOrders();
  draw();
  loadRates();
});
by("holdings-sort")?.addEventListener("change",draw);
by("live-portfolio").checked = livePortfolio;
by("live-portfolio").addEventListener("change",event=>{
  livePortfolio = event.target.checked;
  localWrite("market-observation-live-prices",livePortfolio);
  draw();
  loadRates();
  refreshPortfolioQuotes();
  refreshNavHistory(portfolio,livePortfolio,demo,true);
  refreshPerformance();
});
const publicDialog = by("public-dialog");
by("public-portfolio")?.addEventListener("click",()=>{
  const rows = publicPositions();
  displayPublicRows("public-draft",rows);
  by("public-error").textContent = "";
  by("publish-portfolio").hidden = databaseVersion===null;
  by("unpublish-portfolio").hidden = databaseVersion===null;
  by("publish-portfolio").disabled = !rows.length;
  by("export-public").disabled = !rows.length;
  publicDialog.showModal();
});
by("export-public")?.addEventListener("click",()=>{
  const positions = publicPositions();
  if (positions.length) downloadJson("portfolio-public.json",{positions,publishedAt:new Date().toISOString()});
});
for (const [id,mode] of [["publish-portfolio","publish"],["unpublish-portfolio","unpublish"]]) {
  by(id)?.addEventListener("click",async()=>{
    try {
      await updateDatabase(mode,{positions:mode==="publish"?publicPositions():[]});
      await publicSnapshot();
      publicDialog.close();
    } catch(error) {by("public-error").textContent=error.message;}
  });
}
let navInitialized = false;
const refreshLivePortfolio = (force = false)=>{
  loadRates();
  refreshPortfolioQuotes();
  refreshEtfDisclosures(force).then(changed=>{if(changed)draw();});
  refreshEtfSectors(force).then(changed=>{if(changed)draw();});
  if (navInitialized) {
    refreshNavHistory(portfolio,livePortfolio,demo,force);
    refreshPerformance(force);
  }
};
by("refresh").addEventListener("click",()=>refreshLivePortfolio(true));
initPortfolioAnalysis();
initNavChart();
initPerformance();
initPortfolioJournal();
drawOrders();
draw();
refreshLivePortfolio();
const portfolioDatabaseReady = openDatabase().finally(()=>{
  if (!demo && !portfolio.navHistory) {
    const initial = recordNavHoldings(portfolio,migrateNavHistory());
    if (initial !== portfolio) {
      portfolio = initial;
      navStorageError = !localWrite(storageKeys.portfolio,portfolio);
    }
  }
  navInitialized = true;
  refreshNavHistory(portfolio,livePortfolio,demo);
  refreshPerformance();
});
if (!portfolioRiskPage) publicSnapshot();
window.addEventListener("storage",event=>{
  if (portfolio.journalId && event.key===portfolioJournalPrefix+portfolio.journalId) renderPortfolioJournal();
  if (event.key===analysisRateKey) {
    for (const currency of Object.keys(analysisRates)) delete analysisRates[currency];
    Object.assign(analysisRates,localRead(analysisRateKey,{}));
    renderRiskAnalysis();
  }
  if (event.key==="market-observation-live-prices") {
    livePortfolio = localRead(event.key,true);
    by("live-portfolio").checked = livePortfolio;
    draw();
    refreshLivePortfolio();
  }
  if (event.key===analysisPreferencesKey) {
    Object.assign(analysisPreferences,localRead(analysisPreferencesKey,{}));
    syncAnalysisRanges();
    if (by("performance-benchmark")) by("performance-benchmark").value = performanceReference();
    if (by("risk-recorded")) by("risk-recorded").checked = Boolean(analysisPreferences.recordedOnly);
    if (by("drawdown-limit")) by("drawdown-limit").value = +(analysisDrawdownLimit()*100).toFixed(2);
    draw();
  }
  if (event.key===concentrationLimitsKey) {
    const limits = readConcentrationLimits();
    for (const key of Object.keys(concentrationFields)) {
      if (!fnum(limits[key])) continue;
      analysisLimits[key] = limits[key];
      if (by("concentration-"+key+"-limit")) by("concentration-"+key+"-limit").value = limits[key];
    }
    draw();
  }
  if (event.key===simulationOrdersKey && !demo) {
    orders = readSimulationOrders();
    drawOrders();
    draw();
    refreshPerformance();
  }
  if (event.key===storageKeys.portfolio && !demo) {
    const fresh = readPortfolioBook();
    if (!fresh) return;
    try {portfolio = normalizePortfolio(fresh);}
    catch {return;}
    by("base-currency").value = portfolio.base;
    drawOrders();
    draw();
    refreshLivePortfolio();
  }
});
setInterval(()=>{if(!document.hidden)refreshLivePortfolio();},60000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)refreshLivePortfolio();});
