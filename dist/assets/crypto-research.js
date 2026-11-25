"use strict";

const researchFeed = globalThis.MARKET_CRYPTO_RESEARCH;
const crossView = {days:90,frequency:"day",plot:null,selected:null};
let cryptoDatabaseBook;
const crossKeys = Object.keys(researchFeed.symbols);
const tapeSymbols = {"^GSPC":"标普 500","^NDX":"纳斯达克 100","DX-Y.NYB":"美元指数","GC=F":"黄金期货"};
const researchState = {metrics:{},cross:null,breadth:null,tape:{...globalThis.WORLD_SNAPSHOT?.quotes},
  yield:dailyObservation(globalThis.WORLD_SNAPSHOT?.yields?.DGS10),dominance:[],watchTrends:{},filings:{rows:{}}};
const cryptoMetric = (label,value,move) => '<div><dt>'+esc(label)+'</dt><dd class="'+tone(move)+'">'+esc(value)+'</dd></div>';
const marketDate = time => fnum(time) ? researchFeed.iso(time) : "—";
const pctValue = (value,digits=2) => fnum(value)?fmt(value,digits)+"%":"—";
const pctMove = (value,digits=2) => fnum(value)?plus(value,digits)+"%":"—";
const moneyMove = value => fnum(value) ? (value>0?"+":value<0?"−":"")+cryptoMoney(Math.abs(value)) : "—";

function mergeCryptoResearch(data) {
  if (!data) return;
  researchState.metrics = researchFeed.merge(researchState.metrics,data.metrics);
  if (data.breadth?.count && !(researchState.breadth?.time>data.breadth.time)) researchState.breadth = data.breadth;
  if (data.cross?.series) {
    const previous = researchState.cross?.series ?? {};
    const series = {...previous};
    for (const symbol of crossKeys) {
      const next = data.cross.series[symbol];
      if (next?.rows?.length && !(previous[symbol]?.rows?.at(-1)?.[0]>next.rows.at(-1)[0])) {
        series[symbol] = {rows:[...new Map([...(previous[symbol]?.rows ?? []),...next.rows])].sort(([a],[b])=>a.localeCompare(b)).slice(-370)};
      }
    }
    researchState.cross = {time:Math.max(researchState.cross?.time ?? 0,data.cross.time),series};
  }
  for (const [symbol,row] of Object.entries(data.tape ?? {})) {
    if (Object.hasOwn(tapeSymbols,symbol) && row?.price>0 && !(researchState.tape[symbol]?.time>row.time)) researchState.tape[symbol] = row;
  }
  if (data.yield && !(researchState.yield?.date>data.yield.date)) researchState.yield = data.yield;
  const history = new Map([...researchState.dominance,...(data.dominance ?? [])]
    .filter(([date,value])=>/^\d{4}-\d{2}-\d{2}$/.test(date) && fnum(Date.parse(date)) && fnum(value) && value>0 && value<=100));
  researchState.dominance = [...history].sort(([a],[b])=>a.localeCompare(b)).slice(-35);
  if (data.filings?.rows && !(researchState.filings.time>data.filings.time)) researchState.filings = {
    time:data.filings.time,rows:{...researchState.filings.rows,...data.filings.rows}
  };
  researchState.watchTrends = {...researchState.watchTrends,...data.watchTrends};
}

function saveCryptoResearch() {
  localWrite("market-crypto-research-v1",{...researchState,tape:Object.fromEntries(
    Object.keys(tapeSymbols).filter(key=>researchState.tape[key]).map(key=>[key,researchState.tape[key]])
  )});
}

