"use strict";

const worldRegions = [
  {id:"north",name:"北美",location:[-75,41],label:[5,9],pinned:2,leader:["AAPL","苹果"],indices:[["^GSPC","标普 500"],["^IXIC","纳斯达克综合"],["^DJI","道琼斯"],["^RUT","罗素 2000"],["^GSPTSE","加拿大 TSX"],["^MXX","墨西哥 IPC"]]},
  {id:"europe",name:"欧洲",location:[8,49],label:[39,8],pinned:2,leader:["ASML.AS","阿斯麦"],indices:[["^STOXX50E","欧洲斯托克 50"],["^FTSE","英国富时 100"],["^GDAXI","德国 DAX"],["^FCHI","法国 CAC 40"],["^SSMI","瑞士 SMI"],["^IBEX","西班牙 IBEX"]]},
  {id:"east",name:"日韩与台湾",location:[137,38],label:[81,7],pinned:2,leader:["7203.T","丰田汽车"],indices:[["^N225","日经 225"],["^KS11","韩国 KOSPI"],["^TWII","台湾加权"]]},
  {id:"china",name:"中国内地与香港",location:[113,25],label:[58,34],pinned:2,leader:["0700.HK","腾讯"],indices:[["000001.SS","上证综指"],["^HSI","恒生指数"],["399001.SZ","深证成指"],["000300.SS","沪深 300"],["HSTECH.HK","恒生科技"],["^HSCE","恒生国企"]]},
  {id:"latin",name:"拉美",location:[-51,-15],label:[14,65],pinned:1,leader:["VALE3.SA","淡水河谷"],indices:[["^BVSP","巴西 Bovespa"],["^MERV","阿根廷 MERVAL"]]},
  {id:"south",name:"南亚与东南亚",location:[103,2],label:[59,64],pinned:1,leader:["D05.SI","星展银行"],indices:[["^STI","新加坡海峡时报"],["^NSEI","印度 Nifty 50"],["^JKSE","印尼雅加达综合"],["^TASI.SR","沙特 Tadawul"]]},
  {id:"oceania",name:"大洋洲",location:[145,-33],label:[81,67],pinned:1,leader:["BHP.AX","必和必拓"],indices:[["^AXJO","澳洲 ASX 200"],["^NZ50","新西兰 NZX 50"]]},
];

const listingSuffixes = {
  north:["TO","V","NE","MX"],
  europe:["L","DE","PA","SW","MI","AS","BR","MC","ST","OL","CO","HE","VI","IR","WA","F"],
  east:["T","KS","KQ","TW","TWO"],
  china:["HK","SS","SZ","BJ"],
  latin:["SA","BA","SN","LM","CL"],
  south:["SI","JK","KL","BK","VN","NS","BO","SR","PS","IS"],
  oceania:["AX","NZ"],
};
const defaultWatch = [["SPYM","标普 500 ETF"],["QQQM","纳指 100 ETF"]];
const portfolioOnly = new Set(["USD","SGD","HKD","EUR","JPY","CNY","CNH","BOXX","SGOV","BIL","SHV","USFR","TFLO","TLT","IEF","SHY","BND","AGG","GLDM","GLD","IAU","SLV","DXY","DX-Y.NYB","BTC-USD","ETH-USD"]);
const nonEquityBuckets = new Set(["cash","reserve","gold","duration"]);
const indexRegions = new Map(worldRegions.flatMap(region=>region.indices.map(([symbol])=>[symbol,region.id])));
const quotes = {...window.WORLD_SNAPSHOT?.quotes};
const fresh = new Set();
const fourDays = 4 * 86400000;
let ownWatch = localRead(storageKeys.watch,null);
let portfolioRows = localRead(storageKeys.portfolio,{}).positions || [];
let waiting = false;
let refreshQueued = false;

function stockSymbol(symbol) {
  return tickerPattern.test(symbol) && !symbol.includes("=") && !/-(USD|EUR|USDT)$/.test(symbol) && !portfolioOnly.has(symbol);
}

