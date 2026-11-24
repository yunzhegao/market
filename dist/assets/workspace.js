"use strict";

const by = id => document.getElementById(id);
const fnum = Number.isFinite;
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
const fmt = (value, digits = 2) => fnum(value) ? value.toLocaleString("en-US", {minimumFractionDigits:digits, maximumFractionDigits:digits}) : "—";
const tone = value => value > 0 ? "up" : value < 0 ? "down" : "";
const plus = (value, digits = 2) => fnum(value) ? (value > 0 ? "+" : "") + fmt(value, digits) : "—";
const pctText = value => fnum(value) ? plus(value) + "%" : "—";
const storageKeys = {portfolio:"market-observation-portfolio-v1", watch:"market-observation-watch-v1", theme:"market-monitor-theme"};
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

function timeAt(time, zone = "Asia/Shanghai", full = false) {
  if (!fnum(time)) return "—";
  const format = timeZone => new Intl.DateTimeFormat("zh-CN", {
    timeZone, ...(full ? {year:"numeric"} : {}), month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hourCycle:"h23",
  }).format(time);
  try { return format(zone || "Asia/Shanghai"); } catch { return format("UTC"); }
}

async function requestMarket(scope, parameters = {}) {
  if (!hasApi) throw new Error("行情接口未配置");
  const query = new URLSearchParams({scope, ...parameters});
  const response = await fetch(endpoint + "/api/market?" + query, {cache:"no-store", signal:AbortSignal.timeout(23000)});
  if (!response.ok) throw new Error("行情暂不可用");
  return response.json();
}

function markRequest(time = Date.now()) {
  const node = by("sync-time");
  node.hidden = false;
  node.dateTime = new Date(time).toISOString();
  node.textContent = "更新 " + timeAt(time) + " 北京";
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
