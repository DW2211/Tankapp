// Beleg-Scan: Bild vorbereiten → Tesseract (läuft komplett auf dem Gerät) → deutsche Tankbelege auswerten.
import { parseNum, isNum } from './util.js';

let workerPromise;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve();
    const s = Object.assign(document.createElement('script'), { src, onload: resolve, onerror: reject });
    document.head.append(s);
  });
}

async function getWorker(onProgress) {
  workerPromise ??= (async () => {
    await loadScript('vendor/tesseract.min.js');
    return window.Tesseract.createWorker('deu', 1, {
      workerPath: new URL('vendor/worker.min.js', location.href).href,
      logger: (m) => m.status === 'recognizing text' && onProgress?.(0.3 + m.progress * 0.7),
    });
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

/** Graustufen + Kontrast + Schwellwert → deutlich bessere Erkennung bei Thermopapier */
async function preprocess(file) {
  const bmp = await createImageBitmap(file);
  const target = 1800;
  const scale = Math.min(2.5, target / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  let total = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = g; total += g;
  }
  const mean = total / (d.length / 4);
  for (let i = 0; i < d.length; i += 4) {
    // weicher Schwellwert um den Mittelwert herum
    const v = Math.max(0, Math.min(255, (d[i] - mean * 0.85) * 2.2 + 128));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export async function scanReceipt(file, onProgress) {
  onProgress?.(0.05);
  const [worker, canvas] = await Promise.all([getWorker(onProgress), preprocess(file)]);
  onProgress?.(0.3);
  const { data } = await worker.recognize(canvas);
  onProgress?.(1);
  return { text: data.text, ...parseReceipt(data.text) };
}

const BRANDS = ['ARAL', 'SHELL', 'ESSO', 'TOTALENERGIES', 'TOTAL', 'JET', 'AVIA', 'AGIP', 'ENI', 'STAR', 'ORLEN', 'HEM', 'OMV', 'BFT', 'WESTFALEN', 'RAIFFEISEN', 'TAMOIL', 'SB', 'HOYER', 'Q1', 'CLASSIC', 'GLOBUS', 'KAUFLAND', 'MAXOL', 'TANKCENTER', 'BAYWA', 'NORDOEL', 'GULF', 'ELAN', 'MOL', 'DEHN', 'SPRINT', 'FAMILA', 'ROTH', 'LUKOIL'];

const N = String.raw`(\d{1,4}(?:[.,]\d{1,3}))`;

/** Wertet den erkannten Text eines deutschen Tankbelegs aus. Exportiert für Tests. */
export function parseReceipt(raw) {
  const text = raw
    .replace(/[|]/g, 'l')
    .replace(/(\d)\s*([,.])\s*(\d)/g, '$1$2$3')   // "1 , 759" → "1,759"
    .replace(/€/g, ' EUR ');
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const r = {};

  // --- Datum & Uhrzeit ---
  const dm = text.match(/\b(\d{1,2})[.\/-](\d{1,2})[.\/-](20\d{2}|\d{2})\b/);
  if (dm) {
    let [, d, m, y] = dm;
    y = y.length === 2 ? 2000 + +y : +y;
    const tm = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    const date = new Date(y, +m - 1, +d, tm ? +tm[1] : 12, tm ? +tm[2] : 0);
    if (!isNaN(date) && date <= new Date(Date.now() + 86400000) && y > 2000) r.date = date;
  }

  // --- Preis pro Liter ---
  const ppl = [
    new RegExp(`${N}\\s*(?:EUR)?\\s*/\\s*(?:l|L|Ltr|Liter)\\b`),
    new RegExp(`(?:Preis|Einzelpreis|EP|Literpreis)[^\\d\\n]{0,15}${N}`, 'i'),
    new RegExp(`(?:l|L|Ltr|Liter)\\s*[x*×]\\s*${N}`),
  ];
  for (const re of ppl) {
    const m = text.match(re);
    const v = m && parseNum(m[1]);
    if (v > 0.8 && v < 3.5) { r.price = v; break; }
  }

  // --- Liter ---
  const lm = [...text.matchAll(new RegExp(`${N}\\s*(?:l|L|Ltr|Liter)\\b(?!\\s*/)`, 'g'))]
    .map((m) => parseNum(m[1]))
    .filter((v) => v >= 1 && v <= 150);
  if (lm.length) r.liters = lm[0];
  if (!r.liters) {
    const m = text.match(new RegExp(`(?:Menge|Liter|Abgabe)[^\\d\\n]{0,12}${N}`, 'i'));
    const v = m && parseNum(m[1]);
    if (v >= 1 && v <= 150) r.liters = v;
  }

  // --- Gesamtbetrag ---
  const KW = /(SUMME|GESAMT|TOTAL|BETRAG|ZU ZAHLEN|ZAHLBETRAG|BAR|EC[- ]?KARTE|GIROCARD|KARTE|VISA|MASTERCARD)/i;
  const amounts = [];
  lines.forEach((line, i) => {
    const nums = [...line.matchAll(/(\d{1,4},\d{2})(?!\d)/g)].map((m) => parseNum(m[1]));
    nums.forEach((v) => amounts.push({ v, kw: KW.test(line) || (i > 0 && KW.test(lines[i - 1]) && nums.length === 1), mwst: /MWST|UST|NETTO|STEUER/i.test(line) }));
  });
  const cands = amounts.filter((a) => !a.mwst && a.v >= 1 && a.v < 500);
  const kw = cands.filter((a) => a.kw).map((a) => a.v);
  if (kw.length) r.total = Math.max(...kw);
  else if (cands.length) r.total = Math.max(...cands.map((a) => a.v));

  // --- Plausibilität: Liter × Preis ≈ Betrag ---
  if (r.liters && r.price) {
    const calc = r.liters * r.price;
    if (!r.total || Math.abs(calc - r.total) > 0.06) {
      // Kandidat finden, der passt (z. B. wenn Shop-Artikel mit auf dem Beleg sind)
      const match = cands.find((a) => Math.abs(a.v - calc) <= 0.06);
      r.total = match ? match.v : Math.round(calc * 100) / 100;
    }
  } else if (r.total && r.liters && !r.price) {
    r.price = Math.round((r.total / r.liters) * 1000) / 1000;
  } else if (r.total && r.price && !r.liters) {
    r.liters = Math.round((r.total / r.price) * 100) / 100;
  }
  if (isNum(r.price) && (r.price < 0.8 || r.price > 3.5)) delete r.price;

  // --- Kraftstoff ---
  if (/E\s?10/i.test(text)) r.fuel = 'E10';
  else if (/DIESEL/i.test(text)) r.fuel = 'Diesel';
  else if (/PLUS|V-?POWER|ULTIMATE|EXCELLIUM|102|100\s*OKT/i.test(text)) r.fuel = 'Super Plus';
  else if (/E\s?5\b|SUPER/i.test(text)) r.fuel = 'E5';

  // --- Tankstelle ---
  const head = lines.slice(0, 8).join(' ').toUpperCase();
  const brand = BRANDS.find((b) => new RegExp(`\\b${b}\\b`).test(head)) || BRANDS.find((b) => new RegExp(`\\b${b}\\b`).test(text.toUpperCase()));
  const street = lines.slice(0, 10).find((l) => /(str\.|straße|strasse|weg|allee|platz|ring|damm|chaussee)\s*\d*/i.test(l));
  const brandName = brand && (brand.length <= 4 ? brand : brand[0] + brand.slice(1).toLowerCase());
  const streetName = street && street.split(/,|\b\d{5}\b/)[0];
  if (brand || street) r.station = [brandName, streetName].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

  return r;
}