function spark(values) {
  const numbers = values.filter(fnum);
  if (numbers.length<2) return "";
  const low = Math.min(...numbers), span = Math.max(...numbers)-low || 1;
  const points = numbers.map((v,i)=>(i? "L":"M")+(1+i*74/(numbers.length-1)).toFixed(1)+","+(22-(v-low)*20/span).toFixed(1));
  return '<span class="crypto-mini-line '+tone(numbers.at(-1)-numbers[0])+'"><svg viewBox="0 0 76 25" aria-hidden="true"><path d="'+points.join("")+'"/></svg></span>';
}
function stableSupplyDelta(rows,days) {
  const [time,value] = rows.at(-1);
  const old = rows.findLast(([stamp])=>stamp<=time-days*researchFeed.day);
  return old && old[0]>=time-(days+2)*researchFeed.day && old[1]>0 ? (value/old[1]-1)*100 : null;
}
function flowSum(rows,n) {
  return rows.length>=n ? rows.slice(-n).reduce((sum,row)=>sum+row.total,0) : null;
}
function fundDailyFlow(symbol) {
  const value = Object.hasOwn(cryptoFunds,symbol) ? researchState.metrics["flow"+cryptoFunds[symbol]]?.rows.at(-1) : null;
  return value?.funds && Object.hasOwn(value.funds,symbol) ? {time:value.time,total:value.funds[symbol]} : null;
}
function watchSpark(symbol) {
  const chart = cryptoState.charts[chartKey(symbol,1440)];
  const values = chart?.rows?.filter(row=>row[0]+dailyMs<=Date.now()).slice(-8).map(([,close])=>close)
    ?? researchState.watchTrends[symbol]?.map(([,close])=>close);
  return values?.length>=2 ? spark(values) : "—";
}

function shortStat(label,value,detail="",move) {
  return '<div class="crypto-primary-stat"><span class="crypto-price-date">'+esc(label)+'</span>'
    +'<div class="reading"><strong class="'+tone(move)+'">'+esc(value)+'</strong></div>'
    +(detail?'<span class="crypto-price-date">'+esc(detail)+'</span>':"")+'</div>';
}

function dominanceWindow(rows) {
  const last = Date.parse(rows.at(-1)?.[0]);
  return rows.filter(([date,value])=>Date.parse(date)>last-30*researchFeed.day && fnum(value) && value>0 && value<=100);
}

function renderDominanceTrend({rows,source}) {
  const target = by("crypto-dominance-trend");
  target.hidden = rows.length<2;
  if (target.hidden) {
    target.innerHTML = "";
    return;
  }
  const first = Date.parse(rows[0][0]), last = Date.parse(rows.at(-1)[0]);
  const values = rows.map(([,value])=>value);
  const min = Math.min(...values), span = Math.max(...values)-min;
  const coordinates = rows.map(([date,value])=>{
    const x = 1+(Date.parse(date)-first)*98/(last-first);
    const y = span ? 19-(value-min)*16/span : 11;
    return [x.toFixed(2),y.toFixed(2)];
  });
  const path = coordinates.map(([x,y],i)=>(i?"L":"M")+x+","+y).join("");
  const detail = rows[0][0]+" – "+rows.at(-1)[0]+" · "+pctValue(values[0])+" → "+pctValue(values.at(-1))+" · "+source;
  target.innerHTML = '<div class="crypto-dominance-spark" title="'+esc(detail)+'"><span>近 30 日 · '+rows.length+' 个日值</span>'
    +'<svg viewBox="0 0 100 22" preserveAspectRatio="none" role="img" aria-label="'+esc(detail)+'"><path d="'+path+'"/></svg></div>';
}

