"use strict";

const marketFeed = globalThis.MARKET_CRYPTO_FEED;
const cryptoCacheKey = "market-crypto-cache-v1";
const cryptoWatchKey = "market-crypto-watch-v1";
const quotedCoins = new Set(marketFeed.coins.map(([symbol])=>symbol));
const watchableCoins = new Set([...quotedCoins].filter(symbol=>!cryptoStable.has(symbol)));
const cryptoDefaultWatch = [...watchableCoins].filter(symbol=>!["DOT","LTC","DOGE"].includes(symbol));
let cryptoWatch = localRead(cryptoWatchKey,cryptoDefaultWatch);
cryptoWatch = Array.isArray(cryptoWatch) ? cryptoWatch.filter(symbol=>watchableCoins.has(symbol)) : cryptoDefaultWatch;
if (!cryptoWatch.length) cryptoWatch = cryptoDefaultWatch;
const cryptoState = {quotes:{},global:null,fear:[],charts:{},securities:{}};
const cryptoView = {asset:"BTC",range:30,mode:"line",plot:null,selected:null};
const fearView = {plot:null,selected:null};
const dailyMs = 86400000;
const refreshEvery = 5*60000;
const compactUSD = new Intl.NumberFormat("zh-CN",{notation:"compact",maximumFractionDigits:2});
const cryptoIntervals = {1:5,7:60,30:1440,90:1440,365:1440};
const chartRequests = new Map();
const lastChartCheck = new Map();
let cryptoUpdating = false;
let cryptoAttempted = false;
let lastCryptoCheck = 0;

const cryptoMoney = value => fnum(value) ? "$"+compactUSD.format(value) : "—";
const assetPrice = value => fmt(value,!(value<1)?2:value>=.01?4:6);
const dualTime = at => fnum(at) ? timeAt(at)+" 北京 · "+timeAt(at,"America/New_York")+" 美东" : "—";
const briefTime = at => timeAt(at,"UTC");
const chartKey = (asset,interval) => asset+"/"+interval;

function mergeCryptoData(data) {
  if (!data || typeof data!=="object") return;
  for (const [symbol,reading] of Object.entries(data.quotes ?? {})) {
    if (quotedCoins.has(symbol) && reading?.price>0 && fnum(reading.time)
      && !(cryptoState.quotes[symbol]?.time>reading.time)) cryptoState.quotes[symbol] = reading;
  }
  if (fnum(data.global?.time) && !(cryptoState.global?.time>data.global.time)) cryptoState.global = data.global;
  if (Array.isArray(data.fear) && data.fear.length && !(cryptoState.fear.at(-1)?.time>data.fear.at(-1).time)) cryptoState.fear = data.fear;
  for (const [key,chart] of Object.entries(data.charts ?? {})) {
    if (!Array.isArray(chart?.rows) || !chart.rows.length) continue;
    const previous = cryptoState.charts[key];
    if (!previous || previous.rows.at(-1)[0]<chart.rows.at(-1)[0]
      || (previous.rows.at(-1)[0]===chart.rows.at(-1)[0] && previous.fetchedAt<=chart.fetchedAt && previous.rows.length<=chart.rows.length)) {
      cryptoState.charts[key] = chart;
    }
  }
  for (const [symbol,quote] of Object.entries(data.securities ?? {})) {
    if (quote?.price>0 && fnum(quote.time) && !(cryptoState.securities[symbol]?.time>quote.time)) cryptoState.securities[symbol] = quote;
  }
}

mergeCryptoData(globalThis.MARKET_CRYPTO_SNAPSHOT);
mergeCryptoData(localRead(cryptoCacheKey,{}));
mergeCryptoResearch(globalThis.MARKET_CRYPTO_SNAPSHOT?.research);
mergeCryptoResearch(localRead("market-crypto-research-v1",{}));

