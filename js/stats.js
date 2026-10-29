import { isNum, sum, avg, DAY, startOfDay } from './util.js';

/** Tatsächlich bezahlter Literpreis – nach Rabatt (ADAC, Coupon …) */
export const paidPrice = (e) => (e.discount > 0 && e.liters > 0 ? e.total / e.liters : e.price);

/** Verbrauch nach Voll-zu-Voll-Methode. Teilbetankungen zwischen zwei Volltankungen werden mitgezählt. */
export function consumptionSegments(entries) {
  const out = [];
  let lastFull = null, liters = 0, cost = 0;
  for (const e of entries) {
    if (lastFull) { liters += e.liters || 0; cost += e.total || 0; }
    if (e.full && isNum(e.odometer)) {
      if (lastFull && e.odometer > lastFull.odometer) {
        const km = e.odometer - lastFull.odometer;
        const l100 = (liters / km) * 100;
        if (l100 > 1.5 && l100 < 40) out.push({ date: e.date, km, liters, cost, l100, e100: (cost / km) * 100 });
      }
      lastFull = e; liters = 0; cost = 0;
    }
  }
  return out;
}

export function avgConsumption(entries, last = 6) {
  const seg = consumptionSegments(entries).slice(-last);
  if (!seg.length) return NaN;
  return (sum(seg, (s) => s.liters) / sum(seg, (s) => s.km)) * 100;
}

export function avgCostPer100(entries, last = 6) {
  const seg = consumptionSegments(entries).slice(-last);
  if (!seg.length) return NaN;
  return (sum(seg, (s) => s.cost) / sum(seg, (s) => s.km)) * 100;
}

/** Marktdurchschnitt (Umgebung) am Tag eines Eintrags – aus den gespeicherten Schnappschüssen */
export function marketRef(snapshots, date) {
  const day = startOfDay(date).getTime();
  const same = snapshots.filter((s) => s.t >= day && s.t < day + DAY && isNum(s.avg));
  return same.length ? avg(same, (s) => s.avg) : NaN;
}

/** Ersparnis ggü. dem Durchschnittspreis der Umgebung am selben Tag */
export function savings(entries, snapshots) {
  let saved = 0, n = 0;
  for (const e of entries) {
    const ref = marketRef(snapshots, e.date);
    if (isNum(ref)) { saved += (ref - paidPrice(e)) * e.liters; n++; }
  }
  return { saved, n };
}

/**
 * War das gut oder teuer getankt? Vergleich mit dem Durchschnitt der Tankstellen in der Nähe am selben Tag,
 * ohne solche Daten mit dem eigenen Durchschnitt der 90 Tage davor.
 * @returns {{ verdict: 'good'|'ok'|'bad', diffCt: number, ref: string } | null}
 */
export function rateFill(e, entries, snapshots) {
  const paid = paidPrice(e);
  let refPrice = marketRef(snapshots, e.date), ref = 'Ø Umgebung';
  if (!isNum(refPrice)) {
    const t = new Date(e.date).getTime();
    const prev = entries.filter((x) => x !== e && new Date(x.date).getTime() < t && new Date(x.date).getTime() > t - 90 * DAY);
    if (prev.length < 2) return null;
    refPrice = avg(prev, paidPrice);
    ref = 'deinem Ø';
  }
  const diffCt = (paid - refPrice) * 100;
  return { verdict: diffCt <= -1 ? 'good' : diffCt >= 1 ? 'bad' : 'ok', diffCt, ref };
}

export const inRange = (entries, from, to = Infinity) => entries.filter((e) => { const t = new Date(e.date).getTime(); return t >= from && t < to; });

export function yearRange(year) {
  return [new Date(year, 0, 1).getTime(), new Date(year + 1, 0, 1).getTime()];
}

export function monthRange(offset = 0) {
  const d = new Date();
  return [new Date(d.getFullYear(), d.getMonth() + offset, 1).getTime(), new Date(d.getFullYear(), d.getMonth() + offset + 1, 1).getTime()];
}

export function kmDriven(entries) {
  const odo = entries.filter((e) => isNum(e.odometer)).map((e) => e.odometer);
  return odo.length > 1 ? Math.max(...odo) - Math.min(...odo) : NaN;
}

/** Ø Tage zwischen zwei Tankvorgängen (letzte 8) */
export function fillInterval(entries) {
  const last = entries.slice(-9);
  if (last.length < 3) return NaN;
  const gaps = [];
  for (let i = 1; i < last.length; i++) gaps.push((new Date(last[i].date) - new Date(last[i - 1].date)) / DAY);
  return avg(gaps);
}

/** Welche Stunde ist laut gesammelten Marktdaten am günstigsten? */
export function bestHour(snapshots) {
  const recent = snapshots.filter((s) => s.t > Date.now() - 60 * DAY && isNum(s.min));
  if (recent.length < 12) return null;
  // Preise relativ zum Tagesmittel, damit Trends über Wochen nicht stören
  const byDay = new Map();
  for (const s of recent) {
    const k = startOfDay(s.t).getTime();
    (byDay.get(k) || byDay.set(k, []).get(k)).push(s);
  }
  const hours = new Map();
  for (const list of byDay.values()) {
    if (list.length < 2) continue;
    const m = avg(list, (s) => s.min);
    for (const s of list) {
      const h = new Date(s.t).getHours();
      (hours.get(h) || hours.set(h, []).get(h)).push(s.min - m);
    }
  }
  const ranked = [...hours.entries()].filter(([, v]) => v.length >= 2).map(([h, v]) => ({ h, d: avg(v) })).sort((a, b) => a.d - b.d);
  if (ranked.length < 4) return null;
  return { best: ranked[0], worst: ranked[ranked.length - 1] };
}

export function totals(entries) {
  const liters = sum(entries, (e) => e.liters);
  const total = sum(entries, (e) => e.total);
  return { count: entries.length, liters, total, avgPrice: liters ? total / liters : NaN };
}