function listingRegion(symbol, reading) {
  if (indexRegions.has(symbol)) return indexRegions.get(symbol);
  const market = symbol.split(".").at(-1);
  for (const [region,suffixes] of Object.entries(listingSuffixes)) {
    if (symbol.includes(".") && suffixes.includes(market)) return region;
  }
  const zone = reading?.timezone;
  if (zone?.startsWith("Europe/")) return "europe";
  if (zone?.startsWith("Pacific/") || zone?.startsWith("Australia/")) return "oceania";
  if (zone?.startsWith("Asia/")) return "other";
  return !symbol.includes(".") || /^[A-Z]{1,6}\.[A-Z]$/.test(symbol) ? "north" : "other";
}

function watchRows() {
  const hidden = new Set(portfolioRows.filter(row=>row.kind==="cash"||nonEquityBuckets.has(row.bucket)).map(row=>row.symbol));
  const rows = new Map();
  for (const item of portfolioRows) {
    const {symbol,name,kind,bucket,quantity} = item;
    if (!["stock","etf"].includes(kind) || nonEquityBuckets.has(bucket) || !(quantity > 0) || !stockSymbol(symbol)) continue;
    rows.set(symbol,{symbol,name:name || symbol,held:true,localPrice:fnum(item.price)?item.price:null});
  }
  for (const [symbol,name] of ownWatch ?? (rows.size ? [] : defaultWatch)) {
    if (stockSymbol(symbol) && !hidden.has(symbol) && !rows.has(symbol)) rows.set(symbol,{symbol,name,held:false});
  }
  return [...rows.values()];
}

function projectMarket([lon,lat]) {
  return [500+2.6*lon*(.68+.32*Math.cos(lat*Math.PI/180)),195-1.91*lat];
}

function moveOf(reading) {
  const value=reading?.previous>0 && fnum(reading.price) ? (reading.price/reading.previous-1)*100 : NaN;
  return Math.abs(value)<.005 ? 0 : value;
}

function sourceUrl(symbol) {return "https://finance.yahoo.com/quote/"+encodeURIComponent(symbol)+"/";}

function globeReading({symbol,name,held}) {
  const quote=quotes[symbol];
  const move=moveOf(quote);
  const status=quote ? quoteStamp(quote)+(fresh.has(symbol)?"":" · 快照") : "暂无报价";
  return '<a class="globe-reading" href="'+sourceUrl(symbol)+'" target="_blank" rel="noopener noreferrer" title="'
    +esc(name+" · "+symbol+" · "+status)+'"><span>'+esc(held?symbol:name)+'</span><strong class="'+tone(move)+'">'+pctText(move)+'</strong></a>';
}

function byListing(watch,id) {
  return watch.filter(row=>listingRegion(row.symbol,quotes[row.symbol])===id&&matches(row));
}

