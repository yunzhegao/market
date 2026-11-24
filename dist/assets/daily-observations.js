"use strict";

function dailyObservation(series) {
  const rows = Array.isArray(series?.rows) ? series.rows : [];
  const [date, value] = rows.at(-1) ?? [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(value)) return null;
  const [basis, previous] = rows.findLast(row => row?.[0] < date && Number.isFinite(row[1])) ?? [];
  const source = {fred:"FRED", treasury:"美国财政部"}[series.source] ?? "随站快照";
  return {date, value, basis, source, move:Number.isFinite(previous) ? Math.round((value - previous) * 100) : null};
}

function observationMeta(reading) {
  if (!reading) return {short:"暂无观测", full:"暂无观测"};
  const format = date => date?.slice(5).replace("-", "/") ?? "—";
  return {
    short:reading.source + " · 观测 " + format(reading.date) + " · 基准 " + format(reading.basis),
    full:reading.source + " · 观测日 " + reading.date + " · 比较基准日 " + (reading.basis ?? "—"),
  };
}

function observationBasisPoints(reading) {
  const move = reading?.move;
  if (!Number.isFinite(move)) return "—";
  return (move > 0 ? "+" : move < 0 ? "−" : "") + Math.abs(move).toLocaleString("en-US") + " bp";
}
