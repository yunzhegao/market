"use strict";

const worldRegions = [
  ["north","北美",["US","CA"]],
  ["europe","欧洲",["GB","DE","FR","CH","ES","IT","NL","BE","SE","NO","DK","FI","AT","IE","PL","PT","GR","IS"]],
  ["east","日韩与台湾",["JP","KR","TW"]],
  ["china","中国内地与香港",["CN","HK","MO"]],
  ["latin","拉美",["MX","BR","AR","CL","PE","CO"]],
  ["south","南亚与东南亚",["SG","IN","ID","MY","TH","VN","PH"]],
  ["middle-east","中东",["SA","IL"]],
  ["africa","非洲",["ZA","EG"]],
  ["russia","俄罗斯",["RU"]],
  ["oceania","大洋洲",["AU","NZ"]],
];

// Each venue is pinned at the same projection as the dotted land and country paths.
const venues = [
  ["US","纽约",-74.01,40.71,[["^GSPC","标普 500"],["^IXIC","纳斯达克综合"],["^DJI","道琼斯"],["^RUT","罗素 2000"]]],
  ["GB","伦敦",-.10,51.51,[["^FTSE","富时 100"]]],
  ["DE","法兰克福",8.68,50.11,[["^GDAXI","德国 DAX"],["^STOXX50E","欧洲斯托克 50"]]],
  ["JP","东京",139.78,35.68,[["^N225","日经 225"]]],
  ["CN","上海",121.51,31.23,[["000001.SS","上证指数"],["000300.SS","沪深 300"]]],
  ["HK","香港",114.16,22.28,[["^HSI","恒生指数"],["HSTECH.HK","恒生科技"],["^HSCE","恒生国企"]]],
  ["SG","新加坡",103.85,1.28,[["^STI","新加坡海峡时报","新加坡 STI"]]],
  ["FR","巴黎",2.34,48.87,[["^FCHI","法国 CAC 40","法国 CAC"]]],
  ["KR","首尔",126.93,37.52,[["^KS11","韩国 KOSPI","韩国 KOSPI"]]],
  ["AU","悉尼",151.21,-33.87,[["^AXJO","澳洲 ASX 200","ASX 200"]]],
  ["IN","孟买",72.84,19.06,[["^NSEI","印度 Nifty 50","印度 Nifty"]]],
  ["BR","圣保罗",-46.63,-23.55,[["^BVSP","巴西 Bovespa","巴西 Bovespa"]]],
  ["CA","多伦多",-79.38,43.65,[["^GSPTSE","加拿大 TSX"]]],
  ["MX","墨西哥城",-99.16,19.43,[["^MXX","墨西哥 IPC"]]],
  ["CH","苏黎世",8.53,47.37,[["^SSMI","瑞士 SMI"]]],
  ["ES","马德里",-3.69,40.42,[["^IBEX","西班牙 IBEX"]]],
  ["TW","台北",121.56,25.03,[["^TWII","台湾加权"]]],
  ["CN","深圳",114.05,22.54,[["399001.SZ","深证成指"]]],
  ["AR","布宜诺斯艾利斯",-58.37,-34.60,[["^MERV","阿根廷 MERVAL","阿根廷 MERVAL"]]],
  ["ID","雅加达",106.81,-6.22,[["^JKSE","印尼雅加达综合","印尼综合"]]],
  ["SA","利雅得",46.68,24.69,[["^TASI.SR","沙特 Tadawul"]]],
  ["ZA","约翰内斯堡",28.05,-26.10,[["^J203.JO","南非 FTSE/JSE 全股","南非全股"]]],
  ["EG","开罗",31.24,30.05,[["^CASE30","埃及 EGX 30"]]],
  ["RU","莫斯科",37.61,55.76,[["IMOEX","俄罗斯 MOEX"]]],
  ["NZ","惠灵顿",174.78,-41.29,[["^NZ50","新西兰 NZX 50","NZX 50"]]],
];

