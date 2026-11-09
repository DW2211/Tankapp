// Kaufsignal „Jetzt tanken oder warten?“ – lernt aus den gesammelten Preisen der Umgebung,
// wie sich der günstigste Preis typischerweise über den Tag bewegt, und schätzt den Rest des Tages.
import { isNum, avg, num, eur, DAY } from './util.js';

export const MIN_DAYS = 4;       // so viele Tage mit Messungen zu verschiedenen Uhrzeiten braucht das Signal
const LAST_HOUR = 22;            // später wird für „heute“ nichts mehr vorhergesagt

/**
 * Typische Abweichung vom Tagesmittel je Stunde (0–23) aus den letzten 4 Wochen.
 * Nur Tage mit Messungen zu mindestens zwei verschiedenen Uhrzeiten zählen.
 */
export function hourProfile(snapshots, now = Date.now()) {
  const byDay = new Map();
  for (const s of snapshots) {
    if (s.t <= now - 28 * DAY || s.t > now || !isNum(s.min)) continue;
    const k = new Date(s.t).toDateString();
    (byDay.get(k) || byDay.set(k, []).get(k)).push(s);
  }
  const dev = Array.from({ length: 24 }, () => []);
  let days = 0;
  for (const list of byDay.values()) {
    if (new Set(list.map((s) => new Date(s.t).getHours())).size < 2) continue;
    days++;
    const mean = avg(list, (s) => s.min);
    for (const s of list) dev[new Date(s.t).getHours()].push(s.min - mean);
  }
  const prof = dev.map((v) => (v.length >= 2 ? avg(v) : NaN));
  // Lücken zwischen gemessenen Stunden linear auffüllen
  const known = prof.map((v, h) => (isNum(v) ? h : -1)).filter((h) => h >= 0);
  for (let i = 0; i < known.length - 1; i++) {
    const a = known[i], b = known[i + 1];
    for (let h = a + 1; h < b; h++) prof[h] = prof[a] + ((prof[b] - prof[a]) * (h - a)) / (b - a);
  }
  return { prof, days, first: known[0], last: known[known.length - 1] };
}

/**
 * @param {{ snapshots: object[], price: number, liters: number, now?: Date }} p  price = aktuell günstigster Preis
 * @returns {{ state: 'learning'|'buy'|'hold'|'wait', … }}
 */
export function buySignal({ snapshots, price, liters, now = new Date() }) {
  const { prof, days, first, last } = hourProfile(snapshots, now.getTime());
  if (days < MIN_DAYS || first == null) return { state: 'learning', days, need: MIN_DAYS };
  const h0 = now.getHours();
  // Stunde außerhalb des gemessenen Bereichs → nächstgelegene gemessene Stunde als Bezug
  const ref = isNum(prof[h0]) ? prof[h0] : prof[h0 < first ? first : last];
  const curve = [{ h: h0, p: price }];
  for (let h = h0 + 1; h <= Math.min(LAST_HOUR, last); h++) if (isNum(prof[h])) curve.push({ h, p: price + prof[h] - ref });
  const best = curve.reduce((a, b) => (b.p < a.p - 1e-9 ? b : a));
  const saveCt = (price - best.p) * 100;
  const state = best.h === h0 || saveCt < 1 ? 'buy' : saveCt < 2 ? 'hold' : 'wait';
  return { state, days, h0, price, best, saveCt, saveEur: (saveCt / 100) * liters, liters, curve };
}

