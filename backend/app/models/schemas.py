from typing import Any

from pydantic import BaseModel, Field, field_validator


class SceneSearchRequest(BaseModel):
    bbox: list[float] = Field(..., min_length=4, max_length=4)
    date_start: str = Field(..., examples=["2024-01-01"])
    date_end: str = Field(..., examples=["2024-12-31"])
    max_cloud_cover: int = Field(default=25, ge=0, le=100)
    limit: int = Field(default=8, ge=1, le=25)

    @field_validator("bbox")
    @classmethod
    def validate_bbox(cls, value: list[float]) -> list[float]:
        west, south, east, north = value
        if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
            raise ValueError("bbox must be [west, south, east, north] in valid WGS84 bounds")
        return value


class SceneItem(BaseModel):
    id: str
    datetime: str | None = None
    cloud_cover: float | None = None
    bbox: list[float] = Field(default_factory=list)
    thumbnail_url: str | None = None
    stac_url: str
    platform: str | None = None
    tile_url_template: str


class SceneSearchResponse(BaseModel):
    scenes: list[SceneItem]


class ChangeDetectionRequest(BaseModel):
    scene_id_before: str
    scene_id_after: str
    bbox: list[float] = Field(..., min_length=4, max_length=4)
    mode: str = "ndvi"
    threshold: float = Field(default=0.1, ge=0.01, le=0.9)
    resolution: int = Field(default=256, ge=64, le=768)

    @field_validator("bbox")
    @classmethod
    def validate_bbox(cls, value: list[float]) -> list[float]:
        west, south, east, north = value
        if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
            raise ValueError("bbox must be [west, south, east, north] in valid WGS84 bounds")
        return value


class ChangeStats(BaseModel):
    total_pixels: int
    changed_pixels: int
    change_percent: float
    positive_change_percent: float
    negative_change_percent: float
    mean_change: float
    max_change: float
    min_change: float


class ChangeDetectionResponse(BaseModel):
    overlay_url: str
    stats: ChangeStats
    mode: str
    mode_name: str
    color_legend: dict[str, str]


class ChangeMode(BaseModel):
    id: str
    name: str
    plain_label: str
    plain_summary: str
    positive_label: str
    negative_label: str
    description: str
    formula: str
    bands: dict[str, str]
    color_positive: str
    color_negative: str


class LocationPreset(BaseModel):
    id: str
    name: str
    country: str
    center: list[float]
    zoom: int
    bbox: list[float]
    description: str | None = None
    tags: list[str] = Field(default_factory=list)


class GeocodeResult(BaseModel):
    name: str
    center: list[float]
    bbox: list[float]
    country: str | None = None
    raw: dict[str, Any] = Field(default_factory=dict)
