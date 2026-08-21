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
from fastapi.responses import FileResponse, JSONResponse

from database.models import init_db
from scheduler.tasks import start_scheduler, stop_scheduler
from api import settings, search, requests, discover, playlists, library

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("meadarr")

PORT = int(os.environ.get("PORT", 8090))
FRONTEND_DIR = "/app/frontend/dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    log.info("Meadarr starting up...")
    init_db()
    start_scheduler()
    log.info("Meadarr ready — use Library > Scan Library to index your music")
    yield
    log.info("Meadarr shutting down...")
    stop_scheduler()


app = FastAPI(
    title="Meadarr",
    description="Self-hosted music manager",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(settings.router)
app.include_router(search.router)
app.include_router(requests.router)
app.include_router(discover.router)
app.include_router(playlists.router)
app.include_router(library.router)


@app.get("/health")
async def health():
    return JSONResponse({"status": "ok", "service": "Meadarr", "version": "1.0.0"})


if os.path.isdir(f"{FRONTEND_DIR}/assets"):
    app.mount("/assets", StaticFiles(directory=f"{FRONTEND_DIR}/assets"), name="assets")


@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    """Serve the React SPA for all non-API routes."""
    if full_path.startswith("api/") or full_path == "health":
        return JSONResponse({"error": "Not found"}, status_code=404)
    index = f"{FRONTEND_DIR}/index.html"
    if os.path.isfile(index):
        return FileResponse(index)
    return JSONResponse(
        {"error": "Frontend not built"},
        status_code=503
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT, reload=False)