function paintMove(element, value, digits=2) {
  element.textContent = fnum(value) ? plus(value,digits)+"%" : "—";
  element.classList.toggle("up",value>0);
  element.classList.toggle("down",value<0);
}

function marketRows(list, columns, render) {
  let group;
  return list.map(item=>{
    const title = item[3] ?? item[2];
    const header = title===group ? "" : '<tr class="crypto-group"><th scope="row" colspan="'+columns+'">'+esc(title)+'</th></tr>';
    group = title;
    return header+"<tr>"+render(item)+"</tr>";
  }).join("");
}
const moveCell = value => '<td class="'+tone(value)+'">'+esc(pctText(value))+'</td>';

function drawCryptoTables() {
  const query = by("crypto-search").value.trim().toLowerCase();
  const matches = row=>!query || row.some(value=>value.toLowerCase().includes(query));
  const coins = marketFeed.coins.filter(row=>watchableCoins.has(row[0]) && (query || cryptoWatch.includes(row[0])) && matches(row));
  by("crypto-watch-rows").innerHTML = marketRows(coins,9,([symbol,id,name])=>{
    const row = cryptoState.quotes[symbol] ?? {};
    const label = ["BTC","ETH"].includes(symbol)
      ? '<button type="button" class="text-button" data-chart-asset="'+symbol+'">'+symbol+'</button>'
      : '<a class="crypto-source" href="https://coinpaprika.com/coin/'+id+'/" target="_blank" rel="noopener noreferrer">'+symbol+'</a>';
    return '<th scope="row">'+label+'<small>'+esc(name)+'</small></th><td title="'+esc(dualTime(row.time))+'">'
      +assetPrice(row.price)+'</td>'+moveCell(row.day)+'<td>'+watchSpark(symbol)+'</td>'+moveCell(row.week)+moveCell(row.month)
      +'<td>'+cryptoMoney(row.cap)+'</td><td>'+cryptoMoney(row.volume)+'</td>'+moveCell(row.drawdown);
  });
  by("crypto-securities-rows").innerHTML = marketRows(marketFeed.securities.filter(matches),5,([symbol,name])=>{
    const row = cryptoState.securities[symbol] ?? {};
    const move = row.previous>0 && row.price>0 ? (row.price/row.previous-1)*100 : null;
    const flow = fundDailyFlow(symbol);
    const stamp = fnum(row.time) ? timeAt(row.time,"America/New_York") : "—";
    const session = sessionNames[row.session] ?? (row.source==="public-snapshot" ? "行情快照" : "");
    return '<th scope="row"><a class="crypto-source" href="https://finance.yahoo.com/quote/'+symbol+'/" target="_blank" rel="noopener noreferrer">'+symbol
      +'</a><small>'+esc(name)+'</small></th><td>'+assetPrice(row.price)+'</td>'+moveCell(move)
      +'<td title="'+esc(fnum(row.time)?quoteStamp(row,session || undefined):"")+'">'+esc(stamp)+(session?'<small>'+esc(session)+'</small>':"")
      +'</td><td class="'+tone(flow?.total)+'" title="'+esc(marketDate(flow?.time))+'">'+moneyMove(flow?.total)+'</td>';
  });
  if (!by("crypto-watch-rows").innerHTML) {
    const stableMatch = query && marketFeed.coins.some(row=>cryptoStable.has(row[0]) && matches(row));
    by("crypto-watch-rows").innerHTML = '<tr><td colspan="9">'+(stableMatch?"稳定币报价见上方行情栏":"没有匹配的加密资产")+'</td></tr>';
  }
  if (!by("crypto-securities-rows").innerHTML) by("crypto-securities-rows").innerHTML = '<tr><td colspan="5">没有匹配的证券</td></tr>';
  const fundFees = {IBIT:.25,FBTC:.25,BITB:.20,ETHA:.25,FETH:.25};
  by("crypto-fund-costs").innerHTML = '<thead><tr><th scope="col">基金</th><th scope="col">年费</th><th scope="col">资产规模</th><th scope="col">规模日期</th></tr></thead><tbody>'
    +Object.entries(fundFees).map(([symbol,fee])=>{
      const aum = researchState.metrics["aum"+symbol];
      return '<tr><th scope="row"><a class="crypto-source" href="'+researchFeed.issuerPages[symbol]+'" target="_blank" rel="noopener noreferrer">'+symbol
        +'</a></th><td>'+pctValue(fee)+'</td><td>'+cryptoMoney(aum?.value)+'</td><td>'+marketDate(aum?.time)+'</td></tr>';
    }).join("")+'</tbody>';
  const prices = Object.values(cryptoState.securities);
  const bundled = prices.some(row=>row.source==="public-snapshot");
  const yahoo = prices.some(row=>row.source!=="public-snapshot");
  const sources = [yahoo?"Yahoo Finance":"",bundled?"随站公开行情快照":""].filter(Boolean);
  by("crypto-securities-status").textContent = prices.length
    ? sources.join(" · ")+" · "+prices.length+" / "+marketFeed.securities.length+" 项有报价"
    : hasApi ? "Yahoo Finance · 暂无可用证券报价" : "等待随站快照或行情接口";
}

