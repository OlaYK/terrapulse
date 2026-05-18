from functools import lru_cache
from typing import Any

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    APP_NAME: str = "TerraPulse"
    APP_VERSION: str = "0.1.0"
    ENVIRONMENT: str = "development"

    DATABASE_URL: str | None = None
    REQUIRE_DATABASE: bool = False

    STAC_API_URL: str = "https://earth-search.aws.element84.com/v1"
    SENTINEL2_COLLECTION: str = "sentinel-2-l2a"
    TITILER_ENDPOINT: str = "https://titiler.xyz"
    PHOTON_ENDPOINT: str = "https://photon.komoot.io"
    NOMINATIM_ENDPOINT: str = "https://nominatim.openstreetmap.org"
    GEOCODER_USER_AGENT: str = "TerraPulse MVP"
    NOMINATIM_USER_AGENT: str = "TerraPulse MVP"
    GEOCODER_TIMEOUT_SECONDS: float = 5.0

    CORS_ORIGINS: str = Field(
        default="http://localhost:5173,http://localhost:4173,http://127.0.0.1:5173",
        description="Comma-separated list of allowed frontend origins.",
    )
    CORS_ORIGIN_REGEX: str | None = Field(
        default=None,
        description="Optional regex for allowed frontend origins.",
    )

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    @property
    def cors_origin_regex_value(self) -> str | None:
        return self.CORS_ORIGIN_REGEX.strip() if self.CORS_ORIGIN_REGEX else None


@lru_cache
def get_settings() -> Settings:
    configured = Settings()
    if configured.GEOCODER_USER_AGENT == "TerraPulse MVP":
        configured.GEOCODER_USER_AGENT = configured.NOMINATIM_USER_AGENT
    return configured


settings = get_settings()


AOI_PRESETS: list[dict[str, Any]] = [
    {
        "id": "lagos",
        "name": "Lagos",
        "country": "Nigeria",
        "center": [3.3792, 6.5244],
        "zoom": 10,
        "bbox": [3.05, 6.35, 3.65, 6.75],
        "description": "Urban growth, coastal flooding, and lagoon edge change.",
        "tags": ["urban", "coast", "flood"],
    },
    {
        "id": "niger-delta",
        "name": "Niger Delta",
        "country": "Nigeria",
        "center": [6.55, 4.85],
        "zoom": 8,
        "bbox": [5.0, 4.1, 7.8, 5.8],
        "description": "Wetlands, vegetation loss, flooding, and oil-field disturbance.",
        "tags": ["wetland", "vegetation", "coast"],
    },
    {
        "id": "abuja",
        "name": "Abuja",
        "country": "Nigeria",
        "center": [7.3986, 9.0765],
        "zoom": 10,
        "bbox": [7.05, 8.8, 7.75, 9.35],
        "description": "Urban expansion and peri-urban land-cover change.",
        "tags": ["urban", "built-up"],
    },
    {
        "id": "lake-chad",
        "name": "Lake Chad Basin",
        "country": "Nigeria/Chad",
        "center": [13.35, 13.05],
        "zoom": 7,
        "bbox": [12.0, 12.0, 15.0, 14.2],
        "description": "Water extent, seasonal flooding, and shoreline movement.",
        "tags": ["water", "flood", "shoreline"],
    },
    {
        "id": "lokoja-floodplain",
        "name": "Lokoja Floodplain",
        "country": "Nigeria",
        "center": [6.743, 7.802],
        "zoom": 10,
        "bbox": [6.35, 7.55, 7.05, 8.05],
        "description": "Niger-Benue confluence flood monitoring.",
        "tags": ["flood", "river", "water"],
    },
    {
        "id": "ibadan",
        "name": "Ibadan",
        "country": "Nigeria",
        "center": [3.947, 7.377],
        "zoom": 10,
        "bbox": [3.65, 7.12, 4.25, 7.63],
        "description": "Urban growth and vegetation conversion.",
        "tags": ["urban", "vegetation"],
    },
]


CHANGE_MODES: dict[str, dict[str, Any]] = {
    "ndvi": {
        "id": "ndvi",
        "name": "NDVI",
        "plain_label": "Vegetation change",
        "plain_summary": "Shows where plant cover likely became greener, thinner, or more stressed between the two dates.",
        "positive_label": "Vegetation gain",
        "negative_label": "Vegetation loss",
        "description": "Vegetation gain/loss, deforestation, crop stress.",
        "formula": "(NIR - Red) / (NIR + Red)",
        "bands": {"nir": "B08", "red": "B04"},
        "color_positive": "#22c55e",
        "color_negative": "#ef4444",
    },
    "mndwi": {
        "id": "mndwi",
        "name": "MNDWI",
        "plain_label": "Water change",
        "plain_summary": "Highlights likely water gain or water loss, useful for flooding, river movement, and shoreline shifts.",
        "positive_label": "Water gain",
        "negative_label": "Water loss",
        "description": "Water gain/loss, flooding, coastline movement.",
        "formula": "(Green - SWIR1) / (Green + SWIR1)",
        "bands": {"green": "B03", "swir16": "B11"},
        "color_positive": "#38bdf8",
        "color_negative": "#f97316",
    },
    "nbr": {
        "id": "nbr",
        "name": "NBR",
        "plain_label": "Burn or severe damage",
        "plain_summary": "Shows areas that may have burned, lost vegetation structure, or recovered after fire-like disturbance.",
        "positive_label": "Recovery signal",
        "negative_label": "Damage signal",
        "description": "Burn scars, blast/fire disturbance, severe vegetation damage.",
        "formula": "(NIR - SWIR2) / (NIR + SWIR2)",
        "bands": {"nir": "B08", "swir22": "B12"},
        "color_positive": "#84cc16",
        "color_negative": "#dc2626",
    },
    "builtup": {
        "id": "builtup",
        "name": "Built-up",
        "plain_label": "Built or exposed surface change",
        "plain_summary": "Shows where surfaces became more built-up, bare, or reflective compared with greener/wetter cover.",
        "positive_label": "More built-up",
        "negative_label": "Less built-up",
        "description": "Urban expansion and exposed/built surface increase.",
        "formula": "SWIR1 + Red - NIR - Green",
        "bands": {"swir16": "B11", "red": "B04", "nir": "B08", "green": "B03"},
        "color_positive": "#f59e0b",
        "color_negative": "#14b8a6",
    },
    "rgb": {
        "id": "rgb",
        "name": "RGB Difference",
        "plain_label": "Visible brightness change",
        "plain_summary": "Shows broad visible change when you want a simple before/after difference instead of a specialist index.",
        "positive_label": "Brighter surface",
        "negative_label": "Darker surface",
        "description": "General visible change when a specific spectral index is not enough.",
        "formula": "Mean visible reflectance difference",
        "bands": {"red": "B04", "green": "B03", "blue": "B02"},
        "color_positive": "#a78bfa",
        "color_negative": "#f43f5e",
    },
}
