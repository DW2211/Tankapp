import { $, $$, eur, num, fuelPrice, signed, parseNum, isNum, uid, toast, haptic, download, fmtDate, fmtTime, monthName, toLocalInput, esc, DAY, avg, sum } from './util.js';
import * as store from './store.js';
import { renderChart, hoverDate } from './charts.js';
import { fetchStations, marketSnapshot, sortStations, displayName, mapsLink, DISCOUNT_PRESETS, ROAD_FACTOR, activeDiscount } from './stations.js';
import { scanReceipt, compressImage } from './ocr.js';
import { syncToSheets, uploadReceipts, fetchBackup, fetchReceipt, markUploaded } from './sheets.js';
import { yearReport, commuteAllowance, exportCsv, printReport, exportReceipts } from './tax.js';
import * as stats from './stats.js';
import { demoData } from './demo.js';
import { brandBadge, sparkline, ICONS, countUp, greeting } from './ui.js';

const S = store.getSettings;
let stationData = null;   // { stations, pos, fetchedAt }
let stationError = null;
let chartHead = null;

/* =========================================================
   Navigation
   ========================================================= */
function nav(view) {
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  $$('.tabbar [data-nav]').forEach((b) => b.classList.toggle('on', b.dataset.nav === view));
  window.scrollTo({ top: 0 });
  if (view === 'stations') renderStations();
  if (view === 'log') renderLog();
  if (view === 'tax') renderTax();
  if (view === 'settings') fillSettings();
  if (view === 'home') requestAnimationFrame(renderChartBlock);
  $('#navbar-title').textContent = $(`#view-${view}`).dataset.title;
  onScroll();
  history.replaceState(null, '', view === 'home' ? location.pathname : `#${view}`);
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-nav]');
  if (b) { e.preventDefault(); haptic(); nav(b.dataset.nav); }
});

// Kompakte Leiste einblenden, sobald der große Titel weggescrollt ist (wie iOS)
function onScroll() { $('#navbar').classList.toggle('scrolled', window.scrollY > 44); }
addEventListener('scroll', onScroll, { passive: true });

/* =========================================================
   Home: Ticker-Chart
   ========================================================= */
function renderChartBlock() {
  const s = S();
  const modes = $$('#chart-mode button');
  modes.forEach((b) => b.classList.toggle('on', b.dataset.mode === s.chartMode));
  $('#chart-mode .seg-thumb').style.transform = `translateX(${Math.max(0, modes.findIndex((b) => b.dataset.mode === s.chartMode)) * 100}%)`;
  $$('#chart-range button').forEach((b) => b.classList.toggle('on', b.dataset.range === s.chartRange));
  $('#chart-style span').textContent = s.chartStyle === 'candle' ? 'Kerzen' : 'Linie';
  $('#chart-style').hidden = s.chartMode !== 'price';
  chartHead = renderChart({ entries: store.getEntries(), snapshots: store.getSnapshots(), mode: s.chartMode, range: s.chartRange, style: s.chartStyle }, onHover);
  setTicker(chartHead);
  $('#chart-legend').innerHTML = chartHead.legend;
}

function setTicker(h) {
  $('#ticker-label').textContent = h.label;
  $('#ticker-price').innerHTML = h.price;
  const c = $('#ticker-change');
  // Pfeil zusätzlich zur Farbe, damit „gestiegen/gefallen“ nie nur über Rot/Grün erkennbar ist
  const arrow = h.cls === 'up' ? '<span class="arrow">▲</span>' : h.cls === 'down' ? '<span class="arrow">▼</span>' : '';
  c.innerHTML = arrow + h.change;
  c.className = `ticker-change ${h.cls}`;
}

function onHover(info) {
  if (!info) return chartHead && setTicker(chartHead);
  const [main, extra] = info.html.split(' <small>');
  $('#ticker-price').innerHTML = main;
  const c = $('#ticker-change');
  c.className = 'ticker-change muted';
  c.innerHTML = `${hoverDate(info.date)}${extra ? ' · ' + extra.replace('</small>', '') : ''}`;
}

$('#chart-mode').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  haptic(); store.setSettings({ chartMode: b.dataset.mode }, true); renderChartBlock();
});
$('#chart-range').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  haptic(); store.setSettings({ chartRange: b.dataset.range }, true); renderChartBlock();
});
$('#chart-style').addEventListener('click', () => {
  haptic(); store.setSettings({ chartStyle: S().chartStyle === 'candle' ? 'line' : 'candle' }, true); renderChartBlock();
});

/* =========================================================
   Home: KPIs & Insights
   ========================================================= */
function renderKpis() {
  const entries = store.getEntries();
  const [m0, m1] = stats.monthRange(0), [p0, p1] = stats.monthRange(-1);
  const year = new Date().getFullYear();
  const thisMonth = stats.totals(stats.inRange(entries, m0, m1));
  const lastMonth = stats.totals(stats.inRange(entries, p0, p1));
  const ytd = stats.totals(stats.inRange(entries, ...stats.yearRange(year)));
  const dayOfYear = (Date.now() - new Date(year, 0, 1)) / DAY;
  const last12 = stats.totals(stats.inRange(entries, Date.now() - 365 * DAY));
  const cons = stats.avgConsumption(entries);
  const c100 = stats.avgCostPer100(entries);
  const best = entries.length ? entries.reduce((a, b) => (stats.paidPrice(b) < stats.paidPrice(a) ? b : a)) : null;
  const sv = stats.savings(entries, store.getSnapshots());
  const kmYtd = stats.kmDriven(stats.inRange(entries, ...stats.yearRange(year)));

  const delta = thisMonth.total - lastMonth.total;
  // Monatssummen der letzten 12 Monate für die Sparklines
  const months = Array.from({ length: 12 }, (_, i) => stats.totals(stats.inRange(entries, ...stats.monthRange(i - 11))).total);
  const priceSeries = entries.slice(-12).map(stats.paidPrice);
  const consSeries = stats.consumptionSegments(entries).slice(-10).map((x) => x.l100);
  const kpi = ({ icon, color, label, value, sub = '', cls = '', spark = '' }) => `<div class="kpi">${spark}<div class="k-icon" style="--c:${color}">${ICONS[icon]}</div><div class="label">${label}</div><div class="value num ${cls}">${value}</div><div class="sub">${sub}</div></div>`;
  $('#kpis').innerHTML = [
    kpi({ icon: 'wallet', color: '#0a84ff', label: 'Diesen Monat', value: eur(thisMonth.total), sub: lastMonth.count ? `<span class="${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '▲' : '▼'} ${signed(delta, 0)} €</span> ggü. Vormonat` : `${thisMonth.count} Tankungen`, spark: sparkline(months, '#0a84ff') }),
    kpi({ icon: 'calendar', color: '#5e5ce6', label: `Seit 1.1.${year}`, value: eur(ytd.total, 0), sub: ytd.count && dayOfYear > 20 ? `Prognose ${eur((ytd.total / dayOfYear) * 365, 0)}` : `${ytd.count} Tankungen` }),
    kpi({ icon: 'drop', color: '#64d2ff', label: 'Ø Verbrauch', value: isNum(cons) ? `${num(cons, 1, 1)} L` : '–', sub: 'pro 100 km', spark: sparkline(consSeries, '#64d2ff') }),
    kpi({ icon: 'road', color: '#ff9f0a', label: 'Kosten / 100 km', value: isNum(c100) ? eur(c100) : '–', sub: isNum(kmYtd) ? `${num(kmYtd, 0)} km in ${year}` : 'km-Stand erfassen' }),
    kpi({ icon: 'tag', color: '#bf5af2', label: 'Ø Preis 12 Mon.', value: isNum(last12.avgPrice) ? fuelPrice(last12.avgPrice) : '–', sub: best ? `Bestpreis ${num(stats.paidPrice(best), 3)} €` : '', spark: sparkline(priceSeries, '#bf5af2') }),
    sv.n
      ? kpi({ icon: 'piggy', color: '#30d158', label: 'Gespart', value: eur(sv.saved), sub: `ggü. Ø Umgebung · ${sv.n}×`, cls: sv.saved >= 0 ? 'down' : 'up' })
      : kpi({ icon: 'drop', color: '#30d158', label: 'Liter 12 Mon.', value: isNum(last12.liters) ? num(last12.liters, 0) + ' L' : '–', sub: `${last12.count} Tankungen` }),
  ].join('');
}

