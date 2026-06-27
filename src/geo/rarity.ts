import type { Site, SiteCategory } from '../data/types';

// Rarity scoring (spec §7.4). Derived at load from type frequency across the
// dataset — NOT stored on the Site. Used for the "rarest type you haven't seen"
// nudge in the MVP, and as the selection weight for orienteering in Phase 3.

export interface RarityIndex {
  count: Record<SiteCategory, number>;
  rarity: Record<SiteCategory, number>;
}

export function buildRarityIndex(sites: Site[]): RarityIndex {
  const count = {} as Record<SiteCategory, number>;
  for (const s of sites) {
    count[s.category] = (count[s.category] ?? 0) + 1;
  }
  const rarity = {} as Record<SiteCategory, number>;
  for (const type of Object.keys(count) as SiteCategory[]) {
    // log-dampened inverse frequency: rarer types score higher.
    rarity[type] = 1 / Math.log2(count[type] + 1);
  }
  return { count, rarity };
}
