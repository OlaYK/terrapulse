import logging

from fastapi import APIRouter, HTTPException

from app.models.schemas import SceneSearchRequest, SceneSearchResponse
from app.services.stac import get_scene_by_id, search_scenes

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/scenes", tags=["scenes"])


@router.post("/search", response_model=SceneSearchResponse)
async def search_scene_endpoint(payload: SceneSearchRequest) -> SceneSearchResponse:
    try:
        scenes = await search_scenes(
            bbox=payload.bbox,
            date_start=payload.date_start,
            date_end=payload.date_end,
            max_cloud_cover=payload.max_cloud_cover,
            limit=payload.limit,
        )
        return SceneSearchResponse(scenes=scenes)
    except Exception as exc:
        logger.exception("Scene search failed")
        raise HTTPException(status_code=502, detail=f"Scene search failed: {exc}") from exc


@router.get("/{scene_id}")
async def get_scene_endpoint(scene_id: str) -> dict:
    try:
        scene = await get_scene_by_id(scene_id)
    except Exception as exc:
        logger.exception("Scene lookup failed")
        raise HTTPException(status_code=502, detail=f"Scene lookup failed: {exc}") from exc

    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
    return scene
