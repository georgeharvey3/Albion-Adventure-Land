import { type Site, normalizeCategory } from './types';
import { type SourceMapping } from './mappings/magical_britain';

// Pure ingest logic (spec §5.2). Runtime-agnostic so it runs in the Node build
// script and is unit-testable. Pipeline: apply mapping → validate → dedupe by id.
// Rows that fail validation are returned in `rejected`, never dropped silently.

export type RawRow = Record<string, string>;

export interface RejectedRow {
  row: RawRow;
  reason: string;
}

export interface IngestResult {
  sites: Site[];
  rejected: RejectedRow[];
  /** Rows intentionally not turned into sites: navigation aids (trailheads/
   *  parking) or rows dropped by the mapping's `exclude` rule. Not data errors. */
  skippedNonCollectible: number;
}

const UK_BOUNDS = { minLat: 49, maxLat: 61, minLng: -9, maxLng: 2 };

export function slug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics (ê, û, etc.)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Stable, derived id. Coordinates rounded to ~11 m so tiny CSV jitter on
// re-import doesn't break user state, while distinct nearby sites stay distinct.
export function makeId(name: string, lat: number, lng: number): string {
  return `${slug(name)}_${lat.toFixed(4)}_${lng.toFixed(4)}`;
}

// Stable id for postcode-keyed sources (pubs). Built from name + postcode, both
// of which come straight from the CSV — so re-geocoding (which can nudge the
// coordinates) never changes the id, and user state survives. NOT coordinate-
// based, deliberately, unlike makeId.
export function makePubId(name: string, postcode: string): string {
  return `${slug(name)}_${slug(postcode)}`;
}

function inUkBounds(lat: number, lng: number): boolean {
  return (
    lat >= UK_BOUNDS.minLat &&
    lat <= UK_BOUNDS.maxLat &&
    lng >= UK_BOUNDS.minLng &&
    lng <= UK_BOUNDS.maxLng
  );
}

function col(row: RawRow, key: string | undefined): string {
  if (!key) return '';
  return (row[key] ?? '').trim();
}

// Rows dropped by the mapping's `exclude` rule (e.g. Northern Ireland pubs).
function isExcluded(row: RawRow, mapping: SourceMapping): boolean {
  const ex = mapping.exclude;
  if (!ex) return false;
  return ex.values.includes(col(row, ex.column));
}

export function mapRow(row: RawRow, mapping: SourceMapping): Site | RejectedRow {
  const name = col(row, mapping.columns.name);
  if (!name) {
    return { row, reason: 'missing name' };
  }

  const latRaw = col(row, mapping.columns.lat);
  const lngRaw = col(row, mapping.columns.lng);
  if (!latRaw || !lngRaw) {
    return { row, reason: 'missing lat/lng (OSGB conversion not enabled for this source)' };
  }

  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { row, reason: `unparseable coordinates "${latRaw},${lngRaw}"` };
  }
  if (!inUkBounds(lat, lng)) {
    return { row, reason: `coordinates out of UK range (${lat},${lng})` };
  }

  const description = col(row, mapping.columns.description) || undefined;
  const county = col(row, mapping.columns.county) || undefined;
  const access = col(row, mapping.columns.access) || undefined;
  const category = normalizeCategory(col(row, mapping.columns.category));

  return {
    id: makeId(name, lat, lng),
    name,
    lat,
    lng,
    description,
    county,
    source: mapping.source,
    access,
    category,
  };
}

export function ingest(rows: RawRow[], mapping: SourceMapping): IngestResult {
  const sites: Site[] = [];
  const rejected: RejectedRow[] = [];
  const seen = new Set<string>();
  let skippedNonCollectible = 0;

  for (const row of rows) {
    if (isExcluded(row, mapping)) {
      skippedNonCollectible++;
      continue;
    }

    const role = col(row, mapping.columns.role);
    if (role && !mapping.collectibleRoles.includes(role)) {
      skippedNonCollectible++;
      continue;
    }

    const mapped = mapRow(row, mapping);
    if ('reason' in mapped) {
      rejected.push(mapped);
      continue;
    }
    if (seen.has(mapped.id)) {
      continue; // dedupe by stable id
    }
    seen.add(mapped.id);
    sites.push(mapped);
  }

  return { sites, rejected, skippedNonCollectible };
}

// --- Postcode-keyed sources (pubs) ---------------------------------------

export interface Coords {
  lat: number;
  lng: number;
}

/** Resolves a postcode to coordinates, or null if it can't be geocoded. */
export type Geocoder = (postcode: string) => Coords | null;

export function mapPubRow(row: RawRow, mapping: SourceMapping, geocode: Geocoder): Site | RejectedRow {
  const name = col(row, mapping.columns.name);
  if (!name) {
    return { row, reason: 'missing name' };
  }

  const postcode = col(row, mapping.columns.postcode);
  if (!postcode) {
    return { row, reason: 'missing postcode' };
  }

  // Coordinates come from build-time geocoding, not the CSV. A null result
  // (terminated or mistyped postcode) is a rejection, never a silent drop —
  // these surface in the ingest log so the postcode can be fixed and re-run.
  const coords = geocode(postcode);
  if (!coords) {
    return { row, reason: `postcode "${postcode}" did not geocode` };
  }
  if (!inUkBounds(coords.lat, coords.lng)) {
    return { row, reason: `geocoded coords out of UK range (${coords.lat},${coords.lng}) for "${postcode}"` };
  }

  return {
    id: makePubId(name, postcode),
    name,
    lat: coords.lat,
    lng: coords.lng,
    postcode,
    source: mapping.source,
    category: 'historic_pubs',
  };
}

export function ingestPubs(rows: RawRow[], mapping: SourceMapping, geocode: Geocoder): IngestResult {
  const sites: Site[] = [];
  const rejected: RejectedRow[] = [];
  const seen = new Set<string>();
  let skippedNonCollectible = 0;

  for (const row of rows) {
    if (isExcluded(row, mapping)) {
      skippedNonCollectible++;
      continue;
    }

    const mapped = mapPubRow(row, mapping, geocode);
    if ('reason' in mapped) {
      rejected.push(mapped);
      continue;
    }
    if (seen.has(mapped.id)) {
      continue; // dedupe by stable id
    }
    seen.add(mapped.id);
    sites.push(mapped);
  }

  return { sites, rejected, skippedNonCollectible };
}
