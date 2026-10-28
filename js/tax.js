// Steuer-Auswertung: MwSt-Aufteilung, beruflicher Anteil, Pendlerpauschale, CSV/PDF/ZIP-Export.
import { sum, eur, num, fmtDate, fmtTime, esc, isNum, download } from './util.js';
import { getReceipt } from './store.js';

export const VAT = 0.19;

export function businessShare(e) {
  if (e.usage === 'beruflich') return 100;
  if (e.usage === 'gemischt') return Math.max(0, Math.min(100, e.share || 0));
  return 0;
}

export function taxSplit(e) {
  const net = e.total / (1 + VAT);
  const share = businessShare(e) / 100;
  return { net, vat: e.total - net, business: e.total * share, businessNet: net * share, businessVat: (e.total - net) * share };
}

export function yearReport(entries) {
  const splits = entries.map(taxSplit);
  return {
    count: entries.length,
    liters: sum(entries, (e) => e.liters),
    gross: sum(entries, (e) => e.total),
    net: sum(splits, (s) => s.net),
    vat: sum(splits, (s) => s.vat),
    business: sum(splits, (s) => s.business),
    businessNet: sum(splits, (s) => s.businessNet),
    businessVat: sum(splits, (s) => s.businessVat),
  };
}

export const commuteAllowance = (km, days, rate) => (isNum(km) && isNum(days) && isNum(rate) ? km * days * rate : NaN);

const csvNum = (v, d = 2) => (isNum(v) ? v.toFixed(d).replace('.', ',') : '');
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

export function exportCsv(entries, year, settings) {
  const head = ['Datum', 'Uhrzeit', 'Tankstelle', 'Kraftstoff', 'Liter', 'Preis €/L', 'Betrag brutto €', 'Netto €', 'MwSt 19 % €', 'Kilometerstand', 'Nutzung', 'Beruflich %', 'Beruflich brutto €', 'Vorsteuer beruflich €', 'Beleg', 'Notiz'];
  const rows = entries.map((e) => {
    const t = taxSplit(e);
    return [fmtDate(e.date), fmtTime(e.date), e.station, e.fuel, csvNum(e.liters), csvNum(e.price, 3), csvNum(e.total), csvNum(t.net), csvNum(t.vat), isNum(e.odometer) ? e.odometer : '', e.usage, businessShare(e), csvNum(t.business), csvNum(t.businessVat), e.receiptId ? receiptName(e) : '', e.note].map(csvCell).join(';');
  });
  const r = yearReport(entries);
  rows.push('', ['Summe', '', '', '', csvNum(r.liters), '', csvNum(r.gross), csvNum(r.net), csvNum(r.vat), '', '', '', csvNum(r.business), csvNum(r.businessVat)].map(csvCell).join(';'));
  const name = `Tankbuch_${slug(settings.vehicle)}_${year}.csv`;
  download(name, '﻿' + [head.map(csvCell).join(';'), ...rows].join('\r\n'), 'text/csv;charset=utf-8');
}

const slug = (s) => String(s || 'Auto').replace(/[^\wäöüÄÖÜß-]+/g, '_');
const receiptName = (e) => {
  const d = new Date(e.date);
  return `Beleg_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}_${num(e.total, 2).replace(',', '-')}EUR.jpg`;
};

export function printReport(entries, year, settings) {
  const r = yearReport(entries);
  const allowance = commuteAllowance(settings.commuteKm, settings.workDays, settings.commuteRate);
  const rows = entries.map((e) => {
    const t = taxSplit(e);
    return `<tr><td>${fmtDate(e.date)}</td><td>${esc(e.station || '')}</td><td>${esc(e.fuel || '')}</td><td class="r">${num(e.liters)}</td><td class="r">${num(e.price, 3)}</td><td class="r">${num(e.total)}</td><td class="r">${num(t.vat)}</td><td class="r">${isNum(e.odometer) ? num(e.odometer, 0) : ''}</td><td class="r">${businessShare(e)} %</td><td class="r">${num(t.business)}</td></tr>`;
  }).join('');
  document.getElementById('print-area').innerHTML = `
    <h1>Fahrtkosten-Nachweis ${year} – Kraftstoff</h1>
    <div>${esc(settings.vehicle)}${settings.plate ? ' · Kennzeichen ' + esc(settings.plate) : ''} · erstellt am ${fmtDate(Date.now())}</div>
    <h2>Zusammenfassung</h2>
    <div class="sum">
      <div>Tankungen<b>${r.count}</b></div>
      <div>Liter gesamt<b>${num(r.liters)}</b></div>
      <div>Kosten brutto<b>${eur(r.gross)}</b></div>
      <div>davon MwSt 19 %<b>${eur(r.vat)}</b></div>
      <div>Beruflicher Anteil brutto<b>${eur(r.business)}</b></div>
      <div>Vorsteuer beruflich<b>${eur(r.businessVat)}</b></div>
    </div>
    ${settings.commuteKm ? `<h2>Entfernungspauschale</h2><div>${num(settings.commuteKm, 0)} km × ${settings.workDays} Arbeitstage × ${num(settings.commuteRate, 2)} € = <b>${eur(allowance)}</b></div>` : ''}
    <h2>Einzelnachweis</h2>
    <table>
      <thead><tr><th>Datum</th><th>Tankstelle</th><th>Kraftst.</th><th class="r">Liter</th><th class="r">€/L</th><th class="r">Brutto €</th><th class="r">MwSt €</th><th class="r">km-Stand</th><th class="r">Beruf.</th><th class="r">Beruf. €</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="3">Summe</td><td class="r">${num(r.liters)}</td><td></td><td class="r">${num(r.gross)}</td><td class="r">${num(r.vat)}</td><td></td><td></td><td class="r">${num(r.business)}</td></tr></tfoot>
    </table>
    <div class="foot">MwSt-Anteil rechnerisch aus dem Bruttobetrag (19 %). Diese Aufstellung ersetzt keine Steuerberatung. Originalbelege liegen digital vor.</div>`;
  setTimeout(() => window.print(), 50);
}

async function loadJsZip() {
  if (window.JSZip) return window.JSZip;
  await new Promise((resolve, reject) => document.head.append(Object.assign(document.createElement('script'), { src: 'vendor/jszip.min.js', onload: resolve, onerror: reject })));
  return window.JSZip;
}

export async function exportReceipts(entries, year, settings) {
  const withReceipt = entries.filter((e) => e.receiptId);
  if (!withReceipt.length) return 0;
  const JSZip = await loadJsZip();
  const zip = new JSZip();
  for (const e of withReceipt) {
    const blob = await getReceipt(e.receiptId);
    if (blob) zip.file(receiptName(e), blob);
  }
  const out = await zip.generateAsync({ type: 'blob' });
  download(`Tankbelege_${slug(settings.vehicle)}_${year}.zip`, out);
  return withReceipt.length;
}
