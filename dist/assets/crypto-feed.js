"use strict";

globalThis.MARKET_CRYPTO_FEED = (() => {
  const coins = [
    ["BTC","btc-bitcoin","Bitcoin","核心资产"],["ETH","eth-ethereum","Ethereum","核心资产"],
    ["SOL","sol-solana","Solana","公链与生态"],["BNB","bnb-binance-coin","BNB","公链与生态"],
    ["AVAX","avax-avalanche","Avalanche","公链与生态"],["ADA","ada-cardano","Cardano","公链与生态"],
    ["DOT","dot-polkadot","Polkadot","公链与生态"],["XRP","xrp-xrp","XRP","支付与基础设施"],
    ["LINK","link-chainlink","Chainlink","支付与基础设施"],["LTC","ltc-litecoin","Litecoin","支付与基础设施"],
    ["USDT","usdt-tether","Tether","稳定币"],["USDC","usdc-usd-coin","USD Coin","稳定币"],
    ["DAI","dai-dai","Dai","稳定币"],["DOGE","doge-dogecoin","Dogecoin","其他观察"],
  ];
  const securities = [
    ["IBIT","iShares 比特币信托","比特币现货 ETF"],["FBTC","Fidelity 比特币基金","比特币现货 ETF"],
    ["BITB","Bitwise 比特币 ETF","比特币现货 ETF"],["ETHA","iShares 以太坊信托","以太坊现货 ETF"],
    ["FETH","Fidelity 以太坊基金","以太坊现货 ETF"],["COIN","Coinbase","交易所与金融科技"],
    ["HOOD","Robinhood","交易所与金融科技"],["CRCL","Circle","稳定币企业"],
    ["MSTR","Strategy","加密资产财库"],["MARA","MARA Holdings","比特币矿企"],
    ["RIOT","Riot Platforms","比特币矿企"],["CLSK","CleanSpark","比特币矿企"],
  ];
  const pairs = {BTC:"XBTUSD",ETH:"ETHUSD"};
  const intervals = [5,60,1440];
  const validChart = (asset, interval) => Object.hasOwn(pairs,asset) && intervals.includes(interval);
  const assetById = new Map(coins.map(([symbol,id])=>[id,symbol]));
  const finite = Number.isFinite;
  const number = value => finite(value) ? value : null;

  async function getJSON(url) {
    const response = await fetch(url,{signal:AbortSignal.timeout(10500)});
    if (!response.ok) throw new Error("HTTP "+response.status);
    return response.json();
  }

  function readCoins(data) {
    return Object.fromEntries((Array.isArray(data) ? data : []).flatMap(row=>{
      const symbol = assetById.get(row?.id);
      const q = row?.quotes?.USD;
      const time = Date.parse(row?.last_updated);
      if (!symbol || !(q?.price>0) || !finite(q.price) || !finite(time)) return [];
      return [[symbol,{price:q.price,time,day:number(q.percent_change_24h),week:number(q.percent_change_7d),
        month:number(q.percent_change_30d),cap:number(q.market_cap),volume:number(q.volume_24h),drawdown:number(q.percent_from_price_ath)}]];
    }));
  }

  function readGlobal(data) {
    const value = data?.bitcoin_dominance_percentage;
    const time = data?.last_updated*1000;
    return finite(value) && value>=0 && value<=100 && finite(time) && time>0
      ? {dominance:value,time,cap:number(data.market_cap_usd),change:number(data.market_cap_change_24h)} : null;
  }

  function readFear(data) {
    const readings = new Map((Array.isArray(data?.data) ? data.data : []).flatMap(row=>{
      const time = Number(row?.timestamp)*1000;
      const value = Number(row?.value);
      return time>0 && finite(time) && row?.value!=null && value>=0 && value<=100 && finite(value)
        ? [[time,{time,value,band:String(row.value_classification ?? "")}]] : [];
    }));
    return [...readings.values()].sort((a,b)=>a.time-b.time).slice(-30);
  }

  function chartRows(raw,interval,source,fetchedAt,read) {
    const rows = raw.flatMap(row=>{
      if (!Array.isArray(row) || row.length<5) return [];
      const [time,open,high,low,close] = read(row.map(Number));
      return time>0 && [time,open,high,low,close].every(finite) && low>0 && high>=Math.max(open,close) && low<=Math.min(open,close)
        ? [[time*1000,close,open,high,low]] : [];
    }).sort((a,b)=>a[0]-b[0]).slice(interval===1440 ? -367 : interval===5 ? -290 : -170);
    if (!rows.length) throw new Error("No "+source+" chart");
    return {rows,source,fetchedAt,live:true};
  }

  function readChart(data,interval,fetchedAt=Date.now()) {
    if (Array.isArray(data?.error) && data.error.length) throw new Error("Kraken chart error");
    const raw = Object.values(data?.result ?? {}).find(Array.isArray) ?? [];
    return chartRows(raw,interval,"Kraken",fetchedAt,row=>row);
  }

  async function overview() {
    const requests = [getJSON("https://api.coinpaprika.com/v1/tickers?quotes=USD").then(readCoins),
      getJSON("https://api.coinpaprika.com/v1/global").then(readGlobal),
      getJSON("https://api.alternative.me/fng/?limit=30").then(readFear)];
    const [quotes,global,fear] = (await Promise.allSettled(requests)).map(result=>result.status==="fulfilled" ? result.value : null);
    return {quotes:quotes ?? {},global,fear:fear ?? []};
  }

  async function chart(asset,interval) {
    if (!validChart(asset,interval)) throw new Error("Unsupported crypto chart");
    const params = new URLSearchParams({pair:pairs[asset],interval:String(interval)});
    try {
      return readChart(await getJSON("https://api.kraken.com/0/public/OHLC?"+params),interval);
    } catch {
      const rows = await getJSON("https://api.exchange.coinbase.com/products/"+asset+"-USD/candles?granularity="+interval*60);
      return chartRows(Array.isArray(rows)?rows:[],interval,"Coinbase",Date.now(),([time,low,high,open,close])=>[time,open,high,low,close]);
    }
  }

  return {coins,securities,validChart,overview,chart,readCoins,readGlobal,readFear,readChart};
})();
