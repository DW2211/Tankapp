// Beleg-Scan: Bild vorbereiten → Tesseract (läuft komplett auf dem Gerät) → deutsche Tankbelege auswerten.
// Texterkennung und Sprachdaten liegen in vendor/, es wird nichts von fremden Servern nachgeladen.
import { parseNum, isNum } from './util.js';

let workerPromise;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve();
    const s = Object.assign(document.createElement('script'), { src, onload: resolve, onerror: () => reject(new Error('Texterkennung konnte nicht geladen werden')) });
    document.head.append(s);
  });
}

let progressCb = null;
const PSM = '6';
async function getWorker() {
  workerPromise ??= (async () => {
    await loadScript('vendor/tesseract.min.js');
    const abs = (p) => new URL(p, location.href).href;
    const worker = await window.Tesseract.createWorker('deu', 1, {
      workerPath: abs('vendor/worker.min.js'),
      corePath: abs('vendor/tesseract-core/'),
      langPath: abs('vendor/lang'),
      logger: (m) => m.status === 'recognizing text' && progressCb?.(m.progress),
    });
    // PSM 6 = ein einheitlicher Textblock – liest Kassenbons im Test deutlich besser als die Automatik
    await worker.setParameters({ tessedit_pageseg_mode: window.__ocrCfg?.psm || PSM, preserve_interword_spaces: '1' });
    return worker;
  })();
  workerPromise.catch(() => { workerPromise = null; });
  return workerPromise;
}

/** Verkleinert das Foto und speichert es als JPEG (für Belegarchiv) */
export async function compressImage(file, maxSide = 1600, quality = 0.8) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * scale), height: Math.round(bmp.height * scale) });
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
}

/* ---------- Bildaufbereitung ---------- */

function otsu(gray) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, t = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = gray.length - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; t = i; }
  }
  return t;
}

