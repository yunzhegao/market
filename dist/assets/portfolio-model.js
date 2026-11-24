"use strict";

const currencyList = ["USD","SGD","HKD","CNY","EUR","GBP","JPY","AUD","CAD","CHF","KRW","TWD","CNH"];
const assetKinds = {stock:"个股", etf:"ETF", cash:"现金"};
const buckets = {
  core:"核心股票", tech:"科技成长", bank:"金融", equity:"其他股票", gold:"黄金",
  duration:"长久期债券", reserve:"现金替代", cash:"现金",
};
const defaultScenarios = [
  {name:"全球股市回调", core:-12, tech:-20, bank:-15, equity:-12, gold:5, duration:4, reserve:0, cash:0, fx:0},
  {name:"银行信用承压", core:-8, tech:-10, bank:-22, equity:-8, gold:5, duration:4, reserve:0, cash:0, fx:0},
  {name:"利率再上行", core:-8, tech:-14, bank:-6, equity:-7, gold:-6, duration:-12, reserve:0, cash:0, fx:0},
  {name:"外币走弱", core:0, tech:0, bank:0, equity:0, gold:0, duration:0, reserve:0, cash:0, fx:-5},
];
const defaultPortfolioName = "我的投资组合";
const portfolioNameLimit = 60;
const blankPortfolio = () => ({name:defaultPortfolioName,base:"USD", date:"", positions:[], weights:[], rates:{}, scenarios:structuredClone(defaultScenarios)});
const numeric = value => typeof value === "number" && Number.isFinite(value);
const numberFromInput = value => value !== "" && value != null && Number.isFinite(Number(value)) ? Number(value) : null;
const cleanText = (value, limit = 90) => String(value ?? "").trim().slice(0, limit);
const normalizePortfolioName = name => (typeof name === "string" && cleanText(name.replace(/[\u0000-\u001f\u007f]/g," "),portfolioNameLimit)) || defaultPortfolioName;
const symbolValid = symbol => /^\^?[A-Z0-9][A-Z0-9.=^\-]{0,18}$/.test(symbol);
const currencyValid = currency => currencyList.includes(currency);
const requiredText = (value, field) => {
  const text = cleanText(value);
  if (!text) throw new Error("请填写" + field);
  return text;
};
const orderAssets = {
  SPYM:["etf","core"], SPY:["etf","core"], VOO:["etf","core"], IVV:["etf","core"], RSP:["etf","core"],
  QQQ:["etf","tech"], QQQM:["etf","tech"], SMH:["etf","tech"], SCHD:["etf","core"], VTI:["etf","core"],
  GLD:["etf","gold"], GLDM:["etf","gold"], IAU:["etf","gold"],
  TLT:["etf","duration"], BOXX:["etf","reserve"], SGOV:["etf","reserve"], BIL:["etf","reserve"],
  BAC:["stock","bank"], HSBC:["stock","bank"], IBKR:["stock","bank"], SMFG:["stock","bank"],
  "O39.SI":["stock","bank"], "D05.SI":["stock","bank"],
  NVDA:["stock","tech"], TSM:["stock","tech"], AAPL:["stock","tech"], MSFT:["stock","tech"],
};

