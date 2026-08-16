import { useEffect, useMemo, useRef, useState } from 'react';
import { openExternal } from '../lib/openlink';
import {
  buildTileMap,
  distanceM,
  getSpot,
  humanDistance,
  watchSpot,
  zoomFor,
  type Spot,
  type Watcher,
} from '../lib/place';
import { useStore } from '../lib/store';
import { toast } from './ui';

const MODE_LABEL: Record<string, string> = {
  transit: '🚇 Jamoat transporti',
  walking: '🚶 Piyoda',
  driving: '🚗 Mashinada',
  bicycling: '🚲 Velosipedda',
};

/**
 * Chatdagi yoʻl kartasi: xarita, masofa va jonli kuzatuv.
 * Kuzatuv yoqilganda joylashuv oʻzgargani sayin masofa yangilanib turadi.
 */
export function RouteCard({ routeId }: { routeId: string }) {
  const route = useStore((s) => s.routes.find((r) => r.id === routeId));
  const [spot, setSpot] = useState<Spot | null>(null);
  const [live, setLive] = useState(false);
  const [error, setError] = useState('');
  const watcher = useRef<Watcher | null>(null);

  // Karta ochilganda joylashuvni bir marta olamiz.
  useEffect(() => {
    let cancelled = false;
    void getSpot()
      .then((s) => !cancelled && setSpot(s))
      .catch((err) => !cancelled && setError(String((err as Error)?.message ?? err)));
    return () => {
      cancelled = true;
    };
  }, [routeId]);

  // Kuzatuvni yoqib-oʻchirish.
  useEffect(() => {
    if (!live) {
      watcher.current?.stop();
      watcher.current = null;
      return;
    }
    let stopped = false;
    void watchSpot(
      (next) => !stopped && setSpot(next),
      (message) => !stopped && setError(message),
    ).then((w) => {
      if (stopped) w.stop();
      else watcher.current = w;
    });
    return () => {
      stopped = true;
      watcher.current?.stop();
      watcher.current = null;
    };
  }, [live]);

  const target = useMemo(
    () => (route?.lat != null && route?.lon != null ? { lat: route.lat, lon: route.lon } : null),
    [route?.lat, route?.lon],
  );

  const meters = spot && target ? distanceM(spot, target) : null;

  const map = useMemo(() => {
    if (!spot) return null;
    const zoom = meters ? zoomFor(meters) : 15;
    return buildTileMap(spot, zoom, target);
  }, [spot?.lat, spot?.lon, meters, target]);

  if (!route) return null;

  return (
    <div className="route-card">
      <div className="route-head">
        <span className="route-pin">📍</span>
        <span className="grow">
          <span className="artifact-title">{route.destination}</span>
          <div className="tiny">
            {MODE_LABEL[route.mode] ?? route.mode}
            {meters != null ? ` · ${humanDistance(meters)}` : ''}
            {spot?.accuracy ? ` · ±${Math.round(spot.accuracy)} m` : ''}
          </div>
        </span>
      </div>

      {map && (
        <div className="route-map" style={{ height: 190 }}>
          <div
            className="route-tiles"
            style={{
              width: map.size,
              height: map.size,
              // Konteynerning markazi (left/top 50%) nuqtaga toʻgʻri kelsin.
              transform: `translate(${-map.center.x}px, ${-map.center.y}px)`,
            }}
          >
            {map.tiles.map((t) => (
              <img key={t.url} src={t.url} alt="" style={{ left: t.x, top: t.y }} loading="lazy" />
            ))}
            <span className="route-me" style={{ left: map.center.x, top: map.center.y }} />
            {map.mark && (
              <span className="route-target" style={{ left: map.mark.x, top: map.mark.y }}>
                🎯
              </span>
            )}
          </div>
          {live && <span className="route-live">● jonli</span>}
        </div>
      )}

      {error && <div className="tiny" style={{ padding: '0 12px 8px', color: 'var(--danger)' }}>{error}</div>}

      <div className="route-actions">
        <button
          className="btn mini"
          onClick={() => {
            if (!openExternal(route.mapsUrl)) toast('Xaritani ochib boʻlmadi');
          }}
        >
          Xaritada ochish
        </button>
        <button className="btn mini ghost" onClick={() => setLive((v) => !v)}>
          {live ? 'Kuzatuvni toʻxtatish' : 'Jonli kuzatuv'}
        </button>
      </div>

      <div className="tiny" style={{ padding: '0 12px 10px' }}>
        Xarita © OpenStreetMap
      </div>
    </div>
  );
}
