/**
 * Tankbuch → Google Sheets
 *
 * Einrichtung:
 * 1. Neues Google Sheet öffnen → Erweiterungen → Apps Script
 * 2. Diesen Code komplett einfügen und SECRET unten auf deinen Schlüssel setzen (derselbe wie in der App)
 * 3. Bereitstellen → Neue Bereitstellung → Typ "Web-App"
 *      Ausführen als: Ich   ·   Zugriff: Jeder
 * 4. Die URL (…/exec) in der App unter Einstellungen → Google Sheets eintragen
 *
 * Die App sendet bei jeder Übertragung die komplette Liste. Das Blatt "Tankbuch" wird
 * dabei neu geschrieben, damit auch gelöschte oder geänderte Einträge stimmen.
 * Eigene Auswertungen bitte in einem anderen Tabellenblatt anlegen.
 *
 * Sicherung: Zusätzlich speichert die App eine Komplettsicherung im versteckten Blatt
 * "Backup" und die Belegfotos im Drive-Ordner "Tankbuch Belege". Auf einem neuen Handy
 * holt "Aus Google wiederherstellen" alles zurück.
 */
const SECRET = 'HIER-DEINEN-SCHLUESSEL-EINTRAGEN';
const SHEET = 'Tankbuch';
const SUMMARY = 'Monate';
const BACKUP = 'Backup';
const FOLDER = 'Tankbuch Belege';
const CHUNK = 45000; // Zellen fassen max. 50.000 Zeichen

const HEADERS = [
  'ID', 'Datum', 'Uhrzeit', 'Tankstelle', 'Kraftstoff', 'Liter', 'Preis €/L', 'Betrag €',
  'Kilometerstand', 'Gefahrene km', 'Verbrauch L/100km', 'Vollgetankt', 'Nutzung',
  'Beruflich %', 'Beruflicher Anteil €', 'Netto €', 'MwSt €', 'Rabatt €', 'Notiz',
];

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.secret !== SECRET) return json({ ok: false, error: 'Falscher Schlüssel' });
    if (data.action === 'receipt') return json(saveReceipt(data));

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(SHEET) || ss.insertSheet(SHEET, 0);
    const rows = (data.rows || []).map((r) => HEADERS.map((h) => {
      const v = r[h];
      if (h === 'Datum' && v) return new Date(v + 'T00:00:00');
      return v === null || v === undefined ? '' : v;
    }));

    sh.clearContents();
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
      .setFontWeight('bold').setBackground('#0b0f14').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    if (rows.length) {
      sh.getRange(2, 1, rows.length, HEADERS.length).setValues(rows);
      const n = rows.length;
      sh.getRange(2, 2, n, 1).setNumberFormat('dd.MM.yyyy');
      sh.getRange(2, 6, n, 1).setNumberFormat('#,##0.00');
      sh.getRange(2, 7, n, 1).setNumberFormat('#,##0.000 €');
      sh.getRange(2, 8, n, 1).setNumberFormat('#,##0.00 €');
      sh.getRange(2, 9, n, 2).setNumberFormat('#,##0');
      sh.getRange(2, 11, n, 1).setNumberFormat('0.0');
      sh.getRange(2, 15, n, 4).setNumberFormat('#,##0.00 €');
    }
    sh.hideColumns(1);
    sh.autoResizeColumns(2, HEADERS.length - 1);

    writeSummary(ss, data.rows || []);
    if (data.backup) writeBackup(ss, data.backup, data.force);
    if (data.vehicle) ss.rename('Tankbuch – ' + data.vehicle);

    return json({ ok: true, rows: rows.length, at: new Date().toISOString() });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!p.action) return json({ ok: true, hint: 'Tankbuch-Endpunkt läuft. Daten werden per POST aus der App gesendet.' });
  if (p.secret !== SECRET) return json({ ok: false, error: 'Falscher Schlüssel' });
  try {
    if (p.action === 'backup') return json(readBackup());
    if (p.action === 'receipt') return json(readReceipt(p.id));
    return json({ ok: false, error: 'Unbekannte Aktion' });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

/* ---------- Komplettsicherung (verstecktes Blatt) ---------- */
function writeBackup(ss, backup, force) {
  const sh = ss.getSheetByName(BACKUP) || ss.insertSheet(BACKUP);
  // Schutz: eine leere App überschreibt niemals eine gefüllte Sicherung
  const old = sh.getRange(1, 1).getValue();
  if (!force && old && (!backup.entries || !backup.entries.length)) {
    try { if (JSON.parse(old).count > 0) return; } catch (e) { /* alte Kopfzeile unlesbar → überschreiben */ }
  }
  const text = JSON.stringify(backup);
  const parts = [];
  for (let i = 0; i < text.length; i += CHUNK) parts.push([text.slice(i, i + CHUNK)]);
  sh.clearContents();
  sh.getRange(1, 1).setValue(JSON.stringify({ at: new Date().toISOString(), count: (backup.entries || []).length, chunks: parts.length }));
  if (parts.length) sh.getRange(2, 1, parts.length, 1).setValues(parts);
  if (!sh.isSheetHidden()) sh.hideSheet();
}

function readBackup() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BACKUP);
  if (!sh) return { ok: false, error: 'Noch keine Sicherung vorhanden' };
  const meta = JSON.parse(sh.getRange(1, 1).getValue());
  const text = meta.chunks ? sh.getRange(2, 1, meta.chunks, 1).getValues().map((r) => r[0]).join('') : '{}';
  return { ok: true, at: meta.at, data: JSON.parse(text) };
}

