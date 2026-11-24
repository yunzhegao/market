"use strict";

const by = id => document.getElementById(id);
const fnum = Number.isFinite;
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
const fmt = (value, digits = 2) => fnum(value) ? value.toLocaleString("en-US", {minimumFractionDigits:digits, maximumFractionDigits:digits}) : "—";
const tone = value => value > 0 ? "up" : value < 0 ? "down" : "";
const plus = (value, digits = 2) => fnum(value) ? (value > 0 ? "+" : "") + fmt(value, digits) : "—";
const pctText = value => fnum(value) ? plus(value) + "%" : "—";
const storageKeys = {portfolio:"market-observation-portfolio-v1", theme:"market-monitor-theme"};
const configured = window.MARKET_LIVE_CONFIG?.apiBase?.replace(/\/$/, "");
const endpoint = configured || ".";
const browserFile = location.protocol === "file:";
const hasApi = browserFile ? Boolean(configured) : Boolean(configured) || !location.hostname.endsWith(".github.io");
const portfolioEvent = "market-portfolio-saved";
const tickerPattern = /^\^?[A-Z0-9][A-Z0-9.=^\-]{0,18}$/;

function localRead(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}

function localWrite(key, content) {
  try { localStorage.setItem(key, JSON.stringify(content)); return true; }
  catch { return false; }
}

async function requestSavedPortfolio() {
  const response = await fetch("./api/portfolio",{cache:"no-store",signal:AbortSignal.timeout(8000)});
  if (!response.ok) return null;
  const data = await response.json();
  return Number.isSafeInteger(data.version) ? data : null;
}

function timeAt(time, zone = "Asia/Shanghai", full = false) {
  if (!fnum(time)) return "—";
  const format = timeZone => new Intl.DateTimeFormat("zh-CN", {
    timeZone, ...(full ? {year:"numeric"} : {}), month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hourCycle:"h23",
  }).format(time);
  try { return format(zone || "Asia/Shanghai"); } catch { return format("UTC"); }
}

async function requestMarket(scope, parameters = {}, timeout = 23000) {
  if (!hasApi) throw new Error("行情接口未配置");
  const query = new URLSearchParams({scope, ...parameters});
  const response = await fetch(endpoint + "/api/market?" + query, {cache:"no-store", signal:AbortSignal.timeout(timeout)});
  if (!response.ok) throw new Error("行情暂不可用");
  return response.json();
}

async function latestMarketQuotes(symbols) {
  const unique = [...new Set(symbols)].filter(symbol => tickerPattern.test(symbol));
  const quoteBatch = async i => {
    const batch = unique.slice(i,i+8);
    const data = await requestMarket("world",{symbols:batch.join(",")});
    return Object.entries(data.quotes || {}).filter(([symbol,row]) =>
      batch.includes(symbol) && row && fnum(row.price) && fnum(row.time));
  };
  const batches = Array.from({length:Math.ceil(unique.length/8)},(_,i)=>i*8);
  const results = await Promise.allSettled(batches.map(quoteBatch));
  return Object.fromEntries(results.flatMap(result=>result.status==="fulfilled"?result.value:[]));
}

const sessionNames = {pre:"盘前",regular:"盘中/收盘",post:"盘后"};
const marketZoneLabel = zone => ({"America/New_York":"美东","Asia/Singapore":"新加坡","Asia/Hong_Kong":"香港",
  "Asia/Shanghai":"中国内地","Asia/Tokyo":"日本","Europe/London":"伦敦","America/Toronto":"多伦多"})[zone] || zone;
function quoteStamp(quote, session) {
  if (quote.observationDate) return [quote.observationDate,session ?? "当地收盘"].filter(Boolean).join(" · ");
  const zone = quote.timezone || "UTC";
  const time = timeAt(quote.time,zone) + " " + marketZoneLabel(zone);
  const detail = session ?? [sessionNames[quote.session],quote.delayMinutes ? "延迟 "+quote.delayMinutes+" 分钟" : ""].filter(Boolean).join(" · ");
  return [time,detail].filter(Boolean).join(" · ");
}

function markRequest(time = Date.now()) {
  const node = by("sync-time");
  node.hidden = false;
  node.dateTime = new Date(time).toISOString();
  node.textContent = "更新 " + timeAt(time) + " 北京 · " + timeAt(time,"America/New_York") + " 美东";
}

function initTheme() {
  const button = by("theme");
  let saved;
  try { saved = localStorage.getItem(storageKeys.theme); } catch {}
  const apply = dark => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    button.setAttribute("aria-pressed", String(dark));
    by("theme-color").content = dark ? "#10141b" : "#ffffff";
  };
  apply(saved === "dark");
  button.addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme !== "dark";
    apply(dark);
    try { localStorage.setItem(storageKeys.theme, dark ? "dark" : "light"); } catch {}
  });
}

initTheme();
