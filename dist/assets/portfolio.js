"use strict";

const savedPortfolio = localRead(storageKeys.portfolio,null);
let portfolio;
try { portfolio = savedPortfolio ? normalizePortfolio(savedPortfolio) : blankPortfolio(); }
catch { portfolio = blankPortfolio(); }
let autoRates = {};
let fxInfo = "";
let fxRequest = 0;
let activeFxDate;
let orders = [];
let editor;
let demo = false;
let persistenceWarning = "";
const formatter = new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"});
const editorDialog = by("portfolio-dialog");

const sample = {
  base:"USD", date:"", rates:{}, scenarios:defaultScenarios,
  positions:[
    {account:"示例账户 A",symbol:"SPYM",name:"标普 500 ETF",kind:"etf",currency:"USD",quantity:65,price:83,previous:81,cost:80,bucket:"core",role:"标普 500 核心底仓"},
    {account:"示例账户 A",symbol:"NVDA",name:"英伟达",kind:"stock",currency:"USD",quantity:9,price:155,previous:149,cost:144,bucket:"tech",role:"AI 增长敞口"},
    {account:"示例账户 A",symbol:"BOXX",name:"现金替代 ETF",kind:"etf",currency:"USD",quantity:35,price:118,previous:118.05,cost:115,bucket:"reserve",role:"候选再配置资金"},
    {account:"示例账户 A",symbol:"USD",kind:"cash",currency:"USD",quantity:550},
    {account:"示例账户 B",symbol:"SPYM",name:"标普 500 ETF",kind:"etf",currency:"USD",quantity:15,price:83,previous:81,cost:86,bucket:"core",role:"标普 500 核心底仓"},
    {account:"示例账户 B",symbol:"O39.SI",name:"华侨银行",kind:"stock",currency:"SGD",quantity:180,price:24,previous:24.4,cost:20,bucket:"bank",role:"新加坡银行与 SGD 敞口"},
    {account:"示例账户 B",symbol:"SGD",kind:"cash",currency:"SGD",quantity:300},
  ],
  weights:[{fund:"SPYM",member:"NVDA",weight:6,date:"",source:"演示用权重"}],
};

const options = (map,value)=>Object.entries(map).map(([key,label])=>'<option value="'+esc(key)+'"'+(key===value?' selected':'')+'>'+esc(label)+'</option>').join("");
const currencyOptions = value => options(Object.fromEntries(currencyList.map(x=>[x,x])),value);
const money = value => fmt(value);
const signedMoney = value => '<span class="'+tone(value)+'">'+plus(value)+'</span>';
const ratio = value => fnum(value) ? fmt(value)+"%" : "—";
const navWeight = (value,nav) => fnum(value) && nav > 0 ? 100*value/nav : null;
const td = (value, cls = "") => '<td'+(cls?' class="'+cls+'"':'')+'>'+value+'</td>';

function table(element, headers, rows, empty = "暂无数据") {
  const head = '<thead><tr>'+headers.map(title=>'<th scope="col">'+esc(title)+'</th>').join("")+'</tr></thead>';
  const body = rows.length ? rows.map(cells=>'<tr>'+cells.join("")+'</tr>').join("") :
    '<tr><td colspan="'+headers.length+'">'+esc(empty)+'</td></tr>';
  by(element).innerHTML = head+'<tbody>'+body+'</tbody>';
}

function writePortfolio(next) {
  portfolio = next;
  demo = false;
  const saved = localWrite(storageKeys.portfolio,next);
  persistenceWarning = saved ? "" : "浏览器未允许本地保存。可用「导出备份」保留修改。";
  if (saved) window.dispatchEvent(new Event(portfolioEvent));
}

function showStats(report) {
  const amount = (title, value, detail, sign = false) =>
    '<div class="panel portfolio-kpi"><span>'+esc(title)+'</span><strong class="'+(sign?tone(value):"")+'">'+(sign?plus(value):money(value))
      +'</strong><small>'+esc(detail)+'</small></div>';
  const ret = report.prior > 0 && fnum(report.daily) ? report.daily/report.prior*100 : null;
  by("portfolio-kpis").innerHTML = [
    amount("组合市值 · "+portfolio.base,report.nav,"已计价 "+report.validCount+"/"+report.values.length+" 项"),
    amount("当日盈亏",report.daily,(fnum(ret)?pctText(ret)+" · ":"")+"已归因 "+report.accountedCount+" 项",true),
    amount("汇率影响",report.fxImpact,"基于已完成归因的持仓",true),
    amount("未实现盈亏",report.unrealized,"有成本 "+report.unrealizedCount+" 项",true),
    amount("可用现金",report.cash,"现金替代资产 "+money(report.reserve)),
  ].join("");
}

