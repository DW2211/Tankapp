// Live-Spritpreise über die Tankerkönig-API (Daten der Markttransparenzstelle für Kraftstoffe).
import { isNum, avg } from './util.js';

const API = 'https://creativecommons.tankerkoenig.de/json/list.php';
const CACHE_MS = 4 * 60 * 1000;
let cache = null;

export function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Standort wird von diesem Gerät nicht unterstützt.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => reject(new Error(e.code === 1 ? 'Standortfreigabe verweigert. Bitte in den Browser-Einstellungen erlauben.' : 'Standort konnte nicht ermittelt werden.')),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 5 * 60 * 1000 },
    );
  });
}

/**
 * @returns {Promise<{stations: object[], pos: {lat:number,lng:number}, fetchedAt: number}>}
 */
export async function fetchStations({ apiKey, radius = 5, force = false }) {
  if (!apiKey) throw Object.assign(new Error('Kein API-Key'), { code: 'nokey' });
  if (!force && cache && Date.now() - cache.fetchedAt < CACHE_MS && cache.radius === radius) return cache;
  const pos = await getPosition();
  const url = `${API}?lat=${pos.lat.toFixed(5)}&lng=${pos.lng.toFixed(5)}&rad=${Math.min(25, radius)}&sort=dist&type=e10&apikey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) throw new Error(json?.message ? `Tankerkönig: ${json.message}` : `Tankerkönig nicht erreichbar (${res.status})`);
  const stations = json.stations
    .filter((s) => isNum(s.price) && s.price > 0)
    .map((s) => ({
      id: s.id,
      name: s.name,
      brand: (s.brand || '').trim(),
      street: [s.street, s.houseNumber].filter(Boolean).join(' ').trim(),
      place: [s.postCode, s.place].filter(Boolean).join(' '),
      lat: s.lat, lng: s.lng, dist: s.dist, price: s.price, isOpen: s.isOpen,
    }));
  cache = { stations, pos, fetchedAt: Date.now(), radius };
  return cache;
}

export function marketSnapshot(stations) {
  const open = stations.filter((s) => s.isOpen);
  const list = open.length ? open : stations;
  if (!list.length) return null;
  const best = list.reduce((a, b) => (b.price < a.price ? b : a));
  return { t: Date.now(), min: best.price, avg: Math.round(avg(list, (s) => s.price) * 1000) / 1000, n: list.length, station: displayName(best) };
}

/** Tankerkönig liefert Luftlinie – auf der Straße ist der Weg im Schnitt rund 30 % länger */
export const ROAD_FACTOR = 1.3;

/**
 * Vorlagen bekannter Rabattprogramme (Stand Oktober 2026, ohne Gewähr).
 * Rabatte hängen an Karten/Mitgliedschaften, deshalb schaltet man selbst an, was man hat.
 */
export const DISCOUNT_PRESETS = [
  { id: 'aral-payback-coupon', brand: 'ARAL', ct: 5, label: 'PAYBACK-Coupon', until: '2026-11-15', note: 'einmal pro Konto einlösbar' },
  { id: 'shell-clubsmart', brand: 'SHELL', ct: 2, label: 'ClubSmart Sofortrabatt' },
  { id: 'shell-adac', brand: 'SHELL', ct: 1, label: 'ADAC-Mitglied', until: '2026-12-31' },
  { id: 'esso-adac', brand: 'ESSO', ct: 1, label: 'ADAC-Mitglied' },
];

const brandOf = (st) => `${st.brand} ${st.name}`.toUpperCase();
const isActive = (d, now) => d.on && (!d.until || now <= new Date(d.until + 'T23:59:59').getTime());

/** Höchster aktiver Rabatt für eine Tankstelle – Rabatte einer Marke lassen sich meist nicht addieren */
export function activeDiscount(station, discounts = [], now = Date.now()) {
  const b = brandOf(station);
  return discounts
    .filter((d) => isActive(d, now) && d.brand && b.includes(d.brand.toUpperCase()))
    .reduce((best, d) => (!best || d.ct > best.ct ? d : best), null);
}

/**
 * Rechnet für jede Tankstelle aus, was die Tankfüllung inklusive Hin- und Rückweg kostet,
 * und vergleicht mit der nächstgelegenen geöffneten Tankstelle.
 * So wird die 1 ct billigere Tankstelle 8 km weiter weg nicht fälschlich empfohlen.
 */
export function evaluate(stations, { liters, consumption, discounts }) {
  const withCost = stations.map((st) => {
    const disc = activeDiscount(st, discounts);
    const eff = st.price - (disc ? disc.ct / 100 : 0);
    const roundKm = st.dist * 2 * ROAD_FACTOR;
    const wayL = (roundKm / 100) * consumption;
    return { ...st, disc, eff, roundKm, wayL, cost: eff * (liters + wayL) };
  });
  const open = withCost.filter((s) => s.isOpen);
  const nearest = (open.length ? open : withCost).reduce((a, b) => (b.dist < a.dist ? b : a), withCost[0]);
  return withCost.map((s) => ({
    ...s,
    nearest: s.id === nearest?.id,
    saving: nearest ? nearest.cost - s.cost : 0,
    extraKm: nearest ? s.roundKm - nearest.roundKm : 0,
    // Stadtverkehr ~30 km/h → 2 Minuten pro Kilometer
    extraMin: nearest ? Math.max(0, Math.round((s.roundKm - nearest.roundKm) * 2)) : 0,
  }));
}

export function sortStations(stations, sort, { openOnly, liters = 40, consumption = 7, discounts = [] }) {
  let list = evaluate(stations, { liters, consumption, discounts });
  if (openOnly) list = list.filter((s) => s.isOpen);
  if (sort === 'dist') list.sort((a, b) => a.dist - b.dist);
  else if (sort === 'smart') list.sort((a, b) => a.cost - b.cost || a.dist - b.dist);
  else list.sort((a, b) => a.eff - b.eff || a.dist - b.dist);
  return list;
}

const titleCase = (s) => s.toLowerCase().replace(/(^|[\s-])\S/g, (c) => c.toUpperCase());

export function displayName(s) {
  const brand = s.brand || s.name;
  return brand.length <= 5 ? brand.toUpperCase() : titleCase(brand);
}

export const mapsLink = (s) => `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`;