function normalizePortfolio(raw) {
  if (!raw || !Array.isArray(raw.positions) || raw.positions.length > 400) throw new Error("持仓文件格式有误，或超过 400 项");
  const positions = raw.positions.map((row, i) => {
    if (!row || typeof row !== "object") throw new Error("第 " + (i+1) + " 行持仓格式有误");
    const account = requiredText(row.account, "账户");
    const kind = Object.hasOwn(assetKinds,row.kind) ? row.kind : "stock";
    const currency = cleanText(row.currency,3).toUpperCase();
    if (!currencyValid(currency)) throw new Error("请检查 " + account + " 的币种");
    const symbol = kind === "cash" ? currency : cleanText(row.symbol,19).toUpperCase();
    if (!symbolValid(symbol)) throw new Error("请检查 " + account + " 的代码");
    const quantity = numberFromInput(row.quantity);
    const price = kind === "cash" ? 1 : numberFromInput(row.price);
    const previous = kind === "cash" ? 1 : numberFromInput(row.previous);
    const cost = kind === "cash" ? 1 : numberFromInput(row.cost);
    if (!numeric(quantity) || quantity < 0 || [price,previous,cost].some(x => numeric(x) && x < 0)) {
      throw new Error("请检查 " + symbol + " 的数量、价格和成本");
    }
    const bucket = kind === "cash" ? "cash" : Object.hasOwn(buckets,row.bucket) && row.bucket !== "cash" ? row.bucket
      : orderAssets[symbol]?.[1] || "equity";
    return {account, kind, currency, symbol, quantity, price, previous, cost, bucket,
      name: cleanText(row.name), role: cleanText(row.role), available: row.available !== false};
  });
  const weights = (Array.isArray(raw.weights) ? raw.weights.slice(0,800) : []).map(row => {
    const fund = cleanText(row?.fund,19).toUpperCase();
    const member = cleanText(row?.member,19).toUpperCase();
    const weight = numberFromInput(row?.weight);
    if (!symbolValid(fund) || !symbolValid(member) || !numeric(weight) || weight <= 0 || weight > 100 || fund === member) {
      throw new Error("ETF 成分请填写有效的代码以及 0 至 100 之间的权重");
    }
    return {fund, member, weight, date:cleanText(row.date,10), source:cleanText(row.source,130)};
  });
  const fundTotals = new Map();
  const repeated = new Set();
  for (const row of weights) {
    const key = row.fund + "/" + row.member;
    if (repeated.has(key)) throw new Error("重复的 ETF 成分 " + key);
    repeated.add(key);
    const total = (fundTotals.get(row.fund) ?? 0) + row.weight;
    if (total > 100.01) throw new Error(row.fund + " 的成分权重合计超过 100%");
    fundTotals.set(row.fund,total);
  }
  const rates = {};
  for (const currency of currencyList.filter(x => x !== "USD")) {
    const rate = raw.rates?.[currency];
    const now = numberFromInput(rate?.now), prev = numberFromInput(rate?.prev);
    if ([now,prev].some(x => numeric(x) && x <= 0)) throw new Error(currency + " 的汇率需要大于 0");
    if (numeric(now) || numeric(prev)) rates[currency] = {now,prev};
  }
  const scenarios = (Array.isArray(raw.scenarios) ? raw.scenarios.slice(0,12) : defaultScenarios).map(row => {
    const name = requiredText(row?.name, "情景名称");
    const result = {name};
    for (const field of [...Object.keys(buckets),"fx"]) {
      const value = numberFromInput(row?.[field]) ?? 0;
      if (value < -100 || value > 1000) throw new Error(name + " 的冲击需在 −100% 至 +1000% 之间");
      result[field] = value;
    }
    return result;
  });
  const navHistory = raw.navHistory ? normalizeNavHistory(raw.navHistory) : null;
  return {name:normalizePortfolioName(raw.name),base:currencyValid(raw.base) ? raw.base : "USD",
    date:/^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : "",
    positions, weights, rates, scenarios, ...(navHistory ? {navHistory} : {})};
}

function effectiveRates(auto, manual) {
  const rows = {USD:{now:1,prev:1}};
  for (const currency of currencyList.filter(x => x !== "USD")) {
    const live = auto[currency], saved = manual[currency];
    rows[currency] = {now:saved?.now ?? live?.now, prev:saved?.prev ?? live?.prev};
  }
  return rows;
}

function fxFactor(rates, base, currency, period) {
  if (base === currency) return 1;
  const quote = rates[base]?.[period], original = rates[currency]?.[period];
  return quote > 0 && original > 0 ? quote / original : null;
}