function renderResearchSignals() {
  const {metrics,breadth,dominance} = researchState;
  const available = [...watchableCoins].map(code=>cryptoState.quotes[code])
    .filter(row=>fnum(row?.day) && row.time>=Date.now()-6*3600000);
  const breadthNode = by("crypto-breadth");
  const above = fnum(breadth?.above) && breadth.count>0;
  breadthNode.innerHTML = (available.length ? cryptoMetric("24 小时上涨币种",available.filter(row=>row.day>0).length+" / "+available.length) : "")
    +(above ? cryptoMetric("站上 50 日线",breadth.above+" / "+breadth.count) : "");
  breadthNode.hidden = !breadthNode.innerHTML;

  const historical = dominanceWindow(metrics.btcDominance?.rows ?? []);
  const window = dominanceWindow(dominance);
  const historyIsRecent = Date.parse(historical.at(-1)?.[0])>=Date.parse(window.at(-1)?.[0])-2*researchFeed.day;
  const chart = historical.length>=2 && (window.length<2 || (historyIsRecent && historical.length>=window.length))
    ? {rows:historical,source:"CoinMarketCap"} : {rows:window,source:"CoinPaprika 快照"};
  renderDominanceTrend(chart);

  const flowRows = ["BTC","ETH"].map(asset=>({asset,rows:metrics["flow"+asset]?.rows ?? []}));
  const [,ethFlow] = flowRows;
  const btc = flowRows[0].rows, last = btc.at(-1), eth = ethFlow.rows.at(-1);
  const details = by("crypto-flow-details");
  details.hidden = !flowRows.some(({rows})=>rows.length);
  const totals = [[5,flowSum(btc,5)],[20,flowSum(btc,20)]];
  const latest = last ?? eth;
  by("crypto-flows").innerHTML = latest
    ? shortStat((last?"BTC":"ETH")+" 最近披露日净流入",moneyMove(latest.total),marketDate(latest.time)+" · 美元",latest.total)
      +'<dl class="crypto-metric-list">'+totals.filter(([,value])=>fnum(value)).map(([days,value])=>cryptoMetric("BTC "+days+" 日累计",moneyMove(value),value)).join("")
      +(last && eth ? cryptoMetric("ETH 最近一日",moneyMove(eth.total),eth.total) : "")+'</dl>'
    : '<p class="metric-meta">暂无已披露资金流</p>';
  by("crypto-flow-table").innerHTML = '<table class="crypto-subtable"><thead><tr><th>资产</th><th>最近一日</th><th>5 日</th><th>20 日</th></tr></thead><tbody>'
    +flowRows.filter(({rows})=>rows.length).map(({asset,rows})=>{
      const current = rows.at(-1);
      return '<tr><th scope="row">'+asset+'<small class="crypto-price-date">'+marketDate(current.time)+'</small></th>'
        +[current.total,flowSum(rows,5),flowSum(rows,20)].map(value=>'<td class="'+tone(value)+'">'+moneyMove(value)+'</td>').join("")+'</tr>';
    }).join("")+'</tbody></table>';
  renderLeverage();
}

function fundingEightHours(row) {
  return fnum(row?.funding) && fnum(row.interval) && row.interval>0 ? row.funding*8/row.interval : null;
}

function renderLeverage() {
  const {perpBTC:btc,perpETH:eth,futureBTC:future} = researchState.metrics;
  const rates = [fundingEightHours(btc),fundingEightHours(eth)];
  const primary = fnum(rates[0]) ? 0 : fnum(rates[1]) ? 1 : -1;
  const primaryLabel = ["BTC","ETH"][primary], primaryRow = [btc,eth][primary];
  const secondary = primary===0 && fnum(rates[1]) ? cryptoMetric("ETH 资金费率 · 8 小时",pctMove(rates[1],4)) : "";
  const interest = fnum(btc?.interest) ? cryptoMetric("BTC 未平仓",cryptoMoney(btc.interest)) : "";
  const basis = fnum(future?.premium) ? cryptoMetric("BTC 期货基差",pctMove(future.premium,3)) : "";
  by("crypto-perps").innerHTML = (primary>=0 ? shortStat(primaryLabel+" 永续资金费率 · 8 小时",pctMove(rates[primary],4),timeAt(primaryRow.time)+" 北京") : "")
    +(interest || secondary || basis ? '<dl class="crypto-metric-list">'+interest+secondary+basis+'</dl>' : "")
    +(primary<0 && !interest && !basis ? '<p class="metric-meta">暂无衍生品报价</p>' : "");
  const rows = [["BTC",btc],["ETH",eth]].filter(([,row])=>row);
  const dated = ["BTC","ETH"].map(asset=>{
    const row = researchState.metrics["future"+asset];
    return row && fnum(row.premium) ? cryptoMetric(asset+" 最近到期期货基差",pctMove(row.premium,3)+" · "+marketDate(row.expiry)) : "";
  }).join("");
  by("crypto-perp-table").innerHTML = (rows.length ? '<table class="crypto-subtable"><thead><tr><th>永续</th><th>原始费率</th><th>未平仓</th><th>标记价溢价</th></tr></thead><tbody>'
    +rows.map(([asset,row])=>'<tr><th scope="row">'+asset+'<small class="crypto-price-date">'+timeAt(row.time)+" 北京"+'</small></th><td>'
      +pctMove(row.funding,4)+'<small class="crypto-price-date">'+(row.interval>0?fmt(row.interval,0)+" 小时":"周期未披露")+'</small></td><td>'
      +cryptoMoney(row.interest)+'</td><td>'+pctMove(row.premium,3)+'</td></tr>').join("")+'</tbody></table>' : "")
    +(dated ? '<dl class="crypto-metric-list">'+dated+'</dl>' : "")
    +'<p class="metric-meta">Bybit USDT 永续原始费率按实际周期披露，卡片按 8 小时线性换算。永续溢价为标记价相对指数价。Deribit 交割期货基差为标记价相对预计交割指数价。</p>';
}

