import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';
import { ingest, ingestPubs, type Geocoder, type RawRow } from '../src/data/ingest.ts';
import { magicalBritainMapping, type SourceMapping } from '../src/data/mappings/magical_britain.ts';
import { camraMapping } from '../src/data/mappings/camra.ts';
import { geocodePostcodes, normalizePostcode } from './geocode.ts';
import { SITE_TYPE_LABELS, type Site } from '../src/data/types.ts';

// Build-time ingest (spec §5.2, §12 step 2). Reads the real CSV with Papa Parse
// (NOT naive splitting — descriptions contain embedded commas/newlines), applies
// the source mapping, and emits normalized JSON into public/data for the app to
// fetch. Logs validation rejections and skipped navigation-aid rows.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface SourceSpec {
  csv: string;
  mapping: SourceMapping;
}

const SOURCES: SourceSpec[] = [
  { csv: 'magical_britain_master.csv', mapping: magicalBritainMapping },
  { csv: 'CAMRA.csv', mapping: camraMapping },
];

function parseCsv(text: string): RawRow[] {
  const result = Papa.parse<RawRow>(text, {
    header: true,
    skipEmptyLines: 'greedy',
  });
  if (result.errors.length) {
    for (const e of result.errors) {
      console.warn(`  csv parse warning (row ${e.row}): ${e.message}`);
    }
  }
  return result.data;
}

// Resolve the postcode column to coordinates and return a Geocoder closure.
async function buildGeocoder(rows: RawRow[], mapping: SourceMapping): Promise<Geocoder> {
  const postcodeCol = mapping.columns.postcode;
  const postcodes = rows
    .map((r) => (postcodeCol ? (r[postcodeCol] ?? '').trim() : ''))
    .filter(Boolean);
  const resolved = await geocodePostcodes(postcodes);
  return (postcode: string) => resolved.get(normalizePostcode(postcode)) ?? null;
}

async function main(): Promise<void> {
  const allSites: Site[] = [];
  const seen = new Set<string>();
  let totalRejected = 0;
  let totalSkipped = 0;

  for (const { csv, mapping } of SOURCES) {
    console.log(`\nIngesting ${csv} …`);
    const text = readFileSync(resolve(root, csv), 'utf8');
    const rows = parseCsv(text);
    const { sites, rejected, skippedNonCollectible } =
      mapping.coords === 'geocode_postcode'
        ? ingestPubs(rows, mapping, await buildGeocoder(rows, mapping))
        : ingest(rows, mapping);

    for (const s of sites) {
      if (seen.has(s.id)) continue; // cross-source dedupe by stable id
      seen.add(s.id);
      allSites.push(s);
    }

    console.log(`  ${rows.length} rows → ${sites.length} sites`);
    if (skippedNonCollectible) {
      console.log(`  skipped ${skippedNonCollectible} non-collectible/excluded rows`);
    }
    if (rejected.length) {
      totalRejected += rejected.length;
      console.warn(`  ⚠ ${rejected.length} rows REJECTED (not dropped silently):`);
      for (const r of rejected) {
        console.warn(`    - ${r.reason}: ${JSON.stringify(r.row).slice(0, 120)}`);
      }
    }
    totalSkipped += skippedNonCollectible;
  }

  // Type-frequency summary (rarity is derived at load in the app, not stored).
  const byCategory: Record<string, number> = {};
  for (const s of allSites) byCategory[s.category] = (byCategory[s.category] ?? 0) + 1;
  console.log('\nSites by inferred type:');
  for (const [type, n] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${SITE_TYPE_LABELS[type as Site['category']]}: ${n}`);
  }

  const outDir = resolve(root, 'public/data');
  mkdirSync(outDir, { recursive: true });
  const outFile = resolve(outDir, 'sites.json');
  writeFileSync(outFile, JSON.stringify(allSites, null, 0));

  console.log(
    `\n✓ Wrote ${allSites.length} sites to public/data/sites.json ` +
      `(${totalSkipped} skipped, ${totalRejected} rejected)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
