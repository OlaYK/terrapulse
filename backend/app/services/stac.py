import json
import logging
from datetime import datetime
from typing import Optional
from urllib.parse import urlencode

import httpx

from app.config import settings
from app.models.schemas import SceneItem
from app.services.cache import TTLCache

logger = logging.getLogger(__name__)


BAND_ASSETS = {
    "red": "red",
    "green": "green",
    "blue": "blue",
    "nir": "nir",
    "swir16": "swir16",
    "swir22": "swir22",
}

SCENE_SEARCH_CACHE = TTLCache[list[SceneItem]](ttl_seconds=60 * 30, max_items=256)
SCENE_DETAIL_CACHE = TTLCache[dict](ttl_seconds=60 * 60 * 24, max_items=512)


def build_titiler_stac_url(stac_url: str, assets: str = "red,green,blue") -> str:
    params = urlencode(
        [
            ("url", stac_url),
            *[("assets", asset) for asset in assets.split(",")],
            ("color_formula", "gamma RGB 3.5,saturation 1.7,sigmoidal RGB 15 0.35"),
            ("rescale", "0,3000"),
            ("nodata", "0"),
        ],
        doseq=True,
        safe=",",
    )
    endpoint = settings.TITILER_ENDPOINT.rstrip("/")
    return f"{endpoint}/stac/tiles/WebMercatorQuad/{{z}}/{{x}}/{{y}}.png?{params}"


def build_titiler_cog_url(cog_url: str) -> str:
    params = urlencode(
        [
            ("url", cog_url),
            ("bidx", "1"),
            ("bidx", "2"),
            ("bidx", "3"),
            ("rescale", "0,255"),
            ("nodata", "0"),
        ],
        doseq=True,
        safe=",",
    )
    endpoint = settings.TITILER_ENDPOINT.rstrip("/")
    return f"{endpoint}/cog/tiles/WebMercatorQuad/{{z}}/{{x}}/{{y}}.png?{params}"


async def search_scenes(
    bbox: list[float],
    date_start: str,
    date_end: str,
    max_cloud_cover: int = 25,
    limit: int = 10,
) -> list[SceneItem]:
    search_limit = min(max(limit * 3, limit), 30)
    cache_key = json.dumps(
        {
            "bbox": [round(value, 5) for value in bbox],
            "date_start": date_start,
            "date_end": date_end,
            "max_cloud_cover": max_cloud_cover,
            "limit": limit,
        },
        sort_keys=True,
    )
    cached = SCENE_SEARCH_CACHE.get(cache_key)
    if cached is not None:
        return cached

    payload = {
        "collections": [settings.SENTINEL2_COLLECTION],
        "bbox": bbox,
        "datetime": f"{_as_rfc3339_start(date_start)}/{_as_rfc3339_end(date_end)}",
        "query": {"eo:cloud_cover": {"lt": max_cloud_cover}},
        "limit": search_limit,
    }

    timeout = httpx.Timeout(18.0, connect=8.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(f"{settings.STAC_API_URL.rstrip('/')}/search", json=payload)
        response.raise_for_status()
        features = response.json().get("features", [])

    scenes: list[SceneItem] = []
    for item in features:
        try:
            scenes.append(_item_dict_to_schema(item))
        except Exception as exc:
            logger.warning("Skipping STAC item %s: %s", item.get("id", "unknown"), exc)

    sorted_scenes = sorted(
        scenes,
        key=lambda scene: (
            0 if _covers_bbox(scene.bbox, bbox) else 1,
            scene.cloud_cover if scene.cloud_cover is not None else 101,
            _scene_center_distance(scene.bbox, bbox),
        ),
    )[:limit]
    return SCENE_SEARCH_CACHE.set(cache_key, sorted_scenes)


def _as_rfc3339_start(value: str) -> str:
    return value if "T" in value else f"{value}T00:00:00Z"


def _as_rfc3339_end(value: str) -> str:
    return value if "T" in value else f"{value}T23:59:59Z"


def _item_dict_to_schema(item: dict) -> SceneItem:
    props = item.get("properties", {})
    item_id = item["id"]
    stac_item_url = (
        f"{settings.STAC_API_URL.rstrip('/')}/collections/{settings.SENTINEL2_COLLECTION}"
        f"/items/{item_id}"
    )

    assets = item.get("assets", {})
    thumbnail = None
    if "rendered_preview" in assets:
        thumbnail = assets["rendered_preview"].get("href")
    elif "thumbnail" in assets:
        thumbnail = assets["thumbnail"].get("href")

    visual_href = None
    if "visual" in assets:
        visual_href = assets["visual"].get("href")

    dt_str = props.get("datetime") or props.get("start_datetime")
    if dt_str:
        try:
            dt_str = datetime.fromisoformat(dt_str.replace("Z", "+00:00")).strftime("%Y-%m-%d")
        except ValueError:
            pass

    return SceneItem(
        id=item_id,
        datetime=dt_str,
        cloud_cover=props.get("eo:cloud_cover"),
        bbox=list(item.get("bbox") or []),
        thumbnail_url=thumbnail,
        stac_url=stac_item_url,
        platform=props.get("platform"),
        tile_url_template=build_titiler_cog_url(visual_href) if visual_href else build_titiler_stac_url(stac_item_url),
    )


def _covers_bbox(scene_bbox: list[float], requested_bbox: list[float]) -> bool:
    if len(scene_bbox) != 4 or len(requested_bbox) != 4:
        return False
    west, south, east, north = scene_bbox
    req_west, req_south, req_east, req_north = requested_bbox
    return west <= req_west and south <= req_south and east >= req_east and north >= req_north


def _scene_center_distance(scene_bbox: list[float], requested_bbox: list[float]) -> float:
    if len(scene_bbox) != 4 or len(requested_bbox) != 4:
        return 999.0
    scene_lon = (scene_bbox[0] + scene_bbox[2]) / 2
    scene_lat = (scene_bbox[1] + scene_bbox[3]) / 2
    req_lon = (requested_bbox[0] + requested_bbox[2]) / 2
    req_lat = (requested_bbox[1] + requested_bbox[3]) / 2
    return abs(scene_lon - req_lon) + abs(scene_lat - req_lat)


async def get_scene_by_id(scene_id: str) -> Optional[dict]:
    cached = SCENE_DETAIL_CACHE.get(scene_id)
    if cached is not None:
        return cached

    url = (
        f"{settings.STAC_API_URL.rstrip('/')}/collections/{settings.SENTINEL2_COLLECTION}"
        f"/items/{scene_id}"
    )
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(url)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return SCENE_DETAIL_CACHE.set(scene_id, resp.json())


async def get_cog_urls_for_scene(scene_id: str, bands: list[str]) -> dict[str, str]:
    item_data = await get_scene_by_id(scene_id)
    if not item_data:
        raise ValueError(f"Scene not found: {scene_id}")

    assets = item_data.get("assets", {})
    result: dict[str, str] = {}
    for band in bands:
        asset_name = BAND_ASSETS.get(band, band)
        asset = assets.get(asset_name)
        if asset and asset.get("href"):
            result[band] = asset["href"]

    return result
