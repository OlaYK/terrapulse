import logging

from fastapi import APIRouter, HTTPException

from app.config import CHANGE_MODES
from app.models.schemas import ChangeDetectionRequest, ChangeDetectionResponse, ChangeMode
from app.services.change_detection import compute_change

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/diff", tags=["diff"])


@router.get("/modes", response_model=list[ChangeMode])
async def list_change_modes() -> list[ChangeMode]:
    return [ChangeMode(**mode) for mode in CHANGE_MODES.values()]


@router.post("/compute", response_model=ChangeDetectionResponse)
async def compute_diff(payload: ChangeDetectionRequest) -> ChangeDetectionResponse:
    if payload.mode not in CHANGE_MODES:
        raise HTTPException(status_code=400, detail=f"Unsupported mode: {payload.mode}")

    try:
        return await compute_change(
            scene_id_before=payload.scene_id_before,
            scene_id_after=payload.scene_id_after,
            bbox=payload.bbox,
            mode=payload.mode,
            threshold=payload.threshold,
            resolution=payload.resolution,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Change detection failed")
        raise HTTPException(status_code=502, detail=f"Change detection failed: {exc}") from exc
