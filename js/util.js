export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const nf = {};
const fmt = (min, max) => (nf[`${min}-${max}`] ??= new Intl.NumberFormat('de-DE', { minimumFractionDigits: min, maximumFractionDigits: max }));

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const num = (v, d = 2, dMin = d) => (isNum(v) ? fmt(dMin, d).format(v) : '–');
export const eur = (v, d = 2) => (isNum(v) ? `${num(v, d)} €` : '–');
export const signed = (v, d = 2) => (isNum(v) ? (v > 0 ? '+' : v < 0 ? '−' : '±') + num(Math.abs(v), d) : '–');

/** Spritpreis im Tankstellen-Stil: 1,75⁹ */
export function fuelPrice(v, html = true) {
  if (!isNum(v)) return '–';
  const s = num(v, 3, 3);
  return html ? `${s.slice(0, -1)}<sup>${s.slice(-1)}</sup>` : s;
}

/** "1.234,56" / "1,759" / "40.12" → Number */
export function parseNum(s) {
  if (s == null) return NaN;
  if (typeof s === 'number') return s;
  let t = String(s).trim().replace(/\s|€|EUR/gi, '');
  if (!t) return NaN;
  if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '');
  return parseFloat(t.replace(',', '.'));
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const DAY = 86400000;
export const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const fmtDate = (d, opts = { day: '2-digit', month: '2-digit', year: 'numeric' }) => new Date(d).toLocaleDateString('de-DE', opts);
export const fmtTime = (d) => new Date(d).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
export const monthName = (d) => new Date(d).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });

/** Date → "YYYY-MM-DDTHH:mm" in lokaler Zeit (für datetime-local) */
export function toLocalInput(d) {
  const x = new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastTimer;
export function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export const haptic = (ms = 10) => navigator.vibrate?.(ms);

export function download(filename, data, type = 'text/plain') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Luftlinie in km */
export function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371, r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export const sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + (f(x) || 0), 0);
export const avg = (arr, f = (x) => x) => (arr.length ? sum(arr, f) / arr.length : NaN);
