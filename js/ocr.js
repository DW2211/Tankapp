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

/** Graustufen eines Canvas-Ausschnitts */
function toGray(ctx, w, h) {
  const px = ctx.getImageData(0, 0, w, h).data;
  const g = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  return g;
}

/** Lokaler Schwellwert nach Bradley – unempfindlich gegen Schatten und Helligkeitsverläufe */
function bradley(gray, w, h, T = 0.16) {
  const integral = new Uint32Array((w + 1) * (h + 1));
  for (let y = 1; y <= h; y++) {
    let row = 0;
    for (let x = 1; x <= w; x++) {
      row += gray[(y - 1) * w + (x - 1)];
      integral[y * (w + 1) + x] = integral[(y - 1) * (w + 1) + x] + row;
    }
  }
  const out = new Uint8ClampedArray(w * h);
  const s = Math.max(15, Math.round(w / 14)) >> 1;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - s), y1 = Math.min(h - 1, y + s);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - s), x1 = Math.min(w - 1, x + s);
      const count = (x1 - x0 + 1) * (y1 - y0 + 1);
      const total = integral[(y1 + 1) * (w + 1) + x1 + 1] - integral[y0 * (w + 1) + x1 + 1] - integral[(y1 + 1) * (w + 1) + x0] + integral[y0 * (w + 1) + x0];
      out[y * w + x] = gray[y * w + x] * count <= total * (1 - T) ? 0 : 255;
    }
  }
  return out;
}

/**
 * Schräglage schätzen: Bei richtigem Winkel liegen die Textzeilen waagerecht,
 * die Zeilensummen der dunklen Pixel schwanken dann am stärksten.
 */
function estimateSkew(bin, w, h) {
  const pts = [];
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) if (bin[y * w + x] === 0) pts.push(x - w / 2, y - h / 2);
  if (pts.length < 200) return 0;
  const bins = Math.ceil(Math.hypot(w, h)) + 2;
  const score = (deg) => {
    const a = (deg * Math.PI) / 180, sn = Math.sin(a), cs = Math.cos(a);
    const hist = new Float32Array(bins);
    for (let i = 0; i < pts.length; i += 2) hist[Math.round(pts[i + 1] * cs - pts[i] * sn + bins / 2)]++;
    let sq = 0;
    for (let i = 0; i < bins; i++) sq += hist[i] * hist[i];
    return sq;
  };
  let best = 0, bestS = -1;
  for (let d = -15; d <= 15; d += 1) { const sc = score(d); if (sc > bestS) { bestS = sc; best = d; } }
  for (let d = best - 0.9; d <= best + 0.9; d += 0.3) { const sc = score(d); if (sc > bestS) { bestS = sc; best = d; } }
  return Math.abs(best) < 0.4 ? 0 : best;
}

/**
 * Bereitet ein Foto für die Texterkennung auf:
 * 1. Beleg im Foto finden und ausschneiden (auf einer kleinen Vorschau)
 * 2. Schräglage erkennen und gerade drehen
 * 3. Ausschnitt aus dem Originalfoto in hoher Auflösung holen – Schrift soll ~30 px hoch sein
 * 4. mode 'adaptive': lokaler Schwellwert · mode 'gray': Kontrast gestreckt, Tesseract binarisiert selbst
 * 5. Dunkle Flächen am Rand entfernen, weißer Rand drumherum
 */
