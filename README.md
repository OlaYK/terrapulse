# TerraPulse

Earth change observatory for Nigeria and Africa. TerraPulse compares Sentinel-2 scenes across time, renders them on a split MapLibre map, and computes simple spectral change overlays without machine-learning models.

## What The MVP Does

- Search Sentinel-2 L2A scenes from Element84 Earth Search by visible map bounding box and date range.
- Render before/after COG tiles through TiTiler.
- Compare full before/after scenes in two synchronized side-by-side panes.
- Fit searched locations to their real map bounds and use the center AOI frame for scene search/analysis.
- Run change detection for NDVI, MNDWI, NBR, built-up index, and visible RGB difference.
- Show change overlays and summary statistics in the browser.
- Explain each analysis mode in plain English before showing the technical formula.
- Warn when an analysis area is too large, too high-resolution, or not covered by both selected scenes.
- Copy share links and export print-ready analysis reports that can be saved as PDF.
- Provide Nigeria-focused AOI presets plus Nominatim search.
- Search arbitrary places with OpenStreetMap-based Photon geocoding, with Nominatim fallback and backend caching.

## Architecture

```text
Browser
  React + Vite + MapLibre
  Location panel -> scene picker -> analysis panel
        |
        v
FastAPI backend
  /api/v1/locations/
  /api/v1/scenes/search
  /api/v1/diff/compute
        |
        v
External services
  Element84 Earth Search STAC API
  TiTiler for COG tiles
  Photon + Nominatim for geocoding
```

## Quick Start

### Docker Dev

```bash
docker compose up --build
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- API docs: http://localhost:8000/docs

### Local Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload
```

### Local Frontend

```bash
cd frontend
npm install
copy .env.example .env
npm run dev
```

## Render Free-Tier Deploy

This repo includes a `render.yaml` Blueprint that creates two free Render services:

- `terrapulse-api`: Docker web service for FastAPI.
- `terrapulse-web`: static Vite site served from `frontend/dist`.

Deploy from the Render Dashboard:

1. Push this repository to GitHub, GitLab, or Bitbucket.
2. In Render, choose **New > Blueprint**.
3. Connect the repository and keep the Blueprint path as `render.yaml`.
4. Apply the Blueprint and wait for both services to deploy.
5. Open `https://terrapulse-web.onrender.com` and confirm `https://terrapulse-api.onrender.com/health` returns `ok`.

If Render assigns different service URLs, update these environment variables in Render and redeploy:

```text
terrapulse-web:
  VITE_API_URL=https://your-api-service.onrender.com

terrapulse-api:
  CORS_ORIGINS=https://your-frontend-service.onrender.com
  GEOCODER_USER_AGENT=TerraPulse MVP https://your-frontend-service.onrender.com
  NOMINATIM_USER_AGENT=TerraPulse MVP https://your-frontend-service.onrender.com
```

Also update the static rewrite route for `/api/*` if you want same-origin API proxying through the frontend service.

Render free web services spin down after idle time, so the first backend request after a pause can be slow. The free tier is fine for MVP testing, but use paid always-on services before sharing broadly or calling this production.

## Production Compose

The production compose builds the frontend as static assets behind Nginx, proxies `/api` to FastAPI, and proxies `/tiles` to a self-hosted TiTiler container.

```bash
docker compose -f docker-compose.prod.yml up --build
```

- App: http://localhost:8080
- Backend is exposed only inside the Docker network by default.
- TiTiler is exposed through the app at `/tiles`, so browser tile requests stay on the same origin.

Set these environment variables before production deployment:

```bash
POSTGRES_PASSWORD=change-this
CORS_ORIGINS=https://your-app-domain
NOMINATIM_USER_AGENT="TerraPulse contact@your-domain"
GEOCODER_USER_AGENT="TerraPulse contact@your-domain"
```

By default, production compose sets `TITILER_ENDPOINT=http://titiler:8000` for the backend and `VITE_TITILER_ENDPOINT=/tiles` for the frontend.