function dailyStats(asset) {
  const chart = cryptoState.charts[chartKey(asset,1440)];
  const rows = (chart?.rows ?? []).filter(row=>row[0]+dailyMs<=Date.now()).slice(-31);
  if (rows.length<31 || rows.some((row,i)=>i>0 && row[0]-rows[i-1][0]!==dailyMs)) return null;
  const returns = rows.slice(1).map((row,i)=>Math.log(row[1]/rows[i][1]));
  const mean = returns.reduce((sum,value)=>sum+value,0)/returns.length;
  const variance = returns.reduce((sum,value)=>sum+(value-mean)**2,0)/(returns.length-1);
  return {average:rows.slice(1).reduce((sum,row)=>sum+row[1],0)/30,
    volatility:Math.sqrt(variance*365)*100,time:rows.at(-1)[0],source:chart.source};
}

function drawCryptoSignals() {
  const {asset} = cryptoView;
  const coin = cryptoState.quotes[asset];
  const stats = dailyStats(asset);
  by("crypto-price-title").textContent = asset+" / USD";
  by("crypto-price").textContent = coin ? "$"+assetPrice(coin.price) : "—";
  paintMove(by("crypto-move"),coin?.day);
  by("crypto-price-meta").textContent = coin ? dualTime(coin.time)+" · 24 小时涨跌" : "暂无现货报价";
  by("crypto-price-meta").title = "CoinPaprika 现货报价 · 24 小时交易";
  by("crypto-volume").textContent = cryptoMoney(coin?.volume);
  paintMove(by("crypto-ath"),coin?.drawdown);
  by("crypto-average").textContent = stats ? "$"+assetPrice(stats.average) : "—";
  const vol = by("crypto-volatility");
  vol.textContent = stats ? pctValue(stats.volatility,1) : "—";
  vol.title = "最近 30 个完整日收益率，按 365 日年化"+(stats ? " · "+stats.source+" · "+marketDate(stats.time)+" UTC" : "");
  const dvol = researchState.metrics["dvol"+asset];
  const implied = by("crypto-dvol");
  implied.textContent = pctValue(dvol?.rows.at(-1)?.[1],1);
  implied.title = "Deribit "+asset+" DVOL · 30 日隐含波动率，年化"+(dvol ? " · "+marketDate(dvol.time)+" UTC" : "");

  const global = cryptoState.global, eth = cryptoState.quotes.ETH, btc = cryptoState.quotes.BTC;
  by("crypto-dominance").textContent = fnum(global?.dominance) ? fmt(global.dominance)+"%" : "—";
  const dominanceDate = by("crypto-dominance-date");
  dominanceDate.textContent = fnum(global?.time) ? timeAt(global.time)+" 北京" : "";
  dominanceDate.title = fnum(global?.time) ? dualTime(global.time) : "";
  const ratio = by("crypto-eth-btc");
  if (eth && btc && Math.abs(eth.time-btc.time)<=5*60000) {
    ratio.textContent = fmt(eth.price/btc.price,5);
    ratio.title = "CoinPaprika · 两项美元报价时间相差五分钟以内";
  } else {
    const [ethChart,btcChart] = ["ETH","BTC"].map(symbol=>cryptoState.charts[chartKey(symbol,1440)]);
    const settled = chart=>chart?.rows.findLast(row=>row[0]+dailyMs<=Date.now());
    const e = settled(ethChart), b = settled(btcChart);
    const matched = e && b && e[0]===b[0] && ethChart.source===btcChart.source;
    ratio.textContent = matched ? fmt(e[1]/b[1],5) : "—";
    ratio.title = matched ? ethChart.source+" · "+new Date(e[0]).toISOString().slice(0,10)+" UTC 日线"
      : "待取得同一时点的两项报价";
  }
  by("crypto-market-cap").textContent = cryptoMoney(global?.cap);
  paintMove(by("crypto-market-change"),global?.change);
}

