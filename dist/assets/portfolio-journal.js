"use strict";

const portfolioJournalPrefix = "market-private-journal-v1:";
const journalKinds = {
  buy:{label:"买入",security:true,quantity:true},
  sell:{label:"卖出",security:true,quantity:true,direction:-1},
  tender:{label:"参与回购并卖出",security:true,quantity:true,direction:-1},
  deposit:{label:"入金",external:1},
  withdrawal:{label:"出金",external:-1},
  transfer:{label:"组合内转账"},
  dividend:{label:"现金分红",security:true},
  reinvest:{label:"券商自动再投资",security:true,quantity:true},
  stockDividend:{label:"股票股息",security:true,quantity:true,sharesOnly:true},
  sharesAdded:{label:"股份调整（增加）",security:true,quantity:true,sharesOnly:true},
  sharesRemoved:{label:"股份调整（减少）",security:true,quantity:true,direction:-1,sharesOnly:true},
  interest:{label:"利息"},
  fee:{label:"费用或税费"},
  equity:{label:"全组合期末净值"},
};
const journalIdValid = value=>typeof value==="string" && /^[a-f0-9]{32}$/.test(value);
const newJournalId = ()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,"0")).join("");
const emptyJournal = ()=>({entries:[],coverage:null});
const journalToday = ()=>navDate(Date.now());

function normalizeJournalHoldings(rows) {
  if (!Array.isArray(rows) || rows.length>400 || rows.some(row=>!row || !["stock","etf","crypto","stable"].includes(row.kind)
    || typeof row.account!=="string" || !cleanText(row.account) || typeof row.symbol!=="string" || !symbolValid(row.symbol) || !currencyValid(row.currency)
    || !fnum(row.quantity) || !(row.quantity>0))) throw new Error("对账持仓快照格式有误。");
  return navHoldings(rows.map(row=>({...row,account:cleanText(row.account)})),true);
}

function normalizeJournalEntry(raw) {
  if (!journalIdValid(raw?.id) || !Object.hasOwn(journalKinds,raw?.kind)
    || !currencyValid(raw.currency)) throw new Error("请检查流水类型和币种。");
  const {kind,id,currency} = raw, type = journalKinds[kind], pending = raw.pending===true;
  const date = raw.date || null, positionDate = kind==="reinvest" ? raw.positionDate || null : null;
  if (date ? !validNavDate(date) || date>journalToday() : !pending || kind==="equity") {
    throw new Error("请填写有效日期。流水的日期不清楚时可标为待核对并留空。");
  }
  if (positionDate && (!validNavDate(positionDate) || positionDate>journalToday())) {
    throw new Error("请检查再投资成交日期。");
  }
  const account = kind==="equity" ? "" : cleanText(raw.account);
  const symbol = type.security ? cleanText(raw.symbol,19).toUpperCase() : "";
  if (kind!=="equity" && !account) throw new Error("请填写账户。");
  if (type.security && !symbolValid(symbol)) throw new Error("请填写有效的证券代码。");
  const quantity = type.quantity ? numberFromInput(raw.quantity) : null;
  const amount = type.sharesOnly ? null : numberFromInput(raw.amount);
  const reinvestAmount = kind==="reinvest" ? numberFromInput(raw.reinvestAmount) : null;
  if (type.quantity && ((quantity===null && !pending) || (quantity!==null && quantity<=0))) throw new Error("请填写大于零的股数。");
  if (!type.sharesOnly && ((amount===null && !pending) || (amount!==null && amount<0)
    || (type.external && amount===0))) throw new Error("请填写有效金额。");
  if (reinvestAmount!==null && reinvestAmount<=0) throw new Error("再投资实际扣款需大于零。");
  const convertedAmount = type.external ? numberFromInput(raw.convertedAmount) : null;
  let conversion = null;
  if (convertedAmount!==null) {
    if (!currencyValid(raw.convertedCurrency) || convertedAmount<=0) throw new Error("请检查折合金额。");
    if (raw.convertedCurrency!==currency) conversion = {currency:raw.convertedCurrency,amount:convertedAmount};
  }
  const holdings = kind==="equity" && raw.holdings!=null ? normalizeJournalHoldings(raw.holdings) : null;
  return {id,kind,date,positionDate,currency,account,symbol,quantity,amount,reinvestAmount,conversion,pending,note:cleanText(raw.note,240),
    ...(holdings ? {holdings} : {})};
}

