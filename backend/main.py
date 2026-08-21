"""
Meadarr - Self-hosted music manager
Connects slskd, Last.fm, MusicBrainz, and Jellyfin into a unified UI.
"""
import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from database.models import init_db
from scheduler.tasks import start_scheduler, stop_scheduler
from api import settings, search, requests, discover, playlists, library

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("meadarr")

PORT = int(os.environ.get("PORT", 8090))


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    log.info("🍯 Meadarr starting up...")
    init_db()
    start_scheduler()

    # Run initial library scan on startup (non-blocking)
    from services.library_scanner import run_full_scan
    import asyncio
    asyncio.create_task(run_full_scan())

    log.info("🍯 Meadarr ready")
    yield

    log.info("Meadarr shutting down...")
    stop_scheduler()


app = FastAPI(
    title="Meadarr",
    description="Self-hosted music manager — slskd + Last.fm + MusicBrainz + Jellyfin",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — allow frontend dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── API routes ────────────────────────────────────────────────────────────────
app.include_router(settings.router)
app.include_router(search.router)
app.include_router(requests.router)
app.include_router(discover.router)
app.include_router(playlists.router)
app.include_router(library.router)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "Meadarr",
        "version": "1.0.0",
    }


# ── Serve frontend ────────────────────────────────────────────────────────────
# In production the React build is in /app/frontend/dist
FRONTEND_DIR = "/app/frontend/dist"
if os.path.exists(FRONTEND_DIR):
    app.mount("/assets", StaticFiles(directory=f"{FRONTEND_DIR}/assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        """Serve the React SPA — all non-API routes go to index.html."""
        if full_path.startswith("api/"):
            return {"error": "Not found"}
        index = f"{FRONTEND_DIR}/index.html"
        if os.path.exists(index):
            return FileResponse(index)
        return {"error": "Frontend not built"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT, reload=False)
