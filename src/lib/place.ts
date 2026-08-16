/**
 * Joylashuv, manzil va yoʻl.
 *
 * Hammasi telefonda ishlaydi: koordinatani Android beradi, manzil nomini
 * OpenStreetMap (Nominatim) qaytaradi, xarita esa OSM plitkalaridan
 * yigʻiladi — hech qanday API kalit va server kerak emas.
 */

import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';

export interface Spot {
  lat: number;
  lon: number;
  /** Aniqlik (metr) */
  accuracy?: number;
  /** Tezlik (m/s) — kuzatuv paytida */
  speed?: number | null;
  at: number;
}

export interface Place {
  name: string;
  lat: number;
  lon: number;
  /** Toʻliq manzil */
  address?: string;
}

const isNative = () => Capacitor.isNativePlatform();

/** Joylashuvga ruxsat soʻraydi. */
export async function askLocationPermission(): Promise<boolean> {
  if (!isNative()) return true;
  try {
    const status = await Geolocation.checkPermissions();
    if (status.location === 'granted' || status.coarseLocation === 'granted') return true;
    const asked = await Geolocation.requestPermissions({ permissions: ['location'] });
    return asked.location === 'granted' || asked.coarseLocation === 'granted';
  } catch {
    return false;
  }
}

function fromPosition(p: {
  coords: { latitude: number; longitude: number; accuracy?: number; speed?: number | null };
  timestamp?: number;
}): Spot {
  return {
    lat: p.coords.latitude,
    lon: p.coords.longitude,
    accuracy: p.coords.accuracy,
    speed: p.coords.speed ?? null,
    at: p.timestamp ?? Date.now(),
  };
}

/** Hozirgi joylashuvni bir marta oladi. */
export async function getSpot(timeoutMs = 12000): Promise<Spot> {
  if (isNative()) {
    if (!(await askLocationPermission())) {
      throw new Error('Joylashuvga ruxsat berilmadi. Sozlamalar → Ilovalar → Daho → Ruxsatlar.');
    }
    const position = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: timeoutMs,
    });
    return fromPosition(position);
  }

  if (!navigator.geolocation) throw new Error('Bu qurilmada joylashuv xizmati yoʻq');
  return new Promise<Spot>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(fromPosition(p)),
      (err) => reject(new Error(err.message || 'Joylashuv aniqlanmadi')),
      { enableHighAccuracy: true, timeout: timeoutMs },
    );
  });
}

export interface Watcher {
  stop: () => void;
}

/** Joylashuvni jonli kuzatadi. */
export async function watchSpot(
  onSpot: (spot: Spot) => void,
  onError?: (message: string) => void,
): Promise<Watcher> {
  if (isNative()) {
    if (!(await askLocationPermission())) {
      onError?.('Joylashuvga ruxsat berilmadi.');
      return { stop: () => undefined };
    }
    const id = await Geolocation.watchPosition(
      { enableHighAccuracy: true, timeout: 15000 },
      (position, err) => {
        if (err) onError?.(String(err.message ?? err));
        else if (position) onSpot(fromPosition(position));
      },
    );
    return { stop: () => void Geolocation.clearWatch({ id }).catch(() => undefined) };
  }

  if (!navigator.geolocation) {
    onError?.('Bu qurilmada joylashuv xizmati yoʻq');
    return { stop: () => undefined };
  }
  const id = navigator.geolocation.watchPosition(
    (p) => onSpot(fromPosition(p)),
    (err) => onError?.(err.message || 'Joylashuv aniqlanmadi'),
    { enableHighAccuracy: true, timeout: 15000 },
  );
  return { stop: () => navigator.geolocation.clearWatch(id) };
}

/* ------------------------------------------------------------------ */
/*  Manzil nomi (OpenStreetMap Nominatim — kalitsiz)                    */
/* ------------------------------------------------------------------ */

const NOMINATIM = 'https://nominatim.openstreetmap.org';

/** Koordinatadan manzil nomini topadi. */
export async function describeSpot(spot: Spot, lang = 'uz'): Promise<string> {
  const url =
    `${NOMINATIM}/reverse?format=jsonv2&lat=${spot.lat}&lon=${spot.lon}` +
    `&zoom=17&accept-language=${encodeURIComponent(lang)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Manzil topilmadi (${res.status})`);
  const data = (await res.json()) as { display_name?: string };
  return data.display_name ?? `${spot.lat.toFixed(5)}, ${spot.lon.toFixed(5)}`;
}