function showHoldings(report) {
  const rows = mergeAssets(report.values);
  const key = by("holdings-sort").value === "impact" ? "totalImpact" : "marketValue";
  rows.sort((a,b)=>(b[key] ?? -Infinity)-(a[key] ?? -Infinity));
  const cells = rows.map(row=>[
    td('<strong>'+esc(row.kind==="cash"?row.currency+" 现金":row.symbol)+'</strong>'+(row.name?'<small>'+esc(row.name)+'</small>':"")+'<small>'+esc(row.accounts.join(" / "))+'</small>'),
    td(esc(row.roles.join(" / "))),
    td(fmt(row.quantity,4)+" "+esc(row.kind==="cash"?row.currency:"")),
    td(money(row.marketValue)+(row.incomplete?'<small>有待补数据</small>':"")),
    td(ratio(navWeight(row.marketValue,report.nav))),
    td(signedMoney(row.totalImpact)),
    td(signedMoney(row.priceImpact)),
    td(signedMoney(row.fxImpact)),
  ]);
  table("holdings-table",["持仓","组合角色","数量","市值","占比","今日贡献","价格","汇率"],cells,"请添加持仓");
  by("account-total").innerHTML = [...report.accounts].map(([name,total])=>'<span>'+esc(name)+' <strong>'+money(total)+'</strong></span>').join("");
}

function showAttribution(report) {
  const rows = mergeAssets(report.values).filter(row=>fnum(row.totalImpact));
  const list = (title,items)=>'<div><h3>'+title+'</h3>'+ (items.length ? items.map(row=>
    '<div class="impact-row"><span>'+esc(row.kind==="cash"?row.currency+" 现金":row.symbol)+'</span>'+signedMoney(row.totalImpact)+'</div>').join("") :
    '<div class="work-note">无</div>')+'</div>';
  by("pnl-label").textContent = "价格 "+plus(report.priceImpact)+" · 汇率 "+plus(report.fxImpact);
  const gain = rows.filter(a=>a.totalImpact>0).sort((a,b)=>b.totalImpact-a.totalImpact).slice(0,5);
  const loss = rows.filter(a=>a.totalImpact<0).sort((a,b)=>a.totalImpact-b.totalImpact).slice(0,5);
  by("portfolio-attribution").innerHTML = list("主要正贡献",gain)+list("主要负贡献",loss);
}

function showExposure(report) {
  const rows = report.underlying.slice().sort((a,b)=>Number(b.direct>0&&b.indirect>0)-Number(a.direct>0&&a.indirect>0)||b.total-a.total);
  table("lookthrough-table",["标的","直接持有","ETF 间接持有","合计敞口","间接来源"],rows.slice(0,15).map(row=>[
    td(esc(row.symbol)),td(ratio(navWeight(row.direct,report.nav))),td(ratio(navWeight(row.indirect,report.nav))),
    td('<strong>'+ratio(navWeight(row.total,report.nav))+'</strong>'),td(esc([...row.funds.keys()].join(", ")||"—")),
  ]),"暂无可计算的个股或 ETF 成分");
  const dates = [...new Set(portfolio.weights.map(row=>row.date).filter(Boolean))].sort();
  by("lookthrough-note").textContent = (fnum(report.coverage)
    ? "已录入成分覆盖股票型 ETF 市值的 "+ratio(report.coverage)+"。间接敞口按现有数据计算。"
    : "股票型 ETF 的成分录入后即可计算间接敞口。") + (dates.length ? " 成分日期 "+dates.join("、")+"。" : "");
}