const listingCountries = {
  TO:"CA",V:"CA",NE:"CA",MX:"MX",L:"GB",DE:"DE",F:"DE",PA:"FR",SW:"CH",MI:"IT",AS:"NL",BR:"BE",MC:"ES",
  ST:"SE",OL:"NO",CO:"DK",HE:"FI",VI:"AT",IR:"IE",WA:"PL",LS:"PT",AT:"GR",IS:"TR",
  T:"JP",KS:"KR",KQ:"KR",TW:"TW",TWO:"TW",HK:"HK",SS:"CN",SZ:"CN",BJ:"CN",
  SA:"BR",BA:"AR",SN:"CL",LM:"PE",CL:"CO",SI:"SG",JK:"ID",KL:"MY",BK:"TH",VN:"VN",NS:"IN",BO:"IN",
  SR:"SA",PS:"PH",AX:"AU",NZ:"NZ",TA:"IL",JO:"ZA",ME:"RU",CA:"EG",
};
const countriesByZone = {
  "America/New_York":"US","America/Chicago":"US","America/Los_Angeles":"US","America/Toronto":"CA","America/Vancouver":"CA",
  "Europe/London":"GB","Europe/Berlin":"DE","Europe/Paris":"FR","Europe/Zurich":"CH","Europe/Madrid":"ES",
  "Asia/Singapore":"SG","Asia/Hong_Kong":"HK","Asia/Shanghai":"CN","Asia/Tokyo":"JP","Asia/Seoul":"KR","Asia/Taipei":"TW",
  "Asia/Kolkata":"IN","Asia/Kuala_Lumpur":"MY","Asia/Bangkok":"TH","Asia/Jakarta":"ID","Asia/Manila":"PH",
  "Africa/Cairo":"EG","Africa/Johannesburg":"ZA","Europe/Moscow":"RU","Australia/Sydney":"AU","Pacific/Auckland":"NZ",
};
const portfolioOnly = new Set(["USD","SGD","HKD","EUR","JPY","CNY","CNH","BOXX","SGOV","BIL","SHV","USFR","TFLO","TLT","IEF","SHY","BND","AGG","GLDM","GLD","IAU","SLV","DXY","DX-Y.NYB","BTC-USD","ETH-USD"]);
const nonEquityBuckets = new Set(["cash","reserve","gold","duration"]);
const indexRows = venues.flatMap(([country,city,,,indices])=>indices.map(([symbol,name,label])=>({symbol,name,label:label??name,country,city})));
const indexColumns = [[],[]];
const columnLengths = [0,0];
for (const [id,name,countries] of worldRegions) {
  const rows=indexRows.filter(row=>countries.includes(row.country));
  if (!rows.length) continue;
  const column=columnLengths[0]<=columnLengths[1]?0:1;
  indexColumns[column].push({id,name,rows});
  columnLengths[column]+=rows.length+1;
}
const overviewSymbols = [
  "^GSPC","^IXIC","^FTSE","^GDAXI","000001.SS","^HSI","^N225","^KS11","^STI","^NSEI","^AXJO","^BVSP","^J203.JO","^CASE30","IMOEX",
];
const overviewIndices = overviewSymbols.map(symbol=>indexRows.find(row=>row.symbol===symbol));
const crossGroups = [
  ["world-cross-futures",[["ES=F","标普 500 期货"],["NQ=F","纳指 100 期货"]]],
  ["world-cross-commodities",[["GC=F","黄金期货"],["CL=F","WTI 原油期货"]]],
  ["world-cross-yields",[["DGS2","2 年期"],["DGS10","10 年期"]]],
];
const fxLegs = {EUR:"EURUSD=X",SGD:"USDSGD=X",CNH:"USDCNH=X",HKD:"USDHKD=X"};
const fxNames = {EUR:"欧元",SGD:"新加坡元",CNH:"离岸人民币",USD:"美元",HKD:"港元"};
const fxReferenceKey = "market-world-fx-reference";
const fxReferenceButtons = document.querySelectorAll("[data-fx-reference]");
let fxReference = localRead(fxReferenceKey,"USD")==="HKD" ? "HKD" : "USD";
const convertedFx = new Map();
const crossSymbols = crossGroups.slice(0,-1).flatMap(([,rows])=>rows.map(([symbol])=>symbol))
  .concat("DX-Y.NYB",Object.values(fxLegs));
const treasurySymbols = new Set(crossGroups.at(-1)[1].map(([symbol])=>symbol));
const regionNames = new Intl.DisplayNames(["zh-CN"],{type:"region"});
const snapshotQuotes = window.WORLD_SNAPSHOT?.quotes ?? {};
const quotes = {...snapshotQuotes};
const yields = {...window.WORLD_SNAPSHOT?.yields};
const fresh = new Set();
const adrCacheKey = "market-adr-listings-v1";
const adrTicker = /^[A-Z][A-Z0-9.-]{0,14}$/;
const issuerAdrReferences = globalThis.MARKET_ADR_REFERENCE ?? {};
const adrReferences = new Map(Object.entries(localRead(adrCacheKey,{})).flatMap(([symbol,reading])=>{
  const markets=validAdrMarkets(reading?.markets);
  return adrTicker.test(symbol)&&markets.length
    ? [[symbol,{isAdr:true,markets,checkAfter:fnum(reading.checkAfter)?reading.checkAfter:0}]] : [];
}));
let resolvingAdr = false;
const fourDays = 4 * 86400000;
let portfolioRows = readPortfolioBook()?.positions ?? [];
let watchPortfolioRequest = 0;
let waiting = false;
let refreshQueued = false;

function stockSymbol(symbol) {
  return tickerPattern.test(symbol) && !symbol.includes("=") && !/-(USD|EUR|USDT)$/.test(symbol) && !portfolioOnly.has(symbol);
}

function listingCountry(symbol, reading) {
  const parsed = symbol.includes(".") ? listingCountries[symbol.split(".").at(-1)] : null;
  return parsed ?? countriesByZone[reading?.timezone]
    ?? (!symbol.includes(".") || /^[A-Z]{1,6}\.[A-Z]$/.test(symbol) ? "US" : null);
}

function countryName(country) {
  return ({CN:"中国内地",HK:"香港",TW:"台湾"})[country] ?? regionNames.of(country);
}

function validAdrMarkets(markets) {
  return Array.isArray(markets)?markets.filter(row=>row&&typeof row.country==="string"&&/^[A-Z]{2}$/.test(row.country)
    && typeof row.symbol==="string"&&tickerPattern.test(row.symbol)):[];
}

function mergeAdrMarkets(...listings) {
  const markets=new Map();
  for (const {country,symbol} of listings.flat()) {
    if (!markets.has(country)) markets.set(country,{country,symbol});
  }
  return [...markets.values()];
}