/** Findet den hellen Beleg auf dunklerem Untergrund und schneidet auf ihn zu */
function paperBox(gray, w, h) {
  const t = otsu(gray);
  const rows = new Float32Array(h), cols = new Float32Array(w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (gray[y * w + x] > t) { rows[y]++; cols[x]++; }
  const span = (arr, len, n) => {
    let a = 0, b = n - 1;
    while (a < n && arr[a] / len < 0.3) a++;
    while (b > a && arr[b] / len < 0.3) b--;
    return [a, b];
  };
  const [y0, y1] = span(rows, w, h), [x0, x1] = span(cols, h, w);
  // Nur zuschneiden, wenn ein deutlich kleinerer Bereich gefunden wurde
  if ((x1 - x0) * (y1 - y0) < w * h * 0.12) return [0, 0, w, h];
  return [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}

/** Schwarze Flächen, die den Bildrand berühren (Tisch, Schattenkeile), weiß machen – Schrift berührt den Rand nie */
function clearBorder(px, w, h) {
  const stack = [];
  const push = (x, y) => { const i = y * w + x; if (px[i] === 0) { px[i] = 255; stack.push(i); } };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const i = stack.pop(), x = i % w, y = (i - x) / w;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
}

/**
 * Bereitet ein Foto für die Texterkennung auf.
 * mode 'adaptive': lokaler Schwellwert (Bradley) – unempfindlich gegen Schatten und dunklen Tisch
 * mode 'gray':     nur Graustufen + Kontrast, Tesseract binarisiert selbst
 * Beide Varianten bekommen einen weißen Rand, damit Zeichen am Belegrand nicht verloren gehen.
 */
async function preprocess(file, mode) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(2.5, 2000 / Math.max(bmp.width, bmp.height));
  let w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const src = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const sctx = src.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(bmp, 0, 0, w, h);
  let px = sctx.getImageData(0, 0, w, h).data;
  let gray = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; j < gray.length; i += 4, j++) gray[j] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];

  // auf den Beleg zuschneiden
  const [bx, by, bw, bh] = paperBox(gray, w, h);
  if (bw !== w || bh !== h) {
    const g2 = new Uint8ClampedArray(bw * bh);
    for (let y = 0; y < bh; y++) g2.set(gray.subarray((by + y) * w + bx, (by + y) * w + bx + bw), y * bw);
    gray = g2; w = bw; h = bh;
  }

  const out = new Uint8ClampedArray(w * h);
  if (mode === 'adaptive') {
    const integral = new Uint32Array((w + 1) * (h + 1));
    for (let y = 1; y <= h; y++) {
      let row = 0;
      for (let x = 1; x <= w; x++) {
        row += gray[(y - 1) * w + (x - 1)];
        integral[y * (w + 1) + x] = integral[(y - 1) * (w + 1) + x] + row;
      }
    }
    const s = Math.max(15, Math.round(w / 14)) >> 1, T = 0.16;
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - s), y1 = Math.min(h - 1, y + s);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - s), x1 = Math.min(w - 1, x + s);
        const count = (x1 - x0 + 1) * (y1 - y0 + 1);
        const total = integral[(y1 + 1) * (w + 1) + x1 + 1] - integral[y0 * (w + 1) + x1 + 1] - integral[(y1 + 1) * (w + 1) + x0] + integral[y0 * (w + 1) + x0];
        out[y * w + x] = gray[y * w + x] * count <= total * (1 - T) ? 0 : 255;
      }
    }
    clearBorder(out, w, h);
  } else {
    // Kontrast strecken (2.–98. Perzentil)
    const hist = new Uint32Array(256);
    for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
    let lo = 0, hi = 255, acc = 0;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > gray.length * 0.02) { lo = i; break; } }
    acc = 0;
    for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > gray.length * 0.02) { hi = i; break; } }
    const k = 255 / Math.max(1, hi - lo);
    for (let i = 0; i < gray.length; i++) out[i] = (gray[i] - lo) * k;
  }

  const pad = Math.round(Math.max(w, h) * 0.04);
  const canvas = Object.assign(document.createElement('canvas'), { width: w + pad * 2, height: h + pad * 2 });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const img = ctx.createImageData(w, h);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) { img.data[i] = img.data[i + 1] = img.data[i + 2] = out[j]; img.data[i + 3] = 255; }
  ctx.putImageData(img, pad, pad);
  return canvas;
}

/** Wie gut ist ein Ergebnis? Ein stimmiges Liter × Preis = Betrag zählt am meisten. */
function quality(r) {
  return (r.consistent ? 10 : 0) + ['liters', 'price', 'total', 'date', 'station'].filter((k) => r[k] != null).length;
}

export async function scanReceipt(file, onProgress) {
  onProgress?.(0.05);
  const passes = window.__ocrCfg?.modes || ['adaptive', 'gray'];
  let best = null;
  const texts = [];
  for (let i = 0; i < passes.length; i++) {
    const base = 0.1 + (i / passes.length) * 0.9, span = 0.9 / passes.length;
    progressCb = (p) => onProgress?.(base + p * span);
    const [worker, canvas] = await Promise.all([getWorker(), preprocess(file, passes[i])]);
    const { data } = await worker.recognize(canvas);
    texts.push(data.text);
    window.__ocrDebug?.push({ mode: passes[i], img: canvas.toDataURL('image/jpeg', 0.7), text: data.text });
    const r = parseReceipt(data.text);
    if (!best || quality(r) > quality(best)) best = { ...best, ...r };
    else for (const k of ['date', 'station', 'fuel']) if (best[k] == null && r[k] != null) best[k] = r[k];
    if (best.consistent && best.date) break; // reicht – zweiter Durchgang spart Zeit
  }
  progressCb = null;
  onProgress?.(1);
  return { text: texts.join('\n-----\n'), ...best };
}

/* ---------- Auswertung des Textes ---------- */