function renderStableTape() {
  const {supply} = researchState.metrics;
  const pegs = ["USDT","USDC","DAI"].flatMap(symbol=>{
    const row = cryptoState.quotes[symbol];
    if (!(row?.price>0)) return [];
    const deviation = Math.round((row.price-1)*100000)/1000;
    return '<div title="'+esc("CoinPaprika · 较 1 美元 · "+dualTime(row.time))+'"><dt>'+symbol+'</dt><dd>'
      +fmt(row.price,5)+' <span class="'+tone(deviation)+'">'+pctMove(deviation,3)+'</span></dd></div>';
  });
  const total = supply?.rows.at(-1);
  const supplyData = total ? '<div title="'+esc("DefiLlama · "+marketDate(supply.time)+" UTC")+'"><dt>美元稳定币流通供应</dt><dd>'
    +compactUSD.format(total[1])+'</dd></div>'+[7,30].map(days=>{
      const change = stableSupplyDelta(supply.rows,days);
      return fnum(change) ? '<div><dt>供应 '+days+' 日变化</dt><dd class="'+tone(change)+'">'+pctMove(change)+'</dd></div>' : "";
    }).join("") : "";
  by("crypto-stable").innerHTML = pegs.join("")+supplyData
    || '<div><dt>暂无稳定币报价与流通供应数据</dt></div>';
}

function renderCryptoTape() {
  const {tape,yield:treasury} = researchState;
  const tiles = Object.entries(tapeSymbols).map(([symbol,label])=>{
    const quote = tape[symbol];
    const move = quote?.previous>0 && quote.price>0 ? (quote.price/quote.previous-1)*100 : null;
    return [label,assetPrice(quote?.price),pctMove(move),quote?.time,move];
  });
  const btc = cryptoState.quotes.BTC, eth = cryptoState.quotes.ETH;
  const relative = fnum(btc?.day) && fnum(eth?.day) && Math.abs(btc.time-eth.time)<=15*60000 && eth.day>-100
    ? ((1+btc.day/100)/(1+eth.day/100)-1)*100 : null;
  const treasuryValue = treasury?.value;
  tiles.push(["美国 10 年期国债",pctValue(treasuryValue),treasury ? (treasury.move == null ? "" : plus(treasury.move,0)+" bp · ")+treasury.date : "—",null,treasury?.move],
    ["BTC / ETH",btc?.price>0 && eth?.price>0 && Math.abs(btc.time-eth.time)<=15*60000 ? fmt(btc.price/eth.price) : "—",pctMove(relative),Math.min(btc?.time,eth?.time),relative]);
  by("crypto-tape").innerHTML = tiles.map(([label,value,change,time,move])=>'<div title="'+esc(dualTime(time))+'"><small>'
    +esc(label)+'</small><strong>'+esc(value)+'</strong><small class="'+tone(move)+'">'+esc(change)+'</small></div>').join("");
}

