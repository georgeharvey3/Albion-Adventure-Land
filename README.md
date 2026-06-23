# Albion Adventure Land

An offline-first, installable PWA for **visiting** curated location pins across
Britain — folkloric and magical sites, holy wells, stone circles, wild swimming
spots, and more.

It is a *visiting companion*, not another pin store. Google My Maps and
travel-tracker apps display pins fine but can't do the active field loop this app
is built around:

> *"I'm here now — what's nearby, which have I not done, and how do I chain
> several into one outing?"*

## Why it exists

The collection lives as curated CSVs. This app layers the engagement loop on top:

- **Near me now** — your live location with every site sorted by distance,
  filterable by type, one tap to directions.
- **Visited / wishlist + completion stats** — turn a pile of pins into a
  collection with a shape and a finish line, including a nudge toward the rarer
  types you haven't seen yet.
- **Outing planner** *(later phase)* — group nearby sites and order them into an
  efficient day-out route, exported to Google Maps in one tap.

Built to work in **airplane mode** in no-signal rural Britain: after one online
session covering a region, the whole app keeps working offline for that region.

## Status

Early / pre-implementation. The design is settled; code is being built in phases.

| Phase | Scope | State |
|---|---|---|
| 1 — MVP | Ingest · map · type filter · near-me (haversine) · visited/wishlist · stats · directions handoff · offline | Not started |
| 2 — Accurate & personal | Road travel-time sort · condition filters · site detail with note + photo | Not started |
| 3 — Outing mode | Clustering (DBSCAN) · routing (NN + 2-opt) · rarity-weighted subset selection · multi-stop handoff | Not started |

## Tech stack

Vite · TypeScript · React · Leaflet · Papa Parse · IndexedDB (`idb`) · Workbox ·
Zustand. Geometry and routing are hand-rolled and dependency-free so everything
runs fully offline.

## Architecture in one breath

Client-only single-page PWA. Read-only **site data** (CSV → normalized JSON)
plus read-write **user state** (visited, wishlist, notes, photos, cached travel
matrices) in IndexedDB. Map tiles from OSM/MapTiler, cached offline. Turn-by-turn
navigation is delegated to Google Maps via deep links. No backend.

## Data

- `magical_britain_master.csv` — the first real source dataset (West Penwith /
  North Wales sites). CSVs are heterogeneous and messy (multi-line descriptions,
  per-source columns), so ingest uses a per-source mapping config and Papa Parse.
- User state is kept strictly separate from site data and keyed on a stable,
  derived site `id`, so re-importing a CSV never loses your visit history.

## Documentation

- [`britain-sites-app-spec.md`](./britain-sites-app-spec.md) — full implementation
  spec (the source of truth: goals, data model, algorithms, phases).
- [`CLAUDE.md`](./CLAUDE.md) — working conventions and invariants for contributors.

## Getting started

Project scaffolding is not in place yet. Once the Vite app lands, the usual
`npm install` / `npm run dev` will apply; this section will be filled in then.
