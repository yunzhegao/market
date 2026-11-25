const companies = {COIN:1679788,HOOD:1783879,CRCL:1876042,MSTR:1050446,MARA:1507605,RIOT:1167419,CLSK:827876};
const day = 86400000;
const fiscalFacts = (facts,names,unit,low,high) => {
  for (const name of names) {
    const rows = (facts[name]?.units?.[unit] ?? []).filter(row=>{
      const length = (Date.parse(row.end)-Date.parse(row.start))/day;
      return (row.form==="10-Q" || row.form==="10-K" || row.form==="10-Q/A" || row.form==="10-K/A") &&
        Number.isFinite(row.val) && typeof row.filed==="string" && length>=low && length<=high;
    });
    if (!rows.length) continue;
    return [...new Map(rows.sort((a,b)=>a.filed.localeCompare(b.filed)).map(row=>[row.end,row])).values()]
      .sort((a,b)=>a.end.localeCompare(b.end));
  }
  return [];
};

export function readCompanyMetrics(raw) {
  const facts = raw.facts?.["us-gaap"] ?? {};
  const quarterly = fiscalFacts(facts,["RevenueFromContractWithCustomerExcludingAssessedTax","Revenues","SalesRevenueNet","RevenueFromContractWithCustomerIncludingAssessedTax"],"USD",75,105);
  const latest = quarterly.at(-1);
  const previous = latest && quarterly.findLast(row=>Math.abs((Date.parse(latest.end)-Date.parse(row.end))/day-365)<=12);
  const annualEPS = fiscalFacts(facts,["EarningsPerShareDiluted"],"USD/shares",350,380).at(-1);
  if (!latest && !annualEPS) return null;
  return {revenue:latest?.val,revenueDate:latest?.end,revenueFiled:latest?.filed,revenueChange:previous?.val>0 ? (latest.val/previous.val-1)*100 : null,
    annualEPS:annualEPS?.val,annualEPSDate:annualEPS?.end};
}

export async function cryptoCompanyFilings() {
  const results = await Promise.all(Object.entries(companies).map(async ([symbol,cik])=>{
    const id = String(cik).padStart(10,"0");
    try {
      const response = await fetch("https://data.sec.gov/api/xbrl/companyfacts/CIK"+id+".json",{
        headers:{"User-Agent":"Market Observation https://yunzhegao.github.io","Accept":"application/json"},
        signal:AbortSignal.timeout(8000)
      });
      if (!response.ok) return null;
      const metrics = readCompanyMetrics(await response.json());
      return metrics ? [symbol,{...metrics,cik}] : null;
    } catch {return null;}
  }));
  const rows = Object.fromEntries(results.filter(Boolean));
  if (!Object.keys(rows).length) throw new Error("No company filings");
  return {time:Date.now(),rows};
}
