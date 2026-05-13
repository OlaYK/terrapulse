import asyncio
import base64
import io
import json
import logging
from typing import Tuple

import numpy as np
import rasterio
from PIL import Image
from rasterio.enums import Resampling
from rasterio.warp import transform_bounds
from rasterio.windows import Window, from_bounds, intersection

from app.config import CHANGE_MODES
from app.models.schemas import ChangeDetectionResponse, ChangeStats
from app.services.cache import TTLCache
from app.services.stac import get_cog_urls_for_scene

logger = logging.getLogger(__name__)

CHANGE_CACHE = TTLCache[ChangeDetectionResponse](ttl_seconds=60 * 60, max_items=64)


async def _fetch_band_as_array(
    cog_url: str,
    bbox: list[float],
    resolution: int = 256,
) -> np.ndarray:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _sync_read_band, cog_url, bbox, resolution)


def _sync_read_band(cog_url: str, bbox: list[float], resolution: int) -> np.ndarray:
    west, south, east, north = bbox
    try:
        with rasterio.Env(
            GDAL_HTTP_MAX_RETRY="3",
            GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
            CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif,.tiff",
        ):
            with rasterio.open(cog_url) as src:
                raster_bounds = (west, south, east, north)
                if src.crs and src.crs.to_epsg() != 4326:
                    raster_bounds = transform_bounds("EPSG:4326", src.crs, west, south, east, north, densify_pts=21)

                window = from_bounds(*raster_bounds, transform=src.transform)
                window = intersection(window, Window(0, 0, src.width, src.height))
                if window.width <= 0 or window.height <= 0:
                    raise ValueError("Selected area does not overlap this scene")

                data = src.read(
                    1,
                    window=window,
                    out_shape=(resolution, resolution),
                    resampling=Resampling.bilinear,
                )
                arr = data.astype(np.float32)
                return np.clip(arr / 10000.0, 0, 1)
    except Exception as exc:
        logger.error("Failed reading remote COG band: %s", exc)
        raise RuntimeError("Could not read Sentinel-2 band data for the selected area") from exc


def compute_ndvi(nir: np.ndarray, red: np.ndarray) -> np.ndarray:
    denom = np.where((nir + red) == 0, 1e-10, nir + red)
    return np.clip((nir - red) / denom, -1, 1)


def compute_mndwi(green: np.ndarray, swir: np.ndarray) -> np.ndarray:
    denom = np.where((green + swir) == 0, 1e-10, green + swir)
    return np.clip((green - swir) / denom, -1, 1)


def compute_nbr(nir: np.ndarray, swir: np.ndarray) -> np.ndarray:
    denom = np.where((nir + swir) == 0, 1e-10, nir + swir)
    return np.clip((nir - swir) / denom, -1, 1)


def compute_builtup(
    swir: np.ndarray,
    red: np.ndarray,
    nir: np.ndarray,
    green: np.ndarray,
) -> np.ndarray:
    return np.clip((swir + red - nir - green) / 2.0, -1, 1)


def _diff_to_rgba(
    diff: np.ndarray,
    threshold: float,
    color_neg: Tuple[int, int, int],
    color_pos: Tuple[int, int, int],
) -> np.ndarray:
    h, w = diff.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)

    mag = np.abs(diff)
    above_threshold = mag > threshold

    pos_mask = above_threshold & (diff > 0)
    rgba[pos_mask, 0] = color_pos[0]
    rgba[pos_mask, 1] = color_pos[1]
    rgba[pos_mask, 2] = color_pos[2]
    rgba[pos_mask, 3] = np.clip(mag[pos_mask] * 255, 80, 220).astype(np.uint8)

    neg_mask = above_threshold & (diff < 0)
    rgba[neg_mask, 0] = color_neg[0]
    rgba[neg_mask, 1] = color_neg[1]
    rgba[neg_mask, 2] = color_neg[2]
    rgba[neg_mask, 3] = np.clip(mag[neg_mask] * 255, 80, 220).astype(np.uint8)

    return rgba