function compare(before,after) {
  const rows = [
    ["组合市值",before.nav,after?.nav,money],
    ["最大直接个股权重",before.concentration,after?.concentration,ratio,before.largest,after?.largest],
    ["前五大直接个股",before.topFive,after?.topFive,ratio],
    ["重叠敞口（已知）",before.overlap,after?.overlap,ratio],
    ["可用现金",before.cash,after?.cash,money],
    ["可售现金替代",before.reserve,after?.reserve,money],
    ["现金与可售替代合计",fnum(before.cash)?before.cash+before.reserve:null,fnum(after?.cash)?after.cash+after.reserve:null,money],
  ];
  table("simulation-table",["比较指标","操作前","操作后","变化"],rows.map(([label,a,b,format,left,right])=>[
    td(esc(label)),td((left?'<small>'+esc(left)+'</small>':"")+format(a)),
    td((right?'<small>'+esc(right)+'</small>':"")+format(b)),
    td(fnum(a)&&fnum(b)?(format===ratio?plus(b-a)+" pp":signedMoney(b-a)):"—"),
  ]));
}

function compareExposure(before,after) {
  by("simulation-overlap").hidden = !after;
  if (!after) return;
  const exposures = new Map();
  for (const [side,report] of [["before",before],["after",after]]) {
    for (const row of report.underlying) {
      if (!exposures.has(row.symbol)) exposures.set(row.symbol,{});
      exposures.get(row.symbol)[side] = row;
    }
  }
  const rows = [...exposures.entries()].filter(([,pair])=>[pair.before,pair.after].some(row=>row?.direct>0&&row?.indirect>0));
  table("simulation-exposure",["标的","直接前 / 后","间接前 / 后","合计权重变化"],rows.map(([symbol,pair])=>{
    const a = pair.before, b = pair.after;
    const beforePct = navWeight(a?.total??0,before.nav), afterPct = navWeight(b?.total??0,after.nav);
    return [td(esc(symbol)),
      td(ratio(navWeight(a?.direct??0,before.nav))+" / "+ratio(navWeight(b?.direct??0,after.nav))),
      td(ratio(navWeight(a?.indirect??0,before.nav))+" / "+ratio(navWeight(b?.indirect??0,after.nav))),
      td(fnum(beforePct)&&fnum(afterPct)?plus(afterPct-beforePct)+" pp":"—")];
  }),"已录入的 ETF 成分中暂无重叠");
}

function showSimulation(report,rates) {
  const outcome = orders.length ? simulate(portfolio.positions,orders) : null;
  const after = outcome?.positions ? analyze(outcome.positions,portfolio,rates) : null;
  const error = outcome?.errors.join(" ");
  by("simulation-error").textContent = error || "";
  compare(report,after);
  compareExposure(report,after);
  table("stress-table",["情景","操作前影响","操作后影响","变化"],portfolio.scenarios.map(scenario=>{
    const before = stressResult(report,scenario,portfolio.base);
    const next = after ? stressResult(after,scenario,portfolio.base) : null;
    const display = (value,nav)=>signedMoney(value)+(nav>0&&fnum(value)?'<small>'+pctText(value/nav*100)+'</small>':"");
    return [td(esc(scenario.name)),td(display(before,report.nav)),td(display(next,after?.nav)),td(fnum(before)&&fnum(next)?signedMoney(next-before):"—")];
  }),"暂无压力情景");
}

function draw() {
  const rates = effectiveRates(autoRates,portfolio.rates);
  const report = analyze(portfolio.positions,portfolio,rates);
  by("portfolio-empty").hidden = Boolean(report.values.length);
  by("portfolio-results").hidden = !report.values.length;
  const status = [
    demo ? "演示数据" : portfolio.date ? "持仓价格日期 "+portfolio.date : "持仓与账户仅保存在此浏览器",
    fxInfo || "正在获取汇率",
    persistenceWarning,
  ];
  if (report.validCount < report.values.length) status.push((report.values.length-report.validCount)+" 项缺少价格或汇率，其市值未纳入合计");
  const overrides = Object.keys(portfolio.rates).length;
  if (overrides) status.push(overrides+" 个币种使用手动汇率");
  by("portfolio-status").textContent = status.filter(Boolean).join(" · ");
  if (report.values.length) {
    showStats(report); showHoldings(report); showAttribution(report); showExposure(report); showSimulation(report,rates);
  }
}

function orderClassification(value) {
  const classes = {"":"自动识别"};
  for (const [bucket,label] of Object.entries(buckets)) {
    if (bucket === "cash") continue;
    classes[(["core","gold","duration","reserve"].includes(bucket)?"etf":"stock")+"/"+bucket] = label;
  }
  classes["etf/tech"]="科技 ETF";
  classes["etf/bank"]="金融 ETF";
  classes["etf/equity"]="其他股票 ETF";
  return options(classes,value);
}

