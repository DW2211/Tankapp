// „Dein Tank-Jahr“ – animierter Jahresrückblick zum Durchtippen (wie eine Story) mit teilbarer Abschlusskarte.
import { $, $$, num, eur, esc, fuelPrice, isNum, sum, haptic, toast, download, fmtDate } from './util.js';
import * as stats from './stats.js';
import { countUp } from './ui.js';

const SLIDE_MS = 6500;

/** Alle Kennzahlen eines Jahres. null, wenn es zu wenige Tankungen gibt. */
export function yearStats(all, snapshots, year, settings) {
  const yr = stats.inRange(all, ...stats.yearRange(year));
  if (yr.length < 3) return null;
  const t = stats.totals(yr);
  const byPaid = [...yr].sort((a, b) => stats.paidPrice(a) - stats.paidPrice(b));
  const months = Array.from({ length: 12 }, (_, m) => sum(yr.filter((e) => new Date(e.date).getMonth() === m), (e) => e.total));
  const topMonth = months.indexOf(Math.max(...months));
  const km = stats.kmDriven(yr);
  const cons = stats.avgConsumption(yr, 999);

  const stationCount = new Map();
  for (const e of yr) {
    const name = (e.station || '').trim();
    if (name) stationCount.set(name, (stationCount.get(name) || 0) + 1);
  }
  const fav = [...stationCount.entries()].sort((a, b) => b[1] - a[1])[0] || null;

  const rated = yr.map((e) => stats.rateFill(e, all, snapshots)).filter(Boolean);
  const good = rated.filter((r) => r.verdict === 'good').length;
  const goodPct = rated.length ? good / rated.length : NaN;
  const sv = stats.savings(yr, snapshots);
  const discount = sum(yr, (e) => e.discount || 0);

  // CO₂ aus Verbrennung: Benzin/E10 ca. 2,3 kg je Liter, Diesel ca. 2,65 kg
  const co2 = sum(yr, (e) => e.liters * (e.fuel === 'Diesel' ? 2.65 : 2.3)) / 1000;

  const hours = yr.map((e) => new Date(e.date).getHours());
  const avgHour = hours.reduce((a, b) => a + b, 0) / hours.length;
  const timeType = avgHour < 11 ? ['Frühaufsteher-Tanker', '🌅'] : avgHour < 17 ? ['Mittagspausen-Tanker', '☀️'] : ['Feierabend-Tanker', '🌙'];
  const weekdays = Array(7).fill(0);
  yr.forEach((e) => weekdays[new Date(e.date).getDay()]++);
  const favDay = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'][weekdays.indexOf(Math.max(...weekdays))];

  const type = !isNum(goodPct) ? ['Tank-Entdecker', '🧭', 'Nächstes Jahr wissen wir mehr über deinen Spar-Stil.']
    : goodPct >= 0.6 ? ['Spar-Profi', '🏆', 'Du tankst meistens dann, wenn es günstig ist. Respekt!']
    : goodPct >= 0.35 ? ['Schlauer Sparfuchs', '🦊', 'Oft clever getankt – mit dem Kaufsignal geht noch mehr.']
    : ['Spontan-Tanker', '⚡', 'Du tankst, wenn der Tank leer ist. Das Kaufsignal hilft dir beim Sparen.'];

  return {
    year, vehicle: settings.vehicle || 'Mein Auto', count: t.count, liters: t.liters, total: t.total,
    avgPrice: t.total / t.liters, cheapest: byPaid[0], priciest: byPaid[byPaid.length - 1],
    months, topMonth, km, cons, fav, goodPct, rated: rated.length, saved: sv.n ? sv.saved : NaN,
    discount, co2, timeType, favDay, type,
  };
}

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/** Die einzelnen Story-Seiten */
function slides(s) {
  const n = (v, d = 0) => `<span class="w-num" data-to="${v}" data-dec="${d}">${num(v, d)}</span>`;
  const list = [
    { bg: 'w-bg1', html: `<div class="w-kicker">${esc(s.vehicle)}</div><h2 class="w-hero">Dein<br>Tank-Jahr<br><span>${s.year}</span></h2><p class="w-lead">Tippe dich durch dein Jahr an der Zapfsäule.</p>` },
    { bg: 'w-bg2', html: `<div class="w-kicker">Getankt</div><div class="w-big">${n(s.liters)}<small>Liter</small></div><p class="w-lead">bei <b>${s.count}</b> Tankstopps.</p><p class="w-fun">🛁 Das sind ${num(s.liters / 150, 1)} volle Badewannen.</p>` },
    { bg: 'w-bg3', html: `<div class="w-kicker">Ausgegeben</div><div class="w-big">${n(s.total)}<small>Euro</small></div><p class="w-lead">Im Schnitt ${eur(s.total / 12, 0)} pro Monat.</p><p class="w-fun">📅 Teuerster Monat: <b>${MONTHS[s.topMonth]}</b> mit ${eur(s.months[s.topMonth], 0)}</p>` },
  ];
  if (isNum(s.km)) list.push({ bg: 'w-bg4', html: `<div class="w-kicker">Gefahren</div><div class="w-big">${n(s.km)}<small>km</small></div><p class="w-lead">${isNum(s.cons) ? `mit Ø <b>${num(s.cons, 1, 1)} L</b> auf 100 km.` : ''}</p><p class="w-fun">🌍 ${num((s.km / 40075) * 100, 0)} % einmal um die Erde – oder ${num(s.km / 780, 1)}× München–Hamburg.</p>` });
  list.push({ bg: 'w-bg5', html: `<div class="w-kicker">Dein bester Tankstopp</div><div class="w-big">${fuelPrice(stats.paidPrice(s.cheapest))}<small>€ pro Liter</small></div><p class="w-lead">am ${fmtDate(s.cheapest.date, { day: 'numeric', month: 'long' })}${s.cheapest.station ? `<br>bei ${esc(s.cheapest.station)}` : ''}.</p><p class="w-fun">😬 Teuerster: ${num(stats.paidPrice(s.priciest), 3)} € am ${fmtDate(s.priciest.date, { day: 'numeric', month: 'long' })}</p>` });
  if (s.fav && s.fav[1] >= 2) list.push({ bg: 'w-bg6', html: `<div class="w-kicker">Deine Stamm-Tankstelle</div><h2 class="w-title">${esc(s.fav[0])}</h2><p class="w-lead">Hier warst du <b>${s.fav[1]}×</b>.</p><p class="w-fun">${s.timeType[1]} Du bist ${s.timeType[0]} – am liebsten am <b>${s.favDay}</b>.</p>` });
  if (isNum(s.goodPct)) {
    const extra = isNum(s.saved) && s.saved > 0 ? `<p class="w-fun">💰 Ggü. dem Schnitt deiner Umgebung gespart: <b>${eur(s.saved)}</b></p>` : s.discount > 0 ? `<p class="w-fun">🏷️ Rabatte abgestaubt: <b>${eur(s.discount)}</b></p>` : '';
    list.push({ bg: 'w-bg7', html: `<div class="w-kicker">Günstig getankt</div><div class="w-big">${n(Math.round(s.goodPct * 100))}<small>%</small></div><p class="w-lead">deiner Tankungen lagen unter dem Durchschnitt.</p>${extra}` });
  }
  list.push({ bg: 'w-bg8', html: `<div class="w-kicker">Klima</div><div class="w-big">${n(s.co2, 1)}<small>Tonnen CO₂</small></div><p class="w-lead">aus deinem Sprit (ca.).</p><p class="w-fun">🌳 Ein Baum bindet rund 10 kg CO₂ im Jahr – das wären ${num((s.co2 * 1000) / 10, 0)} Bäume.</p>` });
  list.push({ bg: 'w-bg1', html: `<div class="w-kicker">Du bist</div><div class="w-emoji">${s.type[1]}</div><h2 class="w-title">${s.type[0]}</h2><p class="w-lead">${s.type[2]}</p>` });
  list.push({ bg: 'w-bg9', final: true, html: `<div class="w-kicker">Mein Tank-Jahr ${s.year}</div>
    <div class="w-grid">
      <div><span>Liter</span><b>${num(s.liters, 0)}</b></div>
      <div><span>Kosten</span><b>${eur(s.total, 0)}</b></div>
      <div><span>Tankstopps</span><b>${s.count}</b></div>
      <div><span>Ø Literpreis</span><b>${num(s.avgPrice, 3)} €</b></div>
      <div><span>Kilometer</span><b>${isNum(s.km) ? num(s.km, 0) : '–'}</b></div>
      <div><span>Günstig getankt</span><b>${isNum(s.goodPct) ? num(s.goodPct * 100, 0) + ' %' : '–'}</b></div>
    </div>
    <div class="w-type">${s.type[1]} ${s.type[0]}</div>
    <button class="w-share" data-w-share>Teilen</button>` });
  return list;
}

