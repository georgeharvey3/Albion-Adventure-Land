import { useStore } from '../state/store';
import {
  SITE_TYPES,
  SITE_TYPE_COLORS,
  SITE_TYPE_LABELS,
  PARENT_CATEGORIES,
  PARENT_CATEGORY_LABELS,
  parentOf,
  type SiteCategory,
} from '../data/types';

// Type filter (spec F3): toggle site types on/off; affects both map and list.
// Two-level taxonomy. Each top-level layer (Folklore, Historic pubs) leads with a
// prominent switch that turns the whole layer on/off — that's the primary control.
// A layer with real subcategories (Folklore) then lists its child chips beneath
// the switch for finer control; a single-leaf layer (Historic pubs) has none.
// Only types present in the loaded dataset are shown.

export function Filters() {
  const sites = useStore((s) => s.sites);
  const activeTypes = useStore((s) => s.activeTypes);
  const toggleType = useStore((s) => s.toggleType);
  const setTypesActive = useStore((s) => s.setTypesActive);

  const counts = new Map<SiteCategory, number>();
  for (const s of sites) counts.set(s.category, (counts.get(s.category) ?? 0) + 1);

  // Leaves present in the dataset, grouped by parent (dataset order via SITE_TYPES).
  const layers = PARENT_CATEGORIES.map((parent) => ({
    parent,
    leaves: SITE_TYPES.filter((t) => counts.has(t) && parentOf(t) === parent),
  })).filter((g) => g.leaves.length > 0);

  return (
    <div className="filters">
      {layers.map(({ parent, leaves }) => {
        const groupCount = leaves.reduce((n, t) => n + (counts.get(t) ?? 0), 0);
        const activeCount = leaves.filter((t) => activeTypes.has(t)).length;
        const allOn = activeCount === leaves.length;
        const noneOn = activeCount === 0;
        // A single-leaf parent (e.g. Historic pubs) has no finer subcategories.
        const hasSubs = !(leaves.length === 1 && (leaves[0] as string) === parent);

        return (
          <section className="layer" key={parent}>
            <button
              className={`layer-toggle ${allOn ? 'on' : noneOn ? 'off' : 'mixed'}`}
              onClick={() => setTypesActive(leaves, !allOn)}
              aria-pressed={allOn}
            >
              <span className="layer-name">{PARENT_CATEGORY_LABELS[parent]}</span>
              <span className="layer-count">
                {allOn || !hasSubs ? groupCount : `${activeCount}/${leaves.length} types`}
              </span>
              <span className="switch" aria-hidden="true" />
            </button>

            {hasSubs && (
              <div className="layer-subs">
                <div className="subs-controls">
                  <button
                    className="link-btn"
                    onClick={() => setTypesActive(leaves, true)}
                    disabled={allOn}
                  >
                    Select all
                  </button>
                  <button
                    className="link-btn"
                    onClick={() => setTypesActive(leaves, false)}
                    disabled={noneOn}
                  >
                    Deselect all
                  </button>
                </div>
                {leaves.map((type) => {
                  const on = activeTypes.has(type);
                  return (
                    <button
                      key={type}
                      className={`chip ${on ? 'on' : 'off'}`}
                      onClick={() => toggleType(type)}
                      aria-pressed={on}
                    >
                      <span className="dot" style={{ background: SITE_TYPE_COLORS[type] }} />
                      {SITE_TYPE_LABELS[type]}
                      <span className="chip-count">{counts.get(type)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
