"""Database access for `app_users` accounts for every role.

Authentication requires the configured database. When DATABASE_PROVIDER=postgres
the local Postgres helpers are used; otherwise the Supabase client path is used.
Secrets never reach this module in plaintext, callers pass bcrypt hashes only.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from db import postgres as local_postgres
from db.client import execute_query, get_client

# Roles that sign in with emp_id + PIN and are created from the admin panel.
EMPLOYEE_ROLES = ("staff", "kitchen_staff", "delivery")
ALL_ROLES = ("user", "admin", *EMPLOYEE_ROLES)

_TABLE = "app_users"

# Columns safe to hand to routers/clients; never secret_hash.
_PUBLIC_COLS = "id, role, name, phone, email, emp_id, address, is_active, created_at"


def _require_client():
    client = get_client()
    if client is None:
        raise RuntimeError("Account database is not configured.")
    return client


def _one(resp) -> dict | None:
    data = getattr(resp, "data", None)
    return data[0] if data else None


def _serialize(row: dict) -> dict:
    out = {}
    for key, value in row.items():
        if isinstance(value, datetime):
            out[key] = value.astimezone(timezone.utc).isoformat()
        else:
            out[key] = value
    return out


def _next_emp_id(cur) -> str:
    cur.execute(
        """
        select coalesce(
            max(nullif(regexp_replace(emp_id, '\\D', '', 'g'), '')::int),
            0
        ) + 1
        from public.app_users
        where emp_id like 'SMEMP%'
        """
    )
    return f"SMEMP{int(cur.fetchone()[0]):03d}"


def _local_row_by(field: str, value: str, public_only: bool = False) -> dict | None:
    cols = _PUBLIC_COLS if public_only else "*"
    with local_postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"select {cols} from public.app_users where {field} = %s limit 1",
                (value,),
            )
            row = cur.fetchone()
            if not row:
                return None
            return _serialize(dict(zip([desc.name for desc in cur.description], row)))


def create_user(
    *,
    role: str,
    name: str,
    secret_hash: str,
    phone: str | None = None,
    email: str | None = None,
    address: list[dict] | None = None,
    emp_id: str | None = None,
) -> dict:
    """Insert one account. Returns the public row."""
    if local_postgres.is_enabled():
        with local_postgres.connect() as conn:
            with conn.cursor() as cur:
                final_emp_id = emp_id
                if final_emp_id is None and role in EMPLOYEE_ROLES:
                    final_emp_id = _next_emp_id(cur)
                cur.execute(
                    """
                    insert into public.app_users (
                        role, name, full_name, phone, email, address, emp_id,
                        secret_hash, is_active, status
                    )
                    values (
                        %s, %s, %s, %s, %s, %s::jsonb, %s,
                        %s, true, 'active'
                    )
                    returning id, role, name, phone, email, emp_id, address,
                              is_active, created_at
                    """,
                    (
                        role,
                        name,
                        name,
                        phone,
                        email,
                        json.dumps(address) if address is not None else None,
                        final_emp_id,
                        secret_hash,
                    ),
                )
                row = cur.fetchone()
                if not row:
                    raise RuntimeError("Account insert returned no row.")
                return _serialize(dict(zip([desc.name for desc in cur.description], row)))

    client = _require_client()
    row = {
        "role": role,
        "name": name,
        "secret_hash": secret_hash,
        "phone": phone,
        "email": email,
        "address": address,
        "emp_id": emp_id,
    }
    resp = execute_query(client.table(_TABLE).insert(row))
    created = _one(resp)
    if not created:
        raise RuntimeError("Account insert returned no row.")
    created.pop("secret_hash", None)
    return created


def get_by_login(field: str, value: str) -> dict | None:
    """Fetch the full row, including secret_hash and lockout state."""
    if field not in ("phone", "email", "emp_id"):
        raise ValueError(f"Invalid login field: {field}")
    if local_postgres.is_enabled():
        return _local_row_by(field, value)
    client = _require_client()
    resp = execute_query(client.table(_TABLE).select("*").eq(field, value).limit(1))
    return _one(resp)


def get_by_id(user_id: str) -> dict | None:
    """Public row by id for token-to-user resolution. No secret_hash."""
    if local_postgres.is_enabled():
        return _local_row_by("id", user_id, public_only=True)
    client = _require_client()
    resp = execute_query(
        client.table(_TABLE).select(_PUBLIC_COLS).eq("id", user_id).limit(1)
    )
    return _one(resp)


def update_user(user_id: str, fields: dict) -> dict | None:
    """Update arbitrary account columns; returns the public row."""
    if local_postgres.is_enabled():
        allowed = {
            "role",
            "name",
            "phone",
            "email",
            "emp_id",
            "address",
            "secret_hash",
            "is_active",
            "failed_attempts",
            "locked_until",
        }
        updates = []
        params = []
        for key, value in fields.items():
            if key not in allowed:
                continue
            if key == "address":
                updates.append("address = %s::jsonb")
                params.append(json.dumps(value) if value is not None else None)
            elif key == "name":
                updates.extend(["name = %s", "full_name = %s"])
                params.extend([value, value])
            elif key == "is_active":
                updates.extend(["is_active = %s", "status = %s"])
                params.extend([value, "active" if value else "inactive"])
            else:
                updates.append(f"{key} = %s")
                params.append(value)
        if not updates:
            return get_by_id(user_id)
        params.append(user_id)
        with local_postgres.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    update public.app_users
                    set {", ".join(updates)}, updated_at = now()
                    where id = %s
                    returning id, role, name, phone, email, emp_id, address,
                              is_active, created_at
                    """,
                    tuple(params),
                )
                row = cur.fetchone()
                if not row:
                    return None
                return _serialize(dict(zip([desc.name for desc in cur.description], row)))

    client = _require_client()
    resp = execute_query(client.table(_TABLE).update(fields).eq("id", user_id))
    row = _one(resp)
    if row:
        row.pop("secret_hash", None)
    return row