let filingsLoading = false;
let filingsChecked = 0;
function renderCryptoFilings() {
  const {rows} = researchState.filings;
  by("crypto-company-table").innerHTML = '<thead><tr><th scope="col">公司</th><th scope="col">最新单季收入</th><th scope="col">同比</th><th scope="col">财季截至</th><th scope="col">财年摊薄 EPS</th></tr></thead><tbody>'
    +[...cryptoEquities].map(symbol=>{
      const row = rows[symbol];
      const filing = Number.isSafeInteger(row?.cik) ? "https://www.sec.gov/edgar/browse/?CIK="+row.cik : "https://www.sec.gov/edgar/search/#/q="+symbol;
      return '<tr><th scope="row"><a class="crypto-source" href="'+filing+'" target="_blank" rel="noopener noreferrer">'+symbol+'</a></th>'
        +'<td>'+cryptoMoney(row?.revenue)+'</td><td class="'+tone(row?.revenueChange)+'">'+pctMove(row?.revenueChange)+'</td>'
        +'<td>'+esc(row?.revenueDate ?? "—")+'</td><td title="'+esc(row?.annualEPSDate ?? "—")+'">'+fmt(row?.annualEPS)+'</td></tr>';
    }).join("")+'</tbody>';
  by("crypto-company-status").textContent = filingsLoading ? "正在更新 SEC 财报…" : Object.keys(rows).length
    ? "SEC EDGAR · 最新披露单季 GAAP 收入，日期按各公司财年。" : "等待 SEC 财报，可点击代码查看发行人披露。";
}

async function refreshCryptoFilings(force=false) {
  if (filingsLoading || (!force && Date.now()-filingsChecked<3600000)) return;
  filingsLoading = true;
  filingsChecked = Date.now();
  renderCryptoFilings();
  try {
    const filings = await requestMarket("crypto-filings");
    mergeCryptoResearch({filings});
    saveCryptoResearch();
  } catch {} finally {
    filingsLoading = false;
    renderCryptoFilings();
  }
}

function renderCryptoChain() {
  const data = researchState.metrics;
  const cap = data.CapRealUSD, supply = data.SplyCur;
  const realized = cap?.time===supply?.time && supply?.value>0 ? {time:cap.time,value:cap.value/supply.value} : null;
  const dormant = data.SplyActPct1yr ? {time:data.SplyActPct1yr.time,value:(1-data.SplyActPct1yr.value)*100} : null;
  const rows = [
    ["MVRV",data.CapMVRVCur,value=>fmt(value,2)],["已实现价格",realized,cryptoMoney],
    ["1 年未移动供应",dormant,pctValue],["长期持有者供应",data.longTermHolders,value=>compactUSD.format(value)+" BTC","Glassnode"],
    ["BTC 交易所余额",data.exchangeBalance,value=>fmt(value,0)+" BTC","Glassnode"],
    ["BTC 交易所日净流量",data.exchangeFlow,value=>plus(value,0)+" BTC","Glassnode"],
    ["日交易手续费",data.FeeTotNtv,value=>fmt(value,3)+" BTC"],["下一块费率",data.chainFees,value=>fmt(value,0)+" sat/vB","mempool.space"],
    ["日活跃地址",data.AdrActCnt,value=>fmt(value,0)],["日交易笔数",data.TxCnt,value=>fmt(value,0)],
    ["ETH 活跃质押供应",data.stakingETH,value=>compactUSD.format(value)+" ETH"],
  ];
  const available = rows.filter(([,row])=>fnum(row?.value) && fnum(row.time));
  by("crypto-chain-section").hidden = !available.length;
  by("crypto-chain").innerHTML = available.map(([name,row,format,source="Coin Metrics"])=>'<div title="'+esc(source)+'"><dt>'+esc(name)+'</dt><dd>'
    +esc(format(row.value))+'</dd><small>'+esc(marketDate(row.time)+" UTC")+'</small></div>').join("");
}