function valueAssets(positions, base, rates) {
  return positions.filter(row => row.quantity > 0).map(row => {
    const now = fxFactor(rates,base,row.currency,"now");
    const prev = fxFactor(rates,base,row.currency,"prev");
    const marketValue = numeric(now) && numeric(row.price) ? row.quantity * row.price * now : null;
    const priceImpact = numeric(now) && numeric(row.price) && numeric(row.previous) ? row.quantity * (row.price-row.previous) * now : null;
    const fxImpact = numeric(now) && numeric(prev) && numeric(row.previous) ? row.quantity * row.previous * (now-prev) : null;
    const totalImpact = numeric(priceImpact) && numeric(fxImpact) ? priceImpact + fxImpact : null;
    const previousValue = numeric(prev) && numeric(row.previous) ? row.quantity * row.previous * prev : null;
    const unrealized = row.kind !== "cash" && numeric(now) && numeric(row.price) && numeric(row.cost)
      ? row.quantity * (row.price - row.cost) * now : null;
    return {...row, marketValue, priceImpact, fxImpact, totalImpact, previousValue, unrealized};
  });
}

function sum(values, key) {
  const valid = values.map(row => row[key]).filter(numeric);
  return valid.length ? valid.reduce((total,value) => total+value,0) : null;
}

function mergeAssets(values) {
  const groups = new Map();
  for (const row of values) {
    const key = [row.kind,row.symbol,row.currency].join("/");
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(row);
  }
  return [...groups.values()].map(rows => {
    const first = rows[0];
    const totalImpact = rows.every(row => numeric(row.totalImpact)) ? sum(rows,"totalImpact") : null;
    const name = rows.find(row => row.name)?.name || "";
    return {...first, name, quantity:sum(rows,"quantity"), marketValue:sum(rows,"marketValue"),
      totalImpact, priceImpact:sum(rows,"priceImpact"), fxImpact:sum(rows,"fxImpact"),
      accounts:[...new Set(rows.map(row => row.account))],
      roles:[...new Set(rows.map(row => row.role || buckets[row.bucket]))],
      incomplete:rows.some(row => !numeric(row.marketValue) || !numeric(row.totalImpact))};
  });
}

function cashClass(row) {
  if (row.kind === "cash") return "book";
  return row.bucket === "reserve" ? "equivalent" : null;
}

function analyze(positions, state, rates) {
  const values = valueAssets(positions,state.base,rates);
  const valid = values.filter(row => numeric(row.marketValue));
  const nav = sum(valid,"marketValue");
  const accounted = values.filter(row => numeric(row.totalImpact));
  const individual = new Map(), exposure = new Map();
  const equityFunds = valid.filter(row => row.kind === "etf" && ["core","tech","bank","equity"].includes(row.bucket));
  const entry = key => {
    if (!exposure.has(key)) exposure.set(key,{symbol:key,direct:0,indirect:0,funds:new Map()});
    return exposure.get(key);
  };
  for (const row of valid.filter(row => row.kind === "stock")) {
    entry(row.symbol).direct += row.marketValue;
    individual.set(row.symbol,(individual.get(row.symbol) ?? 0)+row.marketValue);
  }
  let covered = 0;
  for (const fund of equityFunds) {
    for (const member of state.weights.filter(row => row.fund === fund.symbol)) {
      const amount = member.weight * fund.marketValue / 100;
      const underlying = entry(member.member);
      underlying.indirect += amount;
      underlying.funds.set(fund.symbol,(underlying.funds.get(fund.symbol) ?? 0)+amount);
      covered += amount;
    }
  }
  const underlying = [...exposure.values()].map(row => ({...row,total:row.direct+row.indirect})).sort((a,b)=>b.total-a.total);
  const holdings = [...individual.entries()].sort((a,b)=>b[1]-a[1]);
  const accounts = new Map();
  const cashAssets = {book:0,equivalent:0,available:0,saleable:0};
  for (const row of valid) {
    accounts.set(row.account,(accounts.get(row.account) ?? 0)+row.marketValue);
    const type = cashClass(row);
    if (!type) continue;
    cashAssets[type] += row.marketValue;
    if (row.available) cashAssets[type==="book" ? "available" : "saleable"] += row.marketValue;
  }
  return {values, nav, validCount:valid.length, accountedCount:accounted.length,
    daily:sum(accounted,"totalImpact"), prior:sum(accounted,"previousValue"),
    priceImpact:sum(accounted,"priceImpact"), fxImpact:sum(accounted,"fxImpact"), unrealized:sum(valid,"unrealized"),
    unrealizedCount:valid.filter(row => numeric(row.unrealized)).length,
    cashAssets:valid.length ? cashAssets : null,
    concentration:nav > 0 ? ((holdings[0]?.[1] ?? 0)/nav)*100 : null,
    largest:holdings[0]?.[0],
    topFive:nav > 0 ? holdings.slice(0,5).reduce((a,row)=>a+row[1],0)/nav*100 : null,
    overlap:nav > 0 ? underlying.filter(row=>row.direct>0).reduce((a,row)=>a+row.indirect,0)/nav*100 : null,
    underlying, coverage:equityFunds.length ? covered/sum(equityFunds,"marketValue")*100 : null, accounts};
}