def record_login_failure(
    user_id: str, failed_attempts: int, locked_until: str | None
) -> None:
    """Persist the incremented failure count and optional lock timestamp."""
    if local_postgres.is_enabled():
        with local_postgres.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    update public.app_users
                    set failed_attempts = %s, locked_until = %s, updated_at = now()
                    where id = %s
                    """,
                    (failed_attempts, locked_until, user_id),
                )
        return
    client = _require_client()
    execute_query(
        client.table(_TABLE)
        .update({"failed_attempts": failed_attempts, "locked_until": locked_until})
        .eq("id", user_id)
    )


def record_login_success(user_id: str) -> None:
    """Reset lockout counters after a correct secret."""
    if local_postgres.is_enabled():
        with local_postgres.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    update public.app_users
                    set failed_attempts = 0, locked_until = null, updated_at = now()
                    where id = %s
                    """,
                    (user_id,),
                )
        return
    client = _require_client()
    execute_query(
        client.table(_TABLE)
        .update({"failed_attempts": 0, "locked_until": None})
        .eq("id", user_id)
    )


def list_employees() -> list[dict]:
    """All employee accounts, newest first."""
    if local_postgres.is_enabled():
        with local_postgres.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    select {_PUBLIC_COLS}
                    from public.app_users
                    where role = any(%s)
                    order by created_at desc
                    """,
                    (list(EMPLOYEE_ROLES),),
                )
                cols = [desc.name for desc in cur.description]
                return [_serialize(dict(zip(cols, row))) for row in cur.fetchall()]

    client = _require_client()
    resp = execute_query(
        client.table(_TABLE)
        .select(_PUBLIC_COLS)
        .in_("role", list(EMPLOYEE_ROLES))
        .order("created_at", desc=True)
    )
    return getattr(resp, "data", None) or []
