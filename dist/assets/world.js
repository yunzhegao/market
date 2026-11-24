"use strict";

const worldSections = [
  ["北美", [["^GSPC","标普 500"],["^IXIC","纳斯达克综合"],["^DJI","道琼斯"],["^RUT","罗素 2000"],["^GSPTSE","加拿大 TSX"],["^MXX","墨西哥 IPC"]]],
  ["欧洲", [["^STOXX50E","欧洲斯托克 50"],["^FTSE","英国富时 100"],["^GDAXI","德国 DAX"],["^FCHI","法国 CAC 40"],["^SSMI","瑞士 SMI"],["^IBEX","西班牙 IBEX"]]],
  ["亚洲与大洋洲", [["^N225","日经 225"],["^KS11","韩国 KOSPI"],["^TWII","台湾加权"],["^STI","新加坡海峡时报"],["^AXJO","澳洲 ASX 200"],["^NSEI","印度 Nifty 50"],["^NZ50","新西兰 NZX 50"],["^JKSE","印尼雅加达综合"]]],
  ["中国内地与香港", [["000001.SS","上证综指"],["399001.SZ","深证成指"],["000300.SS","沪深 300"],["^HSI","恒生指数"],["HSTECH.HK","恒生科技"],["^HSCE","恒生国企"]]],
  ["拉美与中东", [["^BVSP","巴西 Bovespa"],["^MERV","阿根廷 MERVAL"],["^TASI.SR","沙特 Tadawul"]]],
];
const crossSections = [
  ["指数期货", [["ES=F","标普 500"],["NQ=F","纳斯达克 100"],["YM=F","道琼斯"],["RTY=F","罗素 2000"]]],
  ["商品", [["CL=F","WTI 原油"],["BZ=F","布伦特原油"],["GC=F","黄金"],["SI=F","白银"],["HG=F","铜"]]],
  ["外汇与美元", [["DX-Y.NYB","美元指数"],["EURUSD=X","EUR/USD"],["USDJPY=X","USD/JPY"],["USDSGD=X","USD/SGD"],["USDHKD=X","USD/HKD"],["USDCNH=X","USD/CNH"]]],
  ["美国国债收益率", [["DGS2","2 年美债"],["DGS5","5 年美债"],["DGS10","10 年美债"],["DGS30","30 年美债"]]],
];
const defaultWatch = [["SPYM","标普 500 ETF"],["QQQM","纳指 100 ETF"],["GLDM","黄金 ETF"],["TLT","长期美债 ETF"]];
const marketSnapshot = window.WORLD_SNAPSHOT || {};
const quotes = {...marketSnapshot.quotes};
const yields = {...marketSnapshot.yields};
const fresh = new Set();
const fourDays = 4 * 86400000;
let ownWatch = localRead(storageKeys.watch, null);
let portfolioRows = localRead(storageKeys.portfolio, {}).positions || [];
let waiting = false;

function watchRows() {
  const rows = new Map();
  for (const item of portfolioRows) {
    const {symbol,name,kind,quantity} = item;
    if (kind === "cash" || !(quantity > 0) || !tickerPattern.test(symbol)) continue;
    rows.set(symbol,{symbol, name:name || symbol, held:true, localPrice:fnum(item.price) ? item.price : null});
  }
  for (const [symbol,name] of ownWatch ?? (rows.size ? [] : defaultWatch)) {
    if (tickerPattern.test(symbol) && !rows.has(symbol)) rows.set(symbol,{symbol,name,held:false});
  }
  return [...rows.values()];
}

function marketSpark(values, direction) {
  const data = Array.isArray(values) ? values.filter(fnum) : [];
  if (data.length < 2) return '<span class="market-mini-empty"></span>';
  const low = Math.min(...data), scale = Math.max(Math.max(...data)-low, .000001);
  const points = data.map((n,i) => (i*56/(data.length-1)).toFixed(1) + "," + (15-(n-low)*12/scale).toFixed(1)).join(" ");
  return '<svg viewBox="0 0 56 18" preserveAspectRatio="none" aria-hidden="true" class="market-mini ' + direction
    + '"><polyline points="' + points + '" fill="none" stroke="currentColor" stroke-width="1.15" vector-effect="non-scaling-stroke"/></svg>';
}

