"""Backend configuration from environment. No secrets in code."""

import os
from pathlib import Path

ENV_DATABASE_URL = "CMMESS_DATABASE_URL"
ENV_USERS_FILE = "CMMESS_USERS_FILE"
ENV_SESSION_TTL_HOURS = "CMMESS_SESSION_TTL_HOURS"
ENV_CORS_ORIGINS = "CMMESS_CORS_ORIGINS"

DEFAULT_SESSION_TTL_HOURS = 24
# The Vite dev origins. Packaged-app (file://) origin handling is the
# packaging task's problem — noted, not solved here.
DEFAULT_CORS_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"

_BACKEND_DIR = Path(__file__).resolve().parent.parent


def default_sqlite_path() -> Path:
    """Path of the default dev SQLite database (gitignored)."""
    return _BACKEND_DIR / "data" / "cmmess.db"


def get_users_file() -> Path:
    """Path of the seeded-accounts TOML (FS-Q5); the real file is gitignored."""
    override = os.environ.get(ENV_USERS_FILE)
    if override:
        return Path(override)
    return _BACKEND_DIR / "config" / "users.toml"


def get_session_ttl_hours() -> int:
    """Session lifetime in hours (``CMMESS_SESSION_TTL_HOURS``, default 24)."""
    return int(os.environ.get(ENV_SESSION_TTL_HOURS, str(DEFAULT_SESSION_TTL_HOURS)))


def get_cors_origins() -> list[str]:
    """Allowed CORS origins (``CMMESS_CORS_ORIGINS``, comma-separated)."""
    raw = os.environ.get(ENV_CORS_ORIGINS, DEFAULT_CORS_ORIGINS)
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def get_database_url() -> str:
    """Database URL from ``CMMESS_DATABASE_URL``, else the dev SQLite file.

    The default's parent directory is created lazily here — only when the
    default is actually used, never as an import side effect.
    """
    url = os.environ.get(ENV_DATABASE_URL)
    if url:
        return url
    path = default_sqlite_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{path}"
