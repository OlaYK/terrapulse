import logging

import httpx

from app.config import AOI_PRESETS, settings
from app.models.schemas import GeocodeResult
from app.services.cache import TTLCache

logger = logging.getLogger(__name__)

GEOCODE_CACHE = TTLCache[list[GeocodeResult]](ttl_seconds=60 * 60 * 24, max_items=512)


async def geocode(query: str) -> list[GeocodeResult]:
    clean_query = " ".join(query.strip().split())
    cache_key = clean_query.casefold()
    cached = GEOCODE_CACHE.get(cache_key)
    if cached is not None:
        return cached

    preset_hits = _preset_matches(clean_query)
    photon_hits = await _photon_search(clean_query)
    results = _dedupe([*preset_hits, *photon_hits])

    if not results:
        results = _dedupe([*preset_hits, *await _nominatim_search(clean_query)])

    return GEOCODE_CACHE.set(cache_key, results[:8])


def _preset_matches(query: str) -> list[GeocodeResult]:
    q = query.casefold()
    matches: list[GeocodeResult] = []
    for item in AOI_PRESETS:
        haystack = " ".join(
            [
                item["name"],
                item.get("country", ""),
                item.get("description", ""),
                " ".join(item.get("tags", [])),
            ]
        ).casefold()
        if q in haystack:
            matches.append(
                GeocodeResult(
                    name=f"{item['name']}, {item['country']}",
                    center=item["center"],
                    bbox=item["bbox"],
                    country=item["country"],
                    raw={"provider": "preset", "id": item["id"]},
                )
            )
    return matches


async def _photon_search(query: str) -> list[GeocodeResult]:
    params = {"q": query, "limit": 8, "lang": "en"}
    headers = {"User-Agent": settings.GEOCODER_USER_AGENT}

    try:
        async with httpx.AsyncClient(timeout=settings.GEOCODER_TIMEOUT_SECONDS, headers=headers) as client:
            response = await client.get(f"{settings.PHOTON_ENDPOINT.rstrip('/')}/api", params=params)
            response.raise_for_status()
            features = response.json().get("features", [])
    except Exception as exc:
        logger.info("Photon geocode failed for %r: %s", query, exc)
        return []

    return [_photon_to_result(feature) for feature in features if feature.get("geometry")]


async def _nominatim_search(query: str) -> list[GeocodeResult]:
    params = {
        "q": query,
        "format": "jsonv2",
        "limit": 8,
        "addressdetails": 1,
        "polygon_geojson": 0,
    }
    headers = {"User-Agent": settings.GEOCODER_USER_AGENT}

    try:
        async with httpx.AsyncClient(timeout=settings.GEOCODER_TIMEOUT_SECONDS + 4, headers=headers) as client:
            response = await client.get(f"{settings.NOMINATIM_ENDPOINT.rstrip('/')}/search", params=params)
            response.raise_for_status()
            items = response.json()
    except Exception as exc:
        logger.info("Nominatim geocode failed for %r: %s", query, exc)
        return []

    return [_nominatim_to_result(item) for item in items if item.get("boundingbox")]


def _photon_to_result(feature: dict) -> GeocodeResult:
    props = feature.get("properties", {})
    lon, lat = [float(value) for value in feature["geometry"]["coordinates"][:2]]

    extent = props.get("extent") or []
    if len(extent) == 4:
        west = min(float(extent[0]), float(extent[2]))
        east = max(float(extent[0]), float(extent[2]))
        south = min(float(extent[1]), float(extent[3]))
        north = max(float(extent[1]), float(extent[3]))
        bbox = [west, south, east, north]
    else:
        bbox = _bbox_around(lon, lat)

    name_parts = [
        props.get("name"),
        props.get("city") or props.get("county"),
        props.get("state"),
        props.get("country"),
    ]
    name = ", ".join(dict.fromkeys(part for part in name_parts if part))

    return GeocodeResult(
        name=name or "Unknown location",
        center=[lon, lat],
        bbox=bbox,
        country=props.get("country"),
        raw={"provider": "photon", "osm_id": props.get("osm_id"), "osm_type": props.get("osm_type")},
    )


def _nominatim_to_result(item: dict) -> GeocodeResult:
    south, north, west, east = [float(value) for value in item["boundingbox"]]
    address = item.get("address") or {}
    return GeocodeResult(
        name=item.get("display_name", "Unknown location"),
        center=[float(item["lon"]), float(item["lat"])],
        bbox=[west, south, east, north],
        country=address.get("country"),
        raw={"provider": "nominatim", "type": item.get("type"), "osm_id": item.get("osm_id")},
    )


def _bbox_around(lon: float, lat: float, radius_degrees: float = 0.16) -> list[float]:
    return [
        max(-180, lon - radius_degrees),
        max(-90, lat - radius_degrees),
        min(180, lon + radius_degrees),
        min(90, lat + radius_degrees),
    ]


def _dedupe(results: list[GeocodeResult]) -> list[GeocodeResult]:
    seen: set[tuple[str, float, float]] = set()
    deduped: list[GeocodeResult] = []
    for result in results:
        key = (result.name.casefold(), round(result.center[0], 4), round(result.center[1], 4))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(result)
    return deduped
