import logging

from fastapi import APIRouter, HTTPException, Query

from app.config import AOI_PRESETS
from app.models.schemas import GeocodeResult, LocationPreset
from app.services.geocoding import geocode

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/locations", tags=["locations"])


@router.get("/", response_model=list[LocationPreset])
async def list_locations() -> list[LocationPreset]:
    return [LocationPreset(**item) for item in AOI_PRESETS]


@router.get("/geocode", response_model=list[GeocodeResult])
async def geocode_location(q: str = Query(..., min_length=2, max_length=120)) -> list[GeocodeResult]:
    try:
        return await geocode(q)
    except Exception as exc:
        logger.exception("Geocode lookup failed")
        raise HTTPException(status_code=502, detail=f"Geocode lookup failed: {exc}") from exc