/** Kleiner Verlaufs-Chart für den Rest des Tages (eine Reihe, Achse in Uhrzeiten) */
function curveSvg(curve, best) {
  if (curve.length < 2) return '';
  const W = 300, H = 74, pad = 6;
  const ps = curve.map((c) => c.p), min = Math.min(...ps), max = Math.max(...ps), span = max - min || 0.01;
  const x = (i) => pad + (i / (curve.length - 1)) * (W - 2 * pad);
  const y = (p) => pad + 4 + (1 - (p - min) / span) * (H - 2 * pad - 18);
  const line = curve.map((c, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(c.p).toFixed(1)}`).join(' ');
  const bi = curve.indexOf(best);
  const labels = curve.map((c, i) => (i === 0 || i === curve.length - 1 || i === bi ? `<text x="${x(i)}" y="${H - 1}" text-anchor="${i === 0 ? 'start' : i === curve.length - 1 ? 'end' : 'middle'}">${i === 0 ? 'jetzt' : c.h + ' Uhr'}</text>` : '')).join('');
  return `<svg class="sig-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Erwarteter Preisverlauf bis ${curve[curve.length - 1].h} Uhr">
    <defs><linearGradient id="sigfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".28"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
    <path d="${line} L${x(curve.length - 1)} ${H - 16} L${x(0)} ${H - 16} Z" fill="url(#sigfill)"/>
    <path d="${line}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(0)}" cy="${y(curve[0].p)}" r="5" fill="var(--surface-solid)" stroke="currentColor" stroke-width="2.5"/>
    ${bi > 0 ? `<circle cx="${x(bi)}" cy="${y(best.p)}" r="6" fill="currentColor" stroke="var(--surface-solid)" stroke-width="2"/>` : ''}
    ${labels}
  </svg>`;
}

const STATE = {
  buy: { cls: 'buy', badge: '● KAUFEN', ico: '🟢' },
  hold: { cls: 'hold', badge: '● NEUTRAL', ico: '🟡' },
  wait: { cls: 'wait', badge: '● WARTEN', ico: '🟠' },
  learning: { cls: 'learning', badge: 'LERNT NOCH', ico: '🧠' },
};

export function renderSignal(el, sig) {
  if (!sig) { el.hidden = true; return; }
  el.hidden = false;
  const st = STATE[sig.state];
  el.className = `card signal ${st.cls}`;
  if (sig.state === 'learning') {
    const pct = Math.min(100, (sig.days / sig.need) * 100);
    el.innerHTML = `<div class="sig-head"><span class="sig-title">Kaufsignal</span><span class="sig-badge">${st.badge}</span></div>
      <div class="sig-main">${st.ico} Ich lerne gerade, wann E10 bei dir am günstigsten ist.</div>
      <div class="sig-progress"><i style="width:${pct}%"></i></div>
      <div class="sig-foot">${sig.days} von ${sig.need} Tagen · Öffne die App zu verschiedenen Uhrzeiten – morgens, mittags, abends. Dann sage ich dir, ob sich Warten lohnt.</div>`;
    return;
  }
  const until = sig.best.h;
  let main, sub;
  if (sig.state === 'wait') {
    main = `Warten – gegen <b>${until} Uhr</b> voraussichtlich <b>${num(sig.saveCt, 1)} ct</b> günstiger`;
    sub = `Bei ${num(sig.liters, 0)} L sparst du so etwa <b>${eur(sig.saveEur)}</b>.`;
  } else if (sig.state === 'hold') {
    main = `Kannst du machen – bis ${until} Uhr wird es höchstens ~${num(Math.max(sig.saveCt, 0), 1)} ct billiger`;
    sub = `Das wären bei ${num(sig.liters, 0)} L nur ${eur(Math.max(sig.saveEur, 0))} – Warten lohnt kaum.`;
  } else {
    main = 'Jetzt tanken – heute wird es voraussichtlich nicht mehr günstiger';
    sub = sig.curve.length > 1 ? `Bis ${sig.curve[sig.curve.length - 1].h} Uhr erwartet: gleich bleibend oder teurer.` : 'Für heute gibt es keine späteren Messwerte mehr.';
  }
  el.innerHTML = `<div class="sig-head"><span class="sig-title">Kaufsignal · E10</span><span class="sig-badge">${st.badge}</span></div>
    <div class="sig-main">${main}</div>
    <div class="sig-sub">${sub}</div>
    ${curveSvg(sig.curve, sig.best)}
    <div class="sig-foot">Aus ${sig.days} Tagen deiner Preismessungen in der Nähe · eine Schätzung, keine Garantie</div>`;
}