function quoteFor(symbol) {
  if (!Object.hasOwn(yields,symbol)) return quotes[symbol];
  const rows = yields[symbol]?.rows;
  const latest = rows?.at(-1);
  return latest ? {price:latest[1],previous:rows.at(-2)?.[1],spark:rows.slice(-18).map(row=>row[1]),date:latest[0],source:yields[symbol].source} : quotes[symbol];
}

function matches(row) {
  const needle = by("ticker-filter").value.trim().toUpperCase();
  return !needle || (row.symbol + " " + row.name).toUpperCase().includes(needle);
}

function marketRow(row) {
  const {symbol,name,held,localPrice} = row;
  const reading = quoteFor(symbol);
  const yieldReading = ["fred","treasury"].includes(reading?.source);
  const price = reading?.price ?? localPrice;
  const delta = reading?.price - reading?.previous;
  const move = yieldReading ? delta*100 : reading?.previous > 0 ? delta/reading.previous*100 : NaN;
  const dir = Math.abs(move) < (yieldReading ? .5 : .005) ? "" : tone(move);
  const time = yieldReading ? reading.date?.slice(5).replace("-","/") : reading ? timeAt(reading.time,reading.timezone) : "";
  const digits = symbol.endsWith("=X") ? 4 : 2;
  const url = reading?.source === "treasury"
    ? "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve"
    : yieldReading ? "https://fred.stlouisfed.org/series/" + encodeURIComponent(symbol) : "https://finance.yahoo.com/quote/" + encodeURIComponent(symbol) + "/";
  const stale = fnum(reading?.time) && Date.now() - reading.time > fourDays;
  const source = reading ? time : fnum(localPrice) ? "手动价" : "暂无报价";
  const clock = reading?.timezone ? " · " + reading.timezone : "";
  const status = reading ? stale ? " · 报价超过四天" : !fresh.has(symbol) ? " · 快照" : "" : "";
  const value = fmt(price,digits) + (yieldReading ? "%" : "");
  return '<a class="market-line" href="' + url + '" target="_blank" rel="noopener noreferrer" title="' + esc(name+" "+symbol+" · "+source+clock+status) + '">'
    + '<div class="market-name"><span>' + esc(name) + '</span><small>' + esc(symbol) + (held ? ' · 持仓' : '') + '</small></div>'
    + marketSpark(reading?.spark,dir)
    + '<div class="market-number"><strong>' + esc(value) + '</strong></div>'
    + '<div class="market-number"><strong class="' + dir + '">' + (yieldReading && fnum(move) ? plus(move,0)+" bp" : pctText(fnum(move) && Math.abs(move)<.005 ? 0 : move)) + '</strong><small class="' + (stale ? 'market-stale' : '') + '">' + esc(source) + '</small></div></a>';
}

function regionMarkup([label,list], panel) {
  const rows = list.map(([symbol,name])=>({symbol,name})).filter(matches);
  if (!rows.length) return "";
  return '<section class="' + (panel ? 'panel work-panel' : 'market-region') + '">'
    + (panel ? '<div class="section-line"><h2>' + esc(label) + '</h2></div>' : '<h3>' + esc(label) + '</h3>')
    + '<div class="market-lines">' + rows.map(marketRow).join("") + '</div></section>';
}

function renderWorld() {
  by("regions").innerHTML = worldSections.map(group=>regionMarkup(group,false)).join("") || '<p class="work-note">没有符合条件的指数</p>';
  by("cross-markets").innerHTML = crossSections.map(group=>regionMarkup(group,true)).join("");
  const watch = watchRows();
  by("watch-rows").innerHTML = watch.filter(matches).map(marketRow).join("") || '<p class="work-note">没有符合条件的持仓与自选</p>';
  by("watch-help").hidden = watch.some(row=>row.held) || !!by("ticker-filter").value;
}