function holdingAdr(symbol) {
  const saved=adrReferences.get(symbol);
  const issuer=Object.hasOwn(issuerAdrReferences,symbol)?issuerAdrReferences[symbol]:null;
  return {isAdr:Boolean(issuer||saved?.isAdr),markets:mergeAdrMarkets(issuer?.markets??[],saved?.markets??[])};
}

function heldRows() {
  const rows = new Map();
  for (const {symbol,name,kind,bucket,quantity,price} of portfolioRows) {
    if (!["stock","etf"].includes(kind) || nonEquityBuckets.has(bucket) || !(quantity > 0) || !stockSymbol(symbol)) continue;
    const country=listingCountry(symbol,quotes[symbol]);
    const adr=holdingAdr(symbol);
    rows.set(symbol,{symbol,name:name || symbol,kind,country,held:true,localPrice:fnum(price)?price:null,
      isAdr:adr.isAdr,adrMarkets:adr.markets});
  }
  return [...rows.values()];
}

function moveOf(reading) {
  const value=reading?.previous>0 && fnum(reading.price) ? (reading.price/reading.previous-1)*100 : NaN;
  return Math.abs(value)<.005 ? 0 : value;
}

function quoteIsStale(reading, now = Date.now()) {
  const stamp=reading?.time ?? Date.parse(reading?.observationDate);
  return fnum(stamp) && now-stamp>fourDays;
}

const changeLabel = (reading, move) => quoteIsStale(reading) ? "报价过期" : pctText(move);

function sourceUrl(symbol) {
  if (symbol==="IMOEX") return quotes[symbol]?.source==="investing" ? "https://www.investing.com/indices/mcx-historical-data" : "https://www.moex.com/en/index/IMOEX";
  if (treasurySymbols.has(symbol)) return yields[symbol]?.source==="treasury"
    ? "https://home.treasury.gov/resource-center/data-chart-center/interest-rates" : "https://fred.stlouisfed.org/series/"+symbol;
  return "https://finance.yahoo.com/quote/"+encodeURIComponent(symbol)+"/";}

function displaySymbol(symbol) {return symbol.replaceAll("^","");}

const globe = by("globe-map");
const globeHighlight = by("globe-highlight");
const globePins = by("globe-pins");
const globeAreas = by("globe-areas");
const globePopup = by("globe-popup");
let activeMarket = null;
let marketPinned = false;
let hideMarketTimer;
let pointerPosition;
let dismissedAt;

const globeProjection = {centerX:500,centerLongitude:worldLandGrid.centerLongitude ?? 0,equatorY:218,longitudeScale:2.66,latitudeScale:2.39};
function globePoint(lon,lat) {
  const {centerX,centerLongitude,equatorY,longitudeScale,latitudeScale}=globeProjection;
  const offset=lon-centerLongitude;
  const longitude=Math.abs(offset)<=180 ? offset : ((offset+180)%360+360)%360-180;
  return [centerX+longitude*longitudeScale,equatorY-lat*latitudeScale];
}

const {step:landDotStep,radius:landDotRadius}=worldLandGrid;
const landDotArcs = "a"+landDotRadius+","+landDotRadius+" 0 1,0 "+(2*landDotRadius)+",0"
  +"a"+landDotRadius+","+landDotRadius+" 0 1,0 "+(-2*landDotRadius)+",0Z";
const landDotRows = worldLandGrid.rows.map((columns,row)=>columns.map(column=>{
  const x=Number(((column+.5)*landDotStep).toFixed(2));
  const y=Number(((row+.5)*landDotStep).toFixed(2));
  const latitude=(globeProjection.equatorY-y)/globeProjection.latitudeScale*degreesToRadians;
  return {x,y,sinLatitude:Math.sin(latitude),cosLatitude:Math.cos(latitude),
    longitude:(globeProjection.centerLongitude+(x-globeProjection.centerX)/globeProjection.longitudeScale)*degreesToRadians,
    path:"M"+(x-landDotRadius).toFixed(2)+","+y.toFixed(2)+landDotArcs};
}));
const landDots = landDotRows.flat();
const countryLandDots = new Map();
const usedMarkerDots = new Set();

function dotsInCountry(country) {
  if (countryLandDots.has(country)) return countryLandDots.get(country);
  const outline=worldCountryPaths[country];
  if (!outline) return [];
  const edges=outline.split("Z").filter(Boolean).flatMap(ring=>{
    const vertices=Array.from(ring.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g),([,x,y])=>[Number(x),Number(y)]);
    return vertices.map((point,i)=>[point,vertices[(i+1)%vertices.length]]);
  });
  const dots=landDotRows.flatMap(row=>{
    if (!row.length) return [];
    const {y}=row[0];
    const crossings=[];
    for (const [[x1,y1],[x2,y2]] of edges) {
      if ((y1>y)!==(y2>y)) crossings.push(x1+(y-y1)*(x2-x1)/(y2-y1));
    }
    crossings.sort((a,b)=>a-b);
    let crossed=0;
    return row.filter(dot=>{
      while (crossed<crossings.length && crossings[crossed]<=dot.x) crossed++;
      return crossed%2===1;
    });
  });
  countryLandDots.set(country,dots);
  return dots;
}

function snapMarketDot(country,lon,lat) {
  const [x,y]=globePoint(lon,lat);
  const nearest = dots=>{
    let distance=Infinity, closest;
    for (const dot of dots) {
      if (usedMarkerDots.has(dot)) continue;
      const next=(x-dot.x)**2+(y-dot.y)**2;
      if (next<distance) {distance=next;closest=dot;}
    }
    return {dot:closest,distance};
  };
  const local=nearest(dotsInCountry(country));
  const dot=local.distance<=(2*landDotStep)**2 ? local.dot : nearest(landDots).dot;
  usedMarkerDots.add(dot);
  return dot;
}

