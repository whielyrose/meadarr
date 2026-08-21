"""
Background scheduler for Meadarr.
Runs periodic tasks: retrying failed downloads, auto library scans,
cache cleanup.

NOTE: No tasks run on startup — everything waits for the first interval.
Library scans are triggered manually via the UI or by the auto-scan setting.
"""
import logging
from datetime import datetime, timedelta
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from database.models import get_setting, get_connection

log = logging.getLogger("meadarr.scheduler")

scheduler = AsyncIOScheduler()


async def _retry_failed():
    """Retry failed requests."""
    from services.orchestrator import retry_failed_requests
    await retry_failed_requests()


async def _auto_library_scan():
    """Run a library scan only if auto-scan is enabled in settings."""
    interval = get_setting("auto_scan_interval_hours")
    if not interval or interval == "0":
        return
    from services.library_scanner import run_full_scan
    log.info("Running scheduled library scan")
    await run_full_scan()


async def _clean_cache():
    """Remove expired cache entries."""
    import time
    conn = get_connection()
    try:
        conn.execute(
            "DELETE FROM search_cache WHERE (cached_at + ttl_seconds) < ?",
            (int(time.time()),)
        )
        conn.commit()
    finally:
        conn.close()


def start_scheduler():
    """Start all scheduled tasks with delayed first run so nothing fires on startup."""

    # Retry failed downloads — first run 30 minutes after startup
    scheduler.add_job(
        _retry_failed,
        "interval",
        minutes=30,
        id="retry_failed",
        replace_existing=True,
        next_run_time=datetime.now() + timedelta(minutes=30),
    )

    # Auto library scan — first run 6 hours after startup (respects user setting)
    scheduler.add_job(
        _auto_library_scan,
        "interval",
        hours=6,
        id="auto_scan",
        replace_existing=True,
        next_run_time=datetime.now() + timedelta(hours=6),
    )

    # Cache cleanup — first run 1 hour after startup
    scheduler.add_job(
        _clean_cache,
        "interval",
        hours=1,
        id="cache_cleanup",
        replace_existing=True,
        next_run_time=datetime.now() + timedelta(hours=1),
    )

    scheduler.start()
    log.info("Scheduler started — no tasks will run until their scheduled intervals")


def stop_scheduler():
    """Stop the scheduler."""
    scheduler.shutdown(wait=False)
    log.info("Scheduler stopped")