async function refreshWorld() {
  if (waiting) return;
  waiting = true;
  by("refresh").disabled = true;
  if (!hasApi) {
    by("world-status").textContent = "当前显示随网页发布的行情快照。";
    by("refresh").disabled = false;
    waiting = false;
    return;
  }
  by("world-status").textContent = "正在请求行情，旧报价保留至更新成功。";
  const symbols = [...new Set([...worldSections,...crossSections.slice(0,-1)].flatMap(group=>group[1].map(row=>row[0]))
    .concat(watchRows().map(row=>row.symbol)))];
  const requested = [...symbols,...crossSections.at(-1)[1].map(row=>row[0])];
  const refreshed = new Set();
  const batches = [];
  for (let i=0;i<symbols.length;i+=8) batches.push(symbols.slice(i,i+8));
  try {
    const readQuotes = async batch => {
      const data = await requestMarket("world",{symbols:batch.join(",")});
      for (const [symbol,row] of Object.entries(data.quotes || {})) {
        if (!batch.includes(symbol) || !row || !fnum(row.price) || !fnum(row.time)) continue;
        if (!(quotes[symbol]?.time > row.time)) quotes[symbol] = row;
        if (Date.now() - quotes[symbol].time <= fourDays) {
          fresh.add(symbol);
          refreshed.add(symbol);
        }
      }
      renderWorld();
    };
    const readYields = async () => {
      const data = await requestMarket("world-yields");
      for (const [symbol,row] of Object.entries(data.observations || {})) {
        const date = row?.rows?.at(-1)?.[0];
        if (!date) continue;
        if (!(yields[symbol]?.rows?.at(-1)?.[0] > date)) yields[symbol] = row;
        fresh.add(symbol);
        refreshed.add(symbol);
      }
      renderWorld();
    };
    await Promise.allSettled([readYields(), ...batches.map(readQuotes)]);
    if (refreshed.size) markRequest();
    const missed = requested.filter(key=>!refreshed.has(key));
    by("world-status").textContent = missed.length
      ? (refreshed.size ? "已核对 " + refreshed.size + " 项。未取到 " + missed.length + " 项的近期数据，保留可用快照。" : "本次未取到在线报价，保留可用快照。")
      : "最新可得行情 · 报价可能延迟";
  } finally {
    waiting = false;
    by("refresh").disabled = false;
  }
}

by("ticker-filter").addEventListener("input",renderWorld);
by("refresh").addEventListener("click",refreshWorld);
by("edit-watchlist").addEventListener("click",()=>{
  by("watch-input").value = (ownWatch ?? (portfolioRows.length ? [] : defaultWatch)).map(([key,name])=>key+", "+name).join("\n");
  by("watch-error").textContent = "";
  by("watch-dialog").showModal();
});
by("watch-form").addEventListener("submit",event=>{
  event.preventDefault();
  const next = by("watch-input").value.split(/\r?\n/).filter(line=>line.trim()).map(line=>{
    const [key,...label] = line.split(/[,，]/);
    return [key.trim().toUpperCase(),label.join(",").trim().slice(0,70) || key.trim()];
  });
  if (next.length > 24 || next.some(([key])=>!tickerPattern.test(key))) {
    by("watch-error").textContent = "请检查代码格式，自选最多 24 项。";
    return;
  }
  ownWatch = [...new Map(next)];
  const saved = localWrite(storageKeys.watch,ownWatch);
  by("watch-dialog").close();
  renderWorld();
  refreshWorld();
  if (!saved) by("world-status").textContent = "浏览器未允许保存自选，本次会话可用。";
});
window.addEventListener("storage",event=>{
  if (event.key === storageKeys.portfolio || event.key === storageKeys.watch) {
    portfolioRows = localRead(storageKeys.portfolio,{}).positions || [];
    ownWatch = localRead(storageKeys.watch,null);
    renderWorld();
    refreshWorld();
  }
});
renderWorld();
refreshWorld();
setInterval(()=>{ if (!document.hidden) refreshWorld(); },120000);
