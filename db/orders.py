"""Create and read completed orders in the configured database.

Stage 3 writes frontend, chat, and voice orders to the database as the source of
truth. The legacy mirror helper remains for compatibility with historical
flat-file flows.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Literal

from db import postgres as local_postgres
from db.client import execute_query, get_client

log = logging.getLogger(__name__)

# The only three order channels â€” enforced at the API boundary in
# api/routes.py (checkout_cart); this alias is a static-typing mirror of that
# same set for every function here that accepts or filters by `type`.
OrderType = Literal["online", "dine_in", "takeaway"]

# Kitchen: received -> preparing -> ready_for_pickup. Delivery:
# ready_for_pickup -> out_for_delivery -> delivered. Sequential only â€” one
# step at a time, no skipping/going backward (db/orders.py:update_order_status
# enforces this; it's the only writer of `status` after order creation).
ORDER_STATUS_SEQUENCE = [
    "received",
    "preparing",
    "ready_for_pickup",
    "out_for_delivery",
    "delivered",
]

_STATUS_TIMESTAMP_COLUMN = {
    "preparing": "preparing_at",
    "ready_for_pickup": "ready_at",
    "out_for_delivery": "out_for_delivery_at",
    "delivered": "delivered_at",
}


def mirror_order(
    *,
    name: str,
    phone: str,
    bill,
    payment_mode: str,
    order_no: str,
    timestamp: str,
    source: str = "api",
    session_id: str | None = None,
    language: str | None = None,
) -> str | None:
    """Insert one order row mirroring the .txt log. Returns order_no or None."""
    client = get_client()
    if client is None:
        return None
    row = {
        "order_no": order_no,
        "session_id": session_id,
        "source": source,
        "customer_name": name,
        "customer_phone": phone,
        "base_name": bill.base.name,
        "pizza_name": bill.pizza.name,
        "topping_name": bill.topping.name,
        "unit_price": bill.unit_price,
        "quantity": bill.quantity,
        "subtotal": bill.subtotal,
        "discount": bill.discount,
        "gst": bill.gst,
        "total": bill.total,
        "payment_mode": payment_mode,
        "language": language,
        "logged_at": timestamp,
    }
    try:
        execute_query(client.table("orders").insert(row))
        return order_no
    except Exception as exc:
        log.warning("Supabase order mirror failed (order %s): %s", order_no, exc)
        return None


def create_order(
    *,
    user_id: str | None,
    name: str,
    phone: str,
    items: list[dict],
    subtotal: float,
    discount: float,
    gst: float,
    total: float,
    payment_mode: str,
    source: str = "api",
    session_id: str | None = None,
    language: str | None = None,
    status: str = "received",
    delivery_address: str | None = None,
    type: OrderType = "online",
) -> str:
    """Create ONE order row for an API/frontend cart (DB is the source of truth
    for these â€” they are NOT written to orders_log.txt).

    One row per checkout; the per-line breakdown lives in `items` (jsonb) and the
    money fields are the cart totals (each line still priced by core/pricing).
    `order_no` is omitted so the DB default generates it (SM-YYYYMMDD-NNNN).
    Unlike the best-effort mirror, this RAISES on failure â€” the caller must
    surface it, since there is no .txt fallback for API orders.
    """
    if local_postgres.is_enabled():
        return local_postgres.create_order(
            user_id=user_id,
            name=name,
            phone=phone,
            items=items,
            subtotal=subtotal,
            discount=discount,
            gst=gst,
            total=total,
            payment_mode=payment_mode,
            source=source,
            session_id=session_id,
            language=language,
            status=status,
            delivery_address=delivery_address,
            type=type,
        )

    client = get_client()
    if client is None:
        raise RuntimeError("Order database is not configured.")
    row = {
        "user_id": user_id,
        "session_id": session_id,
        "source": source,
        "customer_name": name,
        "customer_phone": phone,
        "items": items,
        "subtotal": subtotal,
        "discount": discount,
        "gst": gst,
        "total": total,
        "payment_mode": payment_mode,
        "language": language,
        "status": status,
        "delivery_address": delivery_address,
        "type": type,
    }
    resp = execute_query(client.table("orders").insert(row))
    data = getattr(resp, "data", None)
    if not data:
        raise RuntimeError("Order insert returned no row.")
    return data[0].get("order_no")


def update_order_status(order_no: str, new_status: str, performed_by: str | None = None) -> dict:
    """Advance one order exactly one step in ORDER_STATUS_SEQUENCE (kitchen:
    preparing/ready_for_pickup; delivery: out_for_delivery/delivered), stamping
    the matching `..._at` timestamp column. Raises ValueError on an unknown
    order_no, an unknown status, or an illegal transition (skip, repeat, or
    backward) — the caller (api/routes.py) maps that to a 400. Raises
    RuntimeError if the DB is unavailable (status is DB-only, no .txt
    fallback, same convention as create_order)."""
    if local_postgres.is_enabled():
        return local_postgres.update_order_status(order_no, new_status, performed_by)

    client = get_client()
    if client is None:
        raise RuntimeError("Order database is not configured.")

    resp = execute_query(
        client.table("orders").select("status, rider_id, type").eq("order_no", order_no).limit(1)
    )
    rows = getattr(resp, "data", None) or []
    if not rows:
        raise ValueError(f"Order {order_no} not found.")
    current = rows[0]["status"]
    db_rider_id = rows[0].get("rider_id")
    order_type = rows[0].get("type")

    if new_status in {"out_for_delivery", "delivered"}:
        if order_type == "online":
            if not db_rider_id or (performed_by and str(db_rider_id) != str(performed_by)):
                raise ValueError("Only the assigned rider can advance this delivery order.")

    if new_status not in ORDER_STATUS_SEQUENCE:
        raise ValueError(f"Unknown status: {new_status}")
    current_idx = (
        ORDER_STATUS_SEQUENCE.index(current) if current in ORDER_STATUS_SEQUENCE else -1
    )
    new_idx = ORDER_STATUS_SEQUENCE.index(new_status)
    
    is_valid_jump = (order_type != "online" and current == "ready_for_pickup" and new_status == "delivered")
    
    if new_idx != current_idx + 1 and not is_valid_jump:
        next_legal = (
            ORDER_STATUS_SEQUENCE[current_idx + 1]
            if current_idx + 1 < len(ORDER_STATUS_SEQUENCE)
            else None
        )
        detail = (
            f" â€” next legal status is '{next_legal}'."
            if next_legal
            else " â€” already delivered."
        )
        raise ValueError(
            f"Cannot move order {order_no} from '{current}' to '{new_status}'{detail}"
        )

    fields: dict = {"status": new_status}
    ts_col = _STATUS_TIMESTAMP_COLUMN.get(new_status)
    if ts_col:
        fields[ts_col] = datetime.now(timezone.utc).isoformat()

    resp = execute_query(client.table("orders").update(fields).eq("order_no", order_no))
    data = getattr(resp, "data", None)
    if not data:
        raise RuntimeError(f"Order {order_no} status update returned no row.")
    return data[0]


def get_delivery_stats() -> dict:
    """Today's delivered count + each delivered order's pickup->delivered
    minutes (out_for_delivery_at -> delivered_at). Interim scope: global, not
    per-rider — no rider assignment exists yet (matches list_recent_orders)."""
    if local_postgres.is_enabled():
        return local_postgres.get_delivery_stats()

    client = get_client()
    if client is None:
        raise RuntimeError("Order database is not configured.")

    today = datetime.now(timezone.utc).date().isoformat()
    resp = execute_query(
        client.table("orders")
        .select("order_no,out_for_delivery_at,delivered_at")
        .eq("status", "delivered")
        .gte("delivered_at", today)
        .order("delivered_at", desc=True)
    )
    rows = getattr(resp, "data", None) or []

    orders = []
    for row in rows:
        minutes = None
        picked_up_at, delivered_at = row.get("out_for_delivery_at"), row.get(
            "delivered_at"
        )
        if picked_up_at and delivered_at:
            start = datetime.fromisoformat(picked_up_at)
            end = datetime.fromisoformat(delivered_at)
            minutes = round((end - start).total_seconds() / 60, 1)
        orders.append(
            {
                "order_no": row["order_no"],
                "delivered_at": delivered_at,
                "pickup_to_delivered_minutes": minutes,
            }
        )
    return {"delivered_today": len(orders), "orders": orders}


def list_orders_by_user(
    user_id: str,
    limit: int = 50,
    order_type: OrderType | None = None,
    status: str | None = None,
) -> list[dict]:
    """Return a user's orders, newest first. Empty list if the DB is absent."""
    if local_postgres.is_enabled():
        return local_postgres.list_orders_by_user(
            user_id, limit, order_type=order_type, status=status
        )

    client = get_client()
    if client is None:
        return []

    query = client.table("orders").select("*").eq("user_id", user_id)
    if order_type:
        query = query.eq("type", order_type)
    if status:
        query = query.eq("status", status)

    resp = execute_query(query.order("created_at", desc=True).limit(limit))
    return getattr(resp, "data", None) or []


