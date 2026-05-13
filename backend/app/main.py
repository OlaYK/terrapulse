import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import diff, locations, scenes
from app.config import settings
from app.models.database import close_db, init_db

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("TerraPulse API starting up")
    await init_db()
    yield
    await close_db()
    logger.info("TerraPulse API shut down")


app = FastAPI(
    title="TerraPulse API",
    description="Satellite image comparison and change detection for Nigeria and Africa.",
    version=settings.APP_VERSION,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(scenes.router, prefix="/api/v1")
app.include_router(diff.router, prefix="/api/v1")
app.include_router(locations.router, prefix="/api/v1")


@app.get("/health")
async def health() -> dict[str, str]:
    return {
        "status": "ok",
        "version": settings.APP_VERSION,
        "app": settings.APP_NAME,
        "environment": settings.ENVIRONMENT,
    }


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    logger.error("Unhandled error: %s", exc, exc_info=True)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})