function renderGlobe(watch) {
  const visible = [];
  for (const region of worldRegions) {
    const regional=byListing(watch,region.id);
    const indices=region.indices.map(([symbol,name])=>({symbol,name})).filter(matches);
    const [symbol,name]=region.leader;
    const leader=!regional.some(row=>row.symbol===symbol)&&matches({symbol,name})?{symbol,name}:null;
    if (indices.length||regional.length||leader) visible.push({region,regional,indices,leader});
  }
  by("globe-map").hidden=!visible.length;
  by("globe-regions").innerHTML=visible.map(({region,regional,indices,leader})=>{
    const [x,y]=region.label;
    const held=regional.filter(row=>row.held);
    const shown=held.length?held:regional;
    const limit=region.id==="north"?10:2;
    const more=shown.length-limit;
    return '<section class="globe-card globe-'+region.id+'" style="--map-x:'+x+'%;--map-y:'+y+'%">'
      +(indices.length||regional.length?'<a class="globe-region-name" href="#world-region-'+region.id+'">'+esc(region.name)+'</a>'
        :'<span class="globe-region-name">'+esc(region.name)+'</span>')
      +indices.slice(0,region.pinned).map(globeReading).join("")
      +(leader?globeReading(leader):"")
      +(shown.length?'<div class="globe-holdings"><span>'+ (held.length?'持仓':'自选') +'</span>'
        +'<div class="globe-holding-rows">'+shown.slice(0,limit).map(globeReading).join("")+'</div>'
        +(more>0?'<a href="#held-region-'+region.id+'">另有 '+more+' 项</a>':"")+'</div>':"")+'</section>';
  }).join("");
  by("globe-points").innerHTML=visible.map(({region,indices,regional,leader})=>{
    const [x,y]=projectMarket(region.location);
    const [labelX,labelY]=region.label;
    const move=moveOf(quotes[(indices[0]||regional[0]||leader)?.symbol]);
    return '<path d="M'+x.toFixed(1)+','+y.toFixed(1)+' L'+(labelX*10+36)+','+(labelY*3.9+15)+'"/>'
      +'<circle class="'+tone(move)+'" cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="4.3"/>';
  }).join("");
}

function marketSpark(values,direction) {
  const data=Array.isArray(values)?values.filter(fnum):[];
  if (data.length<2) return '<span class="market-mini-empty"></span>';
  const low=Math.min(...data), scale=Math.max(Math.max(...data)-low,.000001);
  const points=data.map((n,i)=>(i*56/(data.length-1)).toFixed(1)+","+(15-(n-low)*12/scale).toFixed(1)).join(" ");
  return '<svg viewBox="0 0 56 18" preserveAspectRatio="none" aria-hidden="true" class="market-mini '+direction
    +'"><polyline points="'+points+'" fill="none" stroke="currentColor" stroke-width="1.15" vector-effect="non-scaling-stroke"/></svg>';
}

function matches(row) {
  const needle=by("ticker-filter").value.trim().toUpperCase();
  return !needle || (row.symbol+" "+row.name).toUpperCase().includes(needle);
}

function marketRow({symbol,name,held,localPrice}) {
  const reading=quotes[symbol];
  const move=moveOf(reading);
  const time=reading?timeAt(reading.time,reading.timezone):fnum(localPrice)?"手动价":"暂无报价";
  const stale=fnum(reading?.time)&&Date.now()-reading.time>fourDays;
  const source=reading?quoteStamp(reading):time;
  const status=reading?(stale?" · 报价超过四天":!fresh.has(symbol)?" · 快照":""):"";
  return '<a class="market-line" href="'+sourceUrl(symbol)+'" target="_blank" rel="noopener noreferrer" title="'+esc(name+" "+symbol+" · "+source+status)+'">'
    +'<div class="market-name"><span>'+esc(name)+'</span><small>'+esc(symbol)+(held?' · 持仓':'')
    +(sessionNames[reading?.session]?' · '+sessionNames[reading.session]:reading?.delayMinutes?' · 延迟':'')+'</small></div>'
    +marketSpark(reading?.spark,tone(move))
    +'<div class="market-number"><strong>'+fmt(reading?.price??localPrice)+'</strong></div>'
    +'<div class="market-number"><strong class="'+tone(move)+'">'+pctText(move)+'</strong><small class="'+(stale?'market-stale':'')+'">'
    +esc(time)+'</small></div></a>';
}

function regionMarkup(id,label,rows) {
  if (!rows.length) return "";
  return '<section class="market-region"'+(id?' id="'+id+'"':'')+'><h3>'+esc(label)+'</h3>'
    +'<div class="market-lines">'+rows.map(marketRow).join("")+'</div></section>';
}