function renderCryptoHoldings() {
  const raw = readPortfolioBook() ?? cryptoDatabaseBook;
  const rows = Array.isArray(raw?.positions) ? raw.positions.filter(row=>row && typeof row.symbol==="string") : [];
  const base = currencyValid(raw?.base) ? raw.base : "USD";
  const savedQuotes = localRead("market-portfolio-quote-cache-v1",{});
  const quoteEnabled = localRead("market-observation-live-prices",true);
  const priced = rows.map(row=>{
    if (!quoteEnabled || row.kind==="cash") return row;
    const quote = savedQuotes[row.symbol] ?? cryptoState.securities[row.symbol];
    const current = row.currency==="USD" && privateCoin(row) ? cryptoState.quotes[coinCode(row.symbol)] : null;
    if (current?.price>0 && !(quote?.time>current.time)) {
      return {...row,price:current.price,previous:fnum(current.day) && current.day>-100 ? current.price/(1+current.day/100) : null};
    }
    return quote?.price>0 && quote.currency===row.currency ? {...row,price:quote.price,previous:quote.previous} : row;
  });
  const report = analyze(priced,{base,weights:[]},effectiveRates(localRead("market-portfolio-fx-cache-v1",{}).rates ?? {},raw?.rates ?? {}));
  const exposure = cryptoExposure(report.values,report.nav);
  const {entries,weight,btcWeight,ethWeight,pricedCount} = exposure;
  const target = by("crypto-holdings");
  by("crypto-holdings-section").hidden = !entries.length;
  if (!entries.length) {
    target.replaceChildren();
    return;
  }
  const daily = entries.every(privateCoin);
  const money = value => fnum(value)?fmt(value)+" "+base:"—";
  target.innerHTML = '<div class="crypto-holding-meta"><span>市值 <strong>'+money(pricedCount?exposure.priced:null)+'</strong></span>'
    +'<span>组合占比 <strong>'+pctValue(weight)+'</strong></span><span>BTC 现货及 ETF <strong>'+pctValue(btcWeight)+'</strong></span>'
    +'<span>ETH 现货及 ETF <strong>'+pctValue(ethWeight)+'</strong></span></div>'
    +'<div class="work-table-wrap"><table class="work-table"><thead><tr><th>持仓</th><th>形式</th><th>市值</th><th>变动金额</th></tr></thead><tbody>'
    +entries.map(row=>'<tr><th scope="row">'+esc(row.code)+'</th><td>'+esc(row.form)+'</td><td>'+money(row.marketValue)
      +'</td><td class="'+tone(row.totalImpact)+'">'+money(row.totalImpact)+'</td></tr>').join("")
    +'</tbody></table></div><p class="work-note">'+pricedCount+' / '+entries.length+' 项已计价 · '
    +(daily?"现货较 24 小时前（汇率沿用组合口径）":"现货通常较 24 小时前，证券较前收")+'</p>';
}

const windowStart = (end,days) => researchFeed.iso(Date.parse(end)-days*researchFeed.day);
function comparableDates(series,frequency) {
  const sessions = (series.SPY?.rows ?? []).map(([date])=>date);
  if (frequency==="day") return sessions;
  const weeks = new Map();
  for (const date of sessions) {
    const at = Date.parse(date)-researchFeed.day;
    weeks.set(researchFeed.iso(at-((new Date(at).getUTCDay()+6)%7)*researchFeed.day),date);
  }
  const rows = [...weeks];
  const current = Date.now();
  return rows.filter(([week])=>Date.parse(week)+6*researchFeed.day+22*3600000<=current).map(([,date])=>date);
}

