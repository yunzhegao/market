"use strict";

const cryptoStable = new Set(["USDT","USDC","DAI","USDS","PYUSD","FDUSD"]);
const cryptoCoins = new Set(["BTC","ETH","SOL","BNB","AVAX","ADA","XRP","LINK","DOT","LTC","DOGE","TON","SUI","TRX","BCH",...cryptoStable]);
const cryptoFunds = {IBIT:"BTC",FBTC:"BTC",BITB:"BTC",ARKB:"BTC",GBTC:"BTC",ETHA:"ETH",FETH:"ETH",ETHW:"ETH",ETHE:"ETH"};
const cryptoEquities = new Set(["COIN","CRCL","MSTR","MARA","RIOT","CLSK","HOOD"]);
const coinCode = symbol => symbol.replace(/-USD$/,"");
const privateCoin = row => ["crypto","stable"].includes(row.kind);
function cryptoLocalBook(book) {
  const rows = value => Array.isArray(value) && value.some(row=>row && privateCoin(row));
  const history = book?.navHistory;
  return book?.localOnly===true || rows(book?.positions) || rows(history?.reference?.holdings) ||
    (Array.isArray(history?.snapshots) && history.snapshots.some(day=>rows(day?.holdings)));
}
const cryptoBucketColors = {btc:"#f7931a",eth:"#8074bf",crypto:"#ae68a1",stable:"#638f89"};

function cryptoAsset(row) {
  const code = coinCode(row.symbol);
  if (row.kind==="stable") return {code,form:"稳定币",risk:"美元锚定与发行人",bucket:"stable"};
  if (row.kind==="crypto") return {code,form:"现货",risk:code,bucket:code==="BTC"?"btc":code==="ETH"?"eth":"crypto"};
  if (row.kind==="etf" && Object.hasOwn(cryptoFunds,row.symbol)) {
    const risk = cryptoFunds[row.symbol];
    return {code:row.symbol,form:"现货 ETF",risk,bucket:risk.toLowerCase()};
  }
  if (row.kind==="stock" && cryptoEquities.has(row.symbol)) {
    const risk = {COIN:"交易平台经营",CRCL:"稳定币业务及利率",MSTR:"BTC 价格与企业融资",HOOD:"零售交易与金融科技"}[row.symbol];
    return {code:row.symbol,form:"相关股票",risk:risk ?? "挖矿经营与融资",bucket:"crypto"};
  }
  return null;
}

function cryptoExposure(rows, nav) {
  const entries = rows.flatMap(row=>{
    const asset = cryptoAsset(row);
    return asset && row.quantity>0 ? [{...row,...asset}] : [];
  });
  const valued = entries.filter(row=>Number.isFinite(row.marketValue));
  const priced = valued.reduce((total,row)=>total+row.marketValue,0);
  const totals = Object.fromEntries(["BTC","ETH"].map(code=>[code,valued
    .filter(row=>row.risk===code && ["现货","现货 ETF"].includes(row.form))
    .reduce((total,row)=>total+row.marketValue,0)]));
  const weight = amount => nav>0 && (valued.length || !entries.length) ? amount/nav*100 : null;
  return {entries, pricedCount:valued.length, priced, weight:weight(priced),
    btcWeight:weight(totals.BTC),ethWeight:weight(totals.ETH)};
}

function cryptoAllocationStress(nav,weight,loss,limit) {
  const decline = weight * loss / 100;
  return {allocation:nav>0?nav*weight/100:null,loss:nav>0?-nav*decline/100:null,
    impact:-decline,budget:limit>0?decline/limit*100:null};
}
