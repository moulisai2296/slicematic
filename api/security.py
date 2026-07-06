"""Authentication helpers for the API/auth surface.

Auth is designed to fail closed for protected routes while leaving public
menu/cart endpoints usable without any secrets.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

MAX_FAILED_ATTEMPTS = 5
LOCKOUT_MINUTES = 15
TOKEN_TTL_HOURS = 24
_ALGO = "HS256"

# Optional bearer scheme: endpoints decide whether auth is required, and we
# return clean 401s instead of FastAPI's default 403 on a missing header.
_bearer = HTTPBearer(auto_error=False)


def _jwt_secret() -> str:
    """Signing secret from env. A dev default keeps local runs friction-free;
    any real deploy must set AUTH_JWT_SECRET (see .env.example)."""
    # â‰¥32 bytes so HS256 meets RFC 7518's minimum even in dev.
    return os.environ.get("AUTH_JWT_SECRET") or "slicematic-dev-only-secret-change-me"


# --------------------------------------------------------------------------- #
# Secrets
# --------------------------------------------------------------------------- #


def hash_secret(secret: str) -> str:
    return bcrypt.hashpw(secret.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_secret(secret: str, secret_hash: str) -> bool:
    try:
        return bcrypt.checkpw(secret.encode("utf-8"), secret_hash.encode("utf-8"))
    except ValueError:  # malformed hash in the row â€” treat as no match
        return False


# --------------------------------------------------------------------------- #
# Tokens
# --------------------------------------------------------------------------- #


def issue_token(user_id: str, role: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "role": role,
        "iat": now,
        "exp": now + timedelta(hours=TOKEN_TTL_HOURS),
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=_ALGO)


def decode_token(token: str) -> dict:
    """Return the claims or raise HTTPException(401)."""
    try:
        return jwt.decode(token, _jwt_secret(), algorithms=[_ALGO])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired â€” sign in again.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid session token.")


# --------------------------------------------------------------------------- #
# FastAPI dependencies
# --------------------------------------------------------------------------- #


def get_current_claims(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict:
    """Require a valid bearer token; return its claims ({sub, role, ...})."""
    if creds is None:
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    return decode_token(creds.credentials)


def require_role(*roles: str):
    """Dependency factory: valid token AND role âˆˆ roles (admin never implied)."""

    def _check(claims: dict = Depends(get_current_claims)) -> dict:
        if claims.get("role") not in roles:
            raise HTTPException(
                status_code=403, detail="You don't have access to this."
            )
        return claims

    return _check


# --------------------------------------------------------------------------- #
# Lockout policy (state lives on the app_users row)
# --------------------------------------------------------------------------- #


def lock_state(row: dict) -> tuple[bool, str | None]:
    """Is the account currently locked? Returns (locked, message)."""
    locked_until = row.get("locked_until")
    if not locked_until:
        return False, None
    try:
        until = datetime.fromisoformat(str(locked_until).replace("Z", "+00:00"))
    except ValueError:
        return False, None
    now = datetime.now(timezone.utc)
    if until <= now:
        return False, None
    mins = max(1, int((until - now).total_seconds() // 60) + 1)
    return True, f"Too many wrong attempts. Try again in {mins} min."


def next_failure_state(row: dict) -> tuple[int, str | None]:
    """New (failed_attempts, locked_until_iso) after one more wrong secret."""
    attempts = int(row.get("failed_attempts") or 0) + 1
    if attempts >= MAX_FAILED_ATTEMPTS:
        until = datetime.now(timezone.utc) + timedelta(minutes=LOCKOUT_MINUTES)
        return attempts, until.isoformat()
    return attempts, None
