import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';
import { makePubId, slug, type RawRow, type PubEnrichment } from '../src/data/ingest.ts';
import { normalizePostcode } from './geocode.ts';
import { camraMapping } from '../src/data/mappings/camra.ts';

// Build-time CAMRA scraper. Enriches the sparse pub rows in CAMRA.csv with the
// general "Description" write-up from each pub's page on the CAMRA Heritage Pubs
// site (NOT the Historic Interest tab), plus a link back to that page
// (attribution). Like geocode.ts this is the
// only place the build touches the network — results are cached on disk
// (data/camra-descriptions.json), keyed by the STABLE pub id, so the app stays
// fully offline and re-runs are cheap and resumable.
//
// Matching is easy because CAMRA.csv was itself derived from the National
// Inventory listing table, which carries the same Name/Postcode columns AND a
// link to each pub's page. We parse that table, pair our CSV rows to it by
// postcode (+ name when a postcode is shared), then fetch each pub page.
//
// Content belongs to CAMRA; we store the description for personal/offline use
// and always link back to the source page. Re-run with --force to re-fetch all.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(root, 'data');
const OUT_FILE = resolve(OUT_DIR, 'camra-descriptions.json');
const LISTING_URL = 'https://camra.org.uk/heritage-pubs/national-inventory';
const UA = 'Mozilla/5.0 (compatible; albion-adventure-land/0.1; build-time enrichment)';
const DELAY_MS = 400; // be polite between pub-page fetches
const FORCE = process.argv.includes('--force');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  return res.text();
}

// Named entities seen in the CAMRA prose (typographic punctuation, £, accents),
// plus the structural few. Numeric entities (&#NNN; / &#xNN;) are handled below.
const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'",
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  hellip: '…', ndash: '–', mdash: '—', pound: '£',
  eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç',
  acirc: 'â', ecirc: 'ê', ocirc: 'ô', uuml: 'ü',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X'
        ? parseInt(code.slice(2), 16)
        : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code] ?? m;
  });
}

// HTML fragment → plain text, preserving paragraph breaks. The build script
// owns this (CLAUDE.md: parsers for CSV; the scraped HTML here is a small, stable
// structure so a targeted regex strip is adequate and dependency-free).
function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/\s*p\s*>/gi, '\n\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface ListingRow {
  name: string;
  postcode: string; // normalized
  url: string;
}

// Parse the National Inventory table into rows. Each <tr> has cells
// [grading, country, area, town, postcode, name-as-link]; we only need 3-star
// rows (everything in our CSV is 3-star) with a pub link.
function parseListing(html: string): ListingRow[] {
  const rows: ListingRow[] = [];
  const trRe = /<tr>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = trRe.exec(html))) {
    const tr = m[1];
    if (!/3-star/.test(tr)) continue;
    const link = /href="(https:\/\/camra\.org\.uk\/pubs\/[^"]+)"[^>]*title="View ([^"]+)"/.exec(tr);
    if (!link) continue;
    const pc = /\b([A-Z]{1,2}\d[A-Z\d]?) ?(\d[A-Z]{2})\b/.exec(tr);
    if (!pc) continue;
    rows.push({
      url: link[1],
      name: decodeEntities(link[2]).trim(),
      postcode: normalizePostcode(`${pc[1]} ${pc[2]}`),
    });
  }
  return rows;
}

// We want the general "Description" tab only — NOT the "Historic Interest" tab
// (Grade II / architectural detail). The page is an Alpine.js tabset: the
// description panel is `activeTab === 0`, the historic-interest one `=== 2`. Each
// panel's prose sits in a `keep-formatting` div, so we take the block whose
// immediately preceding markup marks it as the description panel. (The
// description tab has no "read full" expander — this block is the full text.)
const KEEP_FMT = /<div class="keep-formatting[^"]*">([\s\S]*?)<\/div>/g;
const DESC_PANEL = 'activeTab === 0';

function extractDescription(html: string): string {
  KEEP_FMT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = KEEP_FMT.exec(html))) {
    const before = html.slice(Math.max(0, m.index - 260), m.index);
    if (before.includes(DESC_PANEL)) {
      const text = htmlToText(m[1]);
      if (text) return text;
    }
  }
  return '';
}