/** Teilbare Karte als Bild (1080 × 1350) */
function shareImage(s) {
  const c = Object.assign(document.createElement('canvas'), { width: 1080, height: 1350 });
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 1080, 1350);
  g.addColorStop(0, '#1a6dff'); g.addColorStop(0.5, '#4b3fd6'); g.addColorStop(1, '#8a2fd0');
  x.fillStyle = g; x.fillRect(0, 0, 1080, 1350);
  const font = (w, size) => `${w} ${size}px -apple-system, "Segoe UI", Roboto, "DejaVu Sans", sans-serif`;
  x.fillStyle = 'rgba(255,255,255,.8)'; x.font = font(700, 40); x.fillText(s.vehicle.toUpperCase(), 80, 130);
  x.fillStyle = '#fff'; x.font = font(800, 92); x.fillText(`Mein Tank-Jahr ${s.year}`, 80, 240);
  const tiles = [
    ['Liter', num(s.liters, 0)], ['Kosten', eur(s.total, 0)],
    ['Tankstopps', String(s.count)], ['Ø Literpreis', `${num(s.avgPrice, 3)} €`],
    ['Kilometer', isNum(s.km) ? num(s.km, 0) : '–'], ['Günstig getankt', isNum(s.goodPct) ? `${num(s.goodPct * 100, 0)} %` : '–'],
  ];
  tiles.forEach(([label, value], i) => {
    const tx = 80 + (i % 2) * 470, ty = 320 + Math.floor(i / 2) * 250;
    x.fillStyle = 'rgba(255,255,255,.14)';
    x.beginPath(); x.roundRect(tx, ty, 450, 220, 36); x.fill();
    x.fillStyle = 'rgba(255,255,255,.75)'; x.font = font(600, 34); x.fillText(label, tx + 36, ty + 70);
    x.fillStyle = '#fff'; x.font = font(800, 72); x.fillText(value, tx + 36, ty + 165);
  });
  x.fillStyle = '#fff'; x.font = font(800, 56); x.fillText(`${s.type[1]} ${s.type[0]}`, 80, 1150);
  x.fillStyle = 'rgba(255,255,255,.7)'; x.font = font(600, 32); x.fillText('Tankbuch · dw2211.github.io/Tankapp', 80, 1270);
  return new Promise((r) => c.toBlob(r, 'image/png'));
}

