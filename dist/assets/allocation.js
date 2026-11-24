"use strict";

const allocationColors = {
  core:"#3e81dc", tech:"#7855c0", bank:"#cc8452", equity:"#387c88",
  gold:"#be9b44", duration:"#86a45d", cash:"#687d9c",
};
let allocationMode = "category";
let allocationSelected;
let allocationRows = [];
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

function circleSegments(rows,total,radius) {
  let offset=0;
  return rows.filter(row=>row.value>0).map(row=>{
    const length=row.value/total*100;
    const space=Math.min(.55,length*.2);
    const arc='<circle data-allocation-item="'+esc(row.key)+'" cx="105" cy="105" r="'+radius+'" pathLength="100"'
      +' stroke="'+row.color+'" stroke-opacity="'+(row.shade??1)+'" stroke-dasharray="'+(length-space)+' '+(100-length+space)
      +'" stroke-dashoffset="'+(-offset)+'" transform="rotate(-90 105 105)"><title>'+esc(row.label+" · "+fmt(length)+"%")+'</title></circle>';
    offset+=length;
    return arc;
  }).join("");
}

function chooseAllocation(key) {
  allocationSelected = key;
  const current = allocationRows.find(row=>row.key===key) ?? allocationRows[0];
  if (!current) return;
  const {label,value,impact,rate,partial} = current;
  by("allocation-center").innerHTML = '<span>'+esc(label)+'</span><strong>'+fmt(value)+'</strong><small>'
    +esc(allocationCurrency)+'</small><b class="'+tone(impact)+'">'+pctText(rate)+'</b>';
  for (const item of by("allocation-chart").querySelectorAll("[data-allocation-item]")) {
    item.classList.toggle("allocation-active", key === item.dataset.allocationItem || item.dataset.allocationItem.startsWith(key+"/"));
  }
  for (const row of by("allocation-legend").querySelectorAll("button")) {
    row.setAttribute("aria-pressed",String(row.dataset.allocationItem===key));
  }
  by("allocation-note").textContent = partial
    ? "该组涨跌按有完整前收和汇率的持仓计算。内圈为分类，外圈为持仓。"
    : "内圈为分类，外圈为持仓。涨跌和变动贡献按 "+allocationCurrency+" 计算，含汇率影响。";
}

function showAllocationLegend() {
  const [total,...rows] = allocationRows;
  const shown = rows.filter(row=>allocationMode==="category" ? Boolean(row.assets) : !row.assets);
  by("allocation-legend").innerHTML = shown.map(row=>
    '<button type="button" class="allocation-row" data-allocation-item="'+esc(row.key)+'" aria-pressed="false">'
    +'<span class="allocation-label"><i style="background:'+row.color+'"></i><span><b>'+esc(row.label)+'</b>'
    +(row.sublabel?'<small>'+esc(row.sublabel)+'</small>':"")+'</span></span>'
    +'<span>'+fmt(row.value/total.value*100)+'%</span><span class="'+tone(row.rate)+'">'+pctText(row.rate)
    +'</span><span class="'+tone(row.impact)+'">'+plus(row.impact)+'</span></button>').join("");
  for (const button of by("allocation-legend").querySelectorAll("button")) {
    button.addEventListener("click",()=>chooseAllocation(button.dataset.allocationItem));
    button.addEventListener("focus",()=>chooseAllocation(button.dataset.allocationItem));
  }
  chooseAllocation(allocationSelected);
}

function renderAllocation(report,currency) {
  allocationCurrency = currency;
  const chart = by("allocation-chart");
  const groups = overviewAllocation(report.values);
  if (!(report.nav>0)) {
    allocationRows=[];
    chart.textContent="暂无可计价持仓";
    by("allocation-legend").replaceChildren();
    return;
  }
  const assets = groups.flatMap(row=>row.assets);
  const summary = {...allocationRollup(report.values.filter(row=>fnum(row.marketValue))),key:"total",label:"组合市值"};
  allocationRows=[summary,...groups,...assets];
  chart.innerHTML = '<svg viewBox="0 0 210 210" aria-hidden="true">'
    +'<g class="allocation-outer">'+circleSegments(assets,summary.value,87)+'</g>'
    +'<g class="allocation-inner">'+circleSegments(groups,summary.value,67)+'</g></svg>'
    +'<div id="allocation-center" class="allocation-center"></div>';
  for (const item of chart.querySelectorAll("[data-allocation-item]")) {
    item.addEventListener("pointerenter",()=>chooseAllocation(item.dataset.allocationItem));
    item.addEventListener("click",()=>chooseAllocation(item.dataset.allocationItem));
  }
  showAllocationLegend();
}

for (const button of document.querySelectorAll("[data-allocation-mode]")) {
  button.addEventListener("click",()=>{
    allocationMode=button.dataset.allocationMode;
    allocationSelected=undefined;
    for (const peer of document.querySelectorAll("[data-allocation-mode]")) {
      peer.setAttribute("aria-pressed",String(peer===button));
    }
    if (allocationRows.length) showAllocationLegend();
  });
}