function renderInsights() {
  const entries = store.getEntries();
  const snaps = store.getSnapshots();
  const items = [];
  const add = (ico, html) => items.push(`<li><span class="ico">${ico}</span><span>${html}</span></li>`);
  const recent = stats.totals(stats.inRange(entries, Date.now() - 120 * DAY));

  const open = stationData?.stations.filter((s) => s.isOpen) || [];
  if (open.length && isNum(recent.avgPrice)) {
    const best = open.reduce((a, b) => (b.price < a.price ? b : a));
    const d = (best.price - recent.avgPrice) * 100;
    if (d < -1) add('🟢', `<b>Guter Moment zum Tanken:</b> ${esc(displayName(best))} liegt ${num(-d, 1)} ct unter deinem Ø der letzten 4 Monate.`);
    else if (d > 2) add('🟠', `E10 ist gerade ${num(d, 1)} ct <b>teurer</b> als dein Schnitt. Wenn möglich, später tanken.`);
    else add('⚪️', `Preise liegen aktuell auf deinem üblichen Niveau (${fuelPrice(best.price)} €).`);
  }

  const bh = stats.bestHour(snaps);
  if (bh) add('🕗', `Laut deinen Messungen ist E10 gegen <b>${bh.best.h} Uhr</b> am günstigsten – im Schnitt ${num((bh.worst.d - bh.best.d) * 100, 1)} ct billiger als um ${bh.worst.h} Uhr.`);

  const interval = stats.fillInterval(entries);
  if (isNum(interval) && entries.length) {
    const next = new Date(entries[entries.length - 1].date).getTime() + interval * DAY;
    const days = Math.round((next - Date.now()) / DAY);
    add('⛽️', days > 0 ? `Nächstes Tanken voraussichtlich in <b>${days} Tag${days === 1 ? '' : 'en'}</b> (alle ~${num(interval, 0)} Tage).` : `Du tankst etwa alle ${num(interval, 0)} Tage – <b>bald wieder fällig</b>.`);
  }

  const yearLiters = stats.totals(stats.inRange(entries, Date.now() - 365 * DAY)).liters;
  if (yearLiters > 50) add('💡', `Jeder Cent pro Liter macht bei dir rund <b>${eur(yearLiters / 100)}</b> im Jahr aus. 10 ct Unterschied = ${eur(yearLiters / 10, 0)}.`);

  const seg = stats.consumptionSegments(entries);
  if (seg.length >= 4) {
    const lastL = seg[seg.length - 1].l100, a = avg(seg.slice(-8, -1), (s) => s.l100);
    if (lastL > a * 1.08) add('📈', `Letzte Tankfüllung: <b>${num(lastL, 1)} L/100 km</b> – ${num(((lastL / a) - 1) * 100, 0)} % über deinem Schnitt. Reifendruck prüfen?`);
    else if (lastL < a * 0.95) add('🌱', `Sparsam gefahren: <b>${num(lastL, 1)} L/100 km</b>, ${num((1 - lastL / a) * 100, 0)} % unter deinem Schnitt.`);
    const tank = S().tankSize;
    if (tank) add('🛣️', `Reichweite mit vollem Tank (${tank} L): ca. <b>${num((tank / stats.avgConsumption(entries)) * 100, 0)} km</b>.`);
  }

  const year = new Date().getFullYear();
  const yr = stats.inRange(entries, ...stats.yearRange(year));
  const biz = yr.filter((e) => e.usage !== 'privat');
  if (biz.length) add('🧾', `${biz.length} beruflich genutzte Tankungen in ${year} – <a href="#tax" data-nav="tax">Steuer-Übersicht ansehen</a>.`);
  const noReceipt = yr.filter((e) => e.usage !== 'privat' && !e.receiptId).length;
  if (noReceipt) add('📸', `${noReceipt} berufliche Tankung${noReceipt === 1 ? '' : 'en'} ohne Belegfoto. Für die Steuer lohnt sich der Scan.`);

  const s = S();
  if (entries.filter((e) => !e.demo).length >= 3 && !s.sheetsUrl && (!s.lastExport || Date.now() - s.lastExport > 30 * DAY)) {
    items.unshift(`<li><span class="ico">💾</span><span><b>Deine Daten sind nur auf diesem Handy.</b> ${s.lastExport ? `Letztes Backup vor ${Math.round((Date.now() - s.lastExport) / DAY)} Tagen.` : 'Noch kein Backup.'} <button class="link" data-backup-now>Jetzt sichern</button> oder <a href="#settings" data-nav="settings">Google-Sicherung einrichten</a>.</span></li>`);
  }

  if (!entries.length) {
    add('👋', 'Willkommen! Tippe unten auf <b>+</b> und scanne deinen ersten Tankbeleg – oder lade in den Einstellungen Demo-Daten.');
    add('🔑', 'Für Live-Preise in deiner Nähe: kostenlosen Tankerkönig-API-Key in den <a href="#settings" data-nav="settings">Einstellungen</a> eintragen.');
  }
  $('#insights').innerHTML = items.slice(0, 6).join('') || '<li class="empty-li">Noch keine Auffälligkeiten.</li>';
}

/* =========================================================
   Tankstellen
   ========================================================= */
async function loadStations(force = false) {
  const s = S();
  $('#stations-refresh').classList.add('spin');
  try {
    stationData = await fetchStations({ apiKey: s.apiKey, radius: s.radius, force });
    stationError = null;
    const snap = marketSnapshot(stationData.stations);
    if (snap) { store.addSnapshot(snap); checkAlarm(snap); }
  } catch (e) {
    stationError = e;
  } finally {
    $('#stations-refresh').classList.remove('spin');
  }
  renderNearby();
  renderStations();
  renderInsights();
  updateSuggestions();
}

function checkAlarm(snap) {
  const a = S().alarm;
  if (!isNum(a) || snap.min > a) return;
  const key = 'tankbuch.alarm.' + new Date().toDateString();
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, '1');
  const msg = `Preisalarm: E10 für ${num(snap.min, 3)} € bei ${snap.station}`;
  toast('🔔 ' + msg, 5000);
  if ('Notification' in window && Notification.permission === 'granted') {
    navigator.serviceWorker?.ready.then((reg) => reg.showNotification('Tankbuch', { body: msg, icon: 'icons/icon-192.png', tag: 'alarm' })).catch(() => {});
  }
}