function normalizeJournal(raw) {
  if (!Array.isArray(raw?.entries) || raw.entries.length>10000) throw new Error("流水备份格式有误或超过 10,000 笔。");
  const entries = raw.entries.map(row=>normalizeJournalEntry({...row,
    convertedCurrency:row.conversion?.currency,convertedAmount:row.conversion?.amount}));
  if (new Set(entries.map(row=>row.id)).size!==entries.length) throw new Error("流水备份中有重复的记录编号。");
  const checkpoints = entries.filter(row=>row.kind==="equity").map(row=>row.date+"/"+row.currency);
  if (new Set(checkpoints).size!==checkpoints.length) throw new Error("同一天同币种只保留一条全组合净值，请修改已有记录。");
  const coverage = raw.coverage ?? null;
  if (coverage && (!validNavDate(coverage.from) || !validNavDate(coverage.to) || coverage.from>=coverage.to || coverage.to>journalToday())) {
    throw new Error("请填写有效的覆盖日期，起点需早于截止日。");
  }
  const brokerHistory = raw.brokerHistory == null ? null : normalizeBrokerHistory(raw.brokerHistory);
  return {entries,coverage:coverage ? {from:coverage.from,to:coverage.to} : null,...(brokerHistory ? {brokerHistory} : {})};
}

function normalizeBrokerHistory(raw) {
  if (!Array.isArray(raw.periods) || raw.periods.length>250 ||
    !Array.isArray(raw.archivedEntries) || raw.archivedEntries.length>10000) {
    throw new Error("券商历史格式有误。");
  }
  const periods = raw.periods.map(row=>{
    const {scope,from,to,opening,closing,netDeposits,estimated,summary,source} = row ?? {};
    if (typeof scope!=="string" || !scope.trim() || !validNavDate(from) || !validNavDate(to)
      || from>to || to>journalToday() || ![opening,closing,netDeposits].every(Number.isFinite)) {
      throw new Error("请检查券商历史的账户、日期和金额。");
    }
    return {scope:cleanText(scope),from,to,opening,closing,netDeposits,estimated:estimated===true,summary:summary===true,source:cleanText(source,240)};
  });
  const archivedEntries = raw.archivedEntries.map(row=>normalizeJournalEntry({...row,
    convertedCurrency:row?.conversion?.currency,convertedAmount:row?.conversion?.amount}));
  if (new Set(archivedEntries.map(row=>row.id)).size!==archivedEntries.length || archivedEntries.some(row=>row.kind==="equity")) {
    throw new Error("历史流水含有重复编号或全组合净值。");
  }
  const checks = raw.valuationChecks ?? [];
  if (!Array.isArray(checks) || checks.length>100) throw new Error("估值核对记录格式有误。");
  const valuationChecks = checks.map(row=>{
    const {date,marketValue,reconciledValue,note} = row ?? {};
    if (!validNavDate(date) || date>journalToday() || ![marketValue,reconciledValue].every(Number.isFinite)) {
      throw new Error("请检查估值核对记录的日期和金额。");
    }
    return {date,marketValue,reconciledValue,note:cleanText(note,240)};
  });
  return {periods,archivedEntries,...(valuationChecks.length ? {valuationChecks} : {})};
}

function readPrivateJournal(id=portfolio.journalId) {
  if (!journalIdValid(id)) return emptyJournal();
  return localRead(portfolioJournalPrefix+id,emptyJournal());
}

