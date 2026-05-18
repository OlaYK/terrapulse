import logging

import httpx

from app.config import AOI_PRESETS, settings
from app.models.schemas import GeocodeResult
from app.services.cache import TTLCache

logger = logging.getLogger(__name__)

GEOCODE_CACHE = TTLCache[list[GeocodeResult]](ttl_seconds=60 * 60 * 24, max_items=512)
PRIORITY_COUNTRIES = {
    "nigeria",
    "benin",
    "cameroon",
    "chad",
    "ghana",
    "niger",
    "togo",
}
STRONG_PLACE_TYPES = {"city", "town", "village", "administrative", "municipality", "county", "state"}


async def geocode(query: str) -> list[GeocodeResult]:
    clean_query = " ".join(query.strip().split())
    cache_key = clean_query.casefold()
    cached = GEOCODE_CACHE.get(cache_key)
    if cached is not None:
        return cached

    preset_hits = _preset_matches(clean_query)
    photon_hits = await _photon_search(clean_query)
    results = _dedupe([*preset_hits, *photon_hits])

    if not results or not _has_priority_country(results):
        results = _dedupe([*results, *await _nominatim_search(clean_query)])

    if (
        not _has_priority_country(results)
        and not _has_strong_global_match(results, clean_query)
        and not _query_has_country_hint(clean_query)
    ):
        nigeria_query = f"{clean_query}, Nigeria"
        regional_hits = [
            *await _photon_search(nigeria_query),
            *await _nominatim_search(nigeria_query, countrycodes="ng"),
        ]
        results = _dedupe([*results, *regional_hits])

    ranked = _rank_results(results, clean_query)[:8]
    if not ranked:
        return []

    return GEOCODE_CACHE.set(cache_key, ranked)


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


async def _nominatim_search(query: str, countrycodes: str | None = None) -> list[GeocodeResult]:
    params = {
        "q": query,
        "format": "jsonv2",
        "limit": 8,
        "addressdetails": 1,
        "polygon_geojson": 0,
    }
    if countrycodes:
        params["countrycodes"] = countrycodes
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
        raw={
            "provider": "photon",
            "osm_id": props.get("osm_id"),
            "osm_type": props.get("osm_type"),
            "type": props.get("type"),
            "countrycode": props.get("countrycode"),
        },
    )


def _nominatim_to_result(item: dict) -> GeocodeResult:
    south, north, west, east = [float(value) for value in item["boundingbox"]]
    address = item.get("address") or {}
    return GeocodeResult(
        name=item.get("display_name", "Unknown location"),
        center=[float(item["lon"]), float(item["lat"])],
        bbox=[west, south, east, north],
        country=address.get("country"),
        raw={
            "provider": "nominatim",
            "type": item.get("type"),
            "osm_id": item.get("osm_id"),
            "country_code": address.get("country_code"),
            "importance": item.get("importance"),
        },
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


def _rank_results(results: list[GeocodeResult], query: str) -> list[GeocodeResult]:
    return sorted(results, key=lambda result: _result_rank(result, query))


def _result_rank(result: GeocodeResult, query: str) -> tuple[int, int, int, int, int, int, str]:
    provider_rank = {"preset": 0, "photon": 1, "nominatim": 2}.get(result.raw.get("provider"), 3)
    preset_rank = 0 if provider_rank == 0 else 1
    primary_name = result.name.split(",", 1)[0].casefold()
    q = query.casefold()
    name_rank = 0 if primary_name == q else 1 if primary_name.startswith(q) or q in primary_name else 2
    country_rank = 0 if _is_priority_country(result.country) else 1
    result_type = str(result.raw.get("type") or "").casefold()
    strong_match_rank = 0 if primary_name == q and result_type in STRONG_PLACE_TYPES else 1
    type_rank = 0 if result_type in {*STRONG_PLACE_TYPES, "suburb", "neighbourhood", "district"} else 1
    return (preset_rank, strong_match_rank, country_rank, name_rank, type_rank, provider_rank, result.name.casefold())


def _has_priority_country(results: list[GeocodeResult]) -> bool:
    return any(_is_priority_country(result.country) for result in results)


def _has_strong_global_match(results: list[GeocodeResult], query: str) -> bool:
    q = query.casefold()
    for result in results:
        primary_name = result.name.split(",", 1)[0].casefold()
        result_type = str(result.raw.get("type") or "").casefold()
        if primary_name == q and result_type in STRONG_PLACE_TYPES:
            return True
    return False


def _is_priority_country(country: str | None) -> bool:
    return bool(country and country.casefold() in PRIORITY_COUNTRIES)


def _query_has_country_hint(query: str) -> bool:
    q = query.casefold()
    return any(country in q for country in PRIORITY_COUNTRIES)