function avgTankLiters() {
  const e = store.getEntries().slice(-6);
  return e.length ? avg(e, (x) => x.liters) : (S().tankSize || 50) * 0.75;
}

function consumptionSetting() {
  return S().consumption || stats.avgConsumption(store.getEntries()) || 7;
}

/** Menge, die man typischerweise tankt (einstellbar, sonst aus dem Verlauf) */
function fillLiters() {
  return S().fillLiters || Math.round(avgTankLiters());
}

const calcOpts = (extra = {}) => ({ liters: fillLiters(), consumption: consumptionSetting(), discounts: S().discounts, ...extra });

/** „Lohnt sich der Weg?“ – Ersparnis ggü. der nächstgelegenen Tankstelle inkl. Hin- und Rückweg */
function verdict(st) {
  if (st.nearest) return '<span class="verdict near">📍 Nächste Tankstelle</span>';
  const extra = st.extraKm > 0.3 ? ` · +${num(st.extraKm, 1)} km Umweg, ~${st.extraMin} Min` : '';
  if (st.saving >= 0.05) return `<span class="verdict good">✓ Lohnt sich: spart ${eur(st.saving)}${extra}</span>`;
  if (st.saving > -0.05) return `<span class="verdict even">≈ Gleich teuer wie die nächste${extra}</span>`;
  return `<span class="verdict bad">✗ Lohnt nicht: ${eur(-st.saving)} teurer${extra}</span>`;
}

const discTag = (st) => (st.disc ? `<span class="tag disc">−${num(st.disc.ct, 1, 0)} ct ${esc(st.disc.label)}</span>` : '');

function stationCard(st, i, ref, compact) {
  const delta = ref != null ? (st.eff - ref) * 100 : null;
  const isBest = i === 0 && st.isOpen;
  return `<div class="station ${isBest && !compact ? 'best' : ''}">
    ${brandBadge(st.brand || st.name)}
    <div style="min-width:0">
      <div class="name">${esc(displayName(st))}${st.isOpen ? '' : '<span class="tag closed">GESCHLOSSEN</span>'}</div>
      <div class="addr">${num(st.dist, 1)} km · ${esc(st.street)}${compact ? '' : ', ' + esc(st.place)}</div>
    </div>
    <div>
      <div class="price num">${fuelPrice(st.eff)}</div>
      ${st.disc ? `<div class="was num">${num(st.price, 3)}</div>` : delta != null && !isBest && delta > 0.05 ? `<div class="delta up">▲ ${num(delta, 1)} ct</div>` : isBest ? '<div class="delta best-tag">★ Beste Wahl</div>' : ''}
    </div>
    <div class="st-foot">${verdict(st)}${discTag(st)}</div>
    ${compact ? '' : `<div class="actions"><a href="${mapsLink(st)}" target="_blank" rel="noopener">${ICONS.route}Route</a><button data-fill="${st.id}" data-eff="${st.eff}">${ICONS.plus}Hier getankt</button></div>`}
  </div>`;
}

function stationProblem() {
  if (!stationError) return '';
  if (stationError.code === 'nokey') return `<div class="empty">Für Live-Preise brauchst du einen kostenlosen API-Key von Tankerkönig.<br><button class="btn primary" data-nav="settings">Freischalten</button></div>`;
  return `<div class="empty">${esc(stationError.message)}<br><button class="btn" data-retry>Erneut versuchen</button></div>`;
}

let heroPrice = NaN;

/** Hero-Karte „Jetzt tanken“: günstigste offene Tankstelle, eingefärbt nach Lage zu deinem Schnitt */
function renderHero() {
  const el = $('#hero');
  el.className = 'hero';
  if (stationError) {
    const nokey = stationError.code === 'nokey';
    el.innerHTML = `<div class="hero-top"><span class="hero-label">${ICONS.key} Live-Preise</span></div>
      <h3>${nokey ? 'Günstigstes E10 in deiner Nähe' : 'Preise gerade nicht verfügbar'}</h3>
      <p>${nokey ? 'Schalte Live-Preise frei und sieh beim Öffnen sofort, wo du am billigsten tankst.' : esc(stationError.message)}</p>
      <div class="hero-actions"><button class="solid" ${nokey ? 'data-nav="settings"' : 'data-retry'}>${nokey ? 'Jetzt freischalten' : 'Erneut versuchen'}</button><button data-nav="stations">Mehr erfahren</button></div>`;
    return;
  }
  if (!stationData) { el.innerHTML = '<div class="hero-skeleton"><i></i><i></i><i></i></div>'; return; }
  const list = sortStations(stationData.stations, 'smart', calcOpts({ openOnly: true }));
  if (!list.length) {
    el.innerHTML = `<div class="hero-top"><span class="hero-label"><i class="live-dot"></i> Jetzt tanken</span></div><h3>Alles geschlossen</h3><p>Im Umkreis von ${S().radius} km hat gerade keine Tankstelle geöffnet.</p>`;
    return;
  }
  const best = list[0];
  const ref = stats.totals(stats.inRange(store.getEntries(), Date.now() - 120 * DAY)).avgPrice;
  const d = isNum(ref) ? (best.eff - ref) * 100 : NaN;
  let badge = `Beste von ${list.length}`;
  if (isNum(d) && d < -1) { el.classList.add('good'); badge = `▼ ${num(-d, 1)} ct unter deinem Ø`; }
  else if (isNum(d) && d > 2) { el.classList.add('bad'); badge = `▲ ${num(d, 1)} ct über deinem Ø`; }
  el.innerHTML = `<div class="hero-top"><span class="hero-label"><i class="live-dot"></i> Jetzt tanken</span><span class="hero-badge">${badge}</span></div>
    <div class="hero-price" id="hero-price"></div>
    <div class="hero-station">${brandBadge(best.brand || best.name)}<div style="min-width:0"><b>${esc(displayName(best))}</b><span>${num(best.dist, 1)} km · ${esc(best.street)}</span></div></div>
    <div class="hero-why">${best.nearest ? 'Nächste Tankstelle und gleichzeitig die beste Wahl' : `Spart <b>${eur(best.saving)}</b> ggü. der nächsten – Umweg schon eingerechnet`}${best.disc ? ` · inkl. −${num(best.disc.ct, 1, 0)} ct ${esc(best.disc.label)}` : ''}</div>
    <div class="hero-actions"><a class="solid" href="${mapsLink(best)}" target="_blank" rel="noopener">${ICONS.route} Route</a><button data-fill="${best.id}">${ICONS.plus} Hier getankt</button></div>`;
  const fmt = (v) => `${fuelPrice(v)}<small>€/L</small>`;
  countUp($('#hero-price'), isNum(heroPrice) ? heroPrice : best.eff + 0.15, best.eff, fmt);
  heroPrice = best.eff;
}

function renderNearby() {
  renderHero();
  const el = $('#nearby-list');
  const wrap = [el, el.previousElementSibling];
  const hide = (h) => wrap.forEach((x) => (x.hidden = h));
  if (stationError || !stationData) return hide(true);
  const list = sortStations(stationData.stations, 'smart', calcOpts({ openOnly: true }));
  hide(list.length < 2);
  el.innerHTML = list.slice(1, 4).map((s, i) => stationCard(s, i + 1, list[0].eff, true)).join('');
}

