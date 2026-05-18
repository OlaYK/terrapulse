import { useCallback, useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'

import { buildStacUrl, buildTileUrl } from '../../services/api'

const DEFAULT_CENTER = [8.675, 9.082]
const DEFAULT_ZOOM = 6

const IMAGE_STYLE = {
  version: 8,
  sources: {},
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#0b1117' },
    },
  ],
}

export default function MapView({
  sceneA,
  sceneB,
  changeOverlay,
  bbox,
  onBoundsChange,
  viewTarget,
}) {
  const beforeContainerRef = useRef(null)
  const afterContainerRef = useRef(null)
  const beforeMapRef = useRef(null)
  const afterMapRef = useRef(null)
  const tileTimersRef = useRef({})
  const [tileStatus, setTileStatus] = useState({ before: 'idle', after: 'idle' })

  const emitBounds = useCallback(() => {
    const map = afterMapRef.current
    if (!map) return
    const bounds = map.getBounds()
    onBoundsChange?.({
      bbox: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
      center: [map.getCenter().lng, map.getCenter().lat],
      zoom: map.getZoom(),
    })
  }, [onBoundsChange])

  useEffect(() => {
    if (!beforeContainerRef.current || !afterContainerRef.current) return

    const beforeMap = new maplibregl.Map({
      container: beforeContainerRef.current,
      style: cloneStyle(),
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      maxZoom: 17,
      attributionControl: false,
      interactive: false,
    })

    const afterMap = new maplibregl.Map({
      container: afterContainerRef.current,
      style: cloneStyle(),
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      maxZoom: 17,
      attributionControl: false,
    })

    const syncBefore = () => {
      beforeMap.jumpTo({
        center: afterMap.getCenter(),
        zoom: afterMap.getZoom(),
        bearing: afterMap.getBearing(),
        pitch: afterMap.getPitch(),
      })
    }

    afterMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    afterMap.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right')

    afterMap.on('move', syncBefore)
    afterMap.on('moveend', emitBounds)
    afterMap.on('load', emitBounds)

    beforeMapRef.current = beforeMap
    afterMapRef.current = afterMap

    return () => {
      afterMap.off('move', syncBefore)
      afterMap.off('moveend', emitBounds)
      beforeMap.remove()
      afterMap.remove()
      beforeMapRef.current = null
      afterMapRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const beforeMap = beforeMapRef.current
    const afterMap = afterMapRef.current
    if (!beforeMap || !afterMap || !viewTarget) return

    if (isValidBbox(viewTarget.bbox)) {
      const [west, south, east, north] = viewTarget.bbox
      const bounds = new maplibregl.LngLatBounds([west, south], [east, north])
      const options = {
        padding: { top: 64, bottom: 64, left: 64, right: 64 },
        duration: 900,
        maxZoom: Math.max(viewTarget.zoom || 12, 12),
      }
      beforeMap.fitBounds(bounds, options)
      afterMap.fitBounds(bounds, options)
      return
    }

    const options = {
      center: viewTarget.center,
      zoom: viewTarget.zoom || 12,
      duration: 900,
    }
    beforeMap.flyTo(options)
    afterMap.flyTo(options)
  }, [viewTarget?.key]) // eslint-disable-line react-hooks/exhaustive-deps

  const addSatelliteLayer = useCallback((map, scene, layerId, statusKey) => {
    if (!map) return
    const sourceId = `${layerId}-source`

    const apply = () => {
      if (map.getLayer(layerId)) map.removeLayer(layerId)
      if (map.getSource(sourceId)) map.removeSource(sourceId)
      window.clearTimeout(tileTimersRef.current[statusKey])
      if (!scene) {
        setTileStatus((current) => ({ ...current, [statusKey]: 'idle' }))
        return
      }

      const tileUrl = scene.tile_url_template || buildTileUrl(buildStacUrl(scene.id))
      setTileStatus((current) => ({ ...current, [statusKey]: 'loading' }))
      tileTimersRef.current[statusKey] = window.setTimeout(() => {
        setTileStatus((current) => (
          current[statusKey] === 'loading' ? { ...current, [statusKey]: 'slow' } : current
        ))
      }, 9000)

      map.addSource(sourceId, {
        type: 'raster',
        tiles: [tileUrl],
        tileSize: 256,
        minzoom: 4,
        maxzoom: 16,
        ...(isValidBbox(scene.bbox) ? { bounds: scene.bbox } : {}),
      })
      map.addLayer({
        id: layerId,
        type: 'raster',
        source: sourceId,
        paint: {
          'raster-opacity': 1,
          'raster-fade-duration': 180,
          'raster-resampling': 'linear',
        },
      })

      map.once('idle', () => {
        window.clearTimeout(tileTimersRef.current[statusKey])
        setTileStatus((current) => ({ ...current, [statusKey]: 'ready' }))
      })
    }

    if (map.isStyleLoaded()) apply()
    else map.once('load', apply)
  }, [])

  useEffect(() => {
    addSatelliteLayer(beforeMapRef.current, sceneA, 'satellite-before', 'before')
  }, [sceneA, addSatelliteLayer])

  useEffect(() => {
    addSatelliteLayer(afterMapRef.current, sceneB, 'satellite-after', 'after')
  }, [sceneB, addSatelliteLayer])

  useEffect(() => {
    const map = afterMapRef.current
    if (!map) return

    const apply = () => {
      if (map.getLayer('change-overlay')) map.removeLayer('change-overlay')
      if (map.getSource('change-overlay-source')) map.removeSource('change-overlay-source')
      if (!changeOverlay || !isValidBbox(bbox)) return

      try {
        const [west, south, east, north] = bbox
        map.addSource('change-overlay-source', {
          type: 'image',
          url: changeOverlay,
          coordinates: [
            [west, north],
            [east, north],
            [east, south],
            [west, south],
          ],
        })
        map.addLayer({
          id: 'change-overlay',
          type: 'raster',
          source: 'change-overlay-source',
          paint: {
            'raster-opacity': 0.56,
            'raster-fade-duration': 250,
          },
        })
      } catch (error) {
        console.error('Could not render change overlay', error)
      }
    }

    if (map.isStyleLoaded()) apply()
    else map.once('load', apply)
  }, [changeOverlay, bbox])

  return (
    <div className="compare-map compare-map-split">
      <section className="map-pane" aria-label="Before satellite image">
        <div ref={beforeContainerRef} className="map-canvas" />
        {sceneA && <SceneLabel label="BEFORE" scene={sceneA} />}
        {sceneA && <TileStatus status={tileStatus.before} label="before" />}
        {!sceneA && <PanePlaceholder label="Before" />}
      </section>

      <section className="map-pane" aria-label="After satellite image">
        <div ref={afterContainerRef} className="map-canvas" />
        {sceneB && <SceneLabel label="AFTER" scene={sceneB} />}
        {sceneB && <TileStatus status={tileStatus.after} label="after" />}
        {!sceneB && <PanePlaceholder label="After" />}
      </section>

      <div className="side-by-side-divider" aria-hidden="true" />

      {!sceneA && !sceneB && (
        <div className="empty-map-state">
          <strong>No scenes loaded</strong>
          <span>Select an area and load before/after scenes.</span>
        </div>
      )}
    </div>
  )
}

function cloneStyle() {
  return JSON.parse(JSON.stringify(IMAGE_STYLE))
}

function isValidBbox(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return false
  const [west, south, east, north] = bbox
  return Number.isFinite(west) && Number.isFinite(south) && Number.isFinite(east) && Number.isFinite(north)
    && west < east && south < north
}

function SceneLabel({ scene, label }) {
  return (
    <div className="scene-label">
      <span>{label}</span>
      <strong>{scene.datetime || scene.id}</strong>
      {scene.cloud_cover != null && <small>{scene.cloud_cover.toFixed(1)}% cloud</small>}
    </div>
  )
}

function PanePlaceholder({ label }) {
  return (
    <div className="pane-placeholder">
      <strong>{label}</strong>
      <span>Load a Sentinel-2 scene</span>
    </div>
  )
}

function TileStatus({ status, label }) {
  if (status === 'ready' || status === 'idle') return null
  const copy = status === 'slow'
    ? `Still loading ${label} satellite tiles from TiTiler. Zooming in may load fewer tiles.`
    : `Loading ${label} satellite imagery tiles.`
  return (
    <div className="tile-status" aria-live="polite">
      <span className="tile-status-dot" />
      <span>{copy}</span>
    </div>
  )
}
