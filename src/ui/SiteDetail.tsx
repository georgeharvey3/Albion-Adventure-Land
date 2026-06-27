import { useStore } from '../state/store';
import { SITE_TYPE_COLORS, SITE_TYPE_LABELS } from '../data/types';
import { formatDistance, haversine } from '../geo/haversine';
import { directionsToSite } from '../links/googleMaps';

// Selected-site card (map pin / list tap). MVP shows metadata, visited/wishlist
// toggles, and the single-site Google Maps directions handoff (spec F5, F7).
// A fuller per-site page with note + photo arrives in Phase 2 (F11).

export function SiteDetail() {
  const selectedSiteId = useStore((s) => s.selectedSiteId);
  const site = useStore((s) => s.sites.find((x) => x.id === s.selectedSiteId));
  const position = useStore((s) => s.position);
  const visited = useStore((s) => (selectedSiteId ? s.visited[selectedSiteId] : undefined));
  const wishlisted = useStore((s) => (selectedSiteId ? s.wishlist.has(selectedSiteId) : false));
  const setSelected = useStore((s) => s.setSelected);
  const markVisited = useStore((s) => s.markVisited);
  const unmarkVisited = useStore((s) => s.unmarkVisited);
  const toggleWishlist = useStore((s) => s.toggleWishlist);

  if (!site) return null;

  const distance = position ? haversine(position, site) : null;

  return (
    <div className="card" role="dialog" aria-label={site.name}>
      <button className="card-close" onClick={() => setSelected(null)} aria-label="Close">
        ×
      </button>
      <div className="card-type">
        <span className="dot" style={{ background: SITE_TYPE_COLORS[site.category] }} />
        {SITE_TYPE_LABELS[site.category]}
        {site.county ? ` · ${site.county}` : ''}
        {distance !== null ? ` · ${formatDistance(distance)} away` : ''}
      </div>
      <h2 className="card-title">{site.name}</h2>
      {visited && <div className="badge visited">✓ Visited {visited.visitedAt.slice(0, 10)}</div>}
      {wishlisted && !visited && <div className="badge wish">★ Wishlist</div>}
      {site.access && <p className="card-meta">Access: {site.access}</p>}
      {site.description && <p className="card-desc">{site.description}</p>}

      <div className="card-actions">
        <a
          className="btn primary"
          href={directionsToSite(site, position?.manual ? position : undefined)}
          target="_blank"
          rel="noreferrer"
        >
          Directions ↗
        </a>
        {visited ? (
          <button className="btn" onClick={() => unmarkVisited(site.id)}>
            Unmark visited
          </button>
        ) : (
          <button className="btn" onClick={() => markVisited(site.id)}>
            Mark visited
          </button>
        )}
        <button className="btn" onClick={() => toggleWishlist(site.id)}>
          {wishlisted ? '★ On wishlist' : '☆ Wishlist'}
        </button>
      </div>
    </div>
  );
}
