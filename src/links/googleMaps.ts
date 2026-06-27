import type { Site } from '../data/types';

// Google Maps deep-link builders (spec §8). Handoff only — no embedded
// directions. Single-site is all the MVP needs; the multi-stop builder is here
// for Phase 3 and already guards the ~9-waypoint consumer-URL cap.

/**
 * Single-site directions handoff. When `origin` is given (e.g. a dropped "I am
 * here" pin), the route starts there; otherwise the origin is omitted so Google
 * Maps uses the device's live location.
 */
export function directionsToSite(site: Site, origin?: { lat: number; lng: number }): string {
  const params = new URLSearchParams({ api: '1', destination: `${site.lat},${site.lng}` });
  if (origin) params.set('origin', `${origin.lat},${origin.lng}`);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

const MAX_WAYPOINTS = 9; // consumer URL cap (verify before relying on it — spec §8)

/** Multi-stop route. `ordered` is [start, ...vias, end]. Throws if too many vias. */
export function multiStopRoute(ordered: Site[]): string {
  if (ordered.length < 2) throw new Error('need at least an origin and destination');
  const origin = ordered[0];
  const destination = ordered[ordered.length - 1];
  const vias = ordered.slice(1, -1);
  if (vias.length > MAX_WAYPOINTS) {
    throw new Error(`route has ${vias.length} waypoints, exceeds cap of ${MAX_WAYPOINTS}; chunk it`);
  }
  const params = new URLSearchParams({
    api: '1',
    origin: `${origin.lat},${origin.lng}`,
    destination: `${destination.lat},${destination.lng}`,
  });
  if (vias.length) {
    params.set('waypoints', vias.map((s) => `${s.lat},${s.lng}`).join('|'));
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
