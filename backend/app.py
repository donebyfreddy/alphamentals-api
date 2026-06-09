import os
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routes.notifications import router as notifications_router
from .routes.market import router as market_router
from .routes.metatrader import router as mt5_bridge_router, metatrader_router

logger = logging.getLogger(__name__)

app = FastAPI(title="Alphamentals Backend", version="1.0.0")

allowed_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
]

extra_origins = [item.strip() for item in os.getenv("MT5_API_CORS_ORIGINS", "").split(",") if item.strip()]
allowed_origins.extend(extra_origins)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Liveness routes — registered BEFORE routers so they always win path matching.
@app.get("/")
def root():
    return {"status": "ok", "service": "alphamentals-dashboard"}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/health")
def api_health():
    return {"status": "ok"}


@app.get("/api/status")
def api_status():
    """Deep diagnostics — does not affect Render health checks."""
    from .services.metatrader_service import health as mt5_health
    try:
        mt5 = mt5_health()
    except Exception as exc:
        logger.warning("MT5 health check failed: %s", exc)
        mt5 = {"healthy": False, "message": str(exc)}
    return {
        "status": "ok",
        "services": {
            "mt5_bridge": mt5,
        },
    }


app.include_router(notifications_router)
app.include_router(market_router)
app.include_router(metatrader_router)
app.include_router(mt5_bridge_router)
