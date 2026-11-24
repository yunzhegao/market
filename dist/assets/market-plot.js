"use strict";

const axisStyle = 'fill="var(--muted)" font-size="11"';

function priceScale(values, top, bottom) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max((max - min) * .11, Math.abs(max) * .002, .0001);
  const low = min - pad;
  const high = max + pad;
  const y = value => bottom - (value - low) / (high - low) * (bottom - top);
  return {low, high, y};
}

const hasOHLC = row => row.slice(2, 5).length === 3 && row.slice(2, 5).every(Number.isFinite);

function drawMarketPlot(target, rows, {candle = false, base, history = rows, pointLabel = row => String(row[0]), axisLabel = pointLabel,
  sessionDay, sessionLabel, axisFormat = String, axisWidth = 38, timeDomain, timeLabel, timeTicks, candleSlot,
  estimated = () => false, breakLine = () => false, quietCursor = false, comparison, formatDelta, overlays = []} = {}) {
  const points = candle ? rows.filter(hasOHLC) : rows;
  if (!points.length) {
    target.replaceChildren();
    return null;
  }
  const sessions = Boolean(sessionDay);
  const width = Math.max(200, target.clientWidth || 600);
  const height = Math.max(62, target.clientHeight || 160);
  const left = 7, right = width - axisWidth, top = 7, bottom = height - 17;
  const step = (right - left) / points.length;
  const [startTime,endTime] = timeDomain ?? [points[0][0],points.at(-1)[0]];
  const timeSpan = typeof startTime === "number" ? endTime - startTime : 0;
  const inset = timeDomain ? Math.min(10,step*.5) : step*.5;
  const timeX = time => left + inset + (time - startTime) / timeSpan * (right - left - 2*inset);
  const x = !sessions && timeSpan > 0 ? index => timeX(points[index][0]) : index => left + step * (index + .5);
  const values = points.flatMap(r => candle ? [r[3], r[4]] : [r[1]]);
  for (const overlay of overlays) values.push(...overlay.values.filter(Number.isFinite));
  if (Number.isFinite(base)) values.push(base);
  const {low, high, y} = priceScale(values, top, bottom);
  const grid = Array.from({length: height < 110 ? 3 : 5}, (_, i) => {
    const intervals = height < 110 ? 2 : 4;
    const level = high - i * (high - low) / intervals;
    const pos = y(level).toFixed(2);
    return '<line x1="' + left + '" x2="' + right + '" y1="' + pos + '" y2="' + pos + '" stroke="var(--line)"/><text x="' + (right + 6) + '" y="' + (Number(pos) + 4) + '" ' + axisStyle + '>' + axisFormat(level) + '</text>';
  }).join("");
  const reference = Number.isFinite(base) ? '<line x1="' + left + '" x2="' + right + '" y1="' + y(base) + '" y2="' + y(base) + '" stroke="var(--chart-guide)" stroke-dasharray="4 3"/>' : "";
  const sessionDays = sessions ? points.map(sessionDay) : [];
  const starts = sessionDays.flatMap((day, i) => i === 0 || day !== sessionDays[i - 1] ? [i] : []);
  const separators = starts.slice(1).map(index => {
    const pos = (x(index - 1) + x(index)) / 2;
    return '<line x1="' + pos + '" x2="' + pos + '" y1="' + top + '" y2="' + bottom
      + '" stroke="var(--line)" stroke-dasharray="3 3"/>';
  }).join("");
  const slots = width < 400 ? 4 : 5;
  const count = Math.min(slots, points.length);
  const tickPositions = sessions
    ? starts.map((start, i) => ({index: Math.floor((start + (starts[i + 1] ?? points.length) - 1) / 2), label: sessionLabel(sessionDays[start])}))
    : timeDomain && timeSpan > 0
      ? (timeTicks?.(slots) ?? Array.from({length:slots},(_,i)=>startTime+i*timeSpan/(slots-1)))
        .map(at=>({position:timeX(at),label:timeLabel(at)}))
      : Array.from({length: count}, (_, i) => {
      const index = count === 1 ? 0 : Math.round(i * (points.length - 1) / (count - 1));
      return {index, label: axisLabel(points[index])};
    });
  const dateTicks = tickPositions.map(({index, position, label}) => {
    const pos = Math.max(25, Math.min(right - 7, position ?? x(index)));
    return '<text x="' + pos + '" y="' + (height - 2) + '" text-anchor="middle" ' + axisStyle + '>' + label + '</text>';
  }).join("");
  let graphics;
  if (candle) {
    const slot = candleSlot && timeSpan > 0 ? (right - left - 2*inset)*candleSlot/timeSpan : step;
    const bodyWidth = Math.min(26,step*.58,slot*.58);
    graphics = points.map((row, i) => {
      const [,end,start,highPrice,lowPrice] = row;
      const pos = x(i);
      const color = end >= start ? "var(--up)" : "var(--down)";
      return '<g'+(estimated(row)?' opacity=".63"':'')+'><line x1="' + pos + '" x2="' + pos + '" y1="' + y(highPrice) + '" y2="' + y(lowPrice) + '" stroke="' + color + '" stroke-width="1.5"/><rect x="' + (pos - bodyWidth / 2) + '" y="' + y(Math.max(start, end)) + '" width="' + bodyWidth + '" height="' + Math.max(2, Math.abs(y(start) - y(end))) + '" rx="1" fill="' + color + '"/></g>';
    }).join("");
  } else {
    const groups = sessions ? starts : points.flatMap((row,i)=>i===0 || breakLine(points[i-1],row) ? [i] : []);
    graphics = '<defs><linearGradient id="' + target.id + '-area" x2="0" y2="1"><stop stop-color="var(--chart-line)" stop-opacity=".18"/><stop offset="1" stop-color="var(--chart-line)" stop-opacity=".02"/></linearGradient></defs>'
      + groups.map((start, group) => {
        const end = groups[group + 1] ?? points.length;
        const path = points.slice(start, end).map((r, i) => (i === 0 ? "M" : "L") + x(start + i) + "," + y(r[1])).join(" ");
        if (quietCursor && end===start+1) {
          const px=x(start),py=y(points[start][1]);
          return '<path stroke="var(--chart-line)" stroke-width="2" stroke-linecap="round" d="M'+(px-1.5)+','+py+'h3"/>';
        }
        const dash = estimated(points[start]) ? ' stroke-dasharray="5 3" stroke-opacity=".76"' : "";
        return '<path fill="url(#' + target.id + '-area)" d="' + path + ' L' + x(end - 1) + ',' + bottom + ' L' + x(start) + ',' + bottom + ' Z"/>'
          + '<path fill="none" stroke="var(--chart-line)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'+dash+' d="' + path + '"/>';
      }).join("");
  }
  const comparisonLines = overlays.map(overlay=>{
    let connected = false;
    const path = overlay.values.map((value,i)=>{
      if (!Number.isFinite(value)) {connected=false;return "";}
      const command = connected ? "L" : "M";
      connected = true;
      return command+x(i)+","+y(value);
    }).join(" ");
    return '<path fill="none" stroke="'+overlay.color+'" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" d="'+path+'"/>';
  }).join("");
  target.innerHTML = '<svg viewBox="0 0 ' + width + ' ' + height + '" aria-hidden="true">' + grid + separators + reference + graphics + comparisonLines + dateTicks
    + '<line data-guide style="opacity:0" stroke="var(--chart-guide)" stroke-opacity=".75" stroke-dasharray="4 3"/><circle data-cursor style="opacity:0" r="4.1" fill="var(--chart-line)" stroke="var(--chart-dot-ring)" stroke-width="1.6"/></svg>';
  const tip = document.createElement("div");
  tip.className = "chart-point-tip";
  tip.hidden = true;
  tip.setAttribute("aria-hidden", "true");
  const tipTime = document.createElement("span");
  const tipValue = document.createElement("strong");
  tip.append(tipTime, tipValue);
  target.append(tip);
  const previousValues = new Map(history.map((row, i) => [row[0], history[i - 1]?.[1]]));
  return {points, x, y, top, bottom, width, height, candle, base, previousValues, pointLabel, quietCursor, comparison, formatDelta,
    guide: target.querySelector("[data-guide]"), cursor: target.querySelector("[data-cursor]"),
    tip, tipTime, tipValue};
}

