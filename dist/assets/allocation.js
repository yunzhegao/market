"use strict";

const allocationColors = {
  core:"#3e81dc", tech:"#7855c0", bank:"#cc8452", equity:"#387c88",
  gold:"#be9b44", duration:"#86a45d", cash:"#687d9c", ...cryptoBucketColors,
};
let allocationMode = "category";
let allocationReport;
let allocationCurrency;

function allocationRollup(rows) {
  const value = rows.reduce((total,row)=>total+(row.marketValue||0),0);
  const known = rows.filter(row=>fnum(row.totalImpact) && fnum(row.previousValue));
  const base = sum(known,"previousValue");
  const impact = sum(known,"totalImpact");
  return {value,impact,rate:base>0 ? impact/base*100 : null, partial:known.length!==rows.length};
}

function overviewAllocation(values) {
  const groups = new Map();
  for (const row of values) {
    if (!fnum(row.marketValue) || row.marketValue < 0) continue;
    const category = cashClass(row) ? "cash" : row.bucket;
    if (!groups.has(category)) groups.set(category,new Map());
    const key = [row.symbol,row.currency,row.kind].join("/");
    const members = groups.get(category);
    if (!members.has(key)) members.set(key,[]);
    members.get(key).push(row);
  }
  return [...groups].map(([category,members])=>{
    const assets = [...members].map(([key,rows])=>{
      const row = rows[0];
      const cashType = cashClass(row);
      const sublabel = cashType === "book" ? "账面现金" : cashType === "equivalent" ? "现金替代"
        : (row.name || assetKinds[row.kind])+" · "+buckets[category];
      return {...allocationRollup(rows),key:category+"/"+key,
        label:row.kind==="cash"?row.currency+" 现金":row.symbol,
        sublabel};
    }).sort((a,b)=>b.value-a.value);
    return {...allocationRollup([...members.values()].flat()), key:category,label:buckets[category],
      color:allocationColors[category], assets:assets.map((row,index)=>({...row,color:allocationColors[category],shade:1-.37*(index%4)/3}))};
  }).sort((a,b)=>b.value-a.value);
}

function allocationSegments(groups,total) {
  let offset=0;
  return groups.filter(group=>group.value>0).map(group=>{
    const length=group.value/total*100;
    const gap=Math.min(1.15,length*.22);
    const start=offset+gap/2, span=length-gap;
    offset+=length;
    let memberOffset=start;
    const members=group.assets.filter(row=>row.value>0);
    const assets=members.map((row,i)=>{
      const width=span*row.value/group.value;
      const halfGap=Math.min(.19,width*.13);
      const before=i===0?0:halfGap, after=i===members.length-1?0:halfGap;
      const segment={...row,start:memberOffset+before,span:width-before-after};
      memberOffset+=width;
      return segment;
    });
    return {...group,start,span,assets};
  });
}

function circleSegments(rows,total,radius) {
  return rows.map(row=>{
    const arc='<circle data-allocation-item="'+esc(row.key)+'" cx="105" cy="105" r="'+radius+'" pathLength="100"'
      +' stroke="'+row.color+'" stroke-opacity="'+(row.shade??1)+'" stroke-dasharray="'+row.span+' '+(100-row.span)
      +'" stroke-dashoffset="'+(-row.start)+'" transform="rotate(-90 105 105)"><title>'+esc(row.label+" · "+fmt(row.value/total*100)+"%")+'</title></circle>';
    return arc;
  }).join("");
}

function chooseAllocation(panel,rows,key) {
  const current = rows.find(row=>row.key===key) ?? rows[0];
  const {label,value,impact,rate,partial} = current;
  panel.querySelector(".allocation-center").innerHTML = '<span title="'+esc(label)+'">'+esc(label)+'</span><strong>'+fmt(value)+'</strong><small>'
    +esc(allocationCurrency)+'</small><b class="'+tone(impact)+'">'+pctText(rate)+'</b>';
  for (const item of panel.querySelectorAll("circle[data-allocation-item]")) {
    item.classList.toggle("allocation-active", current.key===item.dataset.allocationItem || item.dataset.allocationItem.startsWith(current.key+"/"));
  }
  for (const row of panel.querySelectorAll(".allocation-legend button")) {
    row.setAttribute("aria-pressed",String(row.dataset.allocationItem===current.key));
  }
  panel.querySelector(".allocation-partial").hidden = !partial;
}

function allocationLegend(total, rows) {
  const shown = rows.filter(row=>allocationMode==="category" ? Boolean(row.assets) : !row.assets);
  return shown.map(row=>
    '<button type="button" class="allocation-row" data-allocation-item="'+esc(row.key)+'" aria-pressed="false">'
    +'<span class="allocation-label"><i style="background:'+row.color+'"></i><span><b>'+esc(row.label)+'</b>'
    +(row.sublabel?'<small>'+esc(row.sublabel)+'</small>':"")+'</span></span>'
    +'<span>'+fmt(row.value/total.value*100)+'%</span><span class="'+tone(row.rate)+'">'+pctText(row.rate)
    +'</span><span class="'+tone(row.impact)+'">'+plus(row.impact)+'</span></button>').join("");
}