function stressResult(analysis, scenario, base) {
  if (!analysis.validCount) return null;
  return analysis.values.reduce((total,row)=>{
    if (!numeric(row.marketValue)) return total;
    const asset = scenario[row.bucket]/100;
    const fx = row.currency === base ? 0 : scenario.fx/100;
    return total + row.marketValue*((1+asset)*(1+fx)-1);
  },0);
}

function simulate(positions, orders) {
  const after = positions.map(row => ({...row}));
  const errors = [], cashChanges = new Map();
  let executed = 0;
  for (const order of orders) {
    const account = cleanText(order.account), currency = order.currency, symbol = cleanText(order.symbol,19).toUpperCase();
    const quantity = numberFromInput(order.quantity), price = numberFromInput(order.price), fee = numberFromInput(order.fee) ?? 0;
    if (!account || !symbol || !numeric(quantity) || !numeric(price) || !numeric(fee) || quantity <= 0 || price <= 0 || fee < 0 || !currencyValid(currency) || !symbolValid(symbol)) {
      errors.push("请补齐每笔操作的账户、代码、数量和成交价。");
      continue;
    }
    const matches = after.filter(row => row.kind !== "cash" && row.account === account && row.currency === currency && row.symbol === symbol);
    const isSell = order.side === "sell";
    if (isSell && matches.reduce((value,row)=>value+row.quantity,0) < quantity-1e-8) {
      errors.push(account + " 的 " + symbol + " 持仓不足。");
      continue;
    }
    if (isSell) {
      let sold = 0;
      for (const row of matches) {
        const take = Math.min(row.quantity,quantity-sold);
        row.quantity -= take;
        sold += take;
      }
    } else {
      const other = matches[0] ?? after.find(row => row.kind !== "cash" && row.symbol === symbol && row.currency === currency);
      const [kind,bucket] = orderAssets[symbol] || ["stock","equity"];
      const classification = String(order.classification ?? "").split("/");
      const [specifiedKind,specifiedBucket] = classification;
      after.push({account,currency,symbol,quantity,price:other?.price ?? price,previous:null,cost:price,
        kind:other?.kind ?? (Object.hasOwn(assetKinds,specifiedKind) && specifiedKind !== "cash" ? specifiedKind : kind),
        bucket:other?.bucket ?? (Object.hasOwn(buckets,specifiedBucket) && specifiedBucket !== "cash" ? specifiedBucket : bucket),
        name:other?.name || "",role:other?.role || "",available:true});
    }
    const cashKey = JSON.stringify([account,currency]);
    const delta = (isSell ? 1 : -1)*quantity*price-fee;
    cashChanges.set(cashKey,(cashChanges.get(cashKey) ?? 0)+delta);
    executed++;
  }
  for (const [key,delta] of cashChanges) {
    const [account,currency] = JSON.parse(key);
    const cash = after.filter(row=>row.kind === "cash" && row.account === account && row.currency === currency && row.available);
    const total = cash.reduce((value,row)=>value+row.quantity,0)+delta;
    if (total < -1e-8) {
      errors.push(account + " 的 " + currency + " 现金不足 " + (-total).toFixed(2) + "。");
      continue;
    }
    for (const row of cash) row.quantity = 0;
    after.push({account,currency,symbol:currency,kind:"cash",quantity:Math.max(0,total),price:1,previous:1,cost:1,bucket:"cash",available:true});
  }
  return {positions:errors.length ? null : after,errors:[...new Set(errors)],executed};
}