## TiTiler Limitation

The public `https://titiler.xyz` instance is a demo server. It is fine for personal MVP testing, but it is rate limited and not suitable for production or public demos. Before CSLS or wider sharing, self-host TiTiler and point both `TITILER_ENDPOINT` and `VITE_TITILER_ENDPOINT` at that deployment.

The compose production stack already includes the official TiTiler image:

```bash
docker compose -f docker-compose.prod.yml up --build
```

For a standalone TiTiler test:

```bash
docker run --platform=linux/amd64 -p 8000:8000 --rm -it ghcr.io/developmentseed/titiler:latest \
  uvicorn titiler.application.main:app --host 0.0.0.0 --port 8000 --workers 1
```

## Geocoding Note

The MVP uses free OpenStreetMap-based geocoding: Photon first for speed, then Nominatim as fallback. Both public services are shared/demo infrastructure, so the backend caches geocode results and only searches when the user submits a query. For production traffic, self-host Photon/Nominatim or use a paid geocoder with a service-level agreement.

## Sentinel-2 Bands

Sentinel-2 is detailed enough for land-cover and environmental monitoring, but it is not sub-meter imagery. ESA lists the mission at 10 m resolution for the highest-resolution bands, with other bands at 20 m or 60 m.

| Band | Asset | Used for |
| --- | --- | --- |
| B02 | blue | RGB |
| B03 | green | RGB, MNDWI, built-up |
| B04 | red | RGB, NDVI, built-up |
| B08 | nir | NDVI, NBR, built-up |
| B11 | swir16 | MNDWI, built-up |
| B12 | swir22 | NBR |

## Change Modes

| Mode | Formula | Use case |
| --- | --- | --- |
| NDVI | `(NIR - Red) / (NIR + Red)` | Deforestation, crop loss, vegetation gain |
| MNDWI | `(Green - SWIR1) / (Green + SWIR1)` | Flooding, coastline movement |
| NBR | `(NIR - SWIR2) / (NIR + SWIR2)` | Fire, blast damage, burn scars |
| Built-up | `SWIR1 + Red - NIR - Green` | Urban expansion |
| RGB | Mean visible reflectance difference | General visible change |

## File Structure

```text
terrapulse/
  docker-compose.yml
  docker-compose.prod.yml
  backend/
    Dockerfile
    requirements.txt
    app/
      main.py
      config.py
      api/
        scenes.py
        diff.py
        locations.py
      services/
        stac.py
        change_detection.py
      models/
        schemas.py
        database.py
  frontend/
    Dockerfile
    Dockerfile.prod
    nginx.conf
    package.json
    vite.config.js
    src/
      App.jsx
      main.jsx
      index.css
      services/api.js
      components/
        Map/MapView.jsx
        Controls/ScenePicker.jsx
        Controls/LocationPanel.jsx
        ChangeDetection/ChangePanel.jsx
```

## API Endpoints

```text
GET  /health
GET  /api/v1/locations/
GET  /api/v1/locations/geocode?q=lagos
POST /api/v1/scenes/search
GET  /api/v1/scenes/{scene_id}
GET  /api/v1/diff/modes
POST /api/v1/diff/compute
```

## Testing Notes

Start with a small AOI and `64 px` or `128 px` analysis resolution. Remote COG reads can be slow, and large areas create unnecessary load on public data services.

Good MVP smoke test:

1. Open Lagos or Lokoja Floodplain from Location.
2. Search before/after scenes with cloud cover under 25%.
3. Select the least cloudy scene on each side.
4. Run NDVI or MNDWI analysis.
5. Confirm the overlay appears on the after map and stats update.

## Roadmap

- Self-host TiTiler for production use.
- Saved comparison library.
- Shareable comparison links.
- Export PNG/PDF reports.
- Time-lapse generation.
- User accounts and organization workspaces.
- Monitoring alerts for selected AOIs.