function journalGrowth(book,base) {
  if (!book.coverage) return {state:"unconfirmed"};
  const {from,to} = book.coverage;
  const valuations = book.entries.filter(row=>row.kind==="equity" && row.currency===base && row.date>=from && row.date<=to && fnum(row.amount))
    .sort((a,b)=>a.date.localeCompare(b.date));
  if (valuations.length<2) return {state:"needValues"};
  const first = valuations[0], last = valuations.at(-1);
  const interval = book.entries.filter(row=>row.kind!=="equity" && row.date>first.date && row.date<=last.date);
  const undated = book.entries.filter(row=>row.kind!=="equity" && !row.date);
  if (undated.some(row=>journalKinds[row.kind].external)) return {state:"missingDate",from:first.date,to:last.date};
  const flows = interval.filter(row=>journalKinds[row.kind].external).map(row=>{
    const amount = row.currency===base ? row.amount : row.conversion?.currency===base ? row.conversion.amount : null;
    return fnum(amount) ? amount*journalKinds[row.kind].external : null;
  });
  if (flows.some(value=>value===null)) return {state:"missingFlow",from:first.date,to:last.date};
  const netDeposits = flows.reduce((sum,value)=>sum+value,0);
  const snapshots = valuations.filter(row=>row.holdings);
  const unbalanced = snapshots.some((row,i)=>i>0 && reconcileJournalHoldings(book,snapshots[i-1],row).length>0);
  const estimated = first.pending || last.pending || interval.some(row=>row.pending) || undated.length>0 || unbalanced;
  return {state:estimated?"estimated":"reconciled",from:first.date,to:last.date,base,
    opening:first.amount,closing:last.amount,netDeposits,growth:last.amount-first.amount-netDeposits};
}

function journalDisplayState(book,base) {
  const stats = journalGrowth(book,base);
  const messages = {
    unconfirmed:book.entries.length?"已登记流水，尚未确认覆盖区间。":"缺少交易、分红和出入金流水，历史表现仍按持仓快照估算。",
    needValues:"请在覆盖区间内录入至少两个 "+base+" 的全组合期末净值。",
    missingFlow:"区间内有出入金缺少金额或折合 "+base+" 的金额，暂无法计算投资净增长。",
    missingDate:"有出入金尚未确定入账日，暂无法计算投资净增长。",
    estimated:"仍有记录或股数差额待核对，显示暂估结果。",
    reconciled:"按已确认区间的期末净值和外部入出金计算。",
  };
  const pending = book.entries.filter(row=>row.pending).length;
  return {stats,pending,message:messages[stats.state]};
}

function reconcileJournalHoldings(book,first,last) {
  const totals = new Map();
  const accumulate = (row,column,quantity)=>{
    const key = JSON.stringify([row.account,row.symbol,row.currency]);
    const item = totals.get(key) ?? {account:row.account,symbol:row.symbol,currency:row.currency,observed:0,logged:0};
    item[column] += quantity;
    totals.set(key,item);
  };
  for (const row of first.holdings) accumulate(row,"observed",-row.quantity);
  for (const row of last.holdings) accumulate(row,"observed",row.quantity);
  for (const row of book.entries) {
    const effective = row.positionDate ?? row.date;
    const type = journalKinds[row.kind];
    if (type.quantity && fnum(row.quantity) && effective>first.date && effective<=last.date) {
      accumulate(row,"logged",row.quantity*(type.direction??1));
    }
  }
  return [...totals.values()].map(row=>({...row,difference:row.observed-row.logged}))
    .filter(row=>Math.abs(row.difference)>1e-8+1e-10*Math.max(Math.abs(row.observed),Math.abs(row.logged)));
}

function savePrivateJournal(change) {
  const current = readPrivateJournal();
  const next = normalizeJournal(change(current));
  const id = portfolio.journalId ?? newJournalId();
  const key = portfolioJournalPrefix+id;
  if (!localWrite(key,next)) throw new Error("浏览器无法保存流水，请检查本机存储空间。");
  if (!portfolio.journalId) {
    const updated = {...portfolio,journalId:id};
    if (!localWrite(storageKeys.portfolio,updated)) throw new Error("浏览器无法保存流水所属的组合。");
    portfolio = updated;
  }
  renderPortfolioJournal();
}

