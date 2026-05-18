export function isValidBbox(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return false
  const [west, south, east, north] = bbox
  return Number.isFinite(west)
    && Number.isFinite(south)
    && Number.isFinite(east)
    && Number.isFinite(north)
    && west < east
    && south < north
}

export function describeBbox(bbox) {
  if (!isValidBbox(bbox)) {
    return {
      label: 'current map view',
      widthKm: 0,
      heightKm: 0,
      areaKm2: 0,
      large: false,
      veryLarge: false,
    }
  }

  const [west, south, east, north] = bbox
  const midLat = (south + north) / 2
  const widthKm = Math.abs(east - west) * 111.32 * Math.cos((midLat * Math.PI) / 180)
  const heightKm = Math.abs(north - south) * 111.32
  const areaKm2 = Math.max(0, widthKm * heightKm)

  return {
    label: `${Math.max(1, Math.round(widthKm))} km x ${Math.max(1, Math.round(heightKm))} km`,
    widthKm,
    heightKm,
    areaKm2,
    large: widthKm > 120 || heightKm > 120 || areaKm2 > 6000,
    veryLarge: widthKm > 220 || heightKm > 220 || areaKm2 > 20000,
  }
}

export function bboxCoverageRatio(targetBbox, sceneBbox) {
  if (!isValidBbox(targetBbox) || !isValidBbox(sceneBbox)) return 0

  const [west, south, east, north] = targetBbox
  const [sceneWest, sceneSouth, sceneEast, sceneNorth] = sceneBbox
  const overlapWest = Math.max(west, sceneWest)
  const overlapSouth = Math.max(south, sceneSouth)
  const overlapEast = Math.min(east, sceneEast)
  const overlapNorth = Math.min(north, sceneNorth)

  if (overlapWest >= overlapEast || overlapSouth >= overlapNorth) return 0

  const targetArea = bboxArea(targetBbox)
  if (targetArea <= 0) return 0
  return Math.min(1, bboxArea([overlapWest, overlapSouth, overlapEast, overlapNorth]) / targetArea)
}

function bboxArea(bbox) {
  const [west, south, east, north] = bbox
  const midLat = (south + north) / 2
  const widthKm = Math.abs(east - west) * 111.32 * Math.cos((midLat * Math.PI) / 180)
  const heightKm = Math.abs(north - south) * 111.32
  return Math.max(0, widthKm * heightKm)
}
