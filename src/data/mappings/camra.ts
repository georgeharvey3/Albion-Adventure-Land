// Per-source mapping config for CAMRA.csv (spec §5.2). Unlike the magical
// britain source, this CSV carries NO coordinates — only a postcode — so it is
// geocoded at build time (coords: 'geocode_postcode', see scripts/geocode.ts)
// and the resolved lat/lng are baked into the emitted JSON. Runtime stays offline.
//
// Every row is a pub, so the leaf category is fixed to 'historic_pubs' in
// mapPubRow (there is no subcategory). The other columns the CSV carries —
// Grading (all "3-star"), Country, Area, Town — are intentionally discarded:
// per the product decision we display only name, postcode and location.
//
// CSV header: Grading, Country, Area, Town, Postcode, Name

import { type SourceMapping } from './magical_britain';

export const camraMapping: SourceMapping = {
  source: 'camra',
  coords: 'geocode_postcode',
  columns: {
    name: 'Name',
    postcode: 'Postcode',
  },
  // No structural-role column — every row is a collectible pub.
  collectibleRoles: [],
  // Out of scope for this app: drop Northern Ireland pubs.
  exclude: { column: 'Country', values: ['Northern Ireland'] },
};