def list_recent_orders(
    limit: int = 100, order_type: OrderType | None = None, status: str | None = None
) -> list[dict]:
    """ALL recent orders, newest first â€” the delivery rider's work queue.

    Interim: every rider sees every order (per-rider assignment is a future
    step). Raises if the DB is unavailable so the caller can surface it."""
    if local_postgres.is_enabled():
        return local_postgres.list_recent_orders(limit, order_type=order_type, status=status)

    client = get_client()
    if client is None:
        raise RuntimeError("Order database is not configured.")

    query = client.table("orders").select("*")
    if order_type:
        query = query.eq("type", order_type)
    if status:
        query = query.eq("status", status)

    resp = execute_query(query.order("created_at", desc=True).limit(limit))
    return getattr(resp, "data", None) or []


def list_orders_by_phone(
    phone: str,
    limit: int = 50,
    order_type: OrderType | None = None,
    status: str | None = None,
) -> list[dict]:
    """Return orders for a phone number, newest first (interim user filter until
    real auth lands and everything keys on user_id). Empty if the DB is absent."""
    if local_postgres.is_enabled():
        return local_postgres.list_orders_by_phone(phone, limit, order_type=order_type, status=status)

    client = get_client()
    if client is None:
        return []

    query = client.table("orders").select("*").eq("customer_phone", phone)
    if order_type:
        query = query.eq("type", order_type)
    if status:
        query = query.eq("status", status)

    resp = execute_query(query.order("created_at", desc=True).limit(limit))
    return getattr(resp, "data", None) or []


def accept_delivery_order(order_no: str, rider_id: str) -> dict | None:
    if local_postgres.is_enabled():
        return local_postgres.accept_delivery_order(order_no, rider_id)

    client = get_client()
    if client is None:
        raise RuntimeError("Order database is not configured.")

    resp = execute_query(
        client.table("orders")
        .update({"rider_id": rider_id})
        .eq("order_no", order_no)
        .is_("rider_id", "null")
        .eq("status", "ready_for_pickup")
    )
    data = getattr(resp, "data", None)
    if not data:
        return None
    return data[0]
