import { create } from 'zustand';
import type { Site, SiteCategory } from '../data/types';
import { SITE_TYPES } from '../data/types';
import { buildRarityIndex, type RarityIndex } from '../geo/rarity';
import {
  loadUserState,
  putVisit,
  deleteVisit,
  addWishlist,
  removeWishlist,
  type VisitLog,
} from './db';

export interface Position {
  lat: number;
  lng: number;
  accuracy: number; // metres
  manual: boolean; // true if dropped by the user (geolocation fallback)
}

interface AppState {
  // Site data (read-only).
  sites: Site[];
  rarity: RarityIndex | null;
  dataLoaded: boolean;
  dataError: string | null;

  // User state (mirrors IndexedDB).
  visited: Record<string, VisitLog>;
  wishlist: Set<string>;
  userLoaded: boolean;

  // Filters.
  activeTypes: Set<SiteCategory>;

  // Geolocation.
  position: Position | null;
  geoError: string | null;

  // UI: the site shown in the detail card (map popup / list tap).
  selectedSiteId: string | null;

  // Actions.
  init: () => Promise<void>;
  setSelected: (siteId: string | null) => void;
  toggleType: (category: SiteCategory) => void;
  setTypesActive: (categories: SiteCategory[], on: boolean) => void;
  setAllTypes: (on: boolean) => void;
  markVisited: (siteId: string, note?: string) => Promise<void>;
  unmarkVisited: (siteId: string) => Promise<void>;
  toggleWishlist: (siteId: string) => Promise<void>;
  setPosition: (pos: Position | null) => void;
  setGeoError: (msg: string | null) => void;
}

export const useStore = create<AppState>((set, get) => ({
  sites: [],
  rarity: null,
  dataLoaded: false,
  dataError: null,

  visited: {},
  wishlist: new Set(),
  userLoaded: false,

  activeTypes: new Set(SITE_TYPES),

  position: null,
  geoError: null,

  selectedSiteId: null,

  init: async () => {
    // Load site data and user state in parallel; they're independent.
    const sitesPromise = fetch(`${import.meta.env.BASE_URL}data/sites.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<Site[]>;
      })
      .then((sites) => {
        set({ sites, rarity: buildRarityIndex(sites), dataLoaded: true });
      })
      .catch((err: unknown) => {
        set({ dataError: err instanceof Error ? err.message : String(err), dataLoaded: true });
      });

    const userPromise = loadUserState()
      .then(({ visited, wishlist }) => {
        set({ visited, wishlist: new Set(wishlist), userLoaded: true });
      })
      .catch(() => {
        // Fresh state if IndexedDB is unavailable; app still works read-only.
        set({ userLoaded: true });
      });

    await Promise.all([sitesPromise, userPromise]);
  },

  toggleType: (category) => {
    const next = new Set(get().activeTypes);
    if (next.has(category)) next.delete(category);
    else next.add(category);
    set({ activeTypes: next });
  },

  // Bulk-toggle a group of leaf types (used by the parent-category toggle).
  setTypesActive: (categories, on) => {
    const next = new Set(get().activeTypes);
    for (const c of categories) {
      if (on) next.add(c);
      else next.delete(c);
    }
    set({ activeTypes: next });
  },

  setAllTypes: (on) => {
    set({ activeTypes: on ? new Set(SITE_TYPES) : new Set() });
  },

  markVisited: async (siteId, note) => {
    const log: VisitLog = {
      siteId,
      visitedAt: new Date().toISOString(),
      ...(note ? { note } : {}),
    };
    await putVisit(log);
    set({ visited: { ...get().visited, [siteId]: log } });
    // Marking visited clears it from the wishlist.
    if (get().wishlist.has(siteId)) {
      await removeWishlist(siteId);
      const w = new Set(get().wishlist);
      w.delete(siteId);
      set({ wishlist: w });
    }
  },

  unmarkVisited: async (siteId) => {
    await deleteVisit(siteId);
    const visited = { ...get().visited };
    delete visited[siteId];
    set({ visited });
  },

  toggleWishlist: async (siteId) => {
    const w = new Set(get().wishlist);
    if (w.has(siteId)) {
      await removeWishlist(siteId);
      w.delete(siteId);
    } else {
      await addWishlist(siteId);
      w.add(siteId);
    }
    set({ wishlist: w });
  },

  setPosition: (position) => set({ position, geoError: null }),
  setGeoError: (geoError) => set({ geoError }),
  setSelected: (selectedSiteId) => set({ selectedSiteId }),
}));
