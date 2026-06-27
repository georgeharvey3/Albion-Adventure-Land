import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { useGeolocation } from '../state/useGeolocation';
import { MapView } from '../map/MapView';
import { NearMeList } from './NearMeList';
import { Filters } from './Filters';
import { SiteDetail } from './SiteDetail';

type Tab = 'near' | 'filters';

export function App() {
  const init = useStore((s) => s.init);
  const dataLoaded = useStore((s) => s.dataLoaded);
  const dataError = useStore((s) => s.dataError);
  const selectedSiteId = useStore((s) => s.selectedSiteId);
  const [tab, setTab] = useState<Tab>('filters');

  useEffect(() => {
    void init();
  }, [init]);

  useGeolocation();

  return (
    <div className="app">
      <MapView />

      {!dataLoaded && <div className="overlay">Loading sites…</div>}
      {dataError && (
        <div className="overlay error">
          Couldn't load site data: {dataError}. Run <code>npm run ingest</code>.
        </div>
      )}

      {selectedSiteId && <SiteDetail />}

      <div className="sheet">
        <nav className="tabs">
          <button className={tab === 'near' ? 'tab active' : 'tab'} onClick={() => setTab('near')}>
            Near me
          </button>
          <button
            className={tab === 'filters' ? 'tab active' : 'tab'}
            onClick={() => setTab('filters')}
          >
            Filters
          </button>
        </nav>
        <div className="sheet-body">
          {tab === 'near' && <NearMeList />}
          {tab === 'filters' && <Filters />}
        </div>
      </div>
    </div>
  );
}