function drawOrders() {
  const accounts = [...new Set(portfolio.positions.map(row=>row.account))];
  if (!orders.length) {
    by("trade-list").innerHTML = '<p class="work-note">添加买入或卖出，查看换仓后集中度、现金和压力损失。</p>';
    return;
  }
  by("trade-list").innerHTML = orders.map((order,index)=>{
    const field = (text,control)=>'<label>'+text+control+'</label>';
    const select = (name,content)=>'<select data-order-field="'+name+'">'+content+'</select>';
    const entry = (name,value,numeric=false)=>'<input data-order-field="'+name+'" '+(numeric?'type="number" step="any" min="0"':'type="text" placeholder="如 SPYM"')+' value="'+esc(value)+'">';
    return '<div class="trade-entry" data-order="'+index+'"><div class="trade-fields">'
      + field("账户",select("account",options(Object.fromEntries(accounts.map(x=>[x,x])),order.account)))
      + field("方向",select("side",options({sell:"卖出",buy:"买入"},order.side)))
      + field("代码",entry("symbol",order.symbol))
      + field("数量",entry("quantity",order.quantity,true))
      + field("价格",entry("price",order.price,true))
      + field("费用",entry("fee",order.fee,true))
      + '<button type="button" class="compact-button" aria-label="移除此操作" data-remove-order>×</button></div>'
      + '<div class="trade-options">'+field("币种",select("currency",currencyOptions(order.currency)))+
      field("新标的分类",select("classification",orderClassification(order.classification)))+'</div></div>';
  }).join("");
}

by("trade-list").addEventListener("click",event=>{
  if (!event.target.closest("[data-remove-order]")) return;
  const index = Number(event.target.closest("[data-order]").dataset.order);
  orders.splice(index,1);
  drawOrders();
  draw();
});
by("trade-list").addEventListener("input",event=>{
  const name = event.target.dataset.orderField;
  if (!name) return;
  orders[Number(event.target.closest("[data-order]").dataset.order)][name] = event.target.value;
  showSimulation(analyze(portfolio.positions,portfolio,effectiveRates(autoRates,portfolio.rates)),effectiveRates(autoRates,portfolio.rates));
});
by("add-trade").addEventListener("click",()=>{
  const account = portfolio.positions[0]?.account || "";
  orders.push({account,side:"sell",symbol:"",quantity:"",price:"",fee:"0",currency:portfolio.base,classification:""});
  drawOrders();
  by("trade-list").querySelector(".trade-entry:last-child input")?.focus();
});

const positionsFields = [
  ["account","账户","text"],["symbol","代码","text"],["name","名称","text"],["kind","类别","kind"],
  ["currency","币种","currency"],["quantity","数量 / 现金","number"],["price","现价","number"],
  ["previous","前收","number"],["cost","平均成本","number"],["bucket","压力分类","bucket"],
  ["role","组合角色","text"],["available","可动用","check"],
];
const weightsFields = [["fund","ETF","text"],["member","成分代码","text"],["weight","基金内权重 %","number"],["date","日期","date"],["source","来源","text"]];
const stressFields = [["name","情景","text"],...Object.entries(buckets).map(([key,label])=>[key,label,"number"]),["fx","外币均变动 %","number"]];
const rateFields = [["currency","每 1 USD 兑换","readonly"],["now","当期汇率","number"],["prev","前期汇率","number"]];
const modes = {
  positions:{title:"编辑账户与持仓",fields:positionsFields,prompt:"每行填一个账户的持仓或现金。现金行只需账户、币种和金额。可以用自定义文字描述每项持仓的作用。"},
  weights:{title:"ETF 成分权重",fields:weightsFields,prompt:"输入有来源的基金成分权重，例如 SPYM、NVDA、5.09。可只填关心的重叠标的。"},
  scenarios:{title:"压力情景设置",fields:stressFields,prompt:"输入百分比变化。负数表示下跌，外币冲击统一相对显示币种。"},
  rates:{title:"汇率设置",fields:rateFields,prompt:"以每 1 USD 兑换多少单位该币种录入。留空使用自动数据。前期汇率缺失时无法拆分该币种的汇率贡献。"},
};
const defaultRow = {
  positions:()=>({account:portfolio.positions[0]?.account||"",symbol:"",name:"",kind:"stock",currency:portfolio.base,quantity:"",price:"",previous:"",cost:"",bucket:"equity",role:"",available:true}),
  weights:()=>({fund:"",member:"",weight:"",date:"",source:""}),
  scenarios:()=>({name:"",...Object.fromEntries(Object.keys(buckets).map(key=>[key,0])),fx:0}),
};