async function preprocess(file, mode) {
  const bmp = await createImageBitmap(file);
  // 1. Vorschau
  const s0 = Math.min(1, 900 / Math.max(bmp.width, bmp.height));
  const pw = Math.round(bmp.width * s0), ph = Math.round(bmp.height * s0);
  const prev = Object.assign(document.createElement('canvas'), { width: pw, height: ph });
  const pctx = prev.getContext('2d', { willReadFrequently: true });
  pctx.drawImage(bmp, 0, 0, pw, ph);
  const pg = toGray(pctx, pw, ph);
  let [bx, by, bw, bh] = paperBox(pg, pw, ph);
  const m = Math.round(Math.max(bw, bh) * 0.02);
  bx = Math.max(0, bx - m); by = Math.max(0, by - m); bw = Math.min(pw - bx, bw + 2 * m); bh = Math.min(ph - by, bh + 2 * m);

  // 2. Schräglage auf dem Vorschau-Ausschnitt
  const cg = new Uint8ClampedArray(bw * bh);
  for (let y = 0; y < bh; y++) cg.set(pg.subarray((by + y) * pw + bx, (by + y) * pw + bx + bw), y * bw);
  const cb = bradley(cg, bw, bh);
  clearBorder(cb, bw, bh);
  const angle = window.__ocrCfg?.noDeskew ? 0 : estimateSkew(cb, bw, bh);

  // 3. hochaufgelöster, gerade gedrehter Ausschnitt aus dem Original
  const sx = bx / s0, sy = by / s0, sw = bw / s0, sh = bh / s0;
  const scale = Math.min(3, 1500 / sw, Math.sqrt(6e6 / (sw * sh)));
  const w = Math.round(sw * scale), h = Math.round(sh * scale);
  const canvas0 = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx0 = canvas0.getContext('2d', { willReadFrequently: true });
  ctx0.fillStyle = '#fff';
  ctx0.fillRect(0, 0, w, h);
  ctx0.translate(w / 2, h / 2);
  ctx0.rotate((-angle * Math.PI) / 180);
  ctx0.imageSmoothingQuality = 'high';
  ctx0.drawImage(bmp, sx, sy, sw, sh, -w / 2, -h / 2, w, h);
  const gray = toGray(ctx0, w, h);

  // 4. Binarisieren bzw. Kontrast
  let out;
  if (mode === 'adaptive') {
    out = bradley(gray, w, h);
    clearBorder(out, w, h);
  } else {
    const hist = new Uint32Array(256);
    for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
    let lo = 0, hi = 255, acc = 0;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > gray.length * 0.02) { lo = i; break; } }
    acc = 0;
    for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > gray.length * 0.02) { hi = i; break; } }
    const k = 255 / Math.max(1, hi - lo);
    out = new Uint8ClampedArray(gray.length);
    for (let i = 0; i < gray.length; i++) out[i] = (gray[i] - lo) * k;
    // dunkle Randflächen (Tisch, Hose, Autositz) aufhellen
    const t = otsu(out), mask = new Uint8ClampedArray(out.length);
    for (let i = 0; i < out.length; i++) mask[i] = out[i] < t * 0.8 ? 0 : 255;
    clearBorder(mask, w, h);
    for (let i = 0; i < out.length; i++) if (mask[i] === 255 && out[i] < t * 0.8) out[i] = 255;
  }

  // 5. weißer Rand
  const pad = Math.round(Math.max(w, h) * 0.03);
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
        // MwSt-Tabelle: Schlüsselwort in der Zeile, Prozentangabe, oder Kopfzeile „Netto MwSt Brutto“ direkt darüber
        tax: KW_TAX.test(line) || /\d\s?%/.test(line) || (li > 0 && KW_TAX.test(lines[li - 1]) && !/\d[,.]\d{2}/.test(lines[li - 1])),
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
  if (!best) {
    // Literpreis falsch gelesen? Dann aus Tankbetrag ÷ Liter herleiten – nur wenn das exakt auf 3 Stellen aufgeht
    for (const L of twos) {
      if (L.v < 3 || L.v > 150) continue;
      for (const F of twos) {
        if (F === L || F.tax) continue;
        const p = Math.round((F.v / L.v) * 1000) / 1000;
        if (p < 0.9 || p > 3.5 || Math.abs(p * L.v - F.v) > 0.006) continue;
        const near = prices.some((P) => Math.abs(P.v - p) <= 0.03);
        if (!near && !(L.liter && Math.abs(F.li - L.li) <= 1)) continue;
        const score = (L.liter ? 3 : 0) + (near ? 3 : 0) + (F.kw ? 1 : 0) + (F.li === L.li || F.li === L.li - 1 ? 1 : 0);
        if (!best || score > best.score) best = { score, liters: L.v, price: p, total: F.v, derived: true };
      }
    }
  }
  return { best, prices, twos };
}

const KW_DISC = /(RABATT|NACHLASS|COUPON|GUTSCHEIN|VORTEIL|ERSPARNIS|ADA[CUOG0]|CLUBSMART|ABZUG|BONUS|T\S{1,3}KBONUS)/i;