const fearBands = {"Extreme Fear":"极度恐惧",Fear:"恐惧",Neutral:"中性",Greed:"贪婪","Extreme Greed":"极度贪婪"};
function drawCryptoFear() {
  const current = cryptoState.fear.at(-1);
  const chart = by("crypto-fear-chart");
  by("crypto-fear").textContent = current?.value ?? "—";
  const band = by("crypto-fear-band");
  band.textContent = fearBands[current?.band] ?? "";
  band.dataset.tone = current?.value<25 ? "alert" : current?.value>75 ? "calm" : "";
  by("crypto-fear-date").textContent = current ? "最近 30 日" : "暂无情绪指数";
  chart.hidden = !current;
  fearView.plot = drawMarketPlot(chart,cryptoState.fear.map(row=>[row.time,row.value]),{
    quietCursor:true,axisWidth:35,axisFormat:value=>fmt(value,0),axisLabel:row=>briefTime(row[0]).slice(0,5),
    pointLabel:row=>new Date(row[0]).toISOString().slice(0,10),
  });
  showFearPoint();
}

function showFearPoint() {plotPoint(fearView,by("crypto-fear-readout"),value=>fmt(value,0));}
function showCryptoPoint() {plotPoint(cryptoView,by("crypto-chart-readout"),assetPrice);}

function drawCryptoChart() {
  const {asset,range,mode} = cryptoView, interval = cryptoIntervals[range], key = chartKey(asset,interval);
  const data = cryptoState.charts[key], target = by("crypto-chart");
  const pending = chartRequests.has(key);
  const last = data?.rows.at(-1)?.[0];
  const rows = (data?.rows ?? []).filter(row=>row[0]>last-range*dailyMs);
  target.hidden = rows.length<2;
  if (target.hidden) {
    by("crypto-chart-status").textContent = pending ? "正在获取 "+asset+" 行情…" : "当前区间暂无 "+asset+" 行情。";
    by("crypto-chart-meta").textContent = "UTC";
    cryptoView.plot = null;
    showCryptoPoint();
    return;
  }
  const label = at=>briefTime(at);
  cryptoView.plot = drawMarketPlot(target,rows,{
    candle:mode==="candle",candleSlot:interval*60000,quietCursor:true,axisWidth:66,
    axisFormat:value=>assetPrice(value),axisLabel:row=>range===1?label(row[0]).slice(-5):label(row[0]).slice(0,5),
    pointLabel:row=>label(row[0])+" UTC",comparison:(row,previous)=> mode==="candle" ? row[2] : previous?.[1],
    breakLine:(previous,row)=>row[0]-previous[0]>interval*60000,
    formatDelta:(value,before)=>plus(value-before)+(before>0?" ("+pctText((value/before-1)*100)+")":""),
  });
  by("crypto-chart-status").textContent = "";
  const completeBars = (last-rows[0][0]+interval*60000)/dailyMs;
  const partial = completeBars < range ? " · 现有 "+(interval===1440?rows.length+" 日":fmt(completeBars*24,1)+" 小时") : "";
  const inProgress = data.live===true && last+interval*60000>Date.now();
  by("crypto-chart-meta").textContent = data.source+" · UTC · "+(interval===1440?"日线":interval+" 分钟")+partial+(inProgress?" · 末根进行中":"");
  const source = by("crypto-chart-source");
  const coin = asset==="BTC"?"bitcoin":"ethereum";
  source.href = data.source==="Kraken" ? "https://www.kraken.com/prices/"+coin
    : data.source==="Coinbase" ? "https://www.coinbase.com/price/"+coin
    : "https://finance.yahoo.com/quote/"+asset+"-USD/history/";
  showCryptoPoint();
}

