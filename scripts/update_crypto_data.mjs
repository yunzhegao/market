import {readFile,writeFile,rename} from "node:fs/promises";
import market from "../worker/index.mjs";

const feed = globalThis.MARKET_CRYPTO_FEED;
const researchFeed = globalThis.MARKET_CRYPTO_RESEARCH;
const file = new URL("../dist/assets/crypto-snapshot.js",import.meta.url);
const readSnapshot = path => readFile(path,"utf8").then(text=>{
  try {return JSON.parse(/globalThis\.MARKET_CRYPTO_SNAPSHOT\s*=\s*(\{[\s\S]*\});/.exec(text)?.[1] ?? "{}");}
  catch {return {};}
}).catch(()=>({}));
const previous = await readSnapshot(file);
const bundledFile = process.argv[2];
const bundled = bundledFile ? await readSnapshot(bundledFile) : {};
const loadScope = async scope => {
  const response = await market.fetch(new Request("https://snapshot.local/api/market?scope="+scope));
  return response.ok ? response.json() : null;
};
const inputs = await Promise.allSettled([
  loadScope("crypto-context"),loadScope("crypto-cross"),loadScope("crypto-breadth"),loadScope("crypto-filings"),
  process.env.MARKET_CMC_API_KEY ? researchFeed.historicalDominance(process.env.MARKET_CMC_API_KEY) : null,
  feed.overview(),feed.chart("BTC",1440),feed.chart("ETH",1440),
  ...[feed.securities.slice(0,8),feed.securities.slice(8)].map(group=>{
    const url = new URL("https://snapshot.local/api/market?scope=world");
    url.searchParams.set("symbols",group.map(([ticker])=>ticker).join(","));
    return market.fetch(new Request(url)).then(response=>response.json());
  }),
]);
const [metrics,cross,breadth,filings,btcDominance,overview,btc,eth,...equities] = inputs.map(result=>result.status==="fulfilled"?result.value:null);
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
const earlier = previous.research ?? {};
const baseline = bundled.research ?? {};
const dominance = new Map([...(baseline.dominance ?? []),...(earlier.dominance ?? [])]);
if (Number.isFinite(global?.dominance) && Number.isFinite(global?.time)) dominance.set(researchFeed.iso(global.time),global.dominance);
const research = {metrics:researchFeed.merge(researchFeed.merge(baseline.metrics,earlier.metrics ?? {}),metrics ?? {}),
  dominance:[...dominance].sort(([a],[b])=>a.localeCompare(b)).slice(-35),
  cross:cross ? {time:cross.time,series:{...earlier.cross?.series,...Object.fromEntries(Object.entries(cross.series).filter(([,row])=>row?.rows?.length))}} : earlier.cross,
  breadth:breadth && !(earlier.breadth?.time>breadth.time) ? breadth : earlier.breadth,
  watchTrends:{...earlier.watchTrends,...breadth?.trends},
  filings:filings ? {time:filings.time,rows:{...earlier.filings?.rows,...filings.rows}} : earlier.filings};
if (btcDominance) research.metrics = researchFeed.merge(research.metrics,{btcDominance});
const temp = new URL("crypto-snapshot.tmp",file);
await writeFile(temp,'"use strict";\nglobalThis.MARKET_CRYPTO_SNAPSHOT = '+JSON.stringify({quotes,global,fear,charts,securities,research})+';\n');
await rename(temp,file);
console.log(`加密快照 · ${Object.keys(quotes).length} 个资产 · ${Object.keys(securities).length} 项证券 · ${Object.keys(charts).length} 条 K 线序列 · ${Object.keys(research.metrics).length} 项研究数据 · ${Object.keys(research.cross?.series ?? {}).length} 条跨资产序列`);
