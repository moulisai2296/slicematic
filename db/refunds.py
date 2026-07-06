"""Refund request database operations."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
import json

from db import postgres as local_postgres
from db.client import execute_query, get_client

log = logging.getLogger(__name__)

def get_refund_for_order(order_no: str) -> dict | None:
    """Get refund request for a specific order."""
    if local_postgres.is_enabled():
        with local_postgres.connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT r.* FROM public.refunds r JOIN public.orders o ON r.order_id = o.id WHERE o.order_no = %s", (order_no,))
                row = cur.fetchone()
                if not row:
                    return None
                cols = [desc.name for desc in cur.description]
                return local_postgres._serialize(dict(zip(cols, row)))

    client = get_client()
    if not client:
        return None
    # Supabase query needs to get order.id first, or use embedded join
    order_resp = execute_query(client.table("orders").select("id").eq("order_no", order_no).limit(1))
    order_data = getattr(order_resp, "data", [])
    if not order_data:
        return None
    order_id = order_data[0]["id"]
    
    resp = execute_query(client.table("refunds").select("*").eq("order_id", order_id).limit(1))
    data = getattr(resp, "data", [])
    return data[0] if data else None


def create_refund_request(order_no: str, customer_id: str, reason: str, refund_amount: float) -> dict:
    """Create a new refund request."""
    if local_postgres.is_enabled():
        with local_postgres.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO public.refunds (order_id, customer_id, reason, refund_amount, status)
                    SELECT id, %s, %s, %s, 'REQUESTED' FROM public.orders WHERE order_no = %s
                    RETURNING *
                    """,
                    (customer_id, reason, refund_amount, order_no)
                )
                row = cur.fetchone()
                cols = [desc.name for desc in cur.description]
                return local_postgres._serialize(dict(zip(cols, row)))

    client = get_client()
    if not client:
        raise RuntimeError("Database not configured")
        
    order_resp = execute_query(client.table("orders").select("id").eq("order_no", order_no).limit(1))
    order_data = getattr(order_resp, "data", [])
    if not order_data:
        raise RuntimeError("Order not found")
    order_id = order_data[0]["id"]
    row = {
        "order_id": order_id,
        "customer_id": customer_id,
        "reason": reason,
        "refund_amount": refund_amount,
        "status": "REQUESTED"
    }
    resp = execute_query(client.table("refunds").insert(row))
    data = getattr(resp, "data", [])
    return data[0] if data else None


def list_refunds(status: str | None = None) -> list[dict]:
    """List all refunds, optionally filtered by status, newest first."""
    if local_postgres.is_enabled():
        with local_postgres.connect() as conn:
            with conn.cursor() as cur:
                sql = "SELECT r.*, o.order_no, o.total as order_total, o.created_at as order_created_at, u.name as customer_name FROM public.refunds r JOIN public.orders o ON r.order_id = o.id LEFT JOIN public.app_users u ON r.customer_id = u.id"
                params = []
                if status:
                    sql += " WHERE r.status = %s"
                    params.append(status)
                sql += " ORDER BY r.requested_at DESC"
                cur.execute(sql, tuple(params))
                cols = [desc.name for desc in cur.description]
                rows = cur.fetchall()
                return [local_postgres._serialize(dict(zip(cols, r))) for r in rows]

    client = get_client()
    if not client:
        return []
    
    query = client.table("refunds").select("*, orders(order_no, total, created_at), app_users(name)")
    if status:
        query = query.eq("status", status)
    resp = execute_query(query.order("requested_at", desc=True))
    data = getattr(resp, "data", [])
    
    # Flatten Supabase join for consistent API output
    out = []
    for d in data:
        flat = dict(d)
        if "orders" in d and d["orders"]:
            flat["order_no"] = d["orders"].get("order_no")
            flat["order_total"] = d["orders"].get("total")
            flat["order_created_at"] = d["orders"].get("created_at")
        if "app_users" in d and d["app_users"]:
            flat["customer_name"] = d["app_users"].get("name")
        # cleanup nested
        flat.pop("orders", None)
        flat.pop("app_users", None)
        out.append(flat)
    return out


def update_refund_status(refund_id: str, status: str, admin_response: str, admin_id: str) -> dict:
    """Approve or reject a refund request."""
    now_ts = datetime.now(timezone.utc).isoformat()
    if local_postgres.is_enabled():
        with local_postgres.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE public.refunds
                    SET status = %s, admin_response = %s, reviewed_by = %s, reviewed_at = %s, updated_at = %s
                    WHERE id = %s
                    RETURNING *
                    """,
                    (status, admin_response, admin_id, now_ts, now_ts, refund_id)
                )
                row = cur.fetchone()
                if not row:
                    raise RuntimeError("Refund not found")
                cols = [desc.name for desc in cur.description]
                return local_postgres._serialize(dict(zip(cols, row)))

    client = get_client()
    if not client:
        raise RuntimeError("Database not configured")
    fields = {
        "status": status,
        "admin_response": admin_response,
        "reviewed_by": admin_id,
        "reviewed_at": now_ts,
        "updated_at": now_ts
    }
    resp = execute_query(client.table("refunds").update(fields).eq("id", refund_id))
    data = getattr(resp, "data", [])
    if not data:
        raise RuntimeError("Refund not found")
    return data[0]