const BRANDS = ['ARAL', 'SHELL', 'ESSO', 'TOTALENERGIES', 'TOTAL', 'JET', 'AVIA', 'AGIP', 'ENI', 'STAR', 'ORLEN', 'HEM', 'OMV', 'BFT', 'WESTFALEN', 'RAIFFEISEN', 'TAMOIL', 'HOYER', 'Q1', 'CLASSIC', 'GLOBUS', 'KAUFLAND', 'MAXOL', 'TANKCENTER', 'BAYWA', 'NORDOEL', 'GULF', 'ELAN', 'DEHN', 'SPRINT', 'FAMILA', 'ROTH', 'LUKOIL'];

const N = String.raw`(\d{1,4}(?:[.,]\d{1,3}))`;
const LITER = String.raw`(?:l|L|I|1|Ltr|Liter|ltr)`;
const KW_TOTAL = /(SUMME|GESAMT|TOTAL|BETRAG|ZU ZAHLEN|ZAHLBETRAG|BAR\b|EC[- ]?KARTE|GIROCARD|KARTE|VISA|MASTERCARD|MAESTRO|GEGEBEN)/i;
const KW_TAX = /(MWST|M\s?W\s?ST|UST|NETTO|STEUER|RÜCKGELD|RUECKGELD|ZURÜCK)/i;

function findDate(text) {
  const now = Date.now();
  // Trenner tolerant: OCR liest "14.09.2026" gern als "14.09, 2026" oder "14. 09.2026"
  for (const m of text.matchAll(/(?<![\d,.])(\d{1,2})[.\/-]\s?(\d{1,2})[.,\/ -]{1,2}\s?(20\d{2}|\d{2})(?![\d,])/g)) {
    const d = +m[1], mo = +m[2];
    let y = +m[3];
    if (m[3].length === 2) y += 2000;
    if (d < 1 || d > 31 || mo < 1 || mo > 12 || y < 2015) continue;
    const tm = text.slice(m.index).match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/) || text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    const date = new Date(y, mo - 1, d, tm ? +tm[1] : 12, tm ? +tm[2] : 0);
    // ungültige Tage (31.02.) rollen sonst in den Folgemonat
    if (date.getDate() !== d || date.getTime() > now + 86400000 || date.getTime() < now - 3 * 365 * 86400000) continue;
    return date;
  }
  return null;
}

/**
 * Sucht die drei Zahlen, die zusammenpassen: Liter × Literpreis = Betrag.
 * Funktioniert unabhängig davon, wie der Beleg die Werte beschriftet – und ignoriert Shop-Artikel.
 */
function solve(lines) {
  const toks = [];
  lines.forEach((line, li) => {
    for (const m of line.matchAll(/(?<![\d,.])(\d{1,4})[,.](\d{2,3})(?![\d])/g)) {
      const v = parseFloat(`${m[1]}.${m[2]}`);
      const after = line.slice(m.index + m[0].length, m.index + m[0].length + 8);
      const before = line.slice(Math.max(0, m.index - 14), m.index);
      toks.push({
        v, dec: m[2].length, li, line,
        liter: new RegExp(`^\\s*${LITER}\\b(?!\\s*/)`).test(after) || /(Menge|Liter|Abgabe)\s*:?\s*$/i.test(before),
        perL: /^\s*(EUR|€)?\s*\/\s*(l|L|1|I|Ltr|Liter)/.test(after) || /(Preis|EP|\/\s*Liter|\/l|[x*×á@])\s*:?\s*$/i.test(before),
        kw: KW_TOTAL.test(line) || (li > 0 && KW_TOTAL.test(lines[li - 1]) && !/\d[,.]\d/.test(lines[li - 1])),
        tax: KW_TAX.test(line),
      });
    }
  });
  const prices = toks.filter((t) => t.v >= 0.9 && t.v <= 3.5 && (t.dec === 3 || t.perL));
  const twos = toks.filter((t) => t.dec === 2 && t.v >= 1 && t.v <= 500);
  let best = null;
  for (const P of prices) for (const L of twos) {
    if (L === P || L.v > 150) continue;
    const calc = L.v * P.v;
    for (const T of twos) {
      if (T === L || T === P || Math.abs(T.v - calc) > 0.015) continue;
      const score = (L.liter ? 3 : 0) + (P.perL ? 2 : 0) + (P.dec === 3 ? 1 : 0) + (T.kw ? 1 : 0) - (T.tax ? 2 : 0) - (L.tax ? 2 : 0) + (L.v >= 5 ? 1 : 0);
      if (!best || score > best.score) best = { score, liters: L.v, price: P.v, total: T.v };
    }
  }
  return { best, prices, twos };
}

