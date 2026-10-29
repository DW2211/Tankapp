// Überträgt das komplette Tankbuch an ein Google-Apps-Script (siehe google-apps-script/Code.gs).
import { isNum } from './util.js';
import { taxSplit } from './tax.js';
import { consumptionSegments } from './stats.js';

export function toRows(entries) {
  const cons = new Map(consumptionSegments(entries).map((s) => [s.date, s.l100]));
  let prevOdo = null;
  return entries.map((e) => {
    const d = new Date(e.date);
    const p = (n) => String(n).padStart(2, '0');
    const driven = isNum(e.odometer) && isNum(prevOdo) ? e.odometer - prevOdo : '';
    if (isNum(e.odometer)) prevOdo = e.odometer;
    const t = taxSplit(e);
    return {
      'ID': e.id,
      'Datum': `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
      'Uhrzeit': `${p(d.getHours())}:${p(d.getMinutes())}`,
      'Tankstelle': e.station || '',
      'Kraftstoff': e.fuel || 'E10',
      'Liter': e.liters,
      'Preis €/L': e.price,
      'Betrag €': e.total,
      'Kilometerstand': isNum(e.odometer) ? e.odometer : '',
      'Gefahrene km': driven,
      'Verbrauch L/100km': cons.has(e.date) ? Math.round(cons.get(e.date) * 10) / 10 : '',
      'Vollgetankt': e.full ? 'ja' : 'nein',
      'Nutzung': e.usage || 'privat',
      'Beruflich %': e.share || 0,
      'Beruflicher Anteil €': round2(t.business),
      'Netto €': round2(t.net),
      'MwSt €': round2(t.vat),
      'Rabatt €': e.discount > 0 ? round2(e.discount) : '',
      'Notiz': e.note || '',
    };
  });
}

const round2 = (v) => Math.round(v * 100) / 100;

function checkUrl(settings) {
  if (!settings.sheetsUrl) throw new Error('Bitte zuerst die Web-App-URL eintragen.');
  if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(settings.sheetsUrl)) throw new Error('Das sieht nicht nach einer Apps-Script-URL aus.');
}

/** POST an das Script. text/plain = "simple request" → kein CORS-Preflight, den Apps Script nicht beantwortet */
async function post(settings, payload) {
  const body = JSON.stringify({ secret: settings.sheetsSecret, ...payload });
  try {
    const res = await fetch(settings.sheetsUrl, { method: 'POST', body, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow' });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Unbekannter Fehler im Script');
    return json;
  } catch (e) {
    if (!(e instanceof TypeError)) throw e;
    // Manche Browser blockieren die Antwort – senden klappt trotzdem, nur ohne Bestätigung.
    await fetch(settings.sheetsUrl, { method: 'POST', body, mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
    return { ok: true, unconfirmed: true };
  }
}

async function get(settings, params) {
  const url = `${settings.sheetsUrl}?${new URLSearchParams({ secret: settings.sheetsSecret, ...params })}`;
  const res = await fetch(url, { redirect: 'follow' });
  const json = await res.json().catch(() => { throw new Error('Keine gültige Antwort – ist das Script als Web-App für „Jeder“ bereitgestellt?'); });
  if (!json.ok) throw new Error(json.error || 'Unbekannter Fehler im Script');
  return json;
}

/** Was in die Sicherung gehört: alles außer dem Sheets-Zugang selbst */
function backupPayload(data) {
  const { sheetsUrl, sheetsSecret, lastSync, ...settings } = data.settings;
  return { version: 1, at: new Date().toISOString(), entries: data.entries, snapshots: data.snapshots.slice(-1500), settings };
}

export async function syncToSheets(entries, settings, fullData, { force = false } = {}) {
  checkUrl(settings);
  return post(settings, { action: 'replaceAll', vehicle: settings.vehicle, rows: toRows(entries), backup: fullData ? backupPayload(fullData) : undefined, force });
}

const UPLOADED = 'tankbuch.uploadedReceipts';
const uploaded = () => new Set(JSON.parse(localStorage.getItem(UPLOADED) || '[]'));
export const markUploaded = (ids) => localStorage.setItem(UPLOADED, JSON.stringify([...new Set([...uploaded(), ...ids])]));

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Lädt alle Belegfotos hoch, die noch nicht in Google Drive liegen */
export async function uploadReceipts(entries, settings, getReceipt) {
  const done = uploaded();
  let n = 0;
  for (const e of entries) {
    if (!e.receiptId || done.has(e.receiptId)) continue;
    const blob = await getReceipt(e.receiptId);
    if (!blob) continue;
    const label = `${e.date.slice(0, 10)} · ${e.station || 'Tankung'} · ${e.total} €`;
    await post(settings, { action: 'receipt', id: e.receiptId, label, data: await blobToBase64(blob) });
    markUploaded([e.receiptId]);
    n++;
  }
  return n;
}

export async function fetchBackup(settings) {
  checkUrl(settings);
  return get(settings, { action: 'backup' });
}

export async function fetchReceipt(settings, id) {
  const r = await get(settings, { action: 'receipt', id });
  const bytes = Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: 'image/jpeg' });
}
