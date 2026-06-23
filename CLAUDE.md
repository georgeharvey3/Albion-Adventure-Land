# CLAUDE.md

Guidance for working in this repo. The authoritative design document is
[`britain-sites-app-spec.md`](./britain-sites-app-spec.md) — read it before making
non-trivial decisions. This file captures the conventions and invariants that
the spec implies but doesn't spell out for day-to-day work.

## What this is

An offline-first, client-only **PWA** for visiting curated location pins across
Britain (folkloric/magical sites, wild swimming, etc.). It is a *visiting
companion*, not a pin-authoring or navigation tool. The whole point is the field
loop: "I'm here now — what's nearby, which have I not done, and how do I chain
several into one outing."

The two features that must never be cut (the product's core principle):

1. **Near me now** — live location, every site sorted by distance, type-filterable, one tap to directions.
2. **Visited / wishlist state with completion stats** — turns a viewer into a collection with a finish line.

If a feature doesn't serve "visit more, and more varied, sites," it's a candidate for cutting.

## Architecture (do not drift from this)

- **Client-only. No backend** for the full MVP and Phase 2. A server buys *only*
  cross-device visited-state sync, and that is deferred until the friction is felt.
- **Offline-first is a hard requirement**, not a nice-to-have — the target use is
  no-signal rural Britain. The mental test: after one online session covering a
  region, the app must be fully functional in airplane mode for that region.
- Single SPA. No SSR, no heavy router (a tiny hash router at most).

## Tech stack

Vite + TypeScript · React (Svelte acceptable — decide once, §11) · Leaflet ·
Papa Parse (CSV) · IndexedDB via `idb` · Workbox (service worker) · Zustand
(state). Geometry/routing is **hand-rolled and dependency-free** (haversine, NN +
2-opt, DBSCAN, orienteering) so it runs fully offline. See spec §4 and §7.

## Data model — the critical invariant

**Site data is replaceable; user state is precious. Keep them strictly separated.**

- `Site` is read-only, derived from CSV → normalized JSON. Its `id` is **stable
  and derived** (`slug(name) + rounded(lat,lng)`). Never key user state on
  anything that changes when a CSV is re-imported.
- `UserState` (visited, wishlist, notes, photos, cached matrices) lives in
  IndexedDB, keyed by the stable site `id`. This is the data we must never lose.
- `rarity` is **not stored** — it is derived at load time from `type` frequency
  across the dataset (spec §7.4).
- `SiteType` is a controlled vocabulary mapped at ingest, *not* a raw CSV value.

## CSV ingest — read before touching `data/`

- CSVs are heterogeneous (different guidebooks, column names, some with OS grid
  refs instead of lat/lng). Handle this with a **per-source `SourceMapping`
  config**, not bespoke parsers. One mapping file per CSV under `data/mappings/`.
- **Use Papa Parse, never naive splitting.** The real data has multi-line
  description fields with embedded commas and newlines — `cut`/`split(',')` will
  corrupt rows. (You can see this in `magical_britain_master.csv`.)
- In `magical_britain_master.csv`, `point_type` encodes the *structural role* of
  a row (`main`, `trailhead`, `trailhead_parking`, `nearby_feature`), and the
  human site name is in `point_name`. This is **not** the `SiteType` vocab — map
  accordingly. A `listing` groups a main point with its trailheads/features.
- Pipeline: read → apply mapping → (OSGB grid ref → WGS84 if needed) → validate
  (lat/lng present and in range) → dedupe by `id` → emit normalized JSON.
  **Log rows that fail validation; never drop them silently.** Unnamed /
  uncoordinated rows are the classic import failure — flag them.
- Only build the OSGB→WGS84 step if a source actually needs it (this CSV carries
  both lat/lng and `os_grid_ref`, so conversion is currently unnecessary).

## Build order (each phase independently shippable)

- **Phase 1 (MVP):** ingest → map view (pins by type) → type filter → near-me
  (haversine) → visited/wishlist → completion stats → single-site Google Maps
  deep link → PWA/offline.
- **Phase 2:** travel-time sort (cached road-time matrix) → condition filters →
  site detail + log (note + photo as IndexedDB blob). Add user-state export/import.
- **Phase 3:** anchor/density grouping (DBSCAN) → route within group (NN + 2-opt)
  → orienteering subset selection (rarity-weighted) → multi-stop Maps handoff.

Build in order; each phase has explicit acceptance criteria in spec §6. Don't
pull Phase 3 work forward before the MVP loop is usable on a real outing.

## Conventions

- Suggested layout is in spec §10 (`src/{data,state,geo,map,ui,links}`,
  `public/data`). Follow it unless there's a concrete reason not to.
- Abstract the routing engine behind one `getMatrix(points): Promise<number[][]>`
  so it's swappable (ORS / OSRM / Google). Cache matrices in IndexedDB keyed by
  the rounded coordinate set.
- Google Maps handoff is deep-link only (no embedded directions). Verify the
  current multi-waypoint cap before relying on it; chunk if a route exceeds it.

## Working agreements

- Keep dependencies minimal — the offline/bundle-size story is a feature.
- Don't introduce a backend, SSR, or a state-management framework heavier than
  Zustand without raising it first.
- When the spec lists an open decision (§11: sync, routing engine, photo storage,
  React vs Svelte), surface it rather than silently picking.
