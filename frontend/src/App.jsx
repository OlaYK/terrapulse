import { useCallback, useState } from 'react'
import clsx from 'clsx'
import { Activity, ChevronLeft, ChevronRight, Globe2, Layers, Map, Satellite } from 'lucide-react'

import ChangePanel from './components/ChangeDetection/ChangePanel'
import LocationPanel from './components/Controls/LocationPanel'
import ScenePicker from './components/Controls/ScenePicker'
import MapView from './components/Map/MapView'
import { isValidBbox } from './utils/geo'
import { readSharedState } from './utils/share'

const SIDEBAR_TABS = [
  { id: 'location', icon: Globe2, label: 'Location' },
  { id: 'scenes', icon: Satellite, label: 'Scenes' },
  { id: 'change', icon: Activity, label: 'Analyse' },
]

export default function App() {
  const [initialState] = useState(() => parseInitialState())
  const [mapBbox, setMapBbox] = useState(initialState.bbox)
  const [mapCenter, setMapCenter] = useState(initialState.center)
  const [mapZoom, setMapZoom] = useState(initialState.zoom)
  const [viewTarget, setViewTarget] = useState(initialState.viewTarget)
  const [sceneA, setSceneA] = useState(initialState.sceneA)
  const [sceneB, setSceneB] = useState(initialState.sceneB)
  const [changeOverlay, setChangeOverlay] = useState(null)
  const [overlayBbox, setOverlayBbox] = useState(null)
  const [activeTab, setActiveTab] = useState(initialState.activeTab)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const handleBoundsChange = useCallback(({ bbox, center, zoom }) => {
    setMapBbox(bbox)
    setMapCenter(center)
    setMapZoom(zoom)
  }, [])

  const handleLocationSelect = useCallback((location) => {
    setViewTarget({
      center: location.center,
      zoom: location.zoom || 12,
      bbox: location.bbox,
      key: `${location.name}-${Date.now()}`,
    })
    setMapBbox(location.bbox)
    setChangeOverlay(null)
    setOverlayBbox(null)
    setActiveTab('scenes')
  }, [])

  const handleSceneASelect = useCallback((scene) => {
    setSceneA(scene)
    setChangeOverlay(null)
    setOverlayBbox(null)
  }, [])

  const handleSceneBSelect = useCallback((scene) => {
    setSceneB(scene)
    setChangeOverlay(null)
    setOverlayBbox(null)
    setActiveTab('change')
  }, [])

  const handleOverlayReady = useCallback((overlayUrl) => {
    setChangeOverlay(overlayUrl)
    setOverlayBbox(mapBbox)
  }, [mapBbox])

  const handleClearOverlay = useCallback(() => {
    setChangeOverlay(null)
    setOverlayBbox(null)
  }, [])

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><Layers size={15} /></span>
          <span className="brand-title">TerraPulse</span>
          <span className="brand-subtitle">Earth Change Observatory</span>
        </div>

        <div className="status-strip" aria-live="polite">
          {sceneA && <StatusPill tone="before">Before {sceneA.datetime || sceneA.id}</StatusPill>}
          {sceneB && <StatusPill tone="after">After {sceneB.datetime || sceneB.id}</StatusPill>}
          {changeOverlay && <StatusPill tone="analysis">Analysis active</StatusPill>}
        </div>

        <div className="topbar-actions">
          <span className="source-chip">Sentinel-2 L2A</span>
          <button className="icon-text-button" onClick={() => setSidebarOpen((value) => !value)}>
            {sidebarOpen ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            <span>{sidebarOpen ? 'Hide' : 'Show'}</span>
          </button>
        </div>
      </header>

      <main className="workspace">
        <section className="map-stage" aria-label="Satellite comparison map">
          <MapView
            sceneA={sceneA}
            sceneB={sceneB}
            changeOverlay={changeOverlay}
            bbox={overlayBbox}
            onBoundsChange={handleBoundsChange}
            viewTarget={viewTarget}
          />
          <div className="map-coordinate-chip">
            <Map size={13} />
            <span>
              {mapBbox
                ? `${mapBbox[1].toFixed(3)}, ${mapBbox[0].toFixed(3)}`
                : 'Loading area'}
            </span>
          </div>
        </section>

        <aside className={clsx('sidebar', !sidebarOpen && 'sidebar-closed')}>
          <nav className="tab-rail" aria-label="Workspace tabs">
            {SIDEBAR_TABS.map((tab) => {
              const Icon = tab.icon
              const active = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  className={clsx('tab-button', active && 'tab-button-active')}
                  onClick={() => setActiveTab(tab.id)}
                  title={tab.label}
                  aria-label={tab.label}
                >
                  <Icon size={17} />
                  <span>{tab.label.slice(0, 3).toUpperCase()}</span>
                </button>
              )
            })}
          </nav>

          <div className="panel-frame">
            {activeTab === 'location' && (
              <LocationPanel onLocationSelect={handleLocationSelect} />
            )}
            {activeTab === 'scenes' && (
              <ScenePicker
                bbox={mapBbox}
                sceneA={sceneA}
                sceneB={sceneB}
                onSceneASelect={handleSceneASelect}
                onSceneBSelect={handleSceneBSelect}
              />
            )}
            {activeTab === 'change' && (
              <ChangePanel
                sceneA={sceneA}
                sceneB={sceneB}
                bbox={mapBbox}
                initialAnalysis={initialState.analysis}
                onOverlayReady={handleOverlayReady}
                onClear={handleClearOverlay}
              />
            )}
          </div>
        </aside>
      </main>
    </div>
  )
}

function StatusPill({ children, tone }) {
  return <span className={clsx('status-pill', `status-${tone}`)}>{children}</span>
}

function parseInitialState() {
  const fallback = {
    bbox: null,
    center: [8.675, 9.082],
    zoom: 6,
    viewTarget: null,
    sceneA: null,
    sceneB: null,
    analysis: null,
    activeTab: 'location',
  }

  const shared = readSharedState()
  if (!shared) return fallback

  const bbox = isValidBbox(shared.bbox) ? shared.bbox : null
  const center = bbox
    ? [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]
    : fallback.center

  return {
    bbox,
    center,
    zoom: Number.isFinite(shared.zoom) ? shared.zoom : fallback.zoom,
    viewTarget: bbox
      ? { bbox, center, zoom: Number.isFinite(shared.zoom) ? shared.zoom : 12, key: 'shared-state' }
      : null,
    sceneA: sanitizeScene(shared.sceneA),
    sceneB: sanitizeScene(shared.sceneB),
    analysis: shared.analysis || null,
    activeTab: shared.sceneA && shared.sceneB ? 'change' : fallback.activeTab,
  }
}

function sanitizeScene(scene) {
  if (!scene?.id) return null
  return {
    id: scene.id,
    datetime: scene.datetime || null,
    cloud_cover: Number.isFinite(scene.cloud_cover) ? scene.cloud_cover : null,
    bbox: isValidBbox(scene.bbox) ? scene.bbox : [],
    thumbnail_url: scene.thumbnail_url || null,
    stac_url: scene.stac_url || '',
    platform: scene.platform || null,
    tile_url_template: scene.tile_url_template || '',
  }
}