function loadCache(): Record<string, PubEnrichment> {
  if (!existsSync(OUT_FILE)) return {};
  try {
    return JSON.parse(readFileSync(OUT_FILE, 'utf8')) as Record<string, PubEnrichment>;
  } catch {
    console.warn('  ⚠ existing camra-descriptions.json unreadable, starting fresh');
    return {};
  }
}

function save(data: Record<string, PubEnrichment>): void {
  mkdirSync(OUT_DIR, { recursive: true });
  const ordered: Record<string, PubEnrichment> = {};
  for (const key of Object.keys(data).sort()) ordered[key] = data[key];
  writeFileSync(OUT_FILE, JSON.stringify(ordered, null, 2) + '\n');
}

async function main(): Promise<void> {
  // 1. Read the canonical pub list (same rows ingest turns into sites).
  const csv = readFileSync(resolve(root, 'CAMRA.csv'), 'utf8');
  const pubs = Papa.parse<RawRow>(csv, { header: true, skipEmptyLines: 'greedy' }).data
    .map((r) => ({
      name: (r[camraMapping.columns.name!] ?? '').trim(),
      postcode: (r[camraMapping.columns.postcode!] ?? '').trim(),
      country: (r['Country'] ?? '').trim(),
    }))
    .filter((p) => p.name && p.postcode)
    .filter((p) => !camraMapping.exclude?.values.includes(p.country)); // drop NI like ingest

  // 2. Fetch + parse the listing table → postcode index of {name, url}.
  console.log(`Fetching National Inventory listing …`);
  const listing = parseListing(await getText(LISTING_URL));
  console.log(`  parsed ${listing.length} three-star listing rows`);
  const byPostcode = new Map<string, ListingRow[]>();
  for (const row of listing) {
    const arr = byPostcode.get(row.postcode) ?? [];
    arr.push(row);
    byPostcode.set(row.postcode, arr);
  }

  // 3. Match each CSV pub to a listing row → resolve its pub-page URL.
  const cache = loadCache();
  const unmatched: string[] = [];
  const toFetch: { id: string; url: string; label: string }[] = [];
  for (const pub of pubs) {
    const id = makePubId(pub.name, pub.postcode);
    const candidates = byPostcode.get(normalizePostcode(pub.postcode)) ?? [];
    const match =
      candidates.length === 1
        ? candidates[0]
        : candidates.find((c) => slug(c.name) === slug(pub.name));
    if (!match) {
      unmatched.push(`${pub.name} (${pub.postcode})`);
      continue;
    }
    if (!FORCE && cache[id]?.description) continue; // resume: already have it
    toFetch.push({ id, url: match.url, label: `${pub.name} (${pub.postcode})` });
  }

  console.log(
    `\n${pubs.length} pubs · ${pubs.length - unmatched.length} matched · ` +
      `${unmatched.length} unmatched · ${toFetch.length} to fetch` +
      `${FORCE ? ' (--force)' : ''}`,
  );

  // 4. Fetch each pub page, extract the historic-interior description.
  let ok = 0;
  const empty: string[] = [];
  for (let i = 0; i < toFetch.length; i++) {
    const { id, url, label } = toFetch[i];
    try {
      const desc = extractDescription(await getText(url));
      if (!desc) {
        delete cache[id]; // re-fetched and found nothing → drop any stale entry
        empty.push(label);
      } else {
        cache[id] = { description: desc, sourceUrl: url };
        ok++;
      }
      process.stdout.write(`\r  fetched ${i + 1}/${toFetch.length}  `);
    } catch (err) {
      console.warn(`\n  ⚠ failed ${label}: ${(err as Error).message}`);
    }
    save(cache); // incremental — a crash never loses progress
    if (i < toFetch.length - 1) await sleep(DELAY_MS);
  }

  // 5. Report. Never silent: unmatched and empty pubs are listed so they can be
  // chased up; they simply keep the sparse card meanwhile.
  console.log(`\n\n✓ ${ok} descriptions written to data/camra-descriptions.json`);
  console.log(`  total cached: ${Object.keys(cache).length}`);
  if (empty.length) {
    console.warn(`  ⚠ ${empty.length} pages had no interior description:`);
    for (const e of empty) console.warn(`    - ${e}`);
  }
  if (unmatched.length) {
    console.warn(`  ⚠ ${unmatched.length} pubs not found in the listing table:`);
    for (const u of unmatched) console.warn(`    - ${u}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