function renderStations() {
  const s = S();
  $('#st-radius').value = s.radius;
  $('#st-sort').value = s.sort;
  $('#st-open').checked = s.openOnly;
  const el = $('#stations-list');
  if (stationError) { el.innerHTML = stationProblem(); $('#stations-meta').textContent = ''; return; }
  if (!stationData) { el.innerHTML = '<div class="empty">Lade Preise …</div>'; return; }
  const list = sortStations(stationData.stations, s.sort, calcOpts({ openOnly: s.openOnly }));
  const cheapest = list.length ? Math.min(...list.map((x) => x.eff)) : null;
  el.innerHTML = list.length ? list.map((st, i) => stationCard(st, i, cheapest, false)).join('') : '<div class="empty">Keine Tankstellen gefunden. Umkreis vergrößern?</div>';
  const prices = list.map((x) => x.price);
  $('#stations-meta').textContent = list.length
    ? `${list.length} Tankstellen · ${num(Math.min(...prices), 3)}–${num(Math.max(...prices), 3)} € · Stand ${fmtTime(stationData.fetchedAt)}`
    : '';
  if (document.activeElement !== $('#calc-liters')) $('#calc-liters').value = fillLiters();
  $('#calc-explain').innerHTML = `Verbrauch ${num(consumptionSetting(), 1)} L/100 km · Weg hin & zurück, Straße ≈ ${num(ROAD_FACTOR, 1)} × Luftlinie${(s.discounts || []).some((d) => d.on) ? ' · deine Rabatte abgezogen' : ''}`;
}

$('#stations-refresh').addEventListener('click', () => { haptic(); loadStations(true); });
$('#st-radius').addEventListener('change', (e) => { store.setSettings({ radius: +e.target.value }, true); loadStations(true); });
$('#st-sort').addEventListener('change', (e) => { store.setSettings({ sort: e.target.value }, true); renderStations(); });
$('#st-open').addEventListener('change', (e) => { store.setSettings({ openOnly: e.target.checked }, true); renderStations(); });
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-retry]')) loadStations(true);
  const f = e.target.closest('[data-fill]');
  if (f) {
    const st = stationData.stations.find((x) => x.id === f.dataset.fill);
    openEntry(null, { station: `${displayName(st)} ${st.street}`, price: st.price });
    autoCalc(null);
  }
});

$('#calc-liters').addEventListener('change', (e) => {
  const v = parseNum(e.target.value);
  store.setSettings({ fillLiters: v > 0 ? v : null }, true);
  renderStations(); renderNearby();
});

/* ---------- Meine Rabatte ---------- */
function discounts() {
  // Vorlagen ergänzen, die es beim Anlegen der Einstellungen noch nicht gab
  const list = [...(S().discounts || [])];
  for (const p of DISCOUNT_PRESETS) if (!list.some((d) => d.id === p.id)) list.push({ ...p, on: false });
  return list;
}

function renderDiscounts() {
  const now = Date.now();
  $('#discount-list').innerHTML = discounts().map((d) => {
    const expired = d.until && now > new Date(d.until + 'T23:59:59').getTime();
    return `<div class="row disc-row ${expired ? 'expired' : ''}">
      ${brandBadge(d.brand)}
      <span class="disc-text"><b>${esc(d.label)}</b><small>${esc(d.brand)} · −${num(d.ct, 1, 0)} ct/L${d.until ? ` · ${expired ? 'abgelaufen' : 'bis'} ${fmtDate(d.until)}` : ''}${d.note ? ' · ' + esc(d.note) : ''}</small></span>
      ${d.custom ? `<button class="x-btn" data-disc-del="${d.id}" aria-label="Löschen">✕</button>` : ''}
      <span class="switch"><input type="checkbox" data-disc="${d.id}" ${d.on ? 'checked' : ''} ${expired ? 'disabled' : ''}><i></i></span>
    </div>`;
  }).join('');
}

$('#discount-list').addEventListener('change', (e) => {
  const id = e.target.dataset.disc;
  if (!id) return;
  haptic();
  store.setSettings({ discounts: discounts().map((d) => (d.id === id ? { ...d, on: e.target.checked } : d)) });
  renderDiscounts();
});
$('#discount-list').addEventListener('click', (e) => {
  const id = e.target.closest('[data-disc-del]')?.dataset.discDel;
  if (!id) return;
  store.setSettings({ discounts: discounts().filter((d) => d.id !== id) });
  renderDiscounts();
});
$('#disc-add').addEventListener('click', () => {
  const brand = $('#disc-brand').value.trim().toUpperCase();
  const ct = parseNum($('#disc-ct').value);
  if (!brand || !(ct > 0)) return toast('Bitte Marke und Cent pro Liter angeben');
  const d = { id: 'c_' + uid(), brand, ct, label: $('#disc-label').value.trim() || 'Mein Rabatt', until: $('#disc-until').value || null, on: true, custom: true };
  store.setSettings({ discounts: [...discounts(), d] });
  ['#disc-brand', '#disc-ct', '#disc-label', '#disc-until'].forEach((x) => ($(x).value = ''));
  renderDiscounts();
  toast('Rabatt hinzugefügt');
});

/* =========================================================
   Verlauf
   ========================================================= */
function yearsOf(entries) {
  const ys = new Set(entries.map((e) => new Date(e.date).getFullYear()));
  ys.add(new Date().getFullYear());
  return [...ys].sort((a, b) => b - a);
}

function fillYearSelect(sel, withAll) {
  const cur = sel.value;
  const ys = yearsOf(store.getEntries());
  sel.innerHTML = (withAll ? '<option value="all">Alle Jahre</option>' : '') + ys.map((y) => `<option>${y}</option>`).join('');
  sel.value = cur && [...sel.options].some((o) => o.value === cur) ? cur : String(withAll ? 'all' : ys[0]);
}