function renderPortfolioJournal() {
  const section = by("portfolio-journal");
  if (!section) return;
  section.hidden = demo;
  if (demo) return;
  const book = readPrivateJournal();
  const {stats,pending,message} = journalDisplayState(book,portfolio.base);
  const summary = by("journal-summary-status");
  if (summary) summary.textContent = pending ? pending+" 条待核对" : book.entries.length ? book.entries.length+" 条记录" : "可选";
  by("journal-status").textContent = (book.coverage ? "流水覆盖 "+book.coverage.from+" – "+book.coverage.to+" · " : "")
    +book.entries.length+" 条记录 · "+pending+" 条待核对 · "+message;
  if (!by("journal-table") && !book.entries.length) by("journal-status").textContent = "实绩流水尚未录入，历史表现为估算。";
  const period = fnum(stats.growth) ? stats.from+" – "+stats.to+" · "+stats.base : "";
  by("journal-results").hidden = !period;
  by("journal-net-in").textContent = plus(stats.netDeposits);
  by("journal-growth").textContent = plus(stats.growth);
  by("journal-growth-label").textContent = stats.state==="estimated" ? "暂估投资净增长" : "投资净增长";
  by("journal-growth").className = tone(stats.growth);
  by("journal-growth-period").textContent = period;
  if (!by("journal-table")) {
    renderBrokerHistory(book.brokerHistory,true);
    return;
  }
  if (!section.open) return;
  renderBrokerHistory(book.brokerHistory);
  const archived = book.brokerHistory?.archivedEntries ?? [];
  by("journal-details").hidden = !book.entries.length && !archived.length;
  const rows = [...book.entries,...archived.map(row=>({...row,archived:true}))].reverse()
    .sort((a,b)=>(b.date??"").localeCompare(a.date??""));
  table("journal-table",["日期","记录","账户／标的","金额／股数","状态","操作"],rows.map(row=>[
    td(esc(row.date??"日期待核对")+(row.positionDate && row.positionDate!==row.date?'<small>再投资成交 '+esc(row.positionDate)+'</small>':"")),
    td(esc(journalKinds[row.kind].label)+(row.holdings?'<small>含持仓快照</small>':"")+(row.note?'<small>'+esc(row.note)+'</small>':"")),
    td(esc([row.account,row.symbol].filter(Boolean).join(" · ")||"全组合")),
    td((fnum(row.amount) ? fmt(row.amount)+" "+esc(row.currency) : "—")+(fnum(row.quantity)?'<small>'+esc(row.quantity)+" 股</small>":"")
      +(fnum(row.reinvestAmount) ? '<small>再投资 '+fmt(row.reinvestAmount)+(fnum(row.amount)?" · 现金净变化 "+plus(row.amount-row.reinvestAmount):"")+'</small>' : "")),
    td(row.pending?"待核对":row.archived?"券商归档":"已核对"),
    td(row.archived?"—":'<button type="button" class="text-button" data-journal-id="'+row.id+'">编辑</button>'),
  ]),"暂无流水或净值记录");
  renderJournalReconciliation(book);
}

function renderBrokerHistory(history,summariesOnly=false) {
  const rows = (history?.periods ?? []).filter(row=>!summariesOnly || row.summary);
  by("broker-history").hidden = !rows.length;
  if (!rows.length) return;
  table("broker-history-table",["账户／区间","期初净值","净入金","期末净值","投资净增长","依据"],rows.map(row=>{
    const growth = Math.round((row.closing-row.opening-row.netDeposits)*100)/100;
    const label = row.summary ? "<strong>"+esc(row.scope)+"</strong>" : esc(row.scope);
    return [td(label+"<small>"+esc(row.from+" – "+row.to)+"</small>"),td(fmt(row.opening)),td(plus(row.netDeposits)),
      td(fmt(row.closing)),td(plus(growth),tone(growth)),td(esc((row.estimated?"暂估 · ":"")+row.source))];
  }));
  by("broker-valuation-checks").replaceChildren(...(history.valuationChecks ?? []).map(row=>{
    const note = document.createElement("p");
    const delta = Math.round((row.marketValue-row.reconciledValue)*100)/100;
    note.className = "work-note";
    note.textContent = row.date+" 估值对账 · 逐项行情 "+fmt(row.marketValue)+" · 结单与估值合计 "+fmt(row.reconciledValue)
      +" · 差额 "+plus(delta)+" USD。"+row.note;
    return note;
  }));
}