def _hex_to_rgb(hex_color: str) -> Tuple[int, int, int]:
    h = hex_color.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def _array_to_base64_png(rgba: np.ndarray) -> str:
    img = Image.fromarray(rgba, mode="RGBA")
    buffer = io.BytesIO()
    img.save(buffer, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def _compute_stats(diff: np.ndarray, threshold: float) -> ChangeStats:
    mag = np.abs(diff)
    total = int(diff.size)
    changed = int(np.sum(mag > threshold))
    pos_changed = int(np.sum(diff > threshold))
    neg_changed = int(np.sum(diff < -threshold))

    return ChangeStats(
        total_pixels=total,
        changed_pixels=changed,
        change_percent=round(changed / total * 100, 2),
        positive_change_percent=round(pos_changed / total * 100, 2),
        negative_change_percent=round(neg_changed / total * 100, 2),
        mean_change=round(float(np.mean(diff)), 4),
        max_change=round(float(np.max(diff)), 4),
        min_change=round(float(np.min(diff)), 4),
    )


async def compute_change(
    scene_id_before: str,
    scene_id_after: str,
    bbox: list[float],
    mode: str = "ndvi",
    threshold: float = 0.1,
    resolution: int = 256,
) -> ChangeDetectionResponse:
    if mode not in CHANGE_MODES:
        raise ValueError(f"Unknown change mode: {mode}")

    cache_key = json.dumps(
        {
            "before": scene_id_before,
            "after": scene_id_after,
            "bbox": [round(value, 5) for value in bbox],
            "mode": mode,
            "threshold": round(threshold, 3),
            "resolution": resolution,
        },
        sort_keys=True,
    )
    cached = CHANGE_CACHE.get(cache_key)
    if cached is not None:
        return cached

    mode_config = CHANGE_MODES[mode]
    required_bands = list(mode_config["bands"].keys())

    urls_before, urls_after = await asyncio.gather(
        get_cog_urls_for_scene(scene_id_before, required_bands),
        get_cog_urls_for_scene(scene_id_after, required_bands),
    )

    missing_before = sorted(set(required_bands) - set(urls_before))
    missing_after = sorted(set(required_bands) - set(urls_after))
    if missing_before or missing_after:
        raise ValueError(
            "Missing required bands: "
            f"before={missing_before or 'none'}, after={missing_after or 'none'}"
        )

    before_arrays, after_arrays = await asyncio.gather(
        _read_band_group(urls_before, bbox, resolution),
        _read_band_group(urls_after, bbox, resolution),
    )

    index_before = _compute_index(mode, before_arrays)
    index_after = _compute_index(mode, after_arrays)
    diff = index_after - index_before

    rgba = _diff_to_rgba(
        diff,
        threshold,
        _hex_to_rgb(mode_config["color_negative"]),
        _hex_to_rgb(mode_config["color_positive"]),
    )

    response = ChangeDetectionResponse(
        overlay_url=_array_to_base64_png(rgba),
        stats=_compute_stats(diff, threshold),
        mode=mode,
        mode_name=mode_config["name"],
        color_legend={
            "positive": mode_config["color_positive"],
            "negative": mode_config["color_negative"],
        },
    )
    return CHANGE_CACHE.set(cache_key, response)


async def _read_band_group(
    urls: dict[str, str],
    bbox: list[float],
    resolution: int,
) -> dict[str, np.ndarray]:
    tasks = {band: _fetch_band_as_array(url, bbox, resolution) for band, url in urls.items()}
    arrays = await asyncio.gather(*tasks.values())
    return dict(zip(tasks.keys(), arrays))


def _compute_index(mode: str, bands: dict[str, np.ndarray]) -> np.ndarray:
    if mode == "ndvi":
        return compute_ndvi(bands["nir"], bands["red"])
    if mode == "mndwi":
        return compute_mndwi(bands["green"], bands["swir16"])
    if mode == "nbr":
        return compute_nbr(bands["nir"], bands["swir22"])
    if mode == "builtup":
        return compute_builtup(bands["swir16"], bands["red"], bands["nir"], bands["green"])
    if mode == "rgb":
        return (bands["red"] + bands["green"] + bands["blue"]) / 3.0
    raise ValueError(f"Unknown change mode: {mode}")