function renderLog() {
  const sel = $('#log-year');
  fillYearSelect(sel, true);
  let entries = store.getEntries();
  if (sel.value !== 'all') entries = stats.inRange(entries, ...stats.yearRange(+sel.value));
  const t = stats.totals(entries);
  const km = stats.kmDriven(entries);
  $('#log-summary').innerHTML = `
    <div><span>Kosten</span><b>${eur(t.total, 0)}</b></div>
    <div><span>Liter</span><b>${num(t.liters, 0)}</b></div>
    <div><span>Ø €/L</span><b>${num(t.avgPrice, 3)}</b></div>
    <div><span>Tankungen</span><b>${t.count}</b></div>
    <div><span>km</span><b>${isNum(km) ? num(km, 0) : '–'}</b></div>
    <div><span>Ø Verbrauch</span><b>${isNum(stats.avgConsumption(entries, 999)) ? num(stats.avgConsumption(entries, 999), 1) : '–'}</b></div>`;

  const cons = new Map(stats.consumptionSegments(store.getEntries()).map((s) => [s.date, s.l100]));
  const groups = new Map();
  [...entries].reverse().forEach((e) => {
    const k = monthName(e.date);
    (groups.get(k) || groups.set(k, []).get(k)).push(e);
  });
  const all = store.getEntries();
  $('#log-list').innerHTML = groups.size ? [...groups.entries()].map(([m, list]) => `
    <div class="month-head"><span>${m}</span><span>${eur(sum(list, (e) => e.total))}</span></div>
    <div class="month-group">${list.map((e) => {
      const i = all.indexOf(e);
      const prev = all[i - 1];
      const d = prev ? (stats.paidPrice(e) - stats.paidPrice(prev)) * 100 : null;
      return `<button class="entry" data-edit="${e.id}">
        <div class="day"><b>${new Date(e.date).getDate()}</b><span>${new Date(e.date).toLocaleDateString('de-DE', { weekday: 'short' })}</span></div>
        <div style="min-width:0">
          <div class="title">${esc(e.station || 'Tankung')}</div>
          <div class="meta">${num(e.liters)} L · ${num(e.price, 3)} €/L${e.discount > 0 ? ` · <span class="disc-c">−${eur(e.discount)}</span>` : ''}${cons.has(e.date) ? ` · ${num(cons.get(e.date), 1)} L/100` : ''}${e.receiptId ? ' · 🧾' : ''}${e.usage !== 'privat' ? ' · 💼' : ''}${e.demo ? ' · Demo' : ''}</div>
        </div>
        <div class="amount">${eur(e.total)}${d != null ? `<small class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${signed(d, 1)} ct</small>` : ''}</div>
      </button>`;
    }).join('')}</div>`).join('') : '<div class="empty">Noch keine Tankungen erfasst.</div>';
}
$('#log-year').addEventListener('change', renderLog);
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-edit]');
  if (b) openEntry(store.getEntry(b.dataset.edit));
});

/* =========================================================
   Steuer
   ========================================================= */
function taxYearEntries() {
  return stats.inRange(store.getEntries(), ...stats.yearRange(+$('#tax-year').value));
}

function renderTax() {
  fillYearSelect($('#tax-year'), false);
  const s = S();
  const r = yearReport(taxYearEntries());
  const bizPct = r.gross ? (r.business / r.gross) * 100 : 0;
  $('#tax-summary').innerHTML = `<div class="tax-hero">
    <div class="lbl">Kraftstoff ${$('#tax-year').value}</div>
    <div class="big">${eur(r.gross)}</div>
    <div class="muted small">${r.count} Tankungen · ${num(r.liters, 0)} Liter · davon MwSt ${eur(r.vat)}</div>
    <div class="tax-bar" role="img" aria-label="Beruflicher Anteil ${num(bizPct, 0)} Prozent">
      <i style="width:${bizPct}%;background:var(--accent)"></i><i style="flex:1;background:var(--surface-3)"></i>
    </div>
    <div class="tax-grid">
      <div><span><i style="background:var(--accent)"></i>Beruflich (${num(bizPct, 0)} %)</span><b>${eur(r.business)}</b></div>
      <div><span><i style="background:var(--surface-3)"></i>Privat</span><b>${eur(r.gross - r.business)}</b></div>
      <div><span>Vorsteuer beruflich</span><b>${eur(r.businessVat)}</b></div>
      <div><span>Netto gesamt</span><b>${eur(r.net)}</b></div>
    </div>
  </div>`;
  for (const [id, key] of [['#tax-commute-km', 'commuteKm'], ['#tax-workdays', 'workDays'], ['#tax-rate', 'commuteRate']]) {
    if (document.activeElement !== $(id)) $(id).value = s[key] ?? '';
  }
  const a = commuteAllowance(s.commuteKm, s.workDays, s.commuteRate);
  $('#tax-commute-result').innerHTML = s.commuteKm
    ? `Entfernungspauschale ${$('#tax-year').value}<b class="num">${eur(a)}</b><span class="muted small">${num(s.commuteKm, 0)} km × ${s.workDays} Tage × ${num(s.commuteRate, 2)} €${a < 1230 ? ' · liegt unter dem Arbeitnehmer-Pauschbetrag (1.230 €)' : ''}</span>`
    : 'Trag deine einfache Strecke zur Arbeit ein, um die Pauschale zu berechnen.';
}
$('#tax-year').addEventListener('change', renderTax);
for (const [id, key] of [['#tax-commute-km', 'commuteKm'], ['#tax-workdays', 'workDays'], ['#tax-rate', 'commuteRate']]) {
  $(id).addEventListener('input', (e) => { store.setSettings({ [key]: parseNum(e.target.value) || 0 }, true); renderTax(); });
}
$('#export-csv').addEventListener('click', () => { exportCsv(taxYearEntries(), $('#tax-year').value, S()); toast('CSV erstellt'); });
$('#export-pdf').addEventListener('click', () => printReport(taxYearEntries(), $('#tax-year').value, S()));
$('#export-receipts').addEventListener('click', async (e) => {
  e.target.disabled = true;
  try {
    const n = await exportReceipts(taxYearEntries(), $('#tax-year').value, S());
    toast(n ? `${n} Belege gepackt` : 'Keine Belegfotos in diesem Jahr');
  } catch (err) { toast('ZIP fehlgeschlagen: ' + err.message); }
  e.target.disabled = false;
});

/* =========================================================
   Eintrag erfassen / bearbeiten
   ========================================================= */
const dlg = $('#entry-dialog');
const form = $('#entry-form');
let editing = null;          // bestehender Eintrag
let pendingReceipt = null;   // { blob, url } oder 'remove'
let edits = [];              // Reihenfolge der zuletzt bearbeiteten Felder liters/price/total

function openEntry(entry, prefill = {}) {
  haptic();
  editing = entry || null;
  pendingReceipt = null;
  edits = [];
  form.reset();
  $$('input', form).forEach((i) => i.classList.remove('auto', 'scanned'));
  const all = store.getEntries();
  const last = all[all.length - 1];
  const e = entry || { date: new Date().toISOString(), fuel: S().fuel, full: true, usage: last?.usage === 'beruflich' ? 'beruflich' : 'privat', share: 0, ...prefill };
  form.date.value = toLocalInput(e.date);
  form.fuel.value = e.fuel || 'E10';
  form.liters.value = isNum(e.liters) ? num(e.liters, 2) : '';
  form.price.value = isNum(e.price) ? num(e.price, 3, 3) : '';
  form.total.value = isNum(e.total) ? num(e.total, 2) : '';
  form.discount.value = e.discount > 0 ? num(e.discount, 2) : '';
  discountManual = e.discount > 0;
  discountRule = null;
  form.odometer.value = isNum(e.odometer) ? e.odometer : '';
  form.odometer.placeholder = last && isNum(last.odometer) && !entry ? `zuletzt ${num(last.odometer, 0)}` : 'optional';
  form.station.value = e.station || '';
  form.full.checked = e.full !== false;
  form.usage.value = e.usage || 'privat';
  form.share.value = e.usage === 'beruflich' ? 100 : e.share || 0;
  syncShareRow();
  form.note.value = e.note || '';
  if (isNum(e.price)) edits.push('price');
  $('#entry-title').textContent = entry ? 'Tankung bearbeiten' : 'Tanken erfassen';
  $('#entry-delete').hidden = !entry;
  $('#scan-progress').hidden = true;
  $('#ocr-text').hidden = true;
  showReceipt(null);
  if (entry?.receiptId) store.getReceipt(entry.receiptId).then((b) => b && showReceipt(URL.createObjectURL(b)));
  applyDiscountRule();
  updateHint();
  dlg.showModal();
}