function renderWorld() {
  const watch=watchRows();
  renderGlobe(watch);
  by("regions").innerHTML=worldRegions.map(({id,name,indices})=>{
    const list=indices.map(([symbol,name])=>({symbol,name})).filter(matches);
    const regional=byListing(watch,id);
    return regionMarkup("world-region-"+id,name,list.length?list:regional);
  }).join("") || '<p class="work-note">没有符合条件的指数</p>';
  by("watch-rows").innerHTML=[...worldRegions,{id:"other",name:"其他上市地"}].map(({id,name})=>
    regionMarkup("held-region-"+id,name,byListing(watch,id))).join("")
    || '<p class="work-note">没有符合条件的持仓与自选</p>';
  by("watch-help").hidden=watch.some(row=>row.held)||!!by("ticker-filter").value;
}

async function refreshWorld() {
  if (waiting) {refreshQueued=true;return;}
  if (!hasApi) {
    by("world-status").textContent="当前显示随网页发布的行情快照。";
    return;
  }
  waiting=true;
  by("refresh").disabled=true;
  by("world-status").textContent="正在请求最新报价。";
  const symbols=[...new Set(worldRegions.flatMap(region=>[region.leader,...region.indices].map(([symbol])=>symbol)).concat(watchRows().map(row=>row.symbol)))];
  try {
    const readings=await latestMarketQuotes(symbols);
    let refreshed=0;
    for (const [symbol,reading] of Object.entries(readings)) {
      if (!(quotes[symbol]?.time>reading.time)) quotes[symbol]=reading;
      if (Date.now()-quotes[symbol].time>fourDays) continue;
      fresh.add(symbol);
      refreshed++;
    }
    renderWorld();
    if (refreshed) markRequest();
    by("world-status").textContent=refreshed===symbols.length ? "最新可得行情 · 报价可能延迟"
      : "已核对 "+refreshed+" / "+symbols.length+" 项。其余保留最后可用报价。";
  } finally {
    waiting=false;
    by("refresh").disabled=false;
    if(refreshQueued){refreshQueued=false;refreshWorld();}
  }
}

by("ticker-filter").addEventListener("input",renderWorld);
by("refresh").addEventListener("click",refreshWorld);
by("edit-watchlist").addEventListener("click",()=>{
  by("watch-input").value=(ownWatch??(portfolioRows.length?[]:defaultWatch)).filter(([key])=>stockSymbol(key)).map(([key,name])=>key+", "+name).join("\n");
  by("watch-error").textContent="";
  by("watch-dialog").showModal();
});
by("watch-form").addEventListener("submit",event=>{
  event.preventDefault();
  const next=by("watch-input").value.split(/\r?\n/).filter(line=>line.trim()).map(line=>{
    const [key,...label]=line.split(/[,，]/);
    return [key.trim().toUpperCase(),label.join(",").trim().slice(0,70)||key.trim()];
  });
  if (next.length>24||next.some(([key])=>!stockSymbol(key))) {
    by("watch-error").textContent="请填写股票、股票型 ETF 或指数代码，自选最多 24 项。";
    return;
  }
  ownWatch=[...new Map(next)];
  const saved=localWrite(storageKeys.watch,ownWatch);
  by("watch-dialog").close();
  renderWorld();
  refreshWorld();
  if (!saved) by("world-status").textContent="浏览器未允许保存自选，本次会话可用。";
});
window.addEventListener("storage",event=>{
  if(event.key!==storageKeys.portfolio&&event.key!==storageKeys.watch)return;
  portfolioRows=localRead(storageKeys.portfolio,{}).positions||[];
  ownWatch=localRead(storageKeys.watch,null);
  renderWorld();
  refreshWorld();
});
renderWorld();
refreshWorld();
setInterval(()=>{if(!document.hidden)refreshWorld();},60000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)refreshWorld();});

fetch("./api/portfolio",{cache:"no-store",signal:AbortSignal.timeout(8000)}).then(async response=>{
  if(!response.ok)return;
  const data=await response.json();
  if(!Array.isArray(data.portfolio?.positions))return;
  portfolioRows=data.portfolio.positions;
  renderWorld();
  refreshWorld();
}).catch(()=>{});