function edit(mode) {
  const rows = mode==="rates" ? currencyList.filter(x=>x!=="USD").map(currency=>({currency,...portfolio.rates[currency]}))
    : structuredClone(portfolio[mode]);
  editor = {mode, rows, date:portfolio.date};
  by("editor-title").textContent = modes[mode].title;
  by("editor-error").textContent = "";
  by("editor-add").hidden = mode==="rates";
  by("editor-import").hidden = mode!=="positions";
  by("editor-export").hidden = mode!=="positions";
  renderEditor();
  editorDialog.showModal();
}

function editorField(row, key, label, kind) {
  const value = row[key];
  const attrs = 'data-field="'+key+'" aria-label="'+esc(label)+'"';
  if (kind==="readonly") return esc(value);
  if (kind==="check") return '<input type="checkbox" '+attrs+(value!==false?' checked':'')+'>';
  if (["kind","currency","bucket"].includes(kind)) return '<select '+attrs+'>'+ (kind==="kind"?options(assetKinds,value):kind==="bucket"?options(buckets,value):currencyOptions(value))+'</select>';
  const hint = editor.mode==="rates" && autoRates[row.currency]?.[key] ? ' placeholder="'+fmt(autoRates[row.currency][key],6).replace(/,/g,"")+'"' : "";
  return '<input type="'+kind+'" '+attrs+(kind==="number"?' step="any"':'')+hint+' value="'+esc(value)+'">';
}

function renderEditor() {
  const {mode,rows,date} = editor;
  const {prompt,fields} = modes[mode];
  const contents = rows.map((row,i)=>'<tr data-edit-row="'+i+'">'+fields.map(([key,label,kind])=>td(editorField(row,key,label,kind))).join("")
    +(mode==="rates"?"":td('<button type="button" class="compact-button" aria-label="删除这一行" data-delete-row>×</button>'))+'</tr>').join("");
  by("editor-content").innerHTML = '<p class="work-note">'+esc(prompt)+'</p>'
    +(mode==="positions"?'<div class="editor-fields"><label>价格日期（留空用最新汇率）<input type="date" id="portfolio-date" value="'+esc(date)+'"></label></div>':"")
    +'<div class="work-table-wrap"><table class="work-table editor-table"><thead><tr>'+fields.map(([,label])=>'<th scope="col">'+esc(label)+'</th>').join("")
    +(mode==="rates"?"":'<th scope="col"><span class="visually-hidden">操作</span></th>')+'</tr></thead><tbody>'+contents+'</tbody></table></div>';
}

by("editor-content").addEventListener("input",event=>{
  const input = event.target;
  if (input.id==="portfolio-date") {editor.date=input.value;return;}
  const field = input.dataset.field;
  if (!field) return;
  const row = editor.rows[Number(input.closest("[data-edit-row]").dataset.editRow)];
  row[field] = input.type==="checkbox" ? input.checked : input.value;
});
by("editor-content").addEventListener("click",event=>{
  if (!event.target.closest("[data-delete-row]")) return;
  editor.rows.splice(Number(event.target.closest("[data-edit-row]").dataset.editRow),1);
  renderEditor();
});
by("editor-add").addEventListener("click",()=>{
  editor.rows.push(defaultRow[editor.mode]());
  renderEditor();
  by("editor-content").querySelector("tbody tr:last-child input")?.focus();
});
by("editor-form").addEventListener("submit",event=>{
  event.preventDefault();
  try {
    const {mode,rows,date} = editor;
    const draft = {...portfolio};
    draft[mode] = mode==="rates" ? Object.fromEntries(rows.map(row=>[row.currency,row])) : rows;
    if (mode==="positions") draft.date=date;
    const next = normalizePortfolio(draft);
    writePortfolio(next);
    if (mode==="positions") orders = [];
    editorDialog.close();
    drawOrders();
    draw();
    if (mode==="positions") loadRates();
  } catch (error) {by("editor-error").textContent = error.message;}
});