function pairedReturns(first,second,dates,weekly=false) {
  const result = [];
  for (let i=1;i<dates.length;i++) {
    const prev = dates[i-1], next = dates[i];
    if (Date.parse(next)-Date.parse(prev)>(weekly?10:5)*researchFeed.day) continue;
    const a = first.get(prev), b = second.get(prev), c = first.get(next), d = second.get(next);
    if (a>0 && b>0 && c>0 && d>0) result.push([next,c/a-1,d/b-1]);
  }
  return result;
}
function pearson(rows,minimum) {
  if (rows.length<minimum) return null;
  const means = rows.reduce(([a,b],[,x,y])=>[a+x,b+y],[0,0]).map(sum=>sum/rows.length);
  const [xx,yy,xy] = rows.reduce(([a,b,c],[,x,y])=>{
    const dx = x-means[0], dy = y-means[1];
    return [a+dx*dx,b+dy*dy,c+dx*dy];
  },[0,0,0]);
  return xx>0 && yy>0 ? Math.max(-1,Math.min(1,xy/Math.sqrt(xx*yy))) : null;
}

function renderCryptoCross() {
  if (!by("crypto-cross").open) return;
  const series = researchState.cross?.series ?? {};
  const hasSessions = Boolean(series.SPY?.rows?.length);
  by("crypto-cross-controls").hidden = !hasSessions;
  by("crypto-cross-series-controls").hidden = !hasSessions;
  const maps = Object.fromEntries(crossKeys.map(key=>[key,new Map(series[key]?.rows ?? [])]));
  const aligned = comparableDates(series,crossView.frequency);
  const last = aligned.at(-1);
  const first = last ? windowStart(last,crossView.days) : null;
  const dates = aligned.filter(date=>date>=first);
  const isWeekly = crossView.frequency==="week";
  const minimum = isWeekly ? 4 : 10;
  const measures = crossKeys.map(a=>crossKeys.map(b=>{
    const pairs = pairedReturns(maps[a],maps[b],dates,isWeekly);
    return {value:pearson(pairs,minimum),count:pairs.length};
  }));
  const hasCorrelation = measures.some((row,i)=>row.some(({value},j)=>i!==j && fnum(value)));
  by("crypto-cross-status").textContent = hasCorrelation ? "截至 "+last+" · 按新加坡 06:00 估值截点对齐 · 每格至少 "+minimum+" 个配对收益样本"
    : hasSessions ? "所选区间至少需要 "+minimum+" 个配对收益样本，当前无法计算跨资产相关性。" : "暂无对齐的历史行情。";
  by("crypto-cross-status").title = hasCorrelation ? "加密用截至截点的小时线，证券用当日已发布复权收盘，DXY 用指数收盘。仅采样美股交易日或已结束的交易周。" : "";
  by("crypto-matrix-wrap").hidden = !hasCorrelation;
  by("crypto-matrix").innerHTML = hasCorrelation ? '<thead><tr><th scope="col">资产</th>'+crossKeys.map(key=>'<th scope="col">'+key+'</th>').join("")
    +'</tr></thead><tbody>'+measures.map((row,i)=>'<tr><th scope="row">'+crossKeys[i]+'</th>'+row.map(({value,count})=>
      '<td'+(fnum(value)?' data-correlation="'+(value<0?"negative":"positive")+'" style="--strength:'+Math.round(Math.abs(value)*54)+'%"':"")
        +'>'+fmt(value,2)+(count?'<small>'+count+' 样本</small>':"")+'</td>'
    ).join("")+'</tr>').join("")+'</tbody>' : "";
  const choice = by("crypto-cross-series").value;
  const rolling = choice==="rolling";
  let points = [];
  if (rolling) {
    const pairs = pairedReturns(maps.BTC,maps.QQQ,comparableDates(series,"day"));
    points = pairs.flatMap(([date],i)=>{
      if (date<first || i<19) return [];
      const window = pairs.slice(i-19,i+1);
      const value = Date.parse(date)-Date.parse(window[0][0])<=40*researchFeed.day ? pearson(window,20) : null;
      return fnum(value) ? [[Date.parse(date),value]] : [];
    });
  } else {
    const [a,b] = choice.split("/");
    const values = dates.flatMap(date=>maps[a]?.get(date)>0 && maps[b]?.get(date)>0 ? [[Date.parse(date),maps[a].get(date)/maps[b].get(date)]] : []);
    points = values.map(([time,value])=>[time,value/values[0][1]*100]);
  }
  const target = by("crypto-cross-chart");
  target.hidden = points.length<2;
  crossView.plot = drawMarketPlot(target,target.hidden?[]:points,{base:rolling?0:100,axisWidth:51,
    pointLabel:row=>marketDate(row[0]),axisLabel:row=>marketDate(row[0]).slice(5),
    axisFormat:value=>fmt(value,rolling?2:1),quietCursor:true,
    breakLine:(before,row)=>Array.isArray(before) && Array.isArray(row) && row[0]-before[0]>(isWeekly&&!rolling?10:5)*researchFeed.day});
  showCrossPoint();
  if (hasSessions && target.hidden) by("crypto-cross-readout").textContent = "所选序列的配对样本不足。";
}
function showCrossPoint() {
  plotPoint(crossView,by("crypto-cross-readout"),value=>fmt(value,2));
}