function drawCryptoPage() {
  drawCryptoTables();
  drawCryptoSignals();
  drawCryptoFear();
  drawCryptoChart();
  renderResearchSignals();
  renderStableTape();
  renderCryptoTape();
  renderCryptoChain();
  renderCryptoFilings();
  renderCryptoHoldings();
  const count = Object.keys(cryptoState.quotes).length;
  const recent = Object.values(cryptoState.quotes).some(row=>Math.abs(Date.now()-row.time)<20*60000);
  const usable = count || cryptoState.fear.length || Object.keys(cryptoState.charts).length;
  by("crypto-status").textContent = cryptoUpdating && !usable ? "正在获取公开行情…"
    : count ? (recent?"现货 24 小时交易":"现货 24 小时交易 · 显示最近可用快照")+" · "+count+" 个资产报价"
      : usable ? "部分数据已载入 · 现货报价待更新" : cryptoAttempted ? "暂未取得公开数据，可点击刷新重试。" : "等待公开行情";
}

function requestCryptoChart(asset,interval,force=false) {
  const key = chartKey(asset,interval);
  if (chartRequests.has(key)) return chartRequests.get(key);
  if (!force && cryptoState.charts[key] && Date.now()-(lastChartCheck.get(key) ?? 0)<refreshEvery) return Promise.resolve();
  const task = (async ()=>{
    const data = await marketFeed.chart(asset,interval)
      .catch(()=>requestMarket("crypto-chart",{asset,interval})).catch(()=>null);
    lastChartCheck.set(key,Date.now());
    if (data?.rows?.length) {
      mergeCryptoData({charts:{[key]:data}});
      localWrite(cryptoCacheKey,cryptoState);
      return true;
    }
  })().finally(()=>{
    chartRequests.delete(key);
    drawCryptoSignals();
    drawCryptoChart();
  });
  chartRequests.set(key,task);
  return task;
}

let researchRefresh;
let lastHistoryCheck = 0;
async function refreshResearch(force) {
  if (researchRefresh) return researchRefresh;
  const update = async (promise, transform)=>{
    try {
      const data = await promise;
      mergeCryptoResearch(transform(data));
    } catch {}
  };
  researchRefresh = (async ()=>{
    const context = requestMarket("crypto-context").catch(()=>researchFeed.overview());
    const tasks = [
      update(context,metrics=>({metrics})),
      update(latestMarketQuotes(Object.keys(tapeSymbols)),tape=>({tape})),
      update(requestMarket("world-yields"),data=>({yield:dailyObservation(data.observations?.DGS10)})),
    ];
    if (force || Date.now()-lastHistoryCheck>60*60000) {
      lastHistoryCheck = Date.now();
      tasks.push(update(requestMarket("crypto-cross"),cross=>({cross})),
        update(requestMarket("crypto-breadth"),breadth=>({breadth,watchTrends:breadth.trends})));
    }
    if (by("crypto-company-disclosure").open) tasks.push(refreshCryptoFilings(force));
    await Promise.allSettled(tasks);
    const current = cryptoState.global;
    if (fnum(current?.dominance) && fnum(current.time)) mergeCryptoResearch({
      dominance:[[marketDate(current.time),current.dominance]]
    });
    saveCryptoResearch();
    renderCryptoCross();
  })().finally(()=>{researchRefresh=null;});
  return researchRefresh;
}

