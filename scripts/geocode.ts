import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Coords } from '../src/data/ingest.ts';

// Build-time postcode → WGS84 geocoder (decision: geocode at ingest, bake in).
// Uses the free postcodes.io bulk API. Results are cached on disk so re-runs are
// cheap, deterministic, and offline once warmed — this is the ONLY place ingest
// touches the network, and it never runs at app runtime.
//
// Caching policy: a definitive "not found" (API returned result: null) is cached
// as null so we don't re-query known-bad postcodes. Network/transport errors are
// NOT cached — they abort the run instead, so a flaky connection can't poison the
// cache with false negatives.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = resolve(root, 'data');
const CACHE_FILE = resolve(CACHE_DIR, 'geocode-cache.json');

const BULK_ENDPOINT = 'https://api.postcodes.io/postcodes';
const BATCH_SIZE = 100; // postcodes.io bulk cap

/** Cache key: uppercased, whitespace removed. "hp14 3ae" → "HP143AE". */
export function normalizePostcode(postcode: string): string {
  return postcode.toUpperCase().replace(/\s+/g, '');
}

type Cache = Record<string, Coords | null>;

function loadCache(): Cache {
  if (!existsSync(CACHE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as Cache;
  } catch {
    console.warn('  ⚠ geocode cache unreadable, starting fresh');
    return {};
  }
}

function saveCache(cache: Cache): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  // Stable key order so the committed cache produces clean diffs.
  const ordered: Cache = {};
  for (const key of Object.keys(cache).sort()) ordered[key] = cache[key];
  writeFileSync(CACHE_FILE, JSON.stringify(ordered, null, 2) + '\n');
}

interface BulkResult {
  query: string;
  result: { latitude: number; longitude: number } | null;
}

async function fetchBatch(postcodes: string[]): Promise<BulkResult[]> {
  const res = await fetch(BULK_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ postcodes }),
  });
  if (!res.ok) {
    throw new Error(`postcodes.io bulk request failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { result: BulkResult[] };
  return body.result;
}

/**
 * Resolve a list of postcodes to coordinates, using and updating the on-disk
 * cache. Returns a map keyed by normalized postcode; values are Coords or null
 * (definitively not found). Throws on network failure so the run aborts cleanly.
 */
export async function geocodePostcodes(postcodes: string[]): Promise<Map<string, Coords | null>> {
  const cache = loadCache();

  // Unique, normalized, not-yet-cached postcodes (send the canonical spaced form).
  const toFetch = new Map<string, string>(); // normalized → original (spaced)
  for (const pc of postcodes) {
    const key = normalizePostcode(pc);
    if (!(key in cache) && !toFetch.has(key)) toFetch.set(key, pc.toUpperCase().trim());
  }

  const pending = [...toFetch.values()];
  if (pending.length) {
    console.log(`  geocoding ${pending.length} new postcode(s) via postcodes.io (${cache && Object.keys(cache).length} cached)…`);
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const batch = pending.slice(i, i + BATCH_SIZE);
      const results = await fetchBatch(batch);
      for (const { query, result } of results) {
        cache[normalizePostcode(query)] = result
          ? { lat: result.latitude, lng: result.longitude }
          : null;
      }
    }
    saveCache(cache);
  } else {
    console.log(`  all ${postcodes.length} postcode(s) already cached`);
  }

  const out = new Map<string, Coords | null>();
  for (const pc of postcodes) {
    const key = normalizePostcode(pc);
    out.set(key, cache[key] ?? null);
  }
  return out;
}