let liquidationSocket;
let liquidationSince;
let liquidationStatus = "正在连接";
let retryLiquidation = 0;
const liquidationTotals = {BTCUSDT:0,ETHUSDT:0};
function updateLiquidationLabel() {
  by("crypto-liquidations").textContent = liquidationStatus+(liquidationSince
    ?" · 本次连接 "+timeAt(liquidationSince)+" 北京起 · BTC "+cryptoMoney(liquidationTotals.BTCUSDT)+" / ETH "+cryptoMoney(liquidationTotals.ETHUSDT)
    :" · 清算累计仅覆盖本次连接");
}
function connectLiquidations() {
  if (liquidationSocket || document.hidden || !by("crypto-auto").checked || typeof WebSocket!=="function" || Date.now()<retryLiquidation) return;
  retryLiquidation = Date.now()+60000;
  try {
    const socket = new WebSocket("wss://stream.bybit.com/v5/public/linear");
    liquidationSocket = socket;
    liquidationSince = null;
    liquidationTotals.BTCUSDT = 0;
    liquidationTotals.ETHUSDT = 0;
    liquidationStatus = "正在连接 Bybit 清算推送";
    updateLiquidationLabel();
    let heartbeat;
    socket.addEventListener("open",()=>{
      socket.send(JSON.stringify({op:"subscribe",args:["allLiquidation.BTCUSDT","allLiquidation.ETHUSDT"]}));
      heartbeat = setInterval(()=>{if (socket.readyState===1) socket.send('{"op":"ping"}');},20000);
    });
    socket.addEventListener("message",event=>{
      if (liquidationSocket!==socket) return;
      let message;
      try {message=JSON.parse(event.data);} catch {return;}
      if (message.op==="subscribe" && message.success===true) {
        liquidationSince = Date.now();
        liquidationStatus = "Bybit 线性永续清算";
      }
      if (message.topic?.startsWith("allLiquidation.") && Array.isArray(message.data)) for (const row of message.data) {
        if (Object.hasOwn(liquidationTotals,row.s) && +row.v>0 && +row.p>0) liquidationTotals[row.s] += Number(row.v)*Number(row.p);
      }
      updateLiquidationLabel();
    });
    socket.addEventListener("close",()=>{
      clearInterval(heartbeat);
      if (liquidationSocket!==socket) return;
      liquidationSocket = null;
      liquidationStatus = "Bybit 清算推送已断开";
      updateLiquidationLabel();
    });
  } catch {
    liquidationSocket = null;
    liquidationStatus = "Bybit 清算连接不可用";
    updateLiquidationLabel();
  }
}
function pauseLiquidations() {
  const socket = liquidationSocket;
  liquidationSocket = null;
  socket?.close();
  liquidationStatus = "清算推送已暂停";
  updateLiquidationLabel();
}
