// Persistenz: Einträge/Einstellungen/Marktdaten in localStorage, Belegfotos in IndexedDB.
const KEY = 'tankbuch.v1';

const DEFAULT_SETTINGS = {
  vehicle: 'Mein Auto',
  plate: '',
  tankSize: 50,
  fuel: 'E10',
  apiKey: '',
  radius: 5,
  sort: 'price',
  openOnly: true,
  alarm: null,
  consumption: null,
  sheetsUrl: '',
  sheetsSecret: '',
  autoSync: false,
  lastSync: null,
  commuteKm: 0,
  workDays: 220,
  commuteRate: 0.38,
  chartMode: 'price',
  chartRange: '6M',
  chartStyle: 'candle',
};

const state = load();
const listeners = new Set();

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY)) || {};
    return {
      entries: raw.entries || [],
      snapshots: raw.snapshots || [],
      settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) },
    };
  } catch {
    return { entries: [], snapshots: [], settings: { ...DEFAULT_SETTINGS } };
  }
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Speichern fehlgeschlagen', e);
  }
}

function emit(kind) {
  persist();
  listeners.forEach((fn) => fn(kind));
}

export const onChange = (fn) => listeners.add(fn);

export const getSettings = () => state.settings;
export function setSettings(patch, silent = false) {
  Object.assign(state.settings, patch);
  silent ? persist() : emit('settings');
}

/** Einträge, aufsteigend nach Datum */
export const getEntries = () => [...state.entries].sort((a, b) => new Date(a.date) - new Date(b.date));
export const getEntry = (id) => state.entries.find((e) => e.id === id);

export function saveEntry(entry) {
  const i = state.entries.findIndex((e) => e.id === entry.id);
  if (i >= 0) state.entries[i] = entry;
  else state.entries.push(entry);
  emit('entries');
}

export function deleteEntry(id) {
  const e = getEntry(id);
  state.entries = state.entries.filter((x) => x.id !== id);
  if (e?.receiptId) deleteReceipt(e.receiptId);
  emit('entries');
}

export function replaceAll(data) {
  state.entries = data.entries || [];
  state.snapshots = data.snapshots || [];
  if (data.settings) state.settings = { ...DEFAULT_SETTINGS, ...data.settings };
  emit('entries');
}

export function mergeData({ entries = [], snapshots = [] }) {
  state.entries.push(...entries);
  state.snapshots = [...state.snapshots, ...snapshots].sort((a, b) => a.t - b.t);
  emit('entries');
}

export function removeWhere(pred) {
  state.entries = state.entries.filter((e) => !pred(e));
  state.snapshots = state.snapshots.filter((s) => !pred(s));
  emit('entries');
}

/* ---------- Marktpreis-Schnappschüsse (für die "Markt"-Linie im Chart) ---------- */
export const getSnapshots = () => state.snapshots;
export function addSnapshot(snap) {
  const last = state.snapshots[state.snapshots.length - 1];
  // höchstens alle 20 Minuten einen Messpunkt speichern
  if (last && snap.t - last.t < 20 * 60 * 1000) {
    state.snapshots[state.snapshots.length - 1] = snap;
  } else {
    state.snapshots.push(snap);
  }
  if (state.snapshots.length > 3000) state.snapshots.splice(0, state.snapshots.length - 3000);
  persist();
}

export const exportData = () => JSON.parse(JSON.stringify(state));

/* ---------- Belege (IndexedDB) ---------- */
let dbPromise;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('tankbuch', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('receipts');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('receipts', mode);
    const req = fn(t.objectStore('receipts'));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

export const putReceipt = (id, blob) => tx('readwrite', (s) => s.put(blob, id));
export const getReceipt = (id) => tx('readonly', (s) => s.get(id));
export const deleteReceipt = (id) => tx('readwrite', (s) => s.delete(id)).catch(() => {});
export const clearReceipts = () => tx('readwrite', (s) => s.clear());