let timer = null;

export function openWrapped(s) {
  if (!s) { toast('Für den Rückblick brauche ich mindestens 3 Tankungen in diesem Jahr'); return; }
  const list = slides(s);
  const root = document.createElement('div');
  root.className = 'wrapped';
  root.innerHTML = `<div class="w-bars">${list.map(() => '<i><b></b></i>').join('')}</div>
    <button class="w-close" aria-label="Schließen">✕</button>
    ${list.map((sl, i) => `<section class="w-slide ${sl.bg}" data-i="${i}">${sl.html}</section>`).join('')}
    <div class="w-tap w-prev"></div><div class="w-tap w-next"></div>`;
  document.body.append(root);
  document.body.style.overflow = 'hidden';
  let i = -1, t0 = 0, paused = false, pausedAt = 0;
  const bars = $$('.w-bars b', root), secs = $$('.w-slide', root);

  const show = (k) => {
    if (k < 0) k = 0;
    if (k >= secs.length) return close();
    i = k; t0 = performance.now(); haptic(8);
    secs.forEach((sec, j) => sec.classList.toggle('on', j === i));
    bars.forEach((b, j) => (b.style.width = j < i ? '100%' : '0%'));
    $$('.w-num', secs[i]).forEach((el) => countUp(el, 0, +el.dataset.to, (v) => num(v, +el.dataset.dec), 1100));
  };
  const tick = (now) => {
    if (!root.isConnected) return;
    if (!paused && i >= 0 && !list[i].final) {
      const p = Math.min(1, (now - t0) / SLIDE_MS);
      bars[i].style.width = `${p * 100}%`;
      if (p >= 1) show(i + 1);
    } else if (list[i]?.final) bars[i].style.width = '100%';
    timer = requestAnimationFrame(tick);
  };
  const close = () => {
    cancelAnimationFrame(timer);
    root.classList.add('out');
    setTimeout(() => root.remove(), 300);
    document.body.style.overflow = '';
    removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'ArrowRight') show(i + 1); if (e.key === 'ArrowLeft') show(i - 1); if (e.key === 'Escape') close(); };
  addEventListener('keydown', onKey);

  $('.w-close', root).addEventListener('click', close);
  $('.w-next', root).addEventListener('click', () => show(i + 1));
  $('.w-prev', root).addEventListener('click', () => show(i - 1));
  // gedrückt halten = pausieren (wie bei Stories)
  root.addEventListener('pointerdown', () => { paused = true; pausedAt = performance.now(); });
  root.addEventListener('pointerup', () => { if (paused) { t0 += performance.now() - pausedAt; paused = false; } });
  root.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-w-share]')) return;
    e.stopPropagation();
    const blob = await shareImage(s);
    const file = new File([blob], `Tank-Jahr-${s.year}.png`, { type: 'image/png' });
    try {
      if (!navigator.canShare?.({ files: [file] })) throw new Error('kein Teilen');
      await navigator.share({ files: [file], title: `Mein Tank-Jahr ${s.year}` });
    } catch (err) {
      // Abbrechen durch den Nutzer ist kein Fehler; sonst (z. B. am Computer) Bild herunterladen
      if (err?.name !== 'AbortError') { download(file.name, blob); toast('Bild gespeichert'); }
    }
  });
  show(0);
  timer = requestAnimationFrame(tick);
}
