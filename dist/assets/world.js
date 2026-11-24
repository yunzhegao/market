"use strict";

const worldRegions = [
  ["north","北美",["US","CA"]],
  ["europe","欧洲",["GB","DE","FR","CH","ES","IT","NL","BE","SE","NO","DK","FI","AT","IE","PL","PT","GR","IS"]],
  ["east","日韩与台湾",["JP","KR","TW"]],
  ["china","中国内地与香港",["CN","HK","MO"]],
  ["latin","拉美",["MX","BR","AR","CL","PE","CO"]],
  ["south","南亚与东南亚",["SG","IN","ID","SA","MY","TH","VN","PH"]],
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
const overviewSymbols = [
  "^GSPC","^IXIC","^FTSE","^GDAXI","000001.SS","^HSI","^N225","^KS11","^STI","^NSEI","^AXJO","^BVSP","^J203.JO","^CASE30","IMOEX",
];
const overviewIndices = overviewSymbols.map(symbol=>indexRows.find(row=>row.symbol===symbol));
const regionNames = new Intl.DisplayNames(["zh-CN"],{type:"region"});
const quotes = {...window.WORLD_SNAPSHOT?.quotes};
const fresh = new Set();
const adrReferences = new Map();
let resolvingAdr = false;
const fourDays = 4 * 86400000;
let portfolioRows = localRead(storageKeys.portfolio,{}).positions || [];
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

function heldRows() {
  const rows = new Map();
  for (const {symbol,name,kind,bucket,quantity,price} of portfolioRows) {
    if (!["stock","etf"].includes(kind) || nonEquityBuckets.has(bucket) || !(quantity > 0) || !stockSymbol(symbol)) continue;
    const country=listingCountry(symbol,quotes[symbol]);
    const adr=adrReferences.get(symbol);
    rows.set(symbol,{symbol,name:name || symbol,kind,country,held:true,localPrice:fnum(price)?price:null,
      isAdr:adr?.isAdr ?? false, adrMarkets:adr?.markets ?? []});
  }
  return [...rows.values()];
}

function moveOf(reading) {
  const value=reading?.previous>0 && fnum(reading.price) ? (reading.price/reading.previous-1)*100 : NaN;
  return Math.abs(value)<.005 ? 0 : value;
}

function sourceUrl(symbol) {
  if (symbol==="IMOEX") return quotes[symbol]?.source==="investing" ? "https://www.investing.com/indices/mcx-historical-data" : "https://www.moex.com/en/index/IMOEX";
  return "https://finance.yahoo.com/quote/"+encodeURIComponent(symbol)+"/";}

function displaySymbol(symbol) {return symbol.replaceAll("^","");}

const globe = by("globe-map");
const globePins = by("globe-pins");
const globeAreas = by("globe-areas");
const globePopup = by("globe-popup");
let activeMarket = null;
let marketPinned = false;
let hideMarketTimer;
let pointerPosition;
let dismissedAt;

function globePoint(lon,lat) {
  return [500+lon*2.76*(.77+.23*Math.cos(lat*Math.PI/180)),218-2.39*lat];
}

const mapMarkers = venues.map(([country,city,lon,lat,indices])=>{
  const [symbol,name,short] = indices[0];
  const [x,y] = globePoint(lon,lat);
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
  return {button,x,y,symbol,name,label:button.querySelector(".globe-label"),value:button.querySelector("strong")};
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

function panelQuoteLink(name,symbol,kind="") {
  const reading=quotes[symbol];
  const move=moveOf(reading);
  const source=reading?quoteStamp(reading)+(fresh.has(symbol)?"":" · 最近可用"):"暂无在线报价";
  return '<a'+(kind==='holding'?' class="globe-adr-link"':'')+' href="'+sourceUrl(symbol)
    +'" target="_blank" rel="noopener noreferrer" title="'+esc(source)+'">'
    +'<span>'+esc(kind==='holding'?"持有 ADR":name)+'<small>'+esc(displaySymbol(symbol))+(kind==='ADR'?' · ADR':'')+'</small></span>'
    +'<strong class="'+tone(move)+'">'+pctText(move)+'</strong></a>';
}

function marketPanelRows(title,rows,country) {
  return '<section class="globe-market-group"><h3>'+title+'</h3>'+rows.map(row=>{
    const local=row.adrMarkets?.find(market=>market.country===country&&country!==row.country);
    if (local) return panelQuoteLink(row.name,local.symbol)+panelQuoteLink(row.name,row.symbol,"holding");
    return panelQuoteLink(row.name,row.symbol,row.isAdr?"ADR":"");
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

function renderMarketPanel(holdings) {
  if (!activeMarket) return;
  const {country,city}=activeMarket;
  const indices=indexRows.filter(row=>row.country===country);
  const stocks=holdings.filter(row=>row.country===country||row.adrMarkets.some(market=>market.country===country));
  if (!indices.length&&!stocks.length) {closeMarketPanel();return;}
  const name=countryName(country);
  by("globe-popup-title").textContent=city&&city!==name ? name+" · "+city : name;
  const contents=by("globe-popup-rows");
  if (contents.dataset.country!==country||!contents.contains(document.activeElement)) {
    contents.dataset.country=country;
    contents.innerHTML=(indices.length?marketPanelRows("当地指数",indices):"")
      +(stocks.length?marketPanelRows("我的持仓",stocks,country):'<p class="work-note">该市场暂无持仓</p>');
  }
  globePopup.hidden=false;
  positionMarketPanel();
}

function closeMarketPanel(restoreFocus=false) {
  clearTimeout(hideMarketTimer);
  if (!activeMarket) return;
  const {country,button}=activeMarket;
  activeMarket=null;
  marketPinned=false;
  mapAreas.get(country)?.classList.remove("globe-active-area");
  button?.setAttribute("aria-expanded","false");
  if (restoreFocus&&!globePopup.hidden) (button??mapMarkers.find(item=>item.button.dataset.country===country)?.button)?.focus({preventScroll:true});
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
  activeMarket={country,city,button,
    x:((at?at.left+at.width/2:event.clientX)-box.left)/box.width,
    y:((at?at.top+at.height/2:event.clientY)-box.top)/box.height};
  marketPinned=pinned;
  mapAreas.get(country)?.classList.add("globe-active-area");
  button?.setAttribute("aria-expanded","true");
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

function renderGlobe(holdings) {
  const countries=new Set(indexRows.concat(holdings).map(row=>row.country));
  for (const row of holdings) for (const market of row.adrMarkets) countries.add(market.country);
  for (const [country,path] of mapAreas) path.classList.toggle("globe-market-area",countries.has(country));
  for (const {symbol,name,button,value} of mapMarkers) {
    const move=moveOf(quotes[symbol]);
    const change=pctText(move);
    button.classList.toggle("up",move>0);
    button.classList.toggle("down",move<0);
    button.setAttribute("aria-label",[button.dataset.city,name,change,"查看当地指数与持仓"].join(" · "));
    value.textContent=change;
  }
  layoutGlobeLabels();
  renderMarketPanel(holdings);
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

function marketRow({symbol,name,held,localPrice,isAdr,adrMarkets=[]}) {
  const reading=quotes[symbol];
  const move=moveOf(reading);
  const time=reading?(reading.observationDate?.slice(5).replace("-","/")??timeAt(reading.time,reading.timezone)):fnum(localPrice)?"手动价":"暂无报价";
  const stale=fnum(reading?.time)&&Date.now()-reading.time>fourDays;
  const source=reading?quoteStamp(reading):time;
  const status=reading?(stale?" · 报价超过四天":!fresh.has(symbol)?" · 快照":""):"";
  const markets=adrMarkets.length?" · 原股 "+adrMarkets.map(market=>countryName(market.country)).join(" / "):"";
  return '<a class="market-line" href="'+sourceUrl(symbol)+'" target="_blank" rel="noopener noreferrer" title="'+esc(name+" "+displaySymbol(symbol)+" · "+source+status+markets)+'">'
    +'<div class="market-name"><span>'+esc(name)+'</span><small>'+esc(displaySymbol(symbol))+(isAdr?' · ADR':held?' · 持仓':'')
    +(sessionNames[reading?.session]?' · '+sessionNames[reading.session]:reading?.delayMinutes?' · 延迟':'')+esc(markets)+'</small></div>'
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

function renderWorld() {
  const holdings=heldRows();
  renderGlobe(holdings);
  by("overview-indices").innerHTML=overviewIndices.map(marketRow).join("");
  by("regions").innerHTML=worldRegions.map(([id,name,countries])=>
    regionMarkup("world-region-"+id,name,indexRows.filter(row=>countries.includes(row.country)&&matches(row)))).join("")
    || '<p class="work-note">没有符合条件的指数</p>';
  by("watch-rows").innerHTML=holdingRegionsMarkup(holdings.filter(matches))
    || '<p class="work-note">没有符合条件的股票持仓</p>';
  by("watch-help").hidden=holdings.length>0||!!by("ticker-filter").value;
}

async function refreshAdrReferences(holdings) {
  if (resolvingAdr) return;
  const symbols=holdings.filter(row=>row.kind==="stock"&&row.country==="US"&&/^[A-Z][A-Z0-9.-]{0,14}$/.test(row.symbol)
    && (adrReferences.get(row.symbol)?.checkAfter ?? 0)<=Date.now()).map(row=>row.symbol);
  if (!symbols.length) return;
  resolvingAdr=true;
  let changed=false;
  try {
    const batches=Array.from({length:Math.ceil(symbols.length/8)},(_,i)=>symbols.slice(i*8,i*8+8));
    await Promise.all(batches.map(async batch=>{
      const data=await requestMarket("adr",{symbols:batch.join(",")},35000).catch(()=>null);
      for (const symbol of batch) {
        const previous=adrReferences.get(symbol);
        const reading=data?.listings?.[symbol];
        const markets=Array.isArray(reading?.markets)?reading.markets.filter(row=>row&&/^[A-Z]{2}$/.test(row.country)&&tickerPattern.test(row.symbol)):[];
        const match=reading?{isAdr:reading.isAdr===true,markets}:previous;
        if (Boolean(match?.isAdr)!==Boolean(previous?.isAdr)||JSON.stringify(match?.markets??[])!==JSON.stringify(previous?.markets??[])) changed=true;
        adrReferences.set(symbol,{...match,checkAfter:Date.now()+(reading?.complete?21600000:180000)});
      }
    }));
  } finally {
    resolvingAdr=false;
  }
  if (changed) {
    renderWorld();
    refreshWorld();
  }
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
  const holdings=heldRows();
  refreshAdrReferences(holdings);
  const locals=holdings.flatMap(row=>row.adrMarkets.filter(market=>mapAreas.has(market.country)).map(market=>market.symbol));
  const symbols=[...new Set(indexRows.concat(holdings).map(row=>row.symbol).concat(locals))];
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
by("refresh").addEventListener("click",refreshWorldData);
window.addEventListener("storage",event=>{
  if(event.key!==storageKeys.portfolio)return;
  portfolioRows=localRead(storageKeys.portfolio,{}).positions||[];
  renderWorld();
  refreshWorld();
});
async function refreshWorldData() {
  refreshWorld();
  try {
    const data=await requestSavedPortfolio();
    if (!Array.isArray(data?.portfolio?.positions)) return;
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
