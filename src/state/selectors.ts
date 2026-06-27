import { useMemo } from 'react';
import type { Site } from '../data/types';
import { haversine } from '../geo/haversine';
import { useStore, type Position } from './store';

export interface SiteView {
  site: Site;
  distance: number | null; // metres from current position, null if unknown
  visited: boolean;
  wishlisted: boolean;
}

/** Sites passing the active type filter, annotated with state and distance,
 *  sorted nearest-first when a position is known (else alphabetically). */
export function useVisibleSites(): SiteView[] {
  const sites = useStore((s) => s.sites);
  const activeTypes = useStore((s) => s.activeTypes);
  const visited = useStore((s) => s.visited);
  const wishlist = useStore((s) => s.wishlist);
  const position = useStore((s) => s.position);

  return useMemo(
    () => buildViews(sites, activeTypes, visited, wishlist, position),
    [sites, activeTypes, visited, wishlist, position],
  );
}

function buildViews(
  sites: Site[],
  activeTypes: Set<string>,
  visited: Record<string, unknown>,
  wishlist: Set<string>,
  position: Position | null,
): SiteView[] {
  const views: SiteView[] = [];
  for (const site of sites) {
    if (!activeTypes.has(site.category)) continue;
    views.push({
      site,
      distance: position ? haversine(position, site) : null,
      visited: site.id in visited,
      wishlisted: wishlist.has(site.id),
    });
  }
  views.sort((a, b) => {
    if (a.distance !== null && b.distance !== null) return a.distance - b.distance;
    return a.site.name.localeCompare(b.site.name);
  });
  return views;
}