function showReceipt(url) {
  const box = $('#receipt-preview');
  box.hidden = !url;
  if (url) $('img', box).src = url;
}

/** Aus zwei der drei Werte Liter / Preis / Betrag den dritten berechnen */
let discountManual = false;   // Rabatt selbst eingetragen oder vom Beleg → nicht automatisch überschreiben
let discountRule = null;      // aktiver Rabatt aus „Meine Rabatte“ (ct/L) für die eingetragene Tankstelle

/** Rabatt aus „Meine Rabatte“ passend zur Tankstelle vorschlagen */
function applyDiscountRule() {
  const hint = $('#disc-auto');
  if (discountManual) { discountRule = null; return; }
  const name = form.station.value.trim();
  discountRule = name ? activeDiscount({ brand: name, name: '' }, S().discounts) : null;
  hint.textContent = discountRule ? `−${num(discountRule.ct, 1, 0)} ct/L · ${discountRule.label}` : 'ADAC, Coupon, Tankkarte …';
  hint.classList.toggle('on', !!discountRule);
  if (!discountRule) form.discount.value = '';
}

/**
 * Aus zwei der drei Werte Liter / Preis / Betrag den dritten berechnen.
 * Betrag = Liter × Preis − Rabatt (Rabatt fest in € oder automatisch in ct/L)
 */
function autoCalc(changed) {
  if (changed) edits = [...edits.filter((x) => x !== changed), changed];
  applyDiscountRule();
  const v = { liters: parseNum(form.liters.value), price: parseNum(form.price.value), total: parseNum(form.total.value) };
  const known = edits.filter((k) => isNum(v[k]) && v[k] > 0).slice(-2);
  const c = discountRule ? discountRule.ct / 100 : 0;          // Rabatt je Liter
  const D = discountRule ? 0 : parseNum(form.discount.value) || 0; // fester Rabatt in €
  if (known.length < 2) return updateHint();
  const target = ['liters', 'price', 'total'].find((k) => !known.includes(k));
  let r;
  if (target === 'total') r = num(v.liters * (v.price - c) - D, 2);
  if (target === 'liters') r = num((v.total + D) / (v.price - c), 2);
  if (target === 'price') r = num((v.total + D) / v.liters + c, 3, 3);
  form[target].value = r;
  form[target].classList.add('auto');
  known.forEach((k) => form[k].classList.remove('auto'));
  if (discountRule) form.discount.value = num(parseNum(form.liters.value) * c, 2);
  updateHint();
}

function updateHint() {
  const l = parseNum(form.liters.value), p = parseNum(form.price.value), odo = parseNum(form.odometer.value);
  const all = store.getEntries().filter((x) => x.id !== editing?.id && new Date(x.date) < new Date(form.date.value));
  const prev = [...all].reverse().find((x) => isNum(x.odometer));
  const parts = [];
  if (isNum(odo) && prev) {
    const km = odo - prev.odometer;
    if (km <= 0) parts.push(`⚠️ km-Stand ist nicht höher als zuletzt (${num(prev.odometer, 0)})`);
    else {
      parts.push(`${num(km, 0)} km seit letzter Tankung`);
      if (form.full.checked && isNum(l) && prev.full) parts.push(`≈ ${num((l / km) * 100, 1)} L/100 km`);
    }
  }
  const ref = stats.totals(stats.inRange(store.getEntries(), Date.now() - 120 * DAY)).avgPrice;
  if (isNum(p) && isNum(ref)) {
    const d = (p - ref) * 100;
    parts.push(`<span class="${d > 0 ? 'up' : 'down'}">${signed(d, 1)} ct ggü. deinem Ø</span>`);
  }
  $('#calc-hint').innerHTML = parts.join(' · ');
}

['liters', 'price', 'total'].forEach((k) => form[k].addEventListener('input', () => { form[k].classList.remove('auto'); autoCalc(k); }));
form.discount.addEventListener('input', () => { discountManual = form.discount.value.trim() !== ''; autoCalc(null); });
form.station.addEventListener('input', () => autoCalc(null));
['odometer', 'date'].forEach((k) => form[k].addEventListener('input', updateHint));
form.full.addEventListener('change', updateHint);
// Anteil-Zeile nur bei „Gemischt“ zeigen
const syncShareRow = () => { $('#share-row').hidden = form.usage.value !== 'gemischt'; };
$('#usage-seg').addEventListener('change', () => {
  haptic();
  if (form.usage.value === 'beruflich') form.share.value = 100;
  if (form.usage.value === 'privat') form.share.value = 0;
  if (form.usage.value === 'gemischt' && (+form.share.value === 0 || +form.share.value === 100)) form.share.value = 50;
  syncShareRow();
});
$('[data-close]', form).addEventListener('click', () => dlg.close());
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

async function handleScan(file) {
  if (!file) return;
  const prog = $('#scan-progress');
  const bar = $('i', prog);
  prog.hidden = false;
  bar.style.width = '5%';
  try {
    const blob = await compressImage(file);
    pendingReceipt = { blob };
    showReceipt(URL.createObjectURL(blob));
    $('span', prog).textContent = 'Beleg wird gelesen … (beim ersten Mal lädt die Texterkennung ~10 MB)';
    const r = await scanReceipt(file, (p) => (bar.style.width = `${Math.round(p * 100)}%`));
    const found = [];
    const set = (name, value) => { form[name].value = value; form[name].classList.remove('auto'); form[name].classList.add('scanned'); found.push(name); };
    if (r.date) set('date', toLocalInput(r.date));
    if (isNum(r.liters)) set('liters', num(r.liters, 2));
    if (isNum(r.price)) set('price', num(r.price, 3, 3));
    if (isNum(r.total)) set('total', num(r.total, 2));
    if (r.fuel) form.fuel.value = r.fuel;
    if (r.station && !form.station.value) set('station', r.station);
    if (r.discount > 0) { set('discount', num(r.discount, 2)); discountManual = true; $('#disc-auto').textContent = `${r.discountLabel || 'Rabatt'} vom Beleg`; $('#disc-auto').classList.add('on'); }
    edits = ['liters', 'price', 'total'].filter((k) => found.includes(k));
    updateHint();
    const core = ['liters', 'price', 'total'].filter((k) => found.includes(k)).length;
    toast(core === 3 ? '✅ Beleg erkannt – bitte kurz prüfen' : core ? 'Teilweise erkannt – bitte ergänzen' : 'Nichts erkannt – Foto gerader & heller aufnehmen');
    console.debug('[OCR]', r.text);
    const box = $('#ocr-text');
    $('pre', box).textContent = r.text.trim() || '(kein Text erkannt)';
    box.hidden = false;
    box.open = core < 3;
  } catch (err) {
    console.error(err);
    toast('Scan fehlgeschlagen: ' + (err.message || 'Texterkennung nicht verfügbar (offline?)'));
  } finally {
    prog.hidden = true;
    $('span', prog).textContent = 'Beleg wird gelesen …';
  }
}
$('#scan-camera').addEventListener('change', (e) => { handleScan(e.target.files[0]); e.target.value = ''; });
$('#scan-file').addEventListener('change', (e) => { handleScan(e.target.files[0]); e.target.value = ''; });
$('#ocr-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#ocr-text pre').textContent); toast('Text kopiert – schick ihn mir, wenn etwas nicht stimmt'); } catch { toast('Kopieren nicht möglich'); }
});
$('#receipt-remove').addEventListener('click', () => { pendingReceipt = 'remove'; showReceipt(null); });
$('#receipt-preview img').addEventListener('click', (e) => {
  const lb = $('#receipt-dialog');
  $('img', lb).src = e.target.src;
  lb.showModal();
});

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const liters = parseNum(form.liters.value), price = parseNum(form.price.value);
  let total = parseNum(form.total.value);
  if (!(liters > 0) || !(price > 0)) {
    toast('Bitte Liter und Preis (oder Betrag) angeben');
    (liters > 0 ? form.price : form.liters).focus();
    return;
  }
  if (!(total > 0)) total = Math.round((liters * price - (parseNum(form.discount.value) || 0)) * 100) / 100;
  const odo = parseNum(form.odometer.value);
  const share = Math.max(0, Math.min(100, parseInt(form.share.value, 10) || 0));
  const entry = {
    ...(editing || {}),
    id: editing?.id || uid(),
    date: new Date(form.date.value || Date.now()).toISOString(),
    liters, price, total,
    discount: Math.max(0, parseNum(form.discount.value) || 0),
    odometer: isNum(odo) ? Math.round(odo) : null,
    full: form.full.checked,
    fuel: form.fuel.value,
    station: form.station.value.trim(),
    usage: form.usage.value,
    share: form.usage.value === 'beruflich' ? 100 : form.usage.value === 'privat' ? 0 : share,
    note: form.note.value.trim(),
  };
  delete entry.demo;
  if (pendingReceipt === 'remove' && entry.receiptId) { store.deleteReceipt(entry.receiptId); delete entry.receiptId; }
  if (pendingReceipt?.blob) {
    if (entry.receiptId) store.deleteReceipt(entry.receiptId);
    entry.receiptId = 'r_' + entry.id + '_' + Date.now().toString(36);
    await store.putReceipt(entry.receiptId, pendingReceipt.blob);
  }
  store.saveEntry(entry);
  haptic(20);
  dlg.close();
  toast(editing ? 'Gespeichert' : `⛽️ ${eur(total)} erfasst`);
});