/**
 * Findet einen Rabatt, z. B. „ADAC-Rabatt -0,48“, „Nachlass 0,010 EUR/l“ oder
 * „ADAC Tankbonus -0,34 EUR“ mit „0,01 EUR/Liter“ in der Folgezeile.
 * Mehr als 5 € pro Tankung gilt als Lesefehler.
 */
function findDiscount(lines, liters) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!KW_DISC.test(line) || /PUNKTE|°P\b|PKT/i.test(line)) continue;
    const kw = line.match(KW_DISC)[1].toUpperCase();
    const label = /^ADA/.test(kw) || /KBONUS$/.test(kw) ? 'ADAC-Rabatt' : kw === 'CLUBSMART' ? 'ClubSmart' : kw[0] + kw.slice(1).toLowerCase();
    // Rabatt je Liter steht oft in der Folgezeile („0,01 EUR/Liter“)
    const next = lines[i + 1] && /\/\s*(l|L|1|I|Ltr|Liter)/i.test(lines[i + 1]) ? [lines[i + 1]] : [];
    for (const l of [line, ...next]) {
      for (const m of l.matchAll(/(\d{1,2})[,.](\d{2,3})(\s*(EUR|€)?\s*\/\s*(l|L|1|I|Ltr|Liter))?/g)) {
        const v = parseFloat(`${m[1]}.${m[2]}`);
        const perLiter = !!m[3] || (m[2].length === 3 && v < 0.3);
        if (perLiter && !(v > 0 && v <= 0.2)) continue;
        // Kassen schneiden Cent-Bruchteile meist ab (34,64 L × 0,01 € = 0,34 €)
        const amount = perLiter ? (isNum(liters) ? Math.floor(liters * v * 100 + 1e-6) / 100 : NaN) : v;
        if (amount > 0 && amount <= 5) return { amount, label };
      }
    }
  }
  return null;
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
  const labeledL = twos.find((t) => t.liter && t.v <= 150)?.v;
  const labeledP = (prices.find((t) => t.perL) || prices.find((t) => t.dec === 3))?.v;
  const kwTotals = twos.filter((t) => t.kw && !t.tax);
  const paidT = kwTotals.length ? kwTotals.reduce((a, b) => (b.v > a.v ? b : a)).v : undefined;

  // Rabatt (ADAC, Coupon, Tankkarte …) – braucht die Liter für Rabatte je Liter
  const disc = findDiscount(lines, best?.liters ?? labeledL);
  const D = disc ? disc.amount : 0;
  if (D) { r.discount = D; r.discountLabel = disc.label; }
  const round2 = (v) => Math.round(v * 100) / 100, round3 = (v) => Math.round(v * 1000) / 1000;

  if (best) {
    // Liter × Preis = Betrag der Tankung (F), bezahlt wurde nach Abzug des Rabatts.
    // Ist die Rabattzeile unleserlich, verrät der kleinere Gesamtbetrag den Rabatt.
    const F = best.total;
    const below = kwTotals.filter((t) => t.v < F - 0.005 && F - t.v <= Math.max(3, F * 0.05));
    if (!D && below.length) {
      const Tk = below.reduce((a, b) => (b.v > a.v ? b : a)).v;
      r.discount = round2(F - Tk);
      r.discountLabel = 'Rabatt';
    }
    Object.assign(r, { liters: best.liters, price: best.price, total: round2(F - (r.discount || 0)), consistent: true });
  } else {
    // Abgleich mit dem (groß gedruckten, meist sauber gelesenen) Gesamtbetrag:
    // eine einzelne falsch gelesene Ziffer im Literpreis oder in den Litern wird so korrigiert
    let L = labeledL, P = labeledP, T = paidT;
    if (L && T) {
      const p = (T + D) / L;
      if (p >= 0.9 && p <= 3.5 && (!P || Math.abs(P - p) < 0.03)) { P = round3(p); r.consistent = true; }
    }
    if (!r.consistent && P && T) {
      const l = (T + D) / P;
      if (l >= 1 && l <= 150 && (!L || Math.abs(L - l) / l < 0.03)) { L = round2(l); r.consistent = true; }
    }
    if (!r.consistent && L && P) T = round2(L * P - D);
    if (L) r.liters = L;
    if (P) r.price = P;
    if (T) r.total = T;
    if (r.total && r.liters && !r.price) r.price = round3((r.total + D) / r.liters);
    else if (r.total && r.price && !r.liters) r.liters = round2((r.total + D) / r.price);
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
