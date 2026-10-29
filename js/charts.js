// Börsen-Chart (TradingView Lightweight Charts): Preis als Kerzen/Linie, Liter als "Volumen", Kosten als Depotkurve.
import { $, cssVar, fuelPrice, eur, num, signed, isNum, fmtDate, DAY, avg } from './util.js';
import { consumptionSegments, paidPrice } from './stats.js';

let chart, series = [], hoverHandler;
const el = () => $('#chart');

/** ms → UTCTimestamp, so verschoben dass die Achse lokale Zeit zeigt */
const ts = (ms) => Math.floor((ms - new Date(ms).getTimezoneOffset() * 60000) / 1000);

function uniqTimes(points) {
  let last = -Infinity;
  return points.map((p) => { const time = p.time <= last ? last + 1 : p.time; last = time; return { ...p, time }; });
}

export function rangeStart(range, entries) {
  const now = new Date();
  switch (range) {
    case '1M': return now - 31 * DAY;
    case '3M': return now - 92 * DAY;
    case '6M': return now - 183 * DAY;
    case '1Y': return now - 366 * DAY;
    case 'YTD': return new Date(now.getFullYear(), 0, 1).getTime();
    default: return entries.length ? new Date(entries[0].date).getTime() - DAY : 0;
  }
}

function ensureChart() {
  if (chart || !window.LightweightCharts) return chart;
  const LC = window.LightweightCharts;
  chart = LC.createChart(el(), {
    autoSize: true,
    layout: { background: { type: 'solid', color: 'transparent' }, textColor: cssVar('--muted'), fontFamily: cssVar('--rounded'), fontSize: 11, attributionLogo: false },
    grid: { vertLines: { visible: false }, horzLines: { color: cssVar('--grid') } },
    rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.22 } },
    timeScale: { borderVisible: false, timeVisible: false, fixLeftEdge: true, fixRightEdge: true, lockVisibleTimeRangeOnResize: true },
    crosshair: { mode: LC.CrosshairMode.Magnet, vertLine: { labelBackgroundColor: cssVar('--accent') }, horzLine: { labelBackgroundColor: cssVar('--accent') } },
    localization: { locale: 'de-DE', dateFormat: 'dd.MM.yy' },
    handleScroll: { vertTouchDrag: false },
  });
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    chart.applyOptions({ layout: { textColor: cssVar('--muted') }, grid: { horzLines: { color: cssVar('--grid') } } });
  });
  return chart;
}

function clear() {
  series.forEach((s) => chart.removeSeries(s));
  series = [];
  if (hoverHandler) chart.unsubscribeCrosshairMove(hoverHandler);
  hoverHandler = null;
  el().querySelector('.chart-empty')?.remove();
}

function empty(msg) {
  const d = document.createElement('div');
  d.className = 'chart-empty';
  d.innerHTML = msg;
  el().append(d);
}

const priceFmt = { type: 'custom', formatter: (p) => num(p, 3, 3), minMove: 0.001 };
const eurFmt = { type: 'custom', formatter: (p) => num(p, 0) + ' €', minMove: 1 };
const lFmt = { type: 'custom', formatter: (p) => num(p, 1, 1), minMove: 0.1 };

function bucketKey(ms, by) {
  const d = new Date(ms);
  if (by === 'week') {
    const day = (d.getDay() + 6) % 7;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day).getTime();
  }
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function candles(points, by) {
  const map = new Map();
  for (const p of points) {
    const k = bucketKey(p.ms, by);
    const c = map.get(k);
    if (!c) map.set(k, { time: ts(k), open: p.v, high: p.v, low: p.v, close: p.v });
    else { c.high = Math.max(c.high, p.v); c.low = Math.min(c.low, p.v); c.close = p.v; }
  }
  const list = [...map.values()].sort((a, b) => a.time - b.time);
  // Wie an der Börse: Eröffnung = Schluss der Vorperiode (sonst wären Kerzen mit nur einer Tankung flach)
  for (let i = 1; i < list.length; i++) {
    list[i].open = list[i - 1].close;
    list[i].high = Math.max(list[i].high, list[i].open);
    list[i].low = Math.min(list[i].low, list[i].open);
  }
  return list;
}