async function refreshCrypto(force=false) {
  if (cryptoUpdating || (!force && Date.now()-lastCryptoCheck<refreshEvery)) return;
  lastCryptoCheck = Date.now();
  cryptoUpdating = true;
  by("refresh").disabled = true;
  const {asset,range} = cryptoView;
  const interval = cryptoIntervals[range];
  const chartTasks = [requestCryptoChart(asset,interval,force)];
  if (interval!==1440) chartTasks.push(requestCryptoChart(asset,1440,force));
  const overview = (async ()=>{
    const direct = await marketFeed.overview();
    mergeCryptoData(direct);
    let fallback;
    if (hasApi && (!Object.keys(direct.quotes).length || !direct.global || !direct.fear.length)) {
      fallback = await requestMarket("crypto-overview").catch(()=>null);
      mergeCryptoData(fallback);
    }
    return Boolean(fallback || Object.keys(direct.quotes).length || direct.global || direct.fear.length);
  })();
  const equities = hasApi ? latestMarketQuotes(marketFeed.securities.map(([ticker])=>ticker))
    .then(securities=>{mergeCryptoData({securities});return Object.keys(securities).length>0;}) : Promise.resolve(false);
  drawCryptoPage();
  try {
    const results = await Promise.allSettled([overview,equities,...chartTasks,refreshResearch(force)]);
    if (results.some(result=>result.status==="fulfilled"&&result.value===true)) markRequest(lastCryptoCheck);
    localWrite(cryptoCacheKey,cryptoState);
  } finally {
    cryptoUpdating = false;
    cryptoAttempted = true;
    by("refresh").disabled = false;
    drawCryptoPage();
  }
}

function changeCryptoView(field,value) {
  if (cryptoView[field]===value) return;
  cryptoView[field] = value;
  cryptoView.selected = null;
  for (const button of document.querySelectorAll("[data-crypto-"+field+"]")) {
    button.setAttribute("aria-pressed",String(button.getAttribute("data-crypto-"+field)===String(value)));
  }
  if (field!=="mode") {
    const {asset,range} = cryptoView;
    requestCryptoChart(asset,cryptoIntervals[range]);
    if (cryptoIntervals[range]!==1440) requestCryptoChart(asset,1440);
  }
  drawCryptoSignals();
  renderResearchSignals();
  drawCryptoChart();
}

for (const field of ["asset","range","mode"]) for (const button of document.querySelectorAll("[data-crypto-"+field+"]")) {
  button.addEventListener("click",()=>{
    const value = button.getAttribute("data-crypto-"+field);
    changeCryptoView(field,field==="range"?Number(value):value);
  });
}
by("crypto-watch-rows").addEventListener("click",event=>{
  const button = event.target.closest("[data-chart-asset]");
  if (button) {
    changeCryptoView("asset",button.dataset.chartAsset);
    by("crypto-chart").scrollIntoView({block:"nearest"});
  }
});

