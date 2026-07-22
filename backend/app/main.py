"""CMMess backend — FastAPI application entry point."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.assets import router as assets_router
from app.auth import router as auth_router
from app.config import get_cors_origins
from app.downtime import router as downtime_router
from app.seeding import seed_users_from_config
from app.work_orders import router as work_orders_router


class HealthResponse(BaseModel):
    """Response model for GET /health."""

    status: Literal["ok"]


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Startup: seed accounts from the users config (FS-Q5).

    Importing the module touches no storage — only startup does.
    """
    seed_users_from_config()
    yield


app = FastAPI(title="CMMess Backend", lifespan=lifespan)
# Bearer header, no cookies — allow_credentials stays False.
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_cors_origins(),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth_router)
app.include_router(assets_router)
app.include_router(downtime_router)
app.include_router(work_orders_router)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Liveness check. No auth."""
    return HealthResponse(status="ok")