const mapMarkers = venues.map(([country,city,lon,lat,indices])=>{
  const [symbol,name,short] = indices[0];
  const dot = snapMarketDot(country,lon,lat);
  const {x,y} = dot;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "globe-pin";
  button.dataset.country = country;
  button.dataset.city = city;
  button.setAttribute("aria-controls","globe-popup");
  button.setAttribute("aria-expanded","false");
  button.style.left=x/10+"%";
  button.style.top=y/3.9+"%";
  button.innerHTML='<i aria-hidden="true"></i><span class="globe-label" aria-hidden="true"><span>'+esc(short??name)
    +'</span><strong></strong></span>';
  globePins.append(button);
  return {button,dot,x,y,symbol,name,label:button.querySelector(".globe-label"),value:button.querySelector("strong")};
});

const mapAreas = new Map(Object.entries(worldCountryPaths).map(([country,d])=>{
  const path = document.createElementNS("http://www.w3.org/2000/svg","path");
  path.dataset.country=country;
  path.setAttribute("d",d);
  globeAreas.append(path);
  return [country,path];
}));

function layoutGlobeLabels() {
  const width=globe.clientWidth, height=globe.clientHeight;
  if (!width||!height) return;
  const points=mapMarkers.map(({x,y})=>[x*width/1000,y*height/390]);
  const placed=points.map(([x,y])=>({left:x-5,top:y-5,right:x+5,bottom:y+5}));
  mapMarkers.forEach(({label},i)=>{
    const [x,y]=points[i];
    label.hidden=false;
    const w=label.offsetWidth, h=label.offsetHeight, gap=8;
    const candidates=[[gap,-h/2],[-w-gap,-h/2],[-w/2,-h-gap],[-w/2,gap],
      [gap,-h-gap],[-w-gap,-h-gap],[gap,gap],[-w-gap,gap]];
    const offset=candidates.find(([dx,dy])=>{
      const l=x+dx,t=y+dy,r=l+w,b=t+h;
      return l>=0&&t>=0&&r<=width&&b<=height&&placed.every(p=>r+3<=p.left||l>=p.right+3||b+2<=p.top||t>=p.bottom+2);
    });
    if (!offset) {label.hidden=true;return;}
    const [dx,dy]=offset;
    label.style.setProperty("--label-x",dx+"px");
    label.style.setProperty("--label-y",dy+"px");
    placed.push({left:x+dx,top:y+dy,right:x+dx+w,bottom:y+dy+h});
  });
}

function panelQuoteLink(name,symbol,country,now,kind="") {
  const reading=quotes[symbol];
  const move=moveOf(reading);
  const stale=quoteIsStale(reading);
  const stamp=reading?quoteStamp(reading,marketQuoteSession(country,symbol,now)):"";
  const source=reading?stamp+(fresh.has(symbol)?"":" · 最近可用"):"暂无在线报价";
  return '<a data-quote-symbol="'+esc(symbol)+'"'+(kind==='holding'?' class="globe-adr-link"':'')+' href="'+sourceUrl(symbol)
    +'" target="_blank" rel="noopener noreferrer" title="'+esc(source)+'">'
    +'<span>'+esc(kind==='holding'?"持有 ADR":name)+'<small>'+esc(displaySymbol(symbol))+(kind==='ADR'?' · ADR':'')+'</small>'
    +(reading?'<small class="globe-quote-detail">'+esc(fmt(reading.price)+" · "+stamp)+'</small>':"")+'</span>'
    +'<strong class="'+(stale?'market-stale':tone(move))+'">'+changeLabel(reading,move)+'</strong></a>';
}

function marketPanelRows(title,rows,country,now) {
  return '<section class="globe-market-group"><h3>'+title+'</h3>'+rows.map(row=>{
    const local=row.adrMarkets?.find(market=>market.country===country&&country!==row.country);
    if (local) return panelQuoteLink(row.name,local.symbol,local.country,now)+panelQuoteLink(row.name,row.symbol,row.country,now,"holding");
    return panelQuoteLink(row.name,row.symbol,row.country,now,row.isAdr?"ADR":"");
  }).join("")+'</section>';
}

function positionMarketPanel() {
  if (globePopup.hidden||!activeMarket) return;
  const box=globe.getBoundingClientRect();
  const {width,height}=globePopup.getBoundingClientRect();
  const x=activeMarket.x*box.width, y=activeMarket.y*box.height;
  const left=x<=box.width/2 ? x+12 : x-12-width;
  globePopup.style.left=Math.max(0,Math.min(left,box.width-width))+"px";
  globePopup.style.top=Math.max(0,Math.min(y-20,box.height-height))+"px";
}

function mapVenueStatus(country,symbol,now) {
  const reading = quotes[symbol];
  return globeMarketStatus(country,reading,now,Boolean(reading && reading!==snapshotQuotes[symbol]));
}

