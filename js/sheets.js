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
      'Notiz': e.note || '',
    };
  });
}

const round2 = (v) => Math.round(v * 100) / 100;

export async function syncToSheets(entries, settings) {
  if (!settings.sheetsUrl) throw new Error('Bitte zuerst die Web-App-URL eintragen.');
  if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(settings.sheetsUrl)) throw new Error('Das sieht nicht nach einer Apps-Script-URL aus.');
  const body = JSON.stringify({ secret: settings.sheetsSecret, action: 'replaceAll', vehicle: settings.vehicle, rows: toRows(entries) });
  // text/plain = "simple request" → kein CORS-Preflight, den Apps Script nicht beantwortet
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