function renderAllocationPanel(panel,{name,values},compare) {
  const heading = compare ? '<h3>'+esc(name)+'</h3>' : "";
  const excludeCash = by("allocation-exclude-cash").checked;
  const shown = values.filter(row=>fnum(row.marketValue) && row.marketValue>=0 && !(excludeCash&&cashClass(row)));
  const summary = {...allocationRollup(shown),key:"total",label:excludeCash?"非现金市值":name?"账户总市值":"组合市值"};
  if (!(summary.value>0)) {
    panel.innerHTML = heading+'<p class="work-note">'+(excludeCash?"暂无可计价的非现金持仓":"暂无可计价持仓")+'</p>';
    return;
  }
  const groups = allocationSegments(overviewAllocation(shown),summary.value);
  const assets = groups.flatMap(row=>row.assets);
  const rows = [summary,...groups,...assets];
  panel.innerHTML = heading+'<div class="allocation-layout"><div class="allocation-chart" aria-label="外圈是持仓，内圈是分类">'
    +'<svg viewBox="0 0 210 210" aria-hidden="true">'
    +'<g class="allocation-outer">'+circleSegments(assets,summary.value,87)+'</g>'
    +'<g class="allocation-inner">'+circleSegments(groups,summary.value,67)+'</g></svg>'
    +'<div class="allocation-center"></div></div><div class="allocation-key">'
    +'<div class="allocation-row allocation-head"><span>分类／持仓</span><span>权重</span><span>涨跌</span><span>变动贡献</span></div>'
    +'<div class="allocation-legend">'+allocationLegend(summary,[...groups,...assets])+'</div></div></div>'
    +'<p class="work-note allocation-partial" hidden>涨跌按有完整前收和汇率的持仓计算。</p>';
  const reset = ()=>chooseAllocation(panel,rows);
  for (const item of panel.querySelectorAll("[data-allocation-item]")) {
    const select = ()=>chooseAllocation(panel,rows,item.dataset.allocationItem);
    item.addEventListener("pointerenter",select);
    item.addEventListener("pointerleave",reset);
    item.addEventListener("focus",select);
    item.addEventListener("blur",reset);
    item.addEventListener("click",select);
    item.addEventListener("keydown",event=>{if(event.key==="Escape") reset();});
  }
  reset();
}

function drawAllocation() {
  if (!allocationReport) return;
  const all = {scope:"all",name:"",values:allocationReport.values};
  const accounts = new Map();
  for (const row of all.values) {
    if (!accounts.has(row.account)) accounts.set(row.account,{scope:"account:"+row.account,name:row.account,values:[]});
    accounts.get(row.account).values.push(row);
  }
  const select = by("allocation-account");
  const saved = select.value;
  const options = [[all.scope,"全部账户"],...[...accounts.values()].map(row=>[row.scope,row.name])];
  if (accounts.size>1) options.push(["compare","分账户对比"]);
  const markup = options.map(([value,label])=>'<option value="'+esc(value)+'">'+esc(label)+'</option>').join("");
  if (select.innerHTML!==markup) select.innerHTML=markup;
  select.value = options.some(([value])=>value===saved)?saved:all.scope;
  const compare = select.value==="compare";
  const panels = compare ? [...accounts.values()] : [select.value===all.scope?all:accounts.get(select.value.slice(8))];
  const container = by("allocation-panels");
  container.classList.toggle("is-comparison",compare);
  container.replaceChildren(...panels.map(data=>{
    const panel=document.createElement("div");
    panel.className="allocation-panel";
    renderAllocationPanel(panel,data,compare);
    return panel;
  }));
  by("allocation-note").textContent = "内圈为分类，外圈为持仓。涨跌和变动贡献按 "+allocationCurrency+" 计算，含汇率影响。"
    +(by("allocation-exclude-cash").checked?" 已排除账面现金及现金替代。":"");
}

function renderAllocation(report,currency) {
  allocationReport = report;
  allocationCurrency = currency;
  drawAllocation();
}

by("allocation-account").addEventListener("change",drawAllocation);
by("allocation-exclude-cash").addEventListener("change",drawAllocation);
for (const button of document.querySelectorAll("[data-allocation-mode]")) {
  button.addEventListener("click",()=>{
    allocationMode=button.dataset.allocationMode;
    for (const peer of document.querySelectorAll("[data-allocation-mode]")) {
      peer.setAttribute("aria-pressed",String(peer===button));
    }
    drawAllocation();
  });
}