function renderMarketPanel(holdings, now = Date.now()) {
  if (!activeMarket) return;
  const {country,city}=activeMarket;
  const indices=indexRows.filter(row=>row.country===country);
  const stocks=holdings.filter(row=>row.country===country||row.adrMarkets.some(market=>market.country===country));
  if (!indices.length&&!stocks.length) {closeMarketPanel();return;}
  const name=countryName(country);
  by("globe-popup-title").textContent=city&&city!==name ? name+" · "+city : name;
  const primary = indices.find(row=>row.city===city) ?? indices[0] ?? stocks.find(row=>row.country===country)
    ?? stocks.flatMap(row=>row.adrMarkets).find(market=>market.country===country);
  const timing = mapVenueStatus(country,primary?.symbol,now);
  by("globe-popup-session").textContent = (timing.clock ? "当地 "+timing.clock+" · " : "")+timing.label;
  const contents=by("globe-popup-rows");
  const markup=(indices.length?marketPanelRows("当地指数",indices,country,now):"")
    +(stocks.length?marketPanelRows("我的持仓",stocks,country,now):'<p class="work-note">该市场暂无持仓</p>');
  if (activeMarket.markup!==markup) {
    const focused=contents.contains(document.activeElement) ? document.activeElement.dataset.quoteSymbol : null;
    contents.innerHTML=markup;
    activeMarket.markup=markup;
    if (focused) [...contents.querySelectorAll("[data-quote-symbol]")]
      .find(link=>link.dataset.quoteSymbol===focused)?.focus({preventScroll:true});
  }
  globePopup.hidden=false;
  positionMarketPanel();
}

function closeMarketPanel(restoreFocus=false) {
  clearTimeout(hideMarketTimer);
  if (!activeMarket) return;
  const {marker}=activeMarket;
  activeMarket=null;
  marketPinned=false;
  globeHighlight.removeAttribute("d");
  marker?.setAttribute("aria-expanded","false");
  if (restoreFocus&&!globePopup.hidden) marker?.focus({preventScroll:true});
  globePopup.hidden=true;
}

function dismissMarketPanel(restoreFocus, event) {
  dismissedAt = event?.type==="click" && event.detail ? [event.clientX,event.clientY] : pointerPosition;
  closeMarketPanel(restoreFocus);
}

function openMarketPanel(target,event,pinned=false) {
  clearTimeout(hideMarketTimer);
  const {country,city}=target.dataset;
  const button=target.matches("button")?target:null;
  if (pinned&&marketPinned&&activeMarket?.button===button&&activeMarket?.country===country) {
    dismissMarketPanel(false,event);
    return;
  }
  if (activeMarket?.country===country&&activeMarket.button===button&&!pinned) return;
  const box=globe.getBoundingClientRect();
  if (!box.width||!box.height) return;
  const at=button?.getBoundingClientRect();
  closeMarketPanel();
  const selected=mapMarkers.find(item=>button ? item.button===button : item.button.dataset.country===country);
  const marker=selected?.button;
  activeMarket={country,city,button,marker,
    x:((at?at.left+at.width/2:event.clientX)-box.left)/box.width,
    y:((at?at.top+at.height/2:event.clientY)-box.top)/box.height};
  marketPinned=pinned;
  const highlighted = new Set(dotsInCountry(country));
  if (selected) highlighted.add(selected.dot);
  globeHighlight.setAttribute("d",[...highlighted].map(dot=>dot.path).join(""));
  marker?.setAttribute("aria-expanded","true");
  renderMarketPanel(heldRows());
}

function deferMarketClose() {
  clearTimeout(hideMarketTimer);
  if (!marketPinned) hideMarketTimer=setTimeout(()=>{
    if (!globePopup.contains(document.activeElement)) closeMarketPanel();
  },190);
}

function hoverMarket(event) {
  if (event.pointerType==="touch"||marketPinned||dismissedAt) return;
  if (globePopup.contains(event.target)) {clearTimeout(hideMarketTimer);return;}
  const target=event.target.closest("[data-country]");
  if (target) {
    if (activeMarket?.country===target.dataset.country&&!target.matches("button")) {
      clearTimeout(hideMarketTimer);
      return;
    }
    openMarketPanel(target,event);
  } else deferMarketClose();
}
globe.addEventListener("pointerover",hoverMarket);
globe.addEventListener("pointermove",event=>{
  if (event.pointerType==="touch") return;
  pointerPosition=[event.clientX,event.clientY];
  if (!dismissedAt||Math.hypot(event.clientX-dismissedAt[0],event.clientY-dismissedAt[1])<8) return;
  dismissedAt=null;
  hoverMarket(event);
});
globe.addEventListener("pointerleave",deferMarketClose);
globe.addEventListener("focusin",event=>{
  clearTimeout(hideMarketTimer);
  if (event.target.matches(".globe-pin")&&!globePopup.contains(event.relatedTarget)) openMarketPanel(event.target,event);
});
globe.addEventListener("focusout",event=>{
  if (!globe.contains(event.relatedTarget)) deferMarketClose();
});
globe.addEventListener("click",event=>{
  const target=event.target.closest("[data-country]");
  if (target) {
    dismissedAt=null;
    openMarketPanel(target,event,true);
    if (event.detail===0&&!globePopup.hidden) by("globe-popup-close").focus();
  }
});
by("globe-popup-close").addEventListener("click",event=>dismissMarketPanel(true,event));
document.addEventListener("pointerdown",event=>{if (!globe.contains(event.target)) closeMarketPanel();});
document.addEventListener("keydown",event=>{if (event.key==="Escape"&&activeMarket) dismissMarketPanel(globePopup.contains(document.activeElement),event);});
new ResizeObserver(()=>{layoutGlobeLabels();positionMarketPanel();}).observe(globe);
document.fonts.ready.then(layoutGlobeLabels);