/** Nom boʻyicha joy qidiradi (universitet, bekat, doʻkon…). */
export async function findPlace(query: string, near?: Spot, lang = 'uz'): Promise<Place[]> {
  const box = near
    ? `&viewbox=${near.lon - 0.6},${near.lat + 0.6},${near.lon + 0.6},${near.lat - 0.6}`
    : '';
  const url =
    `${NOMINATIM}/search?format=jsonv2&q=${encodeURIComponent(query)}` +
    `&limit=5&accept-language=${encodeURIComponent(lang)}${box}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Qidiruv ishlamadi (${res.status})`);
  const data = (await res.json()) as Array<{
    display_name: string;
    name?: string;
    lat: string;
    lon: string;
  }>;
  return data.map((d) => ({
    name: d.name || d.display_name.split(',')[0],
    address: d.display_name,
    lat: Number(d.lat),
    lon: Number(d.lon),
  }));
}

/* ------------------------------------------------------------------ */
/*  Masofa va havolalar                                                */
/* ------------------------------------------------------------------ */

/** Ikki nuqta orasidagi masofa (metr) — Haversine. */
export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function humanDistance(meters: number): string {
  if (meters < 950) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}

export type TravelMode = 'transit' | 'walking' | 'driving' | 'bicycling';

/** Telefondagi xarita ilovasida yoʻlni ochish havolasi. */
export function directionsUrl(
  from: { lat: number; lon: number } | null,
  to: { lat: number; lon: number } | string,
  mode: TravelMode = 'transit',
): string {
  const dest =
    typeof to === 'string' ? encodeURIComponent(to) : `${to.lat},${to.lon}`;
  const origin = from ? `&origin=${from.lat},${from.lon}` : '';
  return `https://www.google.com/maps/dir/?api=1${origin}&destination=${dest}&travelmode=${mode}`;
}

/* ------------------------------------------------------------------ */
/*  OSM plitkalari — oddiy xarita                                      */
/* ------------------------------------------------------------------ */

export interface TileRef {
  url: string;
  /** Plitkaning konteynerdagi joylashuvi (piksel) */
  x: number;
  y: number;
}

export interface TileMap {
  size: number;
  tiles: TileRef[];
  /** Markazdagi nuqtaning konteynerdagi oʻrni */
  center: { x: number; y: number };
  /** Ikkinchi nuqta koʻrsatilsa — uning oʻrni (koʻrinmasa null) */
  mark?: { x: number; y: number } | null;
}

const TILE = 256;

function project(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom;
  const x = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

/**
 * Berilgan nuqta atrofida kichik xarita yigʻadi (3×3 plitka).
 * Rasm manbai — OpenStreetMap, kalit talab qilmaydi.
 */
export function buildTileMap(
  center: { lat: number; lon: number },
  zoom = 15,
  mark?: { lat: number; lon: number } | null,
  span = 3,
): TileMap {
  const p = project(center.lat, center.lon, zoom);
  const tileX = Math.floor(p.x);
  const tileY = Math.floor(p.y);
  const half = Math.floor(span / 2);
  const size = TILE * span;

  const tiles: TileRef[] = [];
  for (let dy = -half; dy <= half; dy += 1) {
    for (let dx = -half; dx <= half; dx += 1) {
      tiles.push({
        url: `https://tile.openstreetmap.org/${zoom}/${tileX + dx}/${tileY + dy}.png`,
        x: (dx + half) * TILE,
        y: (dy + half) * TILE,
      });
    }
  }

  const originX = (tileX - half) * TILE;
  const originY = (tileY - half) * TILE;
  const toPixel = (lat: number, lon: number) => {
    const q = project(lat, lon, zoom);
    return { x: q.x * TILE - originX, y: q.y * TILE - originY };
  };

  const markPixel = mark ? toPixel(mark.lat, mark.lon) : null;
  return {
    size,
    tiles,
    center: toPixel(center.lat, center.lon),
    mark:
      markPixel && markPixel.x >= 0 && markPixel.y >= 0 && markPixel.x <= size && markPixel.y <= size
        ? markPixel
        : null,
  };
}

/** Ikki nuqta sigʻadigan yaqinlashtirish darajasi. */
export function zoomFor(meters: number): number {
  if (meters < 300) return 17;
  if (meters < 800) return 16;
  if (meters < 2000) return 15;
  if (meters < 5000) return 14;
  if (meters < 12000) return 13;
  if (meters < 30000) return 12;
  if (meters < 70000) return 11;
  return 10;
}
