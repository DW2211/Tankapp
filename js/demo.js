// Realistische Beispieldaten, damit man die App sofort ausprobieren kann. Alle mit demo: true markiert.
import { uid, DAY } from './util.js';

const STATIONS = ['ARAL Hauptstraße 12', 'JET Ringstraße 4', 'Shell Bahnhofstraße 31', 'Esso Am Markt 2', 'TotalEnergies Industriestraße 8', 'Star Lindenallee 17'];

function rng(seed) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

export function demoData() {
  const r = rng(42);
  const now = Date.now();
  const start = now - 420 * DAY;
  const entries = [];
  const snapshots = [];

  // Grundpreis als Random Walk mit leichtem Saisonverlauf
  const base = (t) => 1.70 + 0.07 * Math.sin((t / (365 * DAY)) * 2 * Math.PI + 1.2) + 0.03 * Math.sin(t / (23 * DAY));
  let drift = 0;

  let t = start, odo = 48210;
  while (t < now - 2 * DAY) {
    t += (6 + r() * 7) * DAY;
    if (t > now) break;
    drift = Math.max(-0.06, Math.min(0.06, drift + (r() - 0.5) * 0.03));
    const d = new Date(t);
    d.setHours(r() < 0.6 ? 18 + Math.floor(r() * 4) : 7 + Math.floor(r() * 10), Math.floor(r() * 60));
    const evening = d.getHours() >= 18 ? -0.035 : 0;
    const price = Math.round((base(t) + drift + evening + (r() - 0.5) * 0.02) * 1000) / 1000 - 0.001;
    const km = Math.round(480 + r() * 260);
    const full = r() > 0.12;
    const liters = Math.round((km * (6.1 + r() * 1.1)) / 100 * (full ? 1 : 0.6) * 100) / 100;
    odo += km;
    const business = r() < 0.25;
    entries.push({
      id: uid() + entries.length,
      demo: true,
      date: d.toISOString(),
      liters,
      price,
      total: Math.round(liters * price * 100) / 100,
      odometer: odo,
      full,
      fuel: 'E10',
      station: STATIONS[Math.floor(r() * STATIONS.length)],
      usage: business ? 'gemischt' : 'privat',
      share: business ? 40 : 0,
      note: '',
    });
  }

  // Marktdaten der letzten 90 Tage: mehrere Messpunkte am Tag mit typischem Tagesverlauf
  for (let day = now - 90 * DAY; day < now; day += DAY) {
    const d0 = new Date(day); d0.setHours(0, 0, 0, 0);
    for (const h of [7, 9, 12, 15, 17, 19, 21]) {
      if (r() < 0.35) continue;
      const ts = d0.getTime() + h * 3600000 + Math.floor(r() * 50) * 60000;
      if (ts > now) continue;
      const curve = { 7: 0.05, 9: 0.03, 12: 0.04, 15: 0.01, 17: 0.02, 19: -0.03, 21: -0.04 }[h];
      const min = Math.round((base(ts) + curve - 0.01 + (r() - 0.5) * 0.015) * 1000) / 1000 - 0.001;
      snapshots.push({ t: ts, min, avg: Math.round((min + 0.06 + r() * 0.03) * 1000) / 1000, n: 9, station: 'JET Ringstraße 4', demo: true });
    }
  }
  return { entries, snapshots };
}