function exportPortfolio() {
  const url = URL.createObjectURL(new Blob([JSON.stringify(portfolio,null,2)],{type:"application/json"}));
  const link = document.createElement("a");
  link.download = "Market-Portfolio.json";
  link.href = url;
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

by("import-portfolio").addEventListener("change",async event=>{
  const [file] = event.target.files;
  if (!file) return;
  try {
    if (file.size>1024*1024) throw new Error("持仓备份应小于 1 MB");
    const imported = normalizePortfolio(JSON.parse(await file.text()));
    writePortfolio(imported);
    orders = [];
    by("base-currency").value = portfolio.base;
    if (editorDialog.open) editorDialog.close();
    drawOrders();
    draw();
    loadRates();
  } catch(error) {
    if (editorDialog.open) by("editor-error").textContent = error.message;
    else by("portfolio-status").textContent = "导入失败 · "+error.message;
  } finally {event.target.value = "";}
});

async function referenceRates(date) {
  const end = date || formatter.format(Date.now());
  const start = new Date(Date.parse(end)-9*86400000).toISOString().slice(0,10);
  const query = new URLSearchParams({base:"USD",symbols:currencyList.filter(x=>!["USD","TWD","CNH"].includes(x)).join(",")});
  const request = await fetch("https://api.frankfurter.dev/v1/"+start+".."+end+"?"+query,{signal:AbortSignal.timeout(9000)});
  if (!request.ok) throw new Error("参考汇率不可用");
  const values = await request.json();
  const dates = Object.keys(values.rates || {}).filter(value=>value<=end).sort();
  const currentDate = dates.at(-1);
  const previousDate = dates.at(-2);
  if (!currentDate) throw new Error("参考汇率日期缺失");
  return {rates:Object.fromEntries(Object.entries(values.rates[currentDate]).map(([key,value])=>[key,{now:value,prev:values.rates[previousDate]?.[key]}])),
    label:"Frankfurter 日度汇率 "+currentDate+(previousDate?" / "+previousDate:"")};
}

async function loadRates() {
  const request = ++fxRequest;
  const date = portfolio.date && portfolio.date<formatter.format(Date.now()) ? portfolio.date : "";
  if (activeFxDate!==date) autoRates={};
  activeFxDate=date;
  by("refresh").disabled = true;
  try {
    let values;
    if (!date) {
      values = await requestMarket("fx").then(({rates})=>{
        const newest = Math.max(...Object.entries(rates).filter(([key])=>key!=="USD").map(([,row])=>row.time).filter(fnum));
        if (!fnum(newest)) throw new Error("没有报价");
        return {rates,label:"Yahoo 最新汇率 "+timeAt(newest)+" 北京"};
      }).catch(()=>null);
    }
    values ??= await referenceRates(date);
    if (request !== fxRequest) return;
    autoRates = values.rates;
    fxInfo = values.label;
    markRequest();
  } catch {
    if (request!==fxRequest) return;
    const snapshot = window.WORLD_SNAPSHOT;
    if (!date && !Object.keys(autoRates).length && Object.keys(snapshot?.fx || {}).length > 1) {
      autoRates = snapshot.fx;
      fxInfo = "汇率快照 "+timeAt(snapshot.capturedAt)+" 北京";
    } else {
      fxInfo = Object.keys(autoRates).length ? "本次汇率更新失败，保留上次读数" : "暂无自动汇率，可手动输入";
    }
  } finally {
    if (request===fxRequest) {
      draw();
      by("refresh").disabled = false;
    }
  }
}

for (const [button,mode] of [["edit-portfolio","positions"],["edit-exposure","weights"],["edit-rates","rates"],["edit-stress","scenarios"]]) {
  by(button).addEventListener("click",()=>edit(mode));
}
for (const id of ["editor-import","import-first"]) by(id).addEventListener("click",()=>by("import-portfolio").click());
by("editor-export").addEventListener("click",exportPortfolio);
by("base-currency").innerHTML = currencyOptions(portfolio.base);
by("base-currency").addEventListener("change",event=>{
  const next = {...portfolio,base:event.target.value};
  if (demo) portfolio = next;
  else writePortfolio(next);
  draw();
});
by("sample-portfolio").addEventListener("click",()=>{
  portfolio = normalizePortfolio(sample);
  demo = true;
  by("base-currency").value = portfolio.base;
  drawOrders();
  draw();
  loadRates();
});
by("holdings-sort").addEventListener("change",draw);
by("refresh").addEventListener("click",loadRates);
drawOrders();
draw();
loadRates();
setInterval(()=>{if(!document.hidden)loadRates();},120000);
