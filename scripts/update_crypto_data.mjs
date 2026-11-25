import {readFile,writeFile,rename} from "node:fs/promises";
import market from "../worker/index.mjs";

const feed = globalThis.MARKET_CRYPTO_FEED;
const file = new URL("../dist/assets/crypto-snapshot.js",import.meta.url);
const previous = await readFile(file,"utf8").then(text=>{
  try {return JSON.parse(/globalThis\.MARKET_CRYPTO_SNAPSHOT\s*=\s*(\{[\s\S]*\});/.exec(text)?.[1] ?? "{}");}
  catch {return {};}
}).catch(()=>({}));
const inputs = await Promise.allSettled([
  feed.overview(),feed.chart("BTC",1440),feed.chart("ETH",1440),
  ...[feed.securities.slice(0,8),feed.securities.slice(8)].map(group=>{
    const url = new URL("https://snapshot.local/api/market?scope=world");
    url.searchParams.set("symbols",group.map(([ticker])=>ticker).join(","));
    return market.fetch(new Request(url)).then(response=>response.json());
  }),
]);
const [overview,btc,eth,...equities] = inputs.map(result=>result.status==="fulfilled"?result.value:null);
const quotes = {...previous.quotes};
for (const [asset,row] of Object.entries(overview?.quotes ?? {})) {
  if (!(quotes[asset]?.time>row.time)) quotes[asset] = row;
}
const global = overview?.global && !(previous.global?.time>overview.global.time) ? overview.global : previous.global;
const fear = overview?.fear?.length && !(previous.fear?.at(-1)?.time>overview.fear.at(-1).time) ? overview.fear : previous.fear;
const charts = {...previous.charts};
for (const [asset,chart] of [["BTC",btc],["ETH",eth]]) {
  if (chart?.rows?.length && !(charts[asset+"/1440"]?.rows.at(-1)?.[0]>chart.rows.at(-1)[0])) charts[asset+"/1440"] = chart;
}
const securities = {...previous.securities};
for (const result of equities) for (const [ticker,quote] of Object.entries(result?.quotes ?? {})) {
  if (Number.isFinite(quote?.time) && !(securities[ticker]?.time>quote.time)) securities[ticker] = quote;
}
const temp = new URL("crypto-snapshot.tmp",file);
await writeFile(temp,'"use strict";\nglobalThis.MARKET_CRYPTO_SNAPSHOT = '+JSON.stringify({quotes,global,fear,charts,securities})+';\n');
await rename(temp,file);
console.log(`加密快照 · ${Object.keys(quotes).length} 个资产 · ${Object.keys(securities).length} 项证券 · ${Object.keys(charts).length} 条 K 线序列`);