/** Tagesweise günstigster Preis der Umgebung aus den Schnappschüssen */
function marketDaily(snapshots, from) {
  const map = new Map();
  for (const s of snapshots) {
    if (s.t < from || !isNum(s.min)) continue;
    const d = new Date(s.t); const k = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    (map.get(k) || map.set(k, []).get(k)).push(s.min);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => ({ time: ts(k), value: Math.min(...v) }));
}

/** Tages-OHLC aus allen Messpunkten des günstigsten Preises */
function marketCandles(snapshots, from) {
  const map = new Map();
  for (const s of [...snapshots].sort((a, b) => a.t - b.t)) {
    if (s.t < from || !isNum(s.min)) continue;
    const k = ts(new Date(s.t).setHours(0, 0, 0, 0));
    const c = map.get(k);
    if (!c) map.set(k, { time: k, open: s.min, high: s.min, low: s.min, close: s.min, avgs: isNum(s.avg) ? [s.avg] : [] });
    else { c.high = Math.max(c.high, s.min); c.low = Math.min(c.low, s.min); c.close = s.min; if (isNum(s.avg)) c.avgs.push(s.avg); }
  }
  const list = [...map.values()];
  // Farbe wie an der Börse: Schluss ggü. Vortagesschluss
  for (let i = 1; i < list.length; i++) {
    list[i].open = list[i - 1].close;
    list[i].high = Math.max(list[i].high, list[i].open);
    list[i].low = Math.min(list[i].low, list[i].open);
  }
  return list;
}

/**
 * Zeichnet den Chart und gibt die Kopfzeilen-Infos zurück.
 * @returns {{ price: string, change: string, cls: string, label: string, legend: string }}
 */