const watchDialog = by("crypto-watch-dialog");
function drawWatchOptions(selected) {
  by("crypto-watch-options").innerHTML = marketFeed.coins.filter(([symbol])=>watchableCoins.has(symbol)).map(([symbol,,name])=>
    '<label><input type="checkbox" name="crypto-watch" value="'+symbol+'"'+(selected.includes(symbol)?" checked":"")
    +'><span>'+symbol+' · '+esc(name)+'</span></label>').join("");
  by("crypto-watch-error").textContent = "";
}
by("crypto-watch-edit").addEventListener("click",()=>{drawWatchOptions(cryptoWatch);watchDialog.showModal();});
by("crypto-watch-defaults").addEventListener("click",()=>drawWatchOptions(cryptoDefaultWatch));
by("crypto-watch-form").addEventListener("submit",event=>{
  event.preventDefault();
  const selected = new FormData(event.currentTarget).getAll("crypto-watch").filter(symbol=>watchableCoins.has(symbol));
  if (!selected.length) {by("crypto-watch-error").textContent = "请至少保留一个资产。";return;}
  cryptoWatch = selected;
  localWrite(cryptoWatchKey,selected);
  watchDialog.close();
  drawCryptoTables();
});

bindPlot(by("crypto-chart"),cryptoView,showCryptoPoint);
bindPlot(by("crypto-fear-chart"),fearView,showFearPoint);
const cryptoResize = new ResizeObserver(entries=>{
  for (const {target} of entries) {
    const plot = target.id==="crypto-chart" ? cryptoView.plot : fearView.plot;
    if (plot && (plot.width!==target.clientWidth || plot.height!==target.clientHeight) && target.clientWidth>0 && target.clientHeight>0) {
      if (target.id==="crypto-chart") drawCryptoChart();
      else drawCryptoFear();
    }
  }
});
cryptoResize.observe(by("crypto-chart"));
cryptoResize.observe(by("crypto-fear-chart"));
const autoCrypto = by("crypto-auto");
autoCrypto.checked = localRead("market-crypto-auto-v1",true);
autoCrypto.addEventListener("change",()=>{
  localWrite("market-crypto-auto-v1",autoCrypto.checked);
  if (autoCrypto.checked) {connectLiquidations();refreshCrypto(true);}
  else pauseLiquidations();
});
by("crypto-search").addEventListener("input",drawCryptoTables);
by("crypto-company-disclosure").addEventListener("toggle",event=>{if(event.currentTarget.open) refreshCryptoFilings();});
by("crypto-cross").addEventListener("toggle",renderCryptoCross);
by("crypto-cross-series").addEventListener("change",()=>{crossView.selected=null;renderCryptoCross();});
for (const field of ["days","frequency"]) for (const button of document.querySelectorAll("[data-cross-"+field+"]")) {
  button.addEventListener("click",()=>{
    const attribute = "data-cross-"+field;
    const value = button.getAttribute(attribute);
    crossView[field] = field==="days"?Number(value):value;
    crossView.selected = null;
    for (const peer of document.querySelectorAll("["+attribute+"]")) peer.setAttribute("aria-pressed",String(peer===button));
    renderCryptoCross();
  });
}
bindPlot(by("crypto-cross-chart"),crossView,showCrossPoint);
const crossResize = new ResizeObserver(()=>renderCryptoCross());
crossResize.observe(by("crypto-cross-chart"));
by("refresh").addEventListener("click",()=>refreshCrypto(true));
function autoRefreshCrypto() {
  if (!document.hidden && autoCrypto.checked) {connectLiquidations();refreshCrypto();}
}
document.addEventListener("visibilitychange",()=>{if (document.hidden) pauseLiquidations();else autoRefreshCrypto();});
window.addEventListener("storage",event=>{
  if ([storageKeys.portfolio,"market-portfolio-quote-cache-v1","market-portfolio-fx-cache-v1","market-observation-live-prices"].includes(event.key)) renderCryptoHoldings();
});
setInterval(autoRefreshCrypto,refreshEvery);
drawCryptoPage();
renderCryptoCross();
if (!readPortfolioBook() && !browserFile && location.hostname!=="" && !location.hostname.endsWith(".github.io")) {
  requestSavedPortfolio().then(data=>{
    if (data?.portfolio) {cryptoDatabaseBook=data.portfolio;renderCryptoHoldings();}
  }).catch(()=>{});
}
if (autoCrypto.checked) autoRefreshCrypto();
else pauseLiquidations();
