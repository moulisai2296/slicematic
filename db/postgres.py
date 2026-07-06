"""Local Postgres helpers for Stage 0 local development.

Supabase remains supported through db/client.py. This module is used when
DATABASE_PROVIDER=postgres and DATABASE_URL is set.
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from datetime import datetime, timezone

try:
    from dotenv import load_dotenv

    load_dotenv()
except Exception:
    pass


def is_enabled() -> bool:
    return os.environ.get("DATABASE_PROVIDER", "").lower() == "postgres"


def get_database_url() -> str:
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        raise RuntimeError("DATABASE_URL is required when DATABASE_PROVIDER=postgres.")
    return url


@contextmanager
def connect():
    import psycopg

    with psycopg.connect(get_database_url(), autocommit=True) as conn:
        yield conn


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
    type: str = "online",
) -> str:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into public.orders (
                    user_id, session_id, source, customer_name, customer_phone,
                    items, subtotal, discount, gst, total, payment_mode,
                    language, status, delivery_address, "type"
                )
                values (
                    %s, %s, %s, %s, %s,
                    %s::jsonb, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s
                )
                returning order_no
                """,
                (
                    user_id,
                    session_id,
                    source,
                    name,
                    phone,
                    _json(items),
                    subtotal,
                    discount,
                    gst,
                    total,
                    payment_mode,
                    language,
                    status,
                    delivery_address,
                    type,
                ),
            )
            row = cur.fetchone()
    if not row:
        raise RuntimeError("Order insert returned no row.")
    return row[0]


def list_orders_by_user(
    user_id: str,
    limit: int = 50,
    order_type: str | None = None,
    status: str | None = None,
) -> list[dict]:
    with connect() as conn:
        with conn.cursor() as cur:
            sql = "select * from public.orders where user_id = %s"
            params = [user_id]
            if order_type:
                sql += ' and "type" = %s'
                params.append(order_type)
            if status:
                sql += " and status = %s"
                params.append(status)
            sql += " order by created_at desc limit %s"
            params.append(limit)
            cur.execute(sql, tuple(params))
            cols = [desc.name for desc in cur.description]
            rows = cur.fetchall()
    return [_serialize(dict(zip(cols, row))) for row in rows]


def _json(value) -> str:
    import json

    return json.dumps(value)


def _serialize(row: dict) -> dict:
    out = {}
    for key, value in row.items():
        if isinstance(value, datetime):
            out[key] = value.astimezone(timezone.utc).isoformat()
        else:
            out[key] = value
    return out


def update_order_status(order_no: str, new_status: str, performed_by: str | None = None) -> dict:
    import psycopg
    from datetime import datetime, timezone
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
    
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "select status, rider_id, type from public.orders where order_no = %s",
                (order_no,),
            )
            row = cur.fetchone()
            if not row:
                raise ValueError(f"Order {order_no} not found.")
            current, db_rider_id, order_type = row[0], row[1], row[2]
            
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
            
            # Non-online orders (takeaway/dine_in) skip 'out_for_delivery'
            is_valid_jump = (order_type != "online" and current == "ready_for_pickup" and new_status == "delivered")
            
            if new_idx != current_idx + 1 and not is_valid_jump:
                next_legal = (
                    ORDER_STATUS_SEQUENCE[current_idx + 1]
                    if current_idx + 1 < len(ORDER_STATUS_SEQUENCE)
                    else None
                )
                detail = (
                    f" — next legal status is '{next_legal}'."
                    if next_legal
                    else " — already delivered."
                )
                raise ValueError(
                    f"Cannot move order {order_no} from '{current}' to '{new_status}'{detail}"
                )
                
            ts_col = _STATUS_TIMESTAMP_COLUMN.get(new_status)
            if ts_col:
                now_str = datetime.now(timezone.utc).isoformat()
                cur.execute(
                    f"update public.orders set status = %s, {ts_col} = %s where order_no = %s returning *",
                    (new_status, now_str, order_no),
                )
            else:
                cur.execute(
                    "update public.orders set status = %s where order_no = %s returning *",
                    (new_status, order_no),
                )
            
            cols = [desc.name for desc in cur.description]
            updated_row = cur.fetchone()
            if not updated_row:
                raise RuntimeError(f"Order {order_no} status update returned no row.")
            return _serialize(dict(zip(cols, updated_row)))


def get_delivery_stats() -> dict:
    from datetime import datetime, timezone
    today = datetime.now(timezone.utc).date().isoformat()
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select order_no, out_for_delivery_at, delivered_at
                from public.orders
                where status = 'delivered' and delivered_at >= %s
                order by delivered_at desc
                """,
                (today,),
            )
            cols = [desc.name for desc in cur.description]
            rows = cur.fetchall()
            
    orders = []
    for row_data in rows:
        row = dict(zip(cols, row_data))
        minutes = None
        picked_up_at, delivered_at = row.get("out_for_delivery_at"), row.get("delivered_at")
        if picked_up_at and delivered_at:
            if isinstance(picked_up_at, str):
                start = datetime.fromisoformat(picked_up_at)
            else:
                start = picked_up_at
            if isinstance(delivered_at, str):
                end = datetime.fromisoformat(delivered_at)
            else:
                end = delivered_at
            minutes = round((end - start).total_seconds() / 60, 1)
        orders.append(
            {
                "order_no": row["order_no"],
                "delivered_at": delivered_at.isoformat() if isinstance(delivered_at, datetime) else delivered_at,
                "pickup_to_delivered_minutes": minutes,
            }
        )
    return {"delivered_today": len(orders), "orders": orders}


def list_recent_orders(
    limit: int = 100, order_type: str | None = None, status: str | None = None
) -> list[dict]:
    with connect() as conn:
        with conn.cursor() as cur:
            sql = "select * from public.orders"
            conds = []
            params = []
            if order_type:
                conds.append('"type" = %s')
                params.append(order_type)
            if status:
                conds.append("status = %s")
                params.append(status)
            if conds:
                sql += " where " + " and ".join(conds)
            sql += " order by created_at desc limit %s"
            params.append(limit)
            
            cur.execute(sql, tuple(params))
            cols = [desc.name for desc in cur.description]
            rows = cur.fetchall()
    return [_serialize(dict(zip(cols, r))) for r in rows]


def list_orders_by_phone(
    phone: str,
    limit: int = 50,
    order_type: str | None = None,
    status: str | None = None,
) -> list[dict]:
    with connect() as conn:
        with conn.cursor() as cur:
            sql = "select * from public.orders where customer_phone = %s"
            params = [phone]
            if order_type:
                sql += ' and "type" = %s'
                params.append(order_type)
            if status:
                sql += " and status = %s"
                params.append(status)
            sql += " order by created_at desc limit %s"
            params.append(limit)
            
            cur.execute(sql, tuple(params))
            cols = [desc.name for desc in cur.description]
            rows = cur.fetchall()
    return [_serialize(dict(zip(cols, r))) for r in rows]


def accept_delivery_order(order_no: str, rider_id: str) -> dict | None:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update public.orders
                set rider_id = %s
                where order_no = %s and rider_id is null and status = 'ready_for_pickup'
                returning *
                """,
                (rider_id, order_no),
            )
            cols = [desc.name for desc in cur.description]
            row = cur.fetchone()
            if not row:
                return None
            return _serialize(dict(zip(cols, row)))