export function renderChart({ entries, snapshots, mode, range, style }, onHover) {
  const c = ensureChart();
  if (!c) return { price: '–', change: '', cls: '', label: '', legend: '' };
  clear();
  const from = rangeStart(range, entries);
  const list = entries.filter((e) => new Date(e.date).getTime() >= from);
  const up = cssVar('--up'), down = cssVar('--down'), accent = cssVar('--accent'), muted = '#8e8e93';
  const head = { price: '–', change: '&nbsp;', cls: '', label: '', legend: '' };
  const byTime = new Map(); // für Hover

  if (mode === 'price') {
    head.label = 'Dein Tankpreis';
    if (!list.length) {
      empty('Noch keine Tankungen in diesem Zeitraum.<br>Tippe auf <b>+</b> und scanne deinen ersten Beleg.');
    } else {
      const pts = list.map((e) => ({ ms: new Date(e.date).getTime(), v: paidPrice(e), e }));
      const first = pts[0].v, last = pts[pts.length - 1].v, diff = last - first;
      const color = diff > 0 ? up : down;

      const mCandles = marketCandles(snapshots, from);
      let volFrom = -Infinity;
      if (style === 'candle' && mCandles.length >= 5) {
        // Echte Tageskerzen aus den Marktpreisen der Umgebung, deine Tankungen als "Käufe" darauf
        const s = c.addCandlestickSeries({ upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down, priceFormat: priceFmt });
        s.setData(mCandles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
        mCandles.forEach((d) => byTime.set(d.time, `${fuelPrice(d.close)} <small>Markt · H ${num(d.high, 3)} · T ${num(d.low, 3)}</small>`));
        const firstCandle = mCandles[0].time;
        const inCandles = pts.filter((p) => ts(new Date(p.ms).setHours(0, 0, 0, 0)) >= firstCandle);
        s.setMarkers(inCandles.map((p) => {
          const day = ts(new Date(p.ms).setHours(0, 0, 0, 0));
          const ref = mCandles.find((d) => d.time === day);
          const dayAvg = ref?.avgs.length ? avg(ref.avgs) : NaN;
          const good = !isNum(dayAvg) || p.v <= dayAvg;
          const dd = (p.v - dayAvg) * 100;
          byTime.set(day, `${fuelPrice(p.v)} <small>getankt · ${num(p.e.liters, 1)} L${isNum(dayAvg) ? ` · ${good ? '👍' : '👎'} ${num(Math.abs(dd), 1)} ct ${dd <= 0 ? 'günstiger' : 'teurer'} als Ø Umgebung` : ''}</small>`);
          return { time: day, position: 'belowBar', color: good ? down : up, shape: 'arrowUp', text: inCandles.length <= 6 ? num(p.v, 3) : '' };
        }));
        volFrom = firstCandle;
        series.push(s);
        head.legend = `<span>Kerze = 1 Tag · günstigstes E10 in der Nähe</span><span><i style="background:${down}"></i>billiger als am Vortag</span><span><i style="background:${up}"></i>teurer als am Vortag</span><span><b class="down">▲</b> du hast günstig getankt</span><span><b class="up">▲</b> du hast teuer getankt</span>`;
      } else if (style === 'candle') {
        const by = range === '1M' || range === '3M' ? 'week' : 'month';
        const s = c.addCandlestickSeries({ upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down, priceFormat: priceFmt });
        const data = candles(pts, by);
        s.setData(data);
        data.forEach((d) => byTime.set(d.time, `${fuelPrice(d.close)} <small>H ${num(d.high, 3)} · T ${num(d.low, 3)}</small>`));
        series.push(s);
        head.legend = `<span><i style="background:${down}"></i>Preis gesunken = gut</span><span><i style="background:${up}"></i>Preis gestiegen = schlecht</span>`;
        head.legend += `<span>Kerze = ${by === 'week' ? 'Woche' : 'Monat'} deiner Tankpreise</span>`;
      } else {
        const s = c.addAreaSeries({ lineColor: color, topColor: color + '55', bottomColor: color + '00', lineWidth: 2, priceFormat: priceFmt, crosshairMarkerRadius: 5 });
        const data = uniqTimes(pts.map((p) => ({ time: ts(p.ms), value: p.v, e: p.e })));
        s.setData(data.map(({ time, value }) => ({ time, value })));
        data.forEach((d) => byTime.set(d.time, `${fuelPrice(d.value)} <small>${d.e.station ? d.e.station : ''}</small>`));
        // Bester und schlechtester Preis markieren
        const min = data.reduce((a, b) => (b.value < a.value ? b : a));
        const max = data.reduce((a, b) => (b.value > a.value ? b : a));
        if (data.length > 2) s.setMarkers([
          { time: min.time, position: 'belowBar', color: down, shape: 'arrowUp', text: num(min.value, 3) },
          { time: max.time, position: 'aboveBar', color: up, shape: 'arrowDown', text: num(max.value, 3) },
        ].sort((a, b) => a.time - b.time));
        series.push(s);
        head.legend = `<span><i style="background:${color}"></i>dein Preis je Liter</span>`;
      }

      const market = marketDaily(snapshots, from);
      if (market.length > 1 && !(style === 'candle' && mCandles.length >= 5)) {
        const m = c.addLineSeries({ color: accent, lineWidth: 1, lineStyle: 2, priceFormat: priceFmt, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
        m.setData(market);
        series.push(m);
        head.legend += `<span><i style="background:${accent}"></i>günstigstes E10 in der Nähe</span>`;
      }

      // Liter als Volumen-Balken
      const vol = c.addHistogramSeries({ priceScaleId: 'vol', priceFormat: lFmt, lastValueVisible: false, priceLineVisible: false });
      c.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      vol.setData(uniqTimes(pts.filter((p) => ts(p.ms) >= volFrom).map((p) => ({ time: ts(p.ms), value: p.e.liters, color: muted + '55' }))));
      series.push(vol);
      head.legend += `<span><i style="background:${muted}"></i>getankte Liter</span>`;

      head.price = fuelPrice(last);
      const since = `<span class="muted">seit ${fmtDate(pts[0].ms, { day: '2-digit', month: 'short' })}</span>`;
      head.change = Math.abs(diff) < 0.0005
        ? `unverändert ${since}`
        : `${num(Math.abs(diff) * 100, 1)} ct ${diff > 0 ? 'teurer' : 'günstiger'} (${signed((diff / first) * 100, 1)} %) ${since}`;
      head.cls = diff > 0 ? 'up' : diff < 0 ? 'down' : '';
    }
  }

  if (mode === 'spend') {
    head.label = 'Tankkosten im Zeitraum';
    if (!list.length) empty('Noch keine Kosten im Zeitraum.');
    else {
      let acc = 0;
      const data = uniqTimes(list.map((e) => { acc += e.total; return { time: ts(new Date(e.date).getTime()), value: acc, e }; }));
      const s = c.addAreaSeries({ lineColor: accent, topColor: accent + '55', bottomColor: accent + '00', lineWidth: 2, priceFormat: eurFmt });
      s.setData(data.map(({ time, value }) => ({ time, value })));
      data.forEach((d) => byTime.set(d.time, `${eur(d.value, 0)} <small>+${eur(d.e.total)} am ${fmtDate(d.e.date, { day: '2-digit', month: '2-digit' })}</small>`));
      series.push(s);
      const bars = c.addHistogramSeries({ priceScaleId: 'vol', priceFormat: eurFmt, lastValueVisible: false, priceLineVisible: false });
      c.priceScale('vol').applyOptions({ scaleMargins: { top: 0.75, bottom: 0 } });
      bars.setData(data.map((d) => ({ time: d.time, value: d.e.total, color: muted + '66' })));
      series.push(bars);
      const days = Math.max(1, (Date.now() - from) / DAY);
      head.price = eur(acc, 0);
      head.change = `${list.length} Tankungen · Ø ${eur((acc / days) * 30.4, 0)} / Monat`;
      head.legend = `<span><i style="background:${accent}"></i>kumuliert</span><span><i style="background:${muted}"></i>je Tankung</span>`;
    }
  }

  if (mode === 'consumption') {
    head.label = 'Verbrauch L/100 km';
    const seg = consumptionSegments(entries).filter((s) => new Date(s.date).getTime() >= from);
    if (seg.length < 1) empty('Für den Verbrauch brauche ich mindestens zwei <b>Volltankungen mit Kilometerstand</b>.');
    else {
      const a = avg(seg, (s) => s.l100);
      const data = uniqTimes(seg.map((s) => ({ time: ts(new Date(s.date).getTime()), value: s.l100, s })));
      const s = c.addLineSeries({ color: accent, lineWidth: 2, priceFormat: lFmt, pointMarkersVisible: true });
      s.setData(data.map(({ time, value }) => ({ time, value })));
      s.createPriceLine({ price: a, color: muted, lineStyle: 2, lineWidth: 1, axisLabelVisible: true, title: 'Ø' });
      data.forEach((d) => byTime.set(d.time, `${num(d.value, 1, 1)} L <small>${num(d.s.km, 0)} km · ${eur(d.s.e100)}/100 km</small>`));
      series.push(s);
      const last = seg[seg.length - 1].l100;
      head.price = `${num(a, 1, 1)} <small style="font-size:.5em">L/100 km</small>`;
      head.change = `zuletzt ${num(last, 1, 1)} L – ${num(Math.abs(last - a), 1, 1)} L ${last > a ? 'mehr' : 'weniger'} als dein Ø`;
      head.cls = last > a ? 'up' : 'down';
      head.legend = `<span><i style="background:${accent}"></i>je Volltankung</span><span><i style="background:${muted}"></i>Durchschnitt</span>`;
    }
  }

  c.timeScale().fitContent();

  hoverHandler = (param) => {
    if (!param.time || !byTime.has(param.time)) return onHover(null);
    onHover({ html: byTime.get(param.time), date: param.time });
  };
  c.subscribeCrosshairMove(hoverHandler);
  return head;
}

export const hoverDate = (t) => fmtDate((t + new Date().getTimezoneOffset() * 60) * 1000, { weekday: 'short', day: '2-digit', month: '2-digit', year: '2-digit' });