/** Wertet den erkannten Text eines deutschen Tankbelegs aus. Exportiert für Tests. */
export function parseReceipt(raw) {
  const text = raw
    .replace(/[|]/g, 'l')
    .replace(/(\d)\s*([,.])\s*(\d)/g, '$1$2$3')   // "1 , 759" → "1,759"
    .replace(/€/g, ' EUR ');
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const r = {};

  const date = findDate(text);
  if (date) r.date = date;

  const { best, prices, twos } = solve(lines);
  if (best) {
    Object.assign(r, { liters: best.liters, price: best.price, total: best.total, consistent: true });
  } else {
    // Kein stimmiges Trio gefunden → Einzelwerte nach Beschriftung, fehlender Wert wird berechnet
    const price = prices.find((t) => t.perL) || prices.find((t) => t.dec === 3);
    const liters = twos.find((t) => t.liter && t.v <= 150);
    const totals = twos.filter((t) => t.kw && !t.tax);
    const total = totals.length ? totals.reduce((a, b) => (b.v > a.v ? b : a)) : null;
    if (price) r.price = price.v;
    if (liters) r.liters = liters.v;
    if (price && liters) {
      // Liter und Preis sind sicher beschriftet → Betrag daraus (nicht „Gegeben 50,00“ o. ä.)
      const calc = Math.round(liters.v * price.v * 100) / 100;
      r.total = twos.find((t) => Math.abs(t.v - calc) <= 0.02)?.v ?? calc;
    } else if (total) r.total = total.v;
    if (r.total && r.liters && !r.price) r.price = Math.round((r.total / r.liters) * 1000) / 1000;
    else if (r.total && r.price && !r.liters) r.liters = Math.round((r.total / r.price) * 100) / 100;
    else if (r.liters && r.price && !r.total) r.total = Math.round(r.liters * r.price * 100) / 100;
    if (isNum(r.price) && (r.price < 0.9 || r.price > 3.5)) delete r.price;
  }

  // --- Kraftstoff ---
  if (/E\s?1[0O]\b/i.test(text)) r.fuel = 'E10';
  else if (/DIESEL/i.test(text)) r.fuel = 'Diesel';
  else if (/PLUS|V-?POWER|ULTIMATE|102|100\s*OKT/i.test(text)) r.fuel = 'Super Plus';
  else if (/E\s?5\b|SUPER/i.test(text)) r.fuel = 'E5';

  // --- Tankstelle ---
  const upper = text.toUpperCase();
  const head = lines.slice(0, 8).join(' ').toUpperCase();
  const brand = BRANDS.find((b) => new RegExp(`\\b${b}\\b`).test(head)) || BRANDS.find((b) => new RegExp(`\\b${b}\\b`).test(upper));
  const street = lines.slice(0, 10).find((l) => /[a-zäöüß]{3,}(str\.|straße|strasse|weg|allee|platz|ring|damm|chaussee)\s*\d+/i.test(l) || /\b(am|an der|im)\s+[A-ZÄÖÜ][a-zäöü]+\s+\d+/.test(l));
  const brandName = brand && (brand.length <= 4 ? brand : brand[0] + brand.slice(1).toLowerCase());
  const streetName = street && street.replace(/^[^A-Za-zÄÖÜäöü]+/, '').split(/,|\b\d{5}\b/)[0].replace(/^(shell|aral|esso|jet|total\w*)\s+(station\s+)?/i, '');
  if (brand || street) r.station = [brandName, streetName].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

  return r;
}
