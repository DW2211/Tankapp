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

/**
 * "Preis + Weg": Was kostet die Tankfüllung inkl. Hin- und Rückweg?
 * Damit wird die 1 ct billigere Tankstelle 8 km weiter weg nicht fälschlich empfohlen.
 */
export function effectiveCost(station, liters, consumption) {
  const detourL = ((station.dist * 2) / 100) * consumption;
  return station.price * (liters + detourL);
}

export function sortStations(stations, sort, { openOnly, liters, consumption }) {
  let list = openOnly ? stations.filter((s) => s.isOpen) : [...stations];
  if (sort === 'dist') list.sort((a, b) => a.dist - b.dist);
  else if (sort === 'smart') list.sort((a, b) => effectiveCost(a, liters, consumption) - effectiveCost(b, liters, consumption));
  else list.sort((a, b) => a.price - b.price || a.dist - b.dist);
  return list;
}

const titleCase = (s) => s.toLowerCase().replace(/(^|[\s-])\S/g, (c) => c.toUpperCase());

export function displayName(s) {
  const brand = s.brand || s.name;
  return brand.length <= 5 ? brand.toUpperCase() : titleCase(brand);
}

export const mapsLink = (s) => `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`;