function renderGlobeLighting(now) {
  const solar=globeSolarPosition(now);
  const sinSun=Math.sin(solar.declination), cosSun=Math.cos(solar.declination);
  const sunLongitude=solar.longitude*degreesToRadians;
  const day=[],night=[];
  for (const dot of landDots) {
    const light=dot.sinLatitude*sinSun+dot.cosLatitude*cosSun*Math.cos(dot.longitude-sunLongitude);
    (light<0?night:day).push(dot.path);
  }
  by("globe-day").setAttribute("d",day.join(""));
  by("globe-night").setAttribute("d",night.join(""));
  by("globe-terminator").setAttribute("d",globeTerminatorPath(solar,globePoint,globeProjection.centerLongitude));
}

function renderGlobe(holdings) {
  const now=Date.now();
  renderGlobeLighting(now);
  const countries=new Set(indexRows.concat(holdings).map(row=>row.country));
  for (const row of holdings) for (const market of row.adrMarkets) countries.add(market.country);
  for (const [country,path] of mapAreas) path.classList.toggle("globe-market-area",countries.has(country));
  for (const {symbol,name,button,value} of mapMarkers) {
    const reading=quotes[symbol];
    const move=moveOf(reading);
    const stale=quoteIsStale(reading);
    const change=changeLabel(reading,move);
    const {country}=button.dataset;
    const timing=mapVenueStatus(country,symbol,now);
    button.dataset.marketState=timing.state;
    button.classList.toggle("up",!stale&&move>0);
    button.classList.toggle("down",!stale&&move<0);
    button.classList.toggle("market-stale",stale);
    button.setAttribute("aria-label",[button.dataset.city,name,timing.label,change,"查看当地指数与持仓"].join(" · "));
    value.textContent=change;
  }
  layoutGlobeLabels();
  renderMarketPanel(holdings,now);
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

function marketQuoteSession(country, symbol, now = Date.now()) {
  const reading = quotes[symbol];
  if (!reading || quoteIsStale(reading,now)) return "";
  const zone = reading.timezone || globeMarketHours[country]?.zone;
  const today = globeMarketTime(now,zone)?.date;
  if (reading.observationDate) return reading.observationDate === today ? "已收盘" : "前收";
  const quote = globeMarketTime(reading.time,zone);
  if (!today || !quote) return "时段待确认";
  if (quote.date!==today) {
    if (reading.session === "pre" || reading.session === "post") return "上次报价";
    const end = globeMarketTime(reading.sessionEnd-60000,zone);
    return end && quote.minutes>=end.minutes ? "前收" : "上次报价";
  }
  if (reading.session === "pre") return "盘前";
  if (reading.session === "post") return "盘后";
  const timing = mapVenueStatus(country,symbol,now);
  if (timing.state!=="open") return timing.label;
  const minutes = Math.floor((now-reading.time)/60000);
  const delay = minutes >= 15 ? minutes : reading.delayMinutes;
  return delay > 0 ? "盘中·延迟"+delay+"分" : "盘中";
}

function marketRow({symbol,name,label=name,country,held,localPrice,isAdr,adrMarkets=[]}, overview = false) {
  const reading=quotes[symbol];
  const move=moveOf(reading);
  const time=reading?(reading.observationDate?.slice(5).replace("-","/")??timeAt(reading.time,reading.timezone)):fnum(localPrice)?"手动价":"暂无报价";
  const stale=quoteIsStale(reading);
  const session=marketQuoteSession(country,symbol);
  const source=reading?quoteStamp(reading,session):time;
  const status=reading?(stale?" · 报价过期":!fresh.has(symbol)?" · 最近可用":""):"";
  const markets=adrMarkets.length?" · 原股 "+adrMarkets.map(market=>countryName(market.country)).join(" / "):"";
  const link = '<a class="market-line" href="'+sourceUrl(symbol)+'" target="_blank" rel="noopener noreferrer" title="'+esc(name+" "+displaySymbol(symbol)+" · "+source+status+markets)+'">';
  const price = '<div class="market-number"><strong>'+fmt(reading?.price??localPrice)+'</strong></div>';
  const change = '<strong class="'+(stale?'market-stale':tone(move))+'">'+changeLabel(reading,move)+'</strong>';
  if (overview) {
    return link+'<div class="market-name"><span>'+esc(label)+'</span></div>'+price
      +'<div class="market-number">'+change+'</div><small class="overview-quote-status">'+esc(session)+'</small>'
      +'<small class="overview-quote-time">'+esc(time)+'</small></a>';
  }
  return link+'<div class="market-name"><span>'+esc(name)+'</span><small>'+esc(displaySymbol(symbol))+(isAdr?' · ADR':held?' · 持仓':'')
    +(session?' · '+esc(session):'')+esc(markets)+'</small></div>'
    +marketSpark(stale?null:reading?.spark,tone(move))
    +price+'<div class="market-number">'+change+'<small>'+esc(time)+'</small></div></a>';
}

function latestYield(symbol) {
  return dailyObservation(yields[symbol]);
}

function crossQuote([symbol,name], fxReading = null) {
  const calculated = !symbol;
  const isYield=treasurySymbols.has(symbol);
  const daily=isYield?latestYield(symbol):null;
  const reading=isYield?(daily && {observationDate:daily.date,price:daily.value}):calculated?fxReading:quotes[symbol];
  const move=isYield?daily?.move:moveOf(reading);
  const price=fmt(reading?.price,calculated||symbol.endsWith("=X")?4:2)+(isYield&&reading?"%":"");
  const meta=isYield?observationMeta(daily):null;
  const stamp=reading&&!isYield?(calculated?"换算 · ":"")+quoteStamp(reading):"暂无报价";
  const stale=quoteIsStale(reading);
  const change=isYield ? observationBasisPoints(daily) : changeLabel(reading,move);
  const tag=calculated?"div":"a";
  const attributes=calculated?' title="使用实际美元汇率交叉换算，时间取较早的一笔"'
    :' href="'+sourceUrl(symbol)+'" target="_blank" rel="noopener noreferrer"';
  return '<'+tag+' class="world-cross-quote"'+attributes+'>'
    +'<span>'+esc(name)+'</span><strong>'+price+'</strong>'
    +(meta?'':'<small>'+esc(stamp)+'</small>')
    +'<b class="'+(!isYield&&stale?'market-stale':tone(move))+'">'+change+'</b>'
    +(meta?'<small class="world-yield-meta" title="'+esc(meta.full)+'">'+esc(meta.short)+(stale?' · 沿用':'')+'</small>':'')+'</'+tag+'>';
}

function fxCrossRate(base, counter, readings) {
  const leg = currency => {
    if (currency === "USD") return {price:1,previous:1};
    const reading = readings[fxLegs[currency]];
    if (!fnum(reading?.price) || reading.price<=0 || !fnum(reading.time)) return null;
    return currency === "EUR"
      ? {...reading,price:1/reading.price,previous:reading.previous>0 ? 1/reading.previous : null}
      : reading;
  };
  const from = leg(base), to = leg(counter);
  if (!from || !to) return null;
  if (fnum(from.time) && fnum(to.time) && Math.abs(from.time-to.time)>15*60000) return null;
  const earliest = !fnum(to.time) || from.time<to.time ? from : to;
  return {price:to.price/from.price,previous:from.previous>0&&to.previous>0 ? to.previous/from.previous : null,
    time:earliest.time,timezone:earliest.timezone};
}

function renderCrossFx() {
  const pairs = [[fxReference,"CNH"],["EUR","CNH"],["SGD","CNH"],["SGD",fxReference]];
  const [reference,...crosses] = pairs.map(([base,counter])=>{
    const name = fxNames[base]+"／"+fxNames[counter];
    if (base === "USD") return crossQuote([fxLegs[counter],name]);
    const key = base+counter;
    const reading = fxCrossRate(base,counter,quotes);
    if (reading) convertedFx.set(key,reading);
    return crossQuote([null,name],convertedFx.get(key) ?? fxCrossRate(base,counter,snapshotQuotes));
  });
  by("world-fx-primary").innerHTML = crossQuote(["DX-Y.NYB","美元指数"])+reference;
  by("world-fx-pairs").innerHTML = crosses.join("");
  for (const button of fxReferenceButtons) button.setAttribute("aria-pressed",String(button.dataset.fxReference===fxReference));
}

async function refreshYields() {
  try {
    const {observations}=await requestMarket("world-yields");
    let updates=0;
    for (const symbol of treasurySymbols) {
      const reading=observations?.[symbol];
      const latest=dailyObservation(reading);
      if (!latest || latest.date < (latestYield(symbol)?.date || "")) continue;
      yields[symbol]=reading;
      if (!quoteIsStale({observationDate:latest.date})) updates++;
    }
    return updates;
  } catch {return 0;}
}

function regionMarkup(id,label,rows) {
  if (!rows.length) return "";
  return '<section class="market-region"'+(id?' id="'+id+'"':'')+'><h3>'+esc(label)+'</h3>'
    +'<div class="market-lines">'+rows.map(row=>marketRow(row)).join("")+'</div></section>';
}

function holdingRegionsMarkup(holdings) {
  const regions=new Map(worldRegions.map(([id,name])=>[id,{name,rows:[]}]));
  const regionByCountry=new Map(worldRegions.flatMap(([id,,countries])=>countries.map(country=>[country,id])));
  for (const row of holdings) {
    const isAdr=row.isAdr || (row.kind==="stock"&&row.country==="US"&&/\b(?:ADR|ADS)\b|美国存托/i.test(row.name));
    // The reference service returns the depositary's ordinary listing first, followed by cross-listings.
    const country=isAdr?row.adrMarkets[0]?.country:row.country;
    const id=country?(regionByCountry.get(country)??country):(isAdr?"adr-pending":"other");
    if (!regions.has(id)) {
      const name=country?countryName(country):isAdr?"原股上市地待核对":"其他上市地";
      regions.set(id,{name,rows:[]});
    }
    regions.get(id).rows.push({...row,isAdr});
  }
  return [...regions].map(([id,{name,rows}])=>regionMarkup("held-region-"+id,name,rows)).join("");
}

function renderIndexRegions() {
  const columns=indexColumns.map(regions=>regions.map(({id,name,rows})=>
    regionMarkup("world-region-"+id,name,rows.filter(matches))).join(""));
  by("regions").innerHTML=columns.some(Boolean)
    ? columns.map(content=>'<div class="index-column">'+content+'</div>').join("")
    : '<p class="work-note">没有符合条件的指数</p>';
}

function renderOverview() {
  by("overview-indices").innerHTML=overviewIndices.map(row=>marketRow(row,true)).join("");
}

function renderWorld() {
  const holdings=heldRows();
  renderGlobe(holdings);
  for (const [id,rows] of crossGroups) by(id).innerHTML=rows.map(row=>crossQuote(row)).join("");
  renderCrossFx();
  renderOverview();
  renderIndexRegions();
  by("watch-rows").innerHTML=holdingRegionsMarkup(holdings.filter(matches))
    || '<p class="work-note">没有符合条件的股票持仓</p>';
  by("watch-help").hidden=holdings.length>0||!!by("ticker-filter").value;
}

async function refreshAdrReferences(holdings) {
  if (resolvingAdr) return;
  const symbols=holdings.filter(row=>row.kind==="stock"&&row.country==="US"&&adrTicker.test(row.symbol)
    && (adrReferences.get(row.symbol)?.checkAfter ?? 0)<=Date.now()).map(row=>row.symbol);
  if (!symbols.length) return;
  resolvingAdr=true;
  let changed=false;
  let save=false;
  try {
    const batches=Array.from({length:Math.ceil(symbols.length/8)},(_,i)=>symbols.slice(i*8,i*8+8));
    await Promise.all(batches.map(async batch=>{
      const data=await requestMarket("adr",{symbols:batch.join(",")},35000).catch(()=>null);
      for (const symbol of batch) {
        const before=holdingAdr(symbol);
        const previous=adrReferences.get(symbol);
        const reading=data?.listings?.[symbol];
        const markets=reading?.isAdr===true?validAdrMarkets(reading.markets):[];
        const complete=reading?.complete===true && (markets.length>0 || (reading.isAdr===false&&!before.isAdr));
        const retained=complete&&markets.length?[]:previous?.markets??[];
        adrReferences.set(symbol,{isAdr:before.isAdr||reading?.isAdr===true,markets:mergeAdrMarkets(retained,markets),
          checkAfter:Date.now()+(complete?21600000:180000)});
        const after=holdingAdr(symbol);
        if (JSON.stringify(after)!==JSON.stringify(before)) changed=true;
        if (markets.length) save=true;
      }
    }));
  } finally {
    resolvingAdr=false;
  }
  if (save) {
    const confirmed=[...adrReferences].filter(([,reading])=>reading.markets.length);
    confirmed.sort((a,b)=>b[1].checkAfter-a[1].checkAfter);
    localWrite(adrCacheKey,Object.fromEntries(confirmed.slice(0,256)));
  }
  if (changed) {
    renderWorld();
    refreshWorld();
  }
}

async function refreshWorld() {
  if (waiting) {refreshQueued=true;return;}
  if (!hasApi) {
    renderGlobe(heldRows());
    renderOverview();
    by("world-status").textContent="当前显示随网页发布的行情快照。";
    return;
  }
  waiting=true;
  by("refresh").disabled=true;
  by("world-status").textContent="正在请求最新报价。";
  const holdings=heldRows();
  refreshAdrReferences(holdings);
  const locals=holdings.flatMap(row=>row.adrMarkets.filter(market=>mapAreas.has(market.country)).map(market=>market.symbol));
  const symbols=[...new Set(indexRows.concat(holdings).map(row=>row.symbol).concat(locals,crossSymbols))];
  const total=symbols.length+treasurySymbols.size;
  try {
    const [readings,yieldCount]=await Promise.all([latestMarketQuotes(symbols),refreshYields()]);
    let refreshed=yieldCount;
    fresh.clear();
    for (const [symbol,reading] of Object.entries(readings)) {
      if (quotes[symbol]?.time>reading.time) continue;
      quotes[symbol]=reading;
      if (quoteIsStale(reading)) continue;
      fresh.add(symbol);
      refreshed++;
    }
    renderWorld();
    if (refreshed) markRequest();
    by("world-status").textContent=refreshed===total ? "最新可得行情 · 报价可能延迟"
      : "已核对 "+refreshed+" / "+total+" 项 · 其余显示最近可用报价或缺项";
  } finally {
    waiting=false;
    by("refresh").disabled=false;
    if(refreshQueued){refreshQueued=false;refreshWorld();}
  }
}

by("ticker-filter").addEventListener("input",renderWorld);
by("refresh").addEventListener("click",refreshWorldData);
for (const button of fxReferenceButtons) button.addEventListener("click",()=>{
  fxReference=button.dataset.fxReference;
  localWrite(fxReferenceKey,fxReference);
  renderCrossFx();
});
window.addEventListener("storage",event=>{
  if(event.key!==storageKeys.portfolio)return;
  watchPortfolioRequest++;
  portfolioRows=readPortfolioBook()?.positions ?? [];
  renderWorld();
  refreshWorld();
});
async function refreshWorldData() {
  refreshWorld();
  const request = ++watchPortfolioRequest;
  try {
    const data=await requestSavedPortfolio();
    if (request!==watchPortfolioRequest || !Array.isArray(data?.portfolio?.positions)) return;
    const previous=JSON.stringify(portfolioRows);
    portfolioRows=data.portfolio.positions;
    if (JSON.stringify(portfolioRows)!==previous) {
      renderWorld();
      refreshWorld();
    }
  } catch {}
}
renderWorld();
refreshWorldData();
setInterval(()=>{if(!document.hidden)refreshWorld();},60000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)refreshWorldData();});