$('#entry-delete').addEventListener('click', () => {
  if (!editing || !confirm('Diese Tankung wirklich löschen?')) return;
  store.deleteEntry(editing.id);
  dlg.close();
  toast('Gelöscht');
});
$('#fab-add').addEventListener('click', () => openEntry(null));

function updateSuggestions() {
  const names = new Set();
  if (stationData) sortStations(stationData.stations, 'dist', calcOpts()).slice(0, 8).forEach((s) => names.add(`${displayName(s)} ${s.street}`));
  store.getEntries().slice(-30).reverse().forEach((e) => e.station && names.add(e.station));
  $('#station-suggestions').innerHTML = [...names].map((n) => `<option value="${esc(n)}">`).join('');
}

/* =========================================================
   Einstellungen
   ========================================================= */
const SETTINGS_FIELDS = [
  ['#set-vehicle', 'vehicle', 'text'], ['#set-plate', 'plate', 'text'], ['#set-tank', 'tankSize', 'num'], ['#set-fuel', 'fuel', 'text'],
  ['#set-apikey', 'apiKey', 'text'], ['#set-alarm', 'alarm', 'num'], ['#set-cons', 'consumption', 'num'],
  ['#set-sheets', 'sheetsUrl', 'text'], ['#set-secret', 'sheetsSecret', 'text'], ['#set-autosync', 'autoSync', 'bool'],
];

function fillSettings() {
  renderDiscounts();
  const s = S();
  for (const [sel, key, type] of SETTINGS_FIELDS) {
    if (type === 'bool') $(sel).checked = !!s[key];
    else $(sel).value = s[key] ?? '';
  }
}

for (const [sel, key, type] of SETTINGS_FIELDS) {
  $(sel).addEventListener('change', (e) => {
    const v = type === 'bool' ? e.target.checked : type === 'num' ? (isNum(parseNum(e.target.value)) ? parseNum(e.target.value) : null) : e.target.value.trim();
    store.setSettings({ [key]: v });
    if (key === 'apiKey') { stationError = null; loadStations(true); }
    if (key === 'alarm' && isNum(v) && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    toast('Gespeichert');
  });
}

$('#sheets-help').addEventListener('click', async () => {
  const g = $('#sheets-guide');
  g.hidden = !g.hidden;
  if (!g.hidden && $('#script-code').textContent === 'Lädt …') {
    try {
      let code = await (await fetch('google-apps-script/Code.gs')).text();
      if (S().sheetsSecret) code = code.replace('HIER-DEINEN-SCHLUESSEL-EINTRAGEN', S().sheetsSecret);
      $('#script-code').textContent = code;
    } catch { $('#script-code').textContent = 'Konnte Script nicht laden – siehe google-apps-script/Code.gs im Repository.'; }
  }
});
$('#copy-script').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#script-code').textContent);
  toast('Code kopiert');
});

let syncTimer;
async function doSync(manual) {
  const s = S();
  if (!store.getEntries().length) {
    if (manual) toast('Noch nichts zu sichern – für ein neues Handy „Wiederherstellen“ tippen', 4000);
    return;
  }
  const status = $('#sync-status');
  status.textContent = 'Übertrage zu Google Sheets …';
  status.className = 'brand-sub';
  try {
    const r = await syncToSheets(store.getEntries(), s, store.exportData());
    store.setSettings({ lastSync: Date.now() }, true);
    if (manual) toast(r.unconfirmed ? 'Gesendet – bitte im Sheet prüfen' : `✅ ${r.rows} Zeilen gesichert`);
    status.textContent = 'Sichere Belegfotos …';
    const n = await uploadReceipts(store.getEntries(), s, store.getReceipt);
    if (manual && n) toast(`📸 ${n} Beleg${n === 1 ? '' : 'e'} in Google Drive gesichert`);
  } catch (e) {
    if (manual) toast('Sheets: ' + e.message, 4000);
    status.textContent = 'Sheets-Fehler: ' + e.message;
    status.className = 'brand-sub err';
    return;
  }
  renderSyncStatus();
}
$('#sheets-sync').addEventListener('click', () => doSync(true));