function renderJournalReconciliation(book) {
  const section = by("journal-reconciliation");
  const snapshots = book.entries.filter(row=>row.kind==="equity" && row.currency===portfolio.base && row.holdings)
    .sort((a,b)=>a.date.localeCompare(b.date));
  section.hidden = snapshots.length<2;
  if (section.hidden) return;
  const [first,last] = snapshots.slice(-2);
  const differences = reconcileJournalHoldings(book,first,last);
  const undated = book.entries.filter(row=>journalKinds[row.kind].quantity && !(row.positionDate ?? row.date)).length;
  by("journal-reconciliation-summary").textContent = differences.length ? "持仓对账 · "+differences.length+" 项差额" : "持仓对账 · 已录股数相符";
  by("journal-reconciliation-status").textContent = first.date+" – "+last.date
    +" · 按成交或获股日期核对股数。"
    +(undated ? " 还有 "+undated+" 笔股数变动日期待核对。" : "")
    +(differences.length ? " 差额发生在这段区间，请凭券商记录补上日期。" : "");
  by("journal-differences-wrap").hidden = !differences.length;
  const shares = value=>plus(value,Math.abs(value)>=1 ? 4 : 8).replace(/(\.\d*?)0+$/,"$1").replace(/\.$/,"");
  table("journal-differences",["账户／标的","股数变化","已录流水","待核差额"],differences.map(row=>[
    td(esc(row.account+" · "+row.symbol)),td(shares(row.observed)),td(shares(row.logged)),td(shares(row.difference)),
  ]));
}

let editingJournalEntry = null;
function syncJournalFields() {
  const kind = by("journal-kind").value, type = journalKinds[kind], pending = by("journal-pending").checked;
  const visibility = (id,visible,required=false)=>{
    const field = by(id);
    field.closest("label").hidden = !visible;
    field.disabled = !visible;
    field.required = required && visible;
  };
  visibility("journal-account",kind!=="equity",true);
  visibility("journal-symbol",Boolean(type.security),true);
  visibility("journal-quantity",Boolean(type.quantity),!pending);
  by("journal-date").required = !pending || kind==="equity";
  by("journal-date-label").textContent = kind==="equity" ? "估值日期" : ["buy","sell","tender"].includes(kind) ? "成交日期" : "入账日期";
  by("journal-capture-wrap").hidden = kind!=="equity";
  visibility("journal-position-date",kind==="reinvest");
  visibility("journal-amount",!type.sharesOnly,!pending);
  visibility("journal-reinvest-amount",kind==="reinvest");
  visibility("journal-converted-amount",Boolean(type.external) && by("journal-currency").value!==by("journal-converted-currency").value);
  visibility("journal-converted-currency",Boolean(type.external));
  by("journal-amount-label").textContent = ["dividend","reinvest"].includes(kind) ? "税后分红金额"
    : ["buy","sell","tender"].includes(kind) ? "实际结算金额（含费用）" : "金额";
  by("journal-entry-help").textContent = kind==="reinvest" ? "即使券商分开列出分红和买入，也只记一笔。填写税后分红与新增股数，已知实际扣款时也可填写，以核对剩余现金。"
    : kind==="dividend" ? "记录实际留在账户里的税后现金分红。同一笔分红有自动买入时，选择「券商自动再投资」。"
    : kind==="equity" ? "填写截至所选日期的全组合净值。只有当前持仓确属该日期时，才勾选一并保存。"
    : kind==="tender" ? "用于你实际交回股票并收到款项的情况。公司在市场上回购、你的股数和现金未变时，无需录入。"
    : type.external ? "只登记组合与外部之间的资金进出。组合内账户互转请选择「组合内转账」。"
    : "日期、金额或股数暂不清楚时，可先留空并勾选「待核对」。";
}