/* ---------- Belegfotos in Google Drive ---------- */
function folder() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('folderId');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* gelöscht → neu anlegen */ } }
  const f = DriveApp.createFolder(FOLDER);
  props.setProperty('folderId', f.getId());
  return f;
}

function saveReceipt(data) {
  const f = folder();
  const existing = f.getFilesByName(data.id + '.jpg');
  if (existing.hasNext()) return { ok: true, existed: true };
  const blob = Utilities.newBlob(Utilities.base64Decode(data.data), 'image/jpeg', data.id + '.jpg');
  const file = f.createFile(blob);
  if (data.label) file.setDescription(data.label);
  return { ok: true };
}

function readReceipt(id) {
  const files = folder().getFilesByName(id + '.jpg');
  if (!files.hasNext()) return { ok: false, error: 'Beleg nicht gefunden' };
  return { ok: true, data: Utilities.base64Encode(files.next().getBlob().getBytes()) };
}

function writeSummary(ss, rows) {
  const sh = ss.getSheetByName(SUMMARY) || ss.insertSheet(SUMMARY);
  const months = {};
  rows.forEach((r) => {
    const key = String(r['Datum']).slice(0, 7);
    const m = months[key] || (months[key] = { n: 0, l: 0, eur: 0, biz: 0 });
    m.n++; m.l += r['Liter'] || 0; m.eur += r['Betrag €'] || 0; m.biz += r['Beruflicher Anteil €'] || 0;
  });
  const keys = Object.keys(months).sort();
  const out = keys.map((k) => {
    const m = months[k];
    return [new Date(k + '-01T00:00:00'), m.n, m.l, m.eur, m.l ? m.eur / m.l : 0, m.biz];
  });
  sh.clearContents();
  sh.getRange(1, 1, 1, 6).setValues([['Monat', 'Tankungen', 'Liter', 'Kosten €', 'Ø Preis €/L', 'Beruflich €']])
    .setFontWeight('bold').setBackground('#0b0f14').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  if (!out.length) return;
  sh.getRange(2, 1, out.length, 6).setValues(out);
  sh.getRange(2, 1, out.length, 1).setNumberFormat('MMM yyyy');
  sh.getRange(2, 3, out.length, 1).setNumberFormat('#,##0.0');
  sh.getRange(2, 4, out.length, 1).setNumberFormat('#,##0.00 €');
  sh.getRange(2, 5, out.length, 1).setNumberFormat('0.000 €');
  sh.getRange(2, 6, out.length, 1).setNumberFormat('#,##0.00 €');

  // Diagramm einmalig anlegen, danach nur den Datenbereich aktualisieren
  const charts = sh.getCharts();
  const builder = (charts[0] ? charts[0].modify().clearRanges() : sh.newChart())
    .setChartType(Charts.ChartType.COMBO)
    .addRange(sh.getRange(1, 1, out.length + 1, 1))
    .addRange(sh.getRange(1, 4, out.length + 1, 1))
    .addRange(sh.getRange(1, 5, out.length + 1, 1))
    .setOption('title', 'Tankkosten & Ø Literpreis')
    .setOption('series', { 0: { type: 'bars', targetAxisIndex: 0 }, 1: { type: 'line', targetAxisIndex: 1, lineWidth: 3 } })
    .setOption('vAxes', { 0: { title: 'Kosten €' }, 1: { title: '€/L' } })
    .setPosition(2, 8, 0, 0);
  if (charts[0]) sh.updateChart(builder.build()); else sh.insertChart(builder.build());
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
