const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
const TITILER_ENDPOINT = (import.meta.env.VITE_TITILER_ENDPOINT || 'https://titiler.xyz').replace(/\/$/, '')
const STAC_API_URL = (import.meta.env.VITE_STAC_API_URL || 'https://earth-search.aws.element84.com/v1').replace(/\/$/, '')
const SENTINEL2_COLLECTION = import.meta.env.VITE_SENTINEL2_COLLECTION || 'sentinel-2-l2a'

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  })

  const contentType = response.headers.get('content-type') || ''
  const data = contentType.includes('application/json') ? await response.json() : await response.text()

  if (!response.ok) {
    const detail = typeof data === 'object' && data?.detail ? data.detail : `Request failed: ${response.status}`
    throw new Error(detail)
  }

  return data
}

export function searchScenes({ bbox, dateStart, dateEnd, maxCloudCover = 25, limit = 8 }) {
  return request('/api/v1/scenes/search', {
    method: 'POST',
    body: JSON.stringify({
      bbox,
      date_start: dateStart,
      date_end: dateEnd,
      max_cloud_cover: maxCloudCover,
      limit,
    }),
  }).then((data) => data.scenes || [])
}

export function getLocations() {
  return request('/api/v1/locations/')
}

export function geocodeLocation(query) {
  return request(`/api/v1/locations/geocode?q=${encodeURIComponent(query)}`)
}

export function getChangeModes() {
  return request('/api/v1/diff/modes')
}

export function computeChange({ sceneA, sceneB, bbox, mode, threshold, resolution }) {
  return request('/api/v1/diff/compute', {
    method: 'POST',
    body: JSON.stringify({
      scene_id_before: sceneA.id,
      scene_id_after: sceneB.id,
      bbox,
      mode,
      threshold,
      resolution,
    }),
  })
}

export function buildStacUrl(sceneId) {
  return `${STAC_API_URL}/collections/${SENTINEL2_COLLECTION}/items/${sceneId}`
}

export function buildTileUrl(stacUrl, assets = 'red,green,blue') {
  const params = new URLSearchParams()
  params.set('url', stacUrl)
  assets.split(',').forEach((asset) => params.append('assets', asset))
  params.set('color_formula', 'gamma RGB 3.5,saturation 1.7,sigmoidal RGB 15 0.35')
  params.set('rescale', '0,3000')
  params.set('nodata', '0')
  return `${TITILER_ENDPOINT}/stac/tiles/WebMercatorQuad/{z}/{x}/{y}.png?${params.toString()}`
}

export const DEFAULT_NIGERIA_BBOX = [2.5, 4.0, 14.7, 13.9]
