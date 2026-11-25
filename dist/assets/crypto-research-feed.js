"use strict";

(() => {
  const day = 86400000;
  const paths = {
    BTC:"https://farside.co.uk/bitcoin-etf-flow-all-data/",
    ETH:"https://farside.co.uk/ethereum-etf-flow-all-data/"
  };
  const assets = ["BTC","ETH"];
  const issuerPages = {
    IBIT:"https://www.ishares.com/us/products/333011/ishares-bitcoin-trust-etf",
    ETHA:"https://www.ishares.com/us/products/337614/ishares-ethereum-trust-etf",
    FBTC:"https://www.fidelity.com/etfs/crypto-funds",
    FETH:"https://www.fidelity.com/etfs/crypto-funds",
    BITB:"https://www.bitwiseetfs.com/single-asset/bitb"
  };
  const parse = value => value == null || String(value).trim()==="" ? NaN : Number(value);
  const valid = Number.isFinite;
  const iso = timestamp => new Date(timestamp).toISOString().slice(0,10);
  const symbols = {BTC:"BTC-USD",ETH:"ETH-USD",SPY:"SPY",QQQ:"QQQ",GLD:"GLD",TLT:"TLT",DXY:"DX-Y.NYB",COIN:"COIN"};
  async function read(url, html=false) {
    const response = await fetch(url,{signal:AbortSignal.timeout(7500)});
    if (!response.ok) throw new Error("HTTP "+response.status);
    return html ? response.text() : response.json();
  }
  function parseFlows(html) {
    const result = new Map();
    let columns = [];
    for (const [,row] of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
        .map(([,cell])=>cell.replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/gi," ")
          .replace(/&minus;|&#8722;|−/gi,"-").replace(/\s+/g," ").trim());
      if (cells.length<3) continue;
      if (["Date",""].includes(cells[0]) && cells.at(-1)==="Total") {
        columns = cells;
        continue;
      }
      if (!/^\d{1,2}\s+[A-Za-z]{3}\s+\d{4}$/.test(cells[0])) continue;
      const at = Date.parse(cells[0]+" UTC");
      const money = raw => {
        const value = raw.replace(/,/g,"").replace(/^\(([^)]+)\)$/,"-$1");
        return /^[-+]?\d+(?:\.\d+)?$/.test(value) ? Number(value)*1e6 : null;
      };
      if (!valid(at) || !cells.slice(1,-1).every(cell=>money(cell)!==null)) continue;
      const total = money(cells.at(-1));
      if (total===null) continue;
      const funds = columns.length===cells.length ? Object.fromEntries(columns.slice(1,-1).flatMap((symbol,i)=>{
        const value = money(cells[i+1]);
        return /^[A-Z]{2,6}$/.test(symbol) && value!==null ? [[symbol,value]] : [];
      })) : {};
      result.set(at,{time:at,total,funds});
    }
    return [...result.values()].sort((a,b)=>a.time-b.time).slice(-60);
  }
  async function flows(asset) {
    const rows = parseFlows(await read(paths[asset],true));
    if (!rows.length) throw new Error("No ETF flow");
    return {time:rows.at(-1).time,rows};
  }
  async function supply() {
    const raw = await read("https://stablecoins.llama.fi/stablecoincharts/all");
    const rows = raw.map(row=>{
      const components = Object.values(row.totalCirculatingUSD ?? {}).map(parse).filter(value=>value>=0);
      const marketCap = components.length ? components.reduce((sum,value)=>sum+value,0) : parse(row.totalCirculatingUSD);
      return [parse(row.date)*1000,parse(row.totalCirculating?.peggedUSD),marketCap>0?marketCap:null];
    })
      .filter(([time,value])=>valid(time) && value>0).sort((a,b)=>a[0]-b[0]).slice(-90);
    if (!rows.length) throw new Error("No stablecoin supply");
    return {time:rows.at(-1)[0],rows};
  }
  async function perpetual(asset) {
    const raw = await read("https://api.bybit.com/v5/market/tickers?category=linear&symbol="+asset+"USDT");
    const row = raw.result?.list?.[0];
    if (raw.retCode!==0 || !row || !valid(raw.time)) throw new Error("No perpetual");
    const mark = parse(row.markPrice), index = parse(row.indexPrice);
    return {time:raw.time,funding:parse(row.fundingRate)*100,interest:parse(row.openInterestValue),
      premium:mark>0 && index>0 ? (mark/index-1)*100 : null,interval:parse(row.fundingIntervalHour)};
  }
  async function futures(asset) {
    const raw = await read("https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency="+asset+"&kind=future");
    const expiries = (raw.result ?? []).flatMap(row=>{
      const date = new RegExp("^"+asset+"-(\\d{1,2})([A-Z]{3})(\\d{2})$").exec(row.instrument_name);
      const expiry = date ? Date.parse(date[1]+" "+date[2]+" 20"+date[3]+" 08:00:00 UTC") : NaN;
      const time = parse(row.creation_timestamp);
      const mark = parse(row.mark_price), reference = parse(row.estimated_delivery_price);
      if (!(expiry>time+day && mark>0 && reference>0)) return [];
      return [{time,expiry,premium:(mark/reference-1)*100}];
    }).sort((a,b)=>a.expiry-b.expiry);
    if (!expiries.length) throw new Error("No dated futures");
    return expiries[0];
  }
  async function fundAssets(code) {
    const html = await read(issuerPages[code],true);
    const cleaned = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ").replace(/<[^>]+>/g," ")
      .replace(/&nbsp;/g," ").replace(/\s+/g," ");
    const match = /Net Assets of Fund \$([\d,]+(?:\.\d+)?) as of ([A-Za-z]{3} \d{1,2}, \d{4})/.exec(cleaned);
    const time = Date.parse((match?.[2] ?? "")+" UTC");
    const value = parse(match?.[1]?.replace(/,/g,""));
    if (!valid(time) || !(value>0)) throw new Error("No issuer fund size");
    return {time,value};
  }
  async function glassnode(metric,key) {
    const params = new URLSearchParams({a:"BTC",i:"24h",s:Math.floor((Date.now()-7*day)/1000),api_key:key});
    const data = await read("https://api.glassnode.com/v1/metrics/"+metric+"?"+params);
    const recent = (Array.isArray(data)?data:[]).findLast(row=>valid(row?.t) && valid(row?.v));
    if (!recent) throw new Error("No Glassnode reading");
    return {time:recent.t*1000,value:recent.v};
  }
  async function dvol(asset) {
    const end = Date.now();
    const params = new URLSearchParams({currency:asset,start_timestamp:end-35*day,end_timestamp:end,resolution:"1D"});
    const raw = await read("https://www.deribit.com/api/v2/public/get_volatility_index_data?"+params);
    const rows = (raw.result?.data ?? []).filter(row=>valid(row[0]) && row[0]+day<=end && row[4]>0).map(row=>[row[0],row[4]]);
    if (!rows.length) throw new Error("No DVOL");
    return {time:rows.at(-1)[0]+day,rows};
  }
  const chainMetrics = ["CapMVRVCur","CapRealUSD","SplyCur","SplyActPct1yr","FeeTotNtv","AdrActCnt","TxCnt"];
  async function chainMetric(metric,asset="btc") {
    const params = new URLSearchParams({assets:asset,metrics:metric,frequency:"1d",start_time:iso(Date.now()-10*day),page_size:"20"});
    const raw = await read("https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?"+params);
    const rows = (raw.data ?? []).map(row=>[Date.parse(row.time),parse(row[metric])]).filter(([time,value])=>valid(time) && valid(value));
    if (!rows.length) throw new Error("No chain metric");
    return {time:rows.at(-1)[0],value:rows.at(-1)[1]};
  }
  async function chainFees() {
    const raw = await read("https://mempool.space/api/v1/fees/recommended");
    if (!(raw.fastestFee>0)) throw new Error("No fee estimate");
    return {time:Date.now(),value:raw.fastestFee};
  }
  async function collect(jobs) {
    const entries = await Promise.all(Object.entries(jobs).map(async ([key,job])=>{
      try {return [key,await job()];} catch {return null;}
    }));
    return Object.fromEntries(entries.filter(Boolean));
  }
  const overview = ({worker=false,glassnodeKey}={}) => collect({
    ...(worker ? {flowBTC:()=>flows("BTC"),flowETH:()=>flows("ETH"),aumIBIT:()=>fundAssets("IBIT"),aumETHA:()=>fundAssets("ETHA")} : {}),
    ...(glassnodeKey ? {
      longTermHolders:()=>glassnode("supply/lth_sum",glassnodeKey),
      exchangeBalance:()=>glassnode("distribution/balance_exchanges",glassnodeKey),
      exchangeFlow:()=>glassnode("transactions/transfers_volume_exchanges_net_pit",glassnodeKey)
    } : {}),
    supply,
    ...Object.fromEntries(assets.flatMap(asset=>[
      ["perp"+asset,()=>perpetual(asset)],["dvol"+asset,()=>dvol(asset)],["future"+asset,()=>futures(asset)]
    ])),
    ...Object.fromEntries(chainMetrics.map(metric=>[metric,()=>chainMetric(metric)])),
    stakingETH:()=>chainMetric("SplyActStkedNtv","eth"),chainFees
  });
  function merge(previous={},next={}) {
    const combined = {...previous};
    for (const [key,value] of Object.entries(next)) {
      if (!valid(value?.time) || combined[key]?.time>value.time) continue;
      if (combined[key]?.time===value.time && combined[key]?.rows?.length>value.rows?.length) continue;
      combined[key] = value;
    }
    return combined;
  }
  globalThis.MARKET_CRYPTO_RESEARCH = {symbols,paths,issuerPages,day,iso,parseFlows,overview,merge};
})();