function openJournalEntry(row=null,{checkpoint=false}={}) {
  editingJournalEntry = row?.id ?? null;
  const fields = {kind:row?.kind??(checkpoint?"equity":"buy"),date:row ? row.date??"" : checkpoint ? journalToday() : "",
    "position-date":row?.positionDate??"",account:row?.account??portfolio.positions[0]?.account??"",
    symbol:row?.symbol??"",currency:row?.currency??portfolio.base,quantity:row?.quantity??"",amount:row?.amount??"","reinvest-amount":row?.reinvestAmount??"",
    "converted-currency":row?.conversion?.currency??portfolio.base,"converted-amount":row?.conversion?.amount??"",note:row?.note??""};
  for (const [key,value] of Object.entries(fields)) by("journal-"+key).value = value;
  by("journal-pending").checked = row ? row.pending : true;
  by("journal-capture").checked = Boolean(row?.holdings);
  by("journal-entry-error").textContent = "";
  by("journal-delete").hidden = !row;
  syncJournalFields();
  by("journal-dialog").showModal();
}

function initPortfolioJournal() {
  if (!by("journal-add")) return;
  by("journal-kind").innerHTML = options(Object.fromEntries(Object.entries(journalKinds).map(([kind,type])=>[kind,type.label])),"buy");
  by("journal-currency").innerHTML = currencyOptions(portfolio.base);
  by("journal-converted-currency").innerHTML = currencyOptions(portfolio.base);
  by("journal-add").addEventListener("click",()=>openJournalEntry());
  by("journal-checkpoint").addEventListener("click",()=>openJournalEntry(null,{checkpoint:true}));
  by("portfolio-journal").addEventListener("toggle",()=>{if(by("portfolio-journal").open) renderPortfolioJournal();});
  by("journal-table").addEventListener("click",event=>{
    const id = event.target.closest("[data-journal-id]")?.dataset.journalId;
    const row = readPrivateJournal().entries.find(item=>item.id===id);
    if (row) openJournalEntry(row);
  });
  for (const key of ["kind","currency","converted-currency","pending"]) by("journal-"+key).addEventListener("change",syncJournalFields);
  by("journal-form").addEventListener("submit",event=>{
    event.preventDefault();
    try {
      const values = Object.fromEntries(new FormData(event.target));
      savePrivateJournal(book=>{
        const previous = book.entries.find(row=>row.id===editingJournalEntry);
        const holdings = values.kind==="equity" && by("journal-capture").checked ? previous?.holdings
          ?? navHoldings(portfolio.positions.filter(row=>row.kind!=="cash"),true) : null;
        const entry = normalizeJournalEntry({...values,holdings,id:editingJournalEntry??newJournalId(),pending:by("journal-pending").checked});
        const entries = previous ? book.entries.map(row=>row.id===entry.id?entry:row) : [...book.entries,entry];
        return {...book,entries};
      });
      by("journal-dialog").close();
      by("journal-details").open = true;
    } catch (error) {by("journal-entry-error").textContent = error.message;}
  });
  by("journal-delete").addEventListener("click",()=>{
    if (!editingJournalEntry || !window.confirm("删除这条本机记录？")) return;
    try {
      savePrivateJournal(book=>({...book,entries:book.entries.filter(row=>row.id!==editingJournalEntry)}));
      by("journal-dialog").close();
    } catch (error) {by("journal-entry-error").textContent = error.message;}
  });
  by("journal-cover").addEventListener("click",()=>{
    const {coverage} = readPrivateJournal();
    by("journal-cover-from").value = coverage?.from ?? "";
    by("journal-cover-to").value = coverage?.to ?? journalToday();
    by("journal-cover-error").textContent = "";
    by("journal-cover-dialog").showModal();
  });
  const saveCoverage = coverage=>{
    try {
      savePrivateJournal(book=>({...book,coverage}));
      by("journal-cover-dialog").close();
    } catch (error) {by("journal-cover-error").textContent = error.message;}
  };
  by("journal-cover-form").addEventListener("submit",event=>{
    event.preventDefault();
    saveCoverage({from:by("journal-cover-from").value,to:by("journal-cover-to").value});
  });
  by("journal-cover-clear").addEventListener("click",()=>saveCoverage(null));
}
