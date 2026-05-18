export function compactScene(scene) {
  if (!scene?.id) return null
  return {
    id: scene.id,
    datetime: scene.datetime || null,
    cloud_cover: scene.cloud_cover ?? null,
    bbox: Array.isArray(scene.bbox) ? scene.bbox : [],
    thumbnail_url: scene.thumbnail_url || null,
    stac_url: scene.stac_url || '',
    platform: scene.platform || null,
    tile_url_template: scene.tile_url_template || '',
  }
}

export function buildShareUrl(state) {
  const url = new URL(window.location.href)
  url.search = ''
  url.hash = ''
  url.searchParams.set('state', encodeState(state))
  return url.toString()
}

export function readSharedState() {
  const params = new URLSearchParams(window.location.search)
  const encoded = params.get('state')
  if (!encoded) return null

  try {
    return JSON.parse(decodeState(encoded))
  } catch {
    return null
  }
}

function encodeState(state) {
  const json = JSON.stringify(state)
  const bytes = new TextEncoder().encode(json)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeState(encoded) {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(encoded.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}