function plotPoint(view, readout, format) {
  if (!view.plot) {
    readout.textContent = "";
    return;
  }
  const {points, x, y, top, bottom, width, height, candle, base, previousValues, pointLabel, quietCursor, comparison, formatDelta,
    guide, cursor, tip, tipTime, tipValue} = view.plot;
  const index = Math.min(view.selected ?? points.length - 1, points.length - 1);
  const row = points[index];
  const stamp = pointLabel(row);
  const [, closeValue, open, high, low] = row;
  const before = comparison ? comparison(row,points[index-1]) : Number.isFinite(base) ? base : previousValues.get(row[0]) ?? points[index-1]?.[1];
  const tone = !Number.isFinite(before) ? "" : closeValue > before ? "up" : closeValue < before ? "down" : "";
  const value = document.createElement("strong");
  value.className = tone;
  value.textContent = candle ? "开 " + format(open) + " 高 " + format(high) + " 低 " + format(low) + " 收 " + format(closeValue) : format(closeValue);
  if (formatDelta && Number.isFinite(before)) value.textContent += " · " + formatDelta(closeValue,before);
  readout.textContent = stamp + "  ";
  readout.append(value);
  const pos = x(index);
  const level = y(closeValue);
  const selected = view.selected !== null;
  guide.setAttribute("x1", pos);
  guide.setAttribute("x2", pos);
  guide.setAttribute("y1", top);
  guide.setAttribute("y2", bottom);
  guide.style.opacity = selected ? "1" : "0";
  cursor.setAttribute("cx", pos);
  cursor.setAttribute("cy", level);
  cursor.style.opacity = !selected && (candle || quietCursor) ? "0" : "1";
  tip.hidden = !selected;
  if (selected) {
    tipTime.textContent = stamp;
    tipValue.textContent = candle ? "收 " + format(closeValue) : format(closeValue);
    tipValue.className = tone;
    const side = pos + tip.offsetWidth + 10 < width ? pos + 10 : pos - tip.offsetWidth - 10;
    const vertical = level - tip.offsetHeight - 9 >= 0 ? level - tip.offsetHeight - 9 : level + 10;
    tip.style.left = Math.max(4, Math.min(width - tip.offsetWidth - 4, side)) + "px";
    tip.style.top = Math.max(0, Math.min(height - tip.offsetHeight, vertical)) + "px";
  }
}

function pointIndex(view, x) {
  const {points, x: at} = view.plot;
  let index = 0;
  while (index + 1 < points.length && x >= (at(index) + at(index + 1)) / 2) index++;
  return index;
}

function bindPlot(target, view, show) {
  function move(event) {
    if (!view.plot) return;
    const index = pointIndex(view, event.clientX - target.getBoundingClientRect().left);
    if (index === view.selected) return;
    view.selected = index;
    show();
  }
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerdown", move);
  target.addEventListener("pointerleave", event => {
    if (event.pointerType !== "mouse") return;
    view.selected = null;
    show();
  });
  target.addEventListener("keydown", event => {
    if (!view.plot) return;
    const next = plotKey(event.key, view.selected, view.plot.points.length);
    if (next === undefined || (next === null && view.selected === null)) return;
    if (next !== null) event.preventDefault();
    view.selected = next;
    show();
  });
}

function plotKey(key, selected, length) {
  const end = length - 1;
  const index = selected ?? end;
  if (key === "Escape") return null;
  if (key === "Home") return 0;
  if (key === "End") return end;
  if (key === "ArrowLeft") return Math.max(0, index - 1);
  if (key === "ArrowRight") return Math.min(end, index + 1);
}