/** Holt Tankbuch, Einstellungen und Belegfotos aus der Google-Sicherung zurück */
async function restoreFromGoogle({ ask = true } = {}) {
  const s = S();
  const status = $('#sync-status');
  status.textContent = 'Suche Sicherung in Google …';
  status.className = 'brand-sub';
  let backup;
  try {
    backup = await fetchBackup(s);
  } catch (e) {
    renderSyncStatus();
    if (ask) toast('Wiederherstellen: ' + e.message, 4000);
    return false;
  }
  const d = backup.data;
  if (!Array.isArray(d.entries)) { renderSyncStatus(); toast('Sicherung ist leer'); return false; }
  const local = store.getEntries().length;
  if (ask && !confirm(`Sicherung vom ${fmtDate(backup.at)} ${fmtTime(backup.at)} mit ${d.entries.length} Tankungen laden?${local ? `\n\nDie ${local} Tankungen auf diesem Gerät werden dabei ersetzt.` : ''}`)) { renderSyncStatus(); return false; }
  // Sheets-Zugang des Geräts behalten, Rest aus der Sicherung
  const keep = { sheetsUrl: s.sheetsUrl, sheetsSecret: s.sheetsSecret, autoSync: s.autoSync, apiKey: s.apiKey || d.settings?.apiKey || '' };
  const receiptIds = d.entries.map((e) => e.receiptId).filter(Boolean);
  markUploaded(receiptIds); // liegen ja schon in Drive
  restoring = true;
  store.replaceAll({ entries: d.entries, snapshots: d.snapshots || [], settings: { ...d.settings, ...keep, lastSync: Date.now() } });
  restoring = false;
  toast(`✅ ${d.entries.length} Tankungen wiederhergestellt`, 4000);
  let n = 0;
  for (const id of receiptIds) {
    if (await store.getReceipt(id)) continue;
    status.textContent = `Lade Belegfotos … ${++n}/${receiptIds.length}`;
    try { await store.putReceipt(id, await fetchReceipt(S(), id)); } catch (e) { console.warn('Beleg', id, e); }
  }
  renderAll();
  return true;
}
let restoring = false;
$('#sheets-restore').addEventListener('click', () => restoreFromGoogle());

function renderSyncStatus() {
  const s = S();
  const el = $('#sync-status');
  if (s.sheetsUrl && s.lastSync) { el.textContent = `Gesichert · ${fmtDate(s.lastSync, { day: '2-digit', month: '2-digit' })} ${fmtTime(s.lastSync)}`; el.className = 'brand-sub ok'; }
  else { el.textContent = s.plate ? s.plate : `${store.getEntries().length} Tankungen`; el.className = 'brand-sub'; }
}

document.addEventListener('click', (e) => { if (e.target.closest('[data-backup-now]')) $('#backup-export').click(); });
$('#backup-export').addEventListener('click', () => {
  download(`tankbuch-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(store.exportData(), null, 1), 'application/json');
  store.setSettings({ lastExport: Date.now() }, true);
  renderInsights();
});
$('#backup-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.entries)) throw new Error('Keine Tankbuch-Datei');
    if (!confirm(`${data.entries.length} Tankungen importieren? Aktuelle Daten werden ersetzt.`)) return;
    store.replaceAll(data);
    toast('Backup importiert');
  } catch (err) { toast('Import fehlgeschlagen: ' + err.message); }
  e.target.value = '';
});
$('#demo-load').addEventListener('click', () => {
  store.removeWhere((x) => x.demo);
  store.mergeData(demoData());
  toast('Demo-Daten geladen');
  nav('home');
});
$('#demo-clear').addEventListener('click', () => { store.removeWhere((x) => x.demo); toast('Demo-Daten entfernt'); });
$('#reset-all').addEventListener('click', async () => {
  if (!confirm('Wirklich ALLE Tankungen, Belege und Einstellungen löschen?')) return;
  store.replaceAll({ entries: [], snapshots: [] });
  await store.clearReceipts();
  toast('Alles gelöscht');
});

/* =========================================================
   Gesamt-Rendering & Start
   ========================================================= */
function renderAll() {
  $('#vehicle-name').textContent = S().vehicle || 'Mein Auto';
  $('#greeting').textContent = greeting();
  $('#today').textContent = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  renderSyncStatus();
  renderChartBlock();
  renderKpis();
  renderInsights();
  renderNearby();
  if ($('#view-log').classList.contains('active')) renderLog();
  if ($('#view-tax').classList.contains('active')) renderTax();
}

store.onChange((kind) => {
  renderAll();
  if (kind === 'settings') renderStations();
  // nie automatisch ein leeres Tankbuch über die Sicherung schreiben
  if (kind === 'entries' && S().autoSync && S().sheetsUrl && !restoring && store.getEntries().length) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => doSync(false), 1500);
  }
});

/** Einrichtungs-Link: …/#setup&key=…&sheets=…&secret=… trägt alles mit einem Tipp ein */
function applySetupLink() {
  if (!location.hash.startsWith('#setup')) return false;
  const p = new URLSearchParams(location.hash.slice(6));
  const patch = {};
  if (p.get('key')) patch.apiKey = p.get('key');
  if (p.get('sheets')) { patch.sheetsUrl = p.get('sheets'); patch.autoSync = true; }
  if (p.get('secret')) patch.sheetsSecret = p.get('secret');
  if (p.get('car')) patch.vehicle = p.get('car');
  history.replaceState(null, '', location.pathname);
  if (!Object.keys(patch).length) return false;
  store.setSettings(patch);
  toast('✅ Einrichtung übernommen', 4000);
  if (patch.sheetsUrl) {
    // Neues Handy? Dann zuerst die Sicherung holen statt das leere Tankbuch hochzuladen
    if (!store.getEntries().length) restoreFromGoogle({ ask: false });
    else doSync(false);
  }
  return true;
}

/* ---------- Willkommens-Rundgang beim ersten Start ---------- */
function showOnboarding() {
  const ob = $('#onboarding'), track = $('#ob-track'), next = $('#ob-next');
  const dots = $$('#ob-dots i');
  ob.hidden = false;
  document.body.style.overflow = 'hidden';
  const index = () => Math.round(track.scrollLeft / track.clientWidth);
  track.addEventListener('scroll', () => {
    const i = index();
    dots.forEach((d, k) => d.classList.toggle('on', k === i));
    next.textContent = i === dots.length - 1 ? 'Los geht’s' : 'Weiter';
  }, { passive: true });
  const finish = () => {
    store.setSettings({ onboarded: true }, true);
    ob.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(1.04)' }], { duration: 350, easing: 'ease-in' }).onfinish = () => { ob.hidden = true; document.body.style.overflow = ''; nav('home'); };
  };
  next.addEventListener('click', () => {
    haptic();
    const i = index();
    if (i >= dots.length - 1) finish();
    else track.scrollTo({ left: (i + 1) * track.clientWidth, behavior: 'smooth' });
  });
  $('#ob-demo').addEventListener('click', () => { store.mergeData(demoData()); finish(); toast('Beispieldaten geladen – in den Einstellungen wieder entfernbar', 4000); });
}

function start() {
  // Bittet den Browser, die Daten nie automatisch aufzuräumen (v. a. Safari löscht sonst nach Wochen ohne Nutzung)
  navigator.storage?.persist?.().then((ok) => store.setSettings({ persisted: ok }, true)).catch(() => {});
  const fromSetupLink = applySetupLink();
  renderAll();
  const hash = location.hash.slice(1);
  if (['stations', 'log', 'tax', 'settings'].includes(hash)) nav(hash);
  if (new URLSearchParams(location.search).has('add')) openEntry(null);
  else if (!fromSetupLink && !S().onboarded && !store.getEntries().length) showOnboarding();
  loadStations();
  updateSuggestions();
  // Beim Zurückkehren in die App frische Preise holen
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadStations(); });
}

if (window.LightweightCharts) start();
else window.addEventListener('load', start, { once: true });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // Kommt eine neue Version an, sofort neu laden statt die alte weiter anzuzeigen
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    // Beim Zurückkehren in die App nach Updates schauen
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
}
