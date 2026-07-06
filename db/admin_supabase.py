"""Supabase REST-backed admin data access.

This module mirrors the public functions used by api/admin_routes.py and
api/staff_routes.py without requiring DATABASE_URL or a local Postgres server.
It intentionally uses the existing service-role Supabase client from db.client.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

from db.admin import (
    ORDER_STATUSES,
    STAFF_NEXT_STATUS,
    STAFF_ORDER_STATUSES,
    AdminDatabaseNotConfigured,
)
from db.client import execute_query, get_client


def _client():
    client = get_client()
    if client is None:
        raise AdminDatabaseNotConfigured(
            "Supabase admin DB requires SUPABASE_URL and SUPABASE_SERVICE_KEY."
        )
    return client


def _rows(resp) -> list[dict]:
    return getattr(resp, "data", None) or []


def _one(resp) -> dict | None:
    rows = _rows(resp)
    return rows[0] if rows else None


def _select(table: str, columns: str = "*", limit: int | None = None) -> list[dict]:
    query = _client().table(table).select(columns)
    if limit is not None:
        query = query.limit(limit)
    return _rows(execute_query(query))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _today_prefix() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _num(value) -> float:
    return float(value or 0)


def _item_quantity(items: list[dict], key: str = "pizza") -> Counter:
    counts: Counter = Counter()
    for item in items or []:
        name = item.get(key)
        qty = int(item.get("quantity") or 1)
        if name:
            counts[name] += qty
    return counts


def _audit(
    *,
    action_type: str,
    entity_type: str,
    entity_id: str | None,
    old_value=None,
    new_value=None,
    performed_by: str | None = None,
    reason: str | None = None,
) -> None:
    try:
        execute_query(
            _client()
            .table("audit_logs")
            .insert(
                {
                    "action_type": action_type,
                    "entity_type": entity_type,
                    "entity_id": entity_id,
                    "old_value": old_value,
                    "new_value": new_value,
                    "performed_by": performed_by,
                    "reason": reason,
                }
            )
        )
    except Exception:
        pass


def _settings_map() -> dict:
    out = {}
    for row in _select("app_settings"):
        value = row.get("value")
        out[row["key"]] = value.get("value") if isinstance(value, dict) else value
    return out


def _roles_by_id() -> dict:
    return {row["id"]: row for row in _select("roles")}


def _permissions_by_id() -> dict:
    return {row["id"]: row for row in _select("permissions")}


def get_user_by_email(email: str) -> dict | None:
    user = _one(
        execute_query(
            _client().table("app_users").select("*").ilike("email", email).limit(1)
        )
    )
    if not user:
        return None

    role_ids = [
        row["role_id"]
        for row in _select("user_roles")
        if row.get("user_id") == user.get("id")
    ]
    roles_map = _roles_by_id()
    user["roles"] = [roles_map[rid]["name"] for rid in role_ids if rid in roles_map]

    permission_ids = [
        row["permission_id"]
        for row in _select("role_permissions")
        if row.get("role_id") in role_ids
    ]
    permissions_map = _permissions_by_id()
    user["permissions"] = [
        permissions_map[pid]["code"] for pid in permission_ids if pid in permissions_map
    ]
    user["full_name"] = user.get("full_name") or user.get("name") or ""
    user.pop("secret_hash", None)
    return user


def _orders(limit: int = 1000) -> list[dict]:
    return _rows(
        execute_query(
            _client()
            .table("orders")
            .select("*")
            .order("created_at", desc=True)
            .limit(limit)
        )
    )


def _payments() -> list[dict]:
    return _select("payments")


def _latest_payment_by_order() -> dict:
    payments = sorted(
        _payments(), key=lambda r: r.get("created_at") or "", reverse=True
    )
    latest = {}
    for payment in payments:
        latest.setdefault(payment.get("order_id"), payment)
    return latest


def _order_with_payment(order: dict, latest_payment: dict | None = None) -> dict:
    payment = latest_payment or {}
    return {
        **order,
        "payment_status": payment.get("payment_status", "Pending"),
        "amount_paid": _num(payment.get("amount_paid")),
    }


def get_dashboard_metrics() -> dict:
    orders = _orders()
    today_orders = [
        o for o in orders if str(o.get("created_at", "")).startswith(_today_prefix())
    ]
    revenue = sum(_num(o.get("total")) for o in today_orders)
    status_counts = Counter(str(o.get("status") or "").lower() for o in today_orders)
    pizzas = Counter()
    hourly = defaultdict(lambda: {"hour": 0, "orders": 0, "revenue": 0.0})
    for order in orders:
        pizzas.update(_item_quantity(order.get("items") or []))
        try:
            hour = datetime.fromisoformat(
                str(order.get("created_at")).replace("Z", "+00:00")
            ).hour
        except Exception:
            hour = 0
        hourly[hour]["hour"] = hour
        hourly[hour]["orders"] += 1
        hourly[hour]["revenue"] += _num(order.get("total"))

    today = {
        "total_orders": len(today_orders),
        "revenue": round(revenue, 2),
        "average_order_value": (
            round(revenue / len(today_orders), 2) if today_orders else 0
        ),
        "pending_orders": status_counts["received"] + status_counts["created"],
        "preparing_orders": status_counts["preparing"],
        "completed_orders": status_counts["completed"] + status_counts["delivered"],
        "cancelled_orders": status_counts["cancelled"],
        "refund_requests": len(
            [r for r in _select("refunds") if r.get("status") == "Requested"]
        ),
    }
    peak_hour = max(hourly.values(), key=lambda r: r["orders"], default={})
    return {
        "today": today,
        "recent_orders": [
            {
                "order_no": o.get("order_no"),
                "customer_name": o.get("customer_name"),
                "total": _num(o.get("total")),
                "payment_mode": o.get("payment_mode"),
                "status": o.get("status"),
                "created_at": o.get("created_at"),
            }
            for o in orders[:8]
        ],
        "top_pizzas": [
            {"name": name, "quantity": qty} for name, qty in pizzas.most_common(5)
        ],
        "peak_hour": peak_hour,
        "low_inventory_alerts": count_low_inventory(),
        "ai_summary": _build_metric_cards(today, peak_hour),
        "ai_insights": [
            "Supabase admin mode is active.",
            f"{today['total_orders']} orders recorded today.",
        ],
    }


def _build_metric_cards(today: dict, peak_hour: dict) -> list[dict]:
    return [
        {
            "title": "Revenue",
            "value": f"Rs {today.get('revenue', 0):.0f}",
            "summary": "Today's revenue from Supabase orders.",
            "detail": "Computed from public.orders through the Supabase service API.",
        },
        {
            "title": "Peak Hour",
            "value": str(peak_hour.get("hour", "-")),
            "summary": "Busiest hour in the current order sample.",
            "detail": "Use seeded/demo data for richer local dashboards.",
        },
    ]


def list_orders(
    *,
    status_filter: str | None = None,
    payment_mode: str | None = None,
    payment_status: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    customer_search: str | None = None,
    source: str | None = None,
    total_min: float | None = None,
    total_max: float | None = None,
    limit: int = 100,
) -> list[dict]:
    latest = _latest_payment_by_order()
    rows = [
        _order_with_payment(o, latest.get(o.get("id")))
        for o in _orders(max(limit, 500))
    ]
    if status_filter:
        rows = [r for r in rows if r.get("status") == status_filter]
    if payment_mode:
        rows = [r for r in rows if r.get("payment_mode") == payment_mode]
    if payment_status:
        rows = [r for r in rows if r.get("payment_status") == payment_status]
    if date_from:
        rows = [r for r in rows if str(r.get("created_at", ""))[:10] >= date_from]
    if date_to:
        rows = [r for r in rows if str(r.get("created_at", ""))[:10] <= date_to]
    if customer_search:
        needle = customer_search.strip().lower()
        rows = [
            r
            for r in rows
            if needle in str(r.get("customer_name", "")).lower()
            or needle in str(r.get("customer_phone", "")).lower()
            or needle in str(r.get("order_no", "")).lower()
        ]
    if source:
        rows = [r for r in rows if r.get("source") == source]
    if total_min is not None:
        rows = [r for r in rows if _num(r.get("total")) >= total_min]
    if total_max is not None:
        rows = [r for r in rows if _num(r.get("total")) <= total_max]
    return rows[: max(1, min(limit, 500))]


def get_order_detail(order_id: str) -> dict:
    order = _one(
        execute_query(_client().table("orders").select("*").eq("id", order_id).limit(1))
    )
    if not order:
        raise LookupError("Order not found.")
    latest = _latest_payment_by_order()
    return {
        "order": _order_with_payment(order, latest.get(order_id)),
        "status_history": [
            r for r in _select("order_status_history") if r.get("order_id") == order_id
        ],
        "payments": [r for r in _payments() if r.get("order_id") == order_id],
        "refunds": [r for r in _select("refunds") if r.get("order_id") == order_id],
        "inventory_deductions": [
            r
            for r in _select("order_inventory_deductions")
            if r.get("order_id") == order_id
        ],
    }


def update_order_status(
    order_id: str,
    *,
    new_status: str,
    performed_by: str,
    reason: str | None = None,
) -> dict:
    new_status = new_status.strip().lower()
    if new_status not in ORDER_STATUSES:
        raise ValueError("Unsupported order status.")
    old = _one(
        execute_query(_client().table("orders").select("*").eq("id", order_id).limit(1))
    )
    if not old:
        raise LookupError("Order not found.")
    updated = _one(
        execute_query(
            _client().table("orders").update({"status": new_status}).eq("id", order_id)
        )
    )
    execute_query(
        _client()
        .table("order_status_history")
        .insert(
            {
                "order_id": order_id,
                "old_status": old.get("status"),
                "new_status": new_status,
                "changed_by": performed_by,
                "reason": reason,
            }
        )
    )
    _audit(
        action_type="order.status.updated",
        entity_type="order",
        entity_id=order_id,
        old_value={"status": old.get("status")},
        new_value={"status": new_status},
        performed_by=performed_by,
        reason=reason,
    )
    return updated


def list_staff_orders(limit: int = 50) -> list[dict]:
    rows = [
        r for r in list_orders(limit=500) if r.get("status") in STAFF_ORDER_STATUSES
    ]
    order_rank = {
        "confirmed": 1,
        "preparing": 2,
        "ready_for_pickup": 3,
        "received": 4,
    }
    return sorted(
        rows,
        key=lambda r: (order_rank.get(r.get("status"), 9), r.get("created_at") or ""),
    )[:limit]


def advance_staff_order(
    order_id: str, *, performed_by: str, reason: str | None = None
) -> dict:
    order = _one(
        execute_query(
            _client().table("orders").select("status").eq("id", order_id).limit(1)
        )
    )
    if not order:
        raise LookupError("Order not found.")
    next_status = STAFF_NEXT_STATUS.get(order.get("status"))
    if not next_status:
        raise ValueError(f"Order cannot be advanced from {order.get('status')}.")
    return update_order_status(
        order_id,
        new_status=next_status,
        performed_by=performed_by,
        reason=reason or "Staff kitchen advance",
    )


def create_staff_order(
    *,
    customer_name: str,
    customer_phone: str,
    items: list[dict],
    subtotal: float,
    discount: float,
    gst: float,
    total: float,
    payment_mode: str,
    performed_by: str,
    type: str = "dine_in",
) -> dict:
    if payment_mode not in {"Cash", "Card", "UPI"}:
        raise ValueError("Unsupported payment mode.")
    order = _one(
        execute_query(
            _client()
            .table("orders")
            .insert(
                {
                    "user_id": None,
                    "source": "staff_pos",
                    "customer_name": customer_name,
                    "customer_phone": customer_phone,
                    "items": items,
                    "subtotal": subtotal,
                    "discount": discount,
                    "gst": gst,
                    "total": total,
                    "payment_mode": payment_mode,
                    "status": "confirmed",
                    "type": type,
                }
            )
        )
    )
    if order:
        execute_query(
            _client()
            .table("payments")
            .insert(
                {
                    "order_id": order["id"],
                    "payment_mode": payment_mode,
                    "payment_status": "Paid" if payment_mode == "Cash" else "Pending",
                    "amount_paid": total if payment_mode == "Cash" else 0,
                }
            )
        )
    _audit(
        action_type="order.staff_created",
        entity_type="order",
        entity_id=order.get("id") if order else None,
        new_value=order,
        performed_by=performed_by,
    )
    return _order_with_payment(order or {})


def list_menu_items() -> dict:
    categories = sorted(
        _select("menu_categories"),
        key=lambda r: (r.get("sort_order") or 0, r.get("name") or ""),
    )
    cat_by_id = {c["id"]: c for c in categories}
    items = []
    for row in _select("menu_items"):
        if row.get("is_deleted"):
            continue
        cat = cat_by_id.get(row.get("category_id"), {})
        items.append(
            {
                **row,
                "category": cat.get("code"),
                "category_name": cat.get("name"),
            }
        )
    items.sort(key=lambda r: (r.get("category_name") or "", r.get("item_code") or ""))
    return {"items": items, "categories": categories}


def _increment_menu_version():
    client_instance = _client()
    resp = execute_query(
        client_instance.table("app_settings").select("value").eq("id", "menu_version").limit(1)
    )
    rows = getattr(resp, "data", None) or []
    if rows:
        current = rows[0].get("value", {}).get("value", 1)
        execute_query(
            client_instance.table("app_settings")
            .update({"value": {"value": current + 1}})
            .eq("id", "menu_version")
        )
    else:
        execute_query(
            client_instance.table("app_settings")
            .insert({"id": "menu_version", "value": {"value": 2}})
        )


def create_menu_category(
    *,
    code: str,
    name: str,
    performed_by: str,
    sort_order: int | None = None,
    reason: str | None = None,
) -> dict:
    normalized = code.strip().lower().replace(" ", "_")
    if not normalized:
        raise ValueError("Category code is required.")
    if not name.strip():
        raise ValueError("Category name is required.")
    if sort_order is None:
        sort_order = (
            max(
                [int(c.get("sort_order") or 0) for c in _select("menu_categories")]
                or [0]
            )
            + 1
        )
    row = _one(
        execute_query(
            _client()
            .table("menu_categories")
            .upsert(
                {"code": normalized, "name": name.strip(), "sort_order": sort_order},
                on_conflict="code",
            )
        )
    )
    _audit(
        action_type="menu.category.upserted",
        entity_type="menu_category",
        entity_id=row.get("id"),
        new_value=row,
        performed_by=performed_by,
        reason=reason,
    )
    _increment_menu_version()
    return row


def delete_menu_category(category_id: str, performed_by: str) -> dict:
    cat = _one(
        execute_query(
            _client().table("menu_categories").select("*").eq("id", category_id)
        )
    )
    if not cat:
        raise LookupError("Menu category not found.")

    if cat["code"] in ("base", "pizza", "topping", "side"):
        raise ValueError(
            "Core categories (base, pizza, topping, side) cannot be deleted."
        )

    execute_query(_client().table("menu_items").delete().eq("category_id", category_id))

    deleted = _one(
        execute_query(_client().table("menu_categories").delete().eq("id", category_id))
    )

    _audit(
        action_type="menu.category.deleted",
        entity_type="menu_category",
        entity_id=category_id,
        old_value=cat,
        new_value=None,
        performed_by=performed_by,
        reason="Admin hard delete",
    )
    _increment_menu_version()
    return deleted


def create_menu_item(
    *,
    category: str,
    item_code: str,
    name: str,
    price: float,
    is_available: bool,
    performed_by: str,
    reason: str | None = None,
) -> dict:
    if not item_code.strip() or not name.strip():
        raise ValueError("Menu item code and name are required.")
    if price < 0:
        raise ValueError("Price must be non-negative.")
    cat = next(
        (c for c in _select("menu_categories") if c.get("code") == category), None
    )
    if not cat:
        raise LookupError("Menu category not found.")
    row = _one(
        execute_query(
            _client()
            .table("menu_items")
            .insert(
                {
                    "item_code": item_code.strip().upper(),
                    "category_id": cat["id"],
                    "name": name.strip(),
                    "price": price,
                    "is_available": is_available,
                }
            )
        )
    )
    execute_query(
        _client()
        .table("price_history")
        .insert(
            {
                "menu_item_id": row["id"],
                "old_price": None,
                "new_price": price,
                "changed_by": performed_by,
                "reason": reason,
            }
        )
    )
    row.update({"category": cat.get("code"), "category_name": cat.get("name")})
    _audit(
        action_type="menu.item.created",
        entity_type="menu_item",
        entity_id=row.get("id"),
        new_value=row,
        performed_by=performed_by,
        reason=reason,
    )
    _increment_menu_version()
    return row


def update_menu_item(
    item_id: str,
    *,
    name: str,
    price: float,
    is_available: bool,
    image_url: str | None = None,
    performed_by: str,
    reason: str | None = None,
) -> dict:
    if not name.strip():
        raise ValueError("Menu item name is required.")
    if price < 0:
        raise ValueError("Price must be non-negative.")
    old = _one(
        execute_query(
            _client().table("menu_items").select("*").eq("id", item_id).limit(1)
        )
    )
    if not old or old.get("is_deleted"):
        raise LookupError("Menu item not found.")
        
    update_data = {
        "name": name.strip(),
        "price": price,
        "is_available": is_available,
        "updated_at": _now(),
    }
    if image_url is not None:
        update_data["image_url"] = image_url

    row = _one(
        execute_query(
            _client()
            .table("menu_items")
            .update(update_data)
            .eq("id", item_id)
        )
    )
    if _num(old.get("price")) != _num(price):
        execute_query(
            _client()
            .table("price_history")
            .insert(
                {
                    "menu_item_id": item_id,
                    "old_price": old.get("price"),
                    "new_price": price,
                    "changed_by": performed_by,
                    "reason": reason,
                }
            )
        )
    cat = (
        _one(
            execute_query(
                _client()
                .table("menu_categories")
                .select("*")
                .eq("id", row.get("category_id"))
                .limit(1)
            )
        )
        or {}
    )
    row.update({"category": cat.get("code"), "category_name": cat.get("name")})
    _audit(
        action_type="menu.item.updated",
        entity_type="menu_item",
        entity_id=item_id,
        old_value=old,
        new_value=row,
        performed_by=performed_by,
        reason=reason,
    )
    _increment_menu_version()
    return row


def soft_delete_menu_item(
    item_id: str, *, performed_by: str, reason: str | None = None
) -> dict:
    old = _one(
        execute_query(
            _client().table("menu_items").select("*").eq("id", item_id).limit(1)
        )
    )
    if not old or old.get("is_deleted"):
        raise LookupError("Menu item not found.")
    row = _one(
        execute_query(
            _client()
            .table("menu_items")
            .update({"is_deleted": True, "is_available": False, "updated_at": _now()})
            .eq("id", item_id)
        )
    )
    _audit(
        action_type="menu.item.soft_deleted",
        entity_type="menu_item",
        entity_id=item_id,
        old_value=old,
        new_value=row,
        performed_by=performed_by,
        reason=reason,
    )
    _increment_menu_version()
    return row


def list_price_history(limit: int = 100) -> list[dict]:
    menu = {i["id"]: i for i in _select("menu_items")}
    cats = {c["id"]: c for c in _select("menu_categories")}
    users = {u["id"]: u for u in _select("app_users")}
    rows = _rows(
        execute_query(
            _client()
            .table("price_history")
            .select("*")
            .order("changed_at", desc=True)
            .limit(max(1, min(limit, 500)))
        )
    )
    out = []
    for row in rows:
        item = menu.get(row.get("menu_item_id"), {})
        cat = cats.get(item.get("category_id"), {})
        user = users.get(row.get("changed_by"), {})
        out.append(
            {
                **row,
                "item_code": item.get("item_code"),
                "menu_item_name": item.get("name"),
                "category": cat.get("code"),
                "category_name": cat.get("name"),
                "changed_by_name": user.get("full_name") or user.get("name"),
            }
        )
    return out


def get_pricing_settings() -> dict:
    settings = _settings_map()
    conditions = {
        r.get("discount_rule_id"): r for r in _select("discount_rule_conditions")
    }
    discounts = []
    for row in sorted(
        _select("discount_rules"),
        key=lambda r: (not bool(r.get("is_active")), r.get("updated_at") or ""),
        reverse=False,
    ):
        cond = conditions.get(row.get("id"), {})
        discounts.append(
            {
                **row,
                "min_quantity": cond.get("min_quantity"),
                "no_min_quantity": cond.get("no_min_quantity", True),
                "no_min_value": cond.get(
                    "no_min_value", _num(row.get("threshold_amount")) == 0
                ),
            }
        )
    return {
        "gst_rate_percent": float(settings.get("gst_rate_percent", 18)),
        "discount_rate_percent": float(settings.get("discount_rate_percent", 10)),
        "discount_quantity_threshold": int(
            settings.get("discount_quantity_threshold", 5)
        ),
        "discount_rules": discounts,
    }


def update_pricing_settings(
    *,
    gst_rate_percent: float,
    discount_rate_percent: float,
    discount_quantity_threshold: int,
    performed_by: str,
    reason: str | None = None,
) -> dict:
    if (
        not (0 <= gst_rate_percent <= 50)
        or not (0 <= discount_rate_percent <= 100)
        or discount_quantity_threshold < 1
    ):
        raise ValueError("Invalid pricing settings.")
    old = get_pricing_settings()
    for key, value in {
        "gst_rate_percent": gst_rate_percent,
        "discount_rate_percent": discount_rate_percent,
        "discount_quantity_threshold": discount_quantity_threshold,
    }.items():
        execute_query(
            _client()
            .table("app_settings")
            .upsert(
                {
                    "key": key,
                    "value": {"value": value},
                    "updated_by": performed_by,
                    "updated_at": _now(),
                },
                on_conflict="key",
            )
        )
    _audit(
        action_type="pricing.settings.updated",
        entity_type="pricing_settings",
        entity_id="global",
        old_value=old,
        new_value=get_pricing_settings(),
        performed_by=performed_by,
        reason=reason,
    )
    return get_pricing_settings()


def upsert_discount_rule(
    *,
    rule_id: str | None,
    name: str,
    coupon_code: str | None,
    description: str | None,
    discount_percent: float,
    threshold_amount: float,
    min_quantity: int | None = None,
    no_min_quantity: bool = True,
    no_min_value: bool = False,
    start_date: str | None,
    end_date: str | None,
    is_active: bool,
    performed_by: str,
    reason: str | None = None,
) -> dict:
    if not name.strip():
        raise ValueError("Discount name is required.")
    payload = {
        "name": name.strip(),
        "coupon_code": coupon_code,
        "description": description,
        "discount_percent": discount_percent,
        "threshold_amount": threshold_amount,
        "start_date": start_date,
        "end_date": end_date,
        "is_active": is_active,
        "updated_at": _now(),
    }
    if rule_id:
        old = _one(
            execute_query(
                _client().table("discount_rules").select("*").eq("id", rule_id).limit(1)
            )
        )
        if not old:
            raise LookupError("Discount rule not found.")
        row = _one(
            execute_query(
                _client().table("discount_rules").update(payload).eq("id", rule_id)
            )
        )
    else:
        row = _one(execute_query(_client().table("discount_rules").insert(payload)))
    try:
        execute_query(
            _client()
            .table("discount_rule_conditions")
            .upsert(
                {
                    "discount_rule_id": row["id"],
                    "min_quantity": min_quantity,
                    "no_min_quantity": no_min_quantity,
                    "no_min_value": no_min_value,
                },
                on_conflict="discount_rule_id",
            )
        )
    except Exception:
        pass
    _audit(
        action_type="discount.rule.upserted",
        entity_type="discount_rule",
        entity_id=row.get("id"),
        new_value=row,
        performed_by=performed_by,
        reason=reason,
    )
    return {
        **row,
        "min_quantity": min_quantity,
        "no_min_quantity": no_min_quantity,
        "no_min_value": no_min_value,
    }


def list_festival_coupon_suggestions(
    limit: int = 6, year: int | None = None
) -> list[dict]:
    rows = _select("indian_festival_calendar")
    if year:
        rows = [
            r for r in rows if str(r.get("festival_date", "")).startswith(str(year))
        ]
    rows = sorted(rows, key=lambda r: r.get("festival_date") or "")[:limit]
    return [
        {
            "festival_date": r.get("festival_date"),
            "name": r.get("name"),
            "coupon_theme": r.get("coupon_theme") or r.get("name"),
            "suggested_discount_percent": 10,
            "suggested_threshold_amount": 499,
            "suggested_coupon_code": _coupon_code_for_festival(r.get("name", "FEST")),
            "suggestion": f"Run a {r.get('name')} pizza coupon.",
            "source_type": "calendar",
        }
        for r in rows
    ]


def _coupon_code_for_festival(name: str) -> str:
    return "".join(ch for ch in name.upper() if ch.isalnum())[:8] + "10"


def list_staff() -> list[dict]:
    users = {u["id"]: u for u in _select("app_users")}
    rows = []
    for profile in _select("staff_profiles"):
        user = users.get(profile.get("user_id"), {})
        rows.append(
            {
                **profile,
                "full_name": user.get("full_name") or user.get("name"),
                "email": user.get("email"),
                "phone": user.get("phone"),
                "status": user.get("status", "active"),
            }
        )
    return rows


def list_roles() -> list[dict]:
    return sorted(_select("roles"), key=lambda r: r.get("name") or "")


def create_staff(
    *,
    full_name: str,
    email: str,
    phone: str | None,
    role_name: str,
    employee_code: str | None = None,
    performed_by: str,
    reason: str | None = None,
) -> dict:
    role = next((r for r in _select("roles") if r.get("name") == role_name), None)
    if not role:
        raise ValueError("Role not found.")
    user = _one(
        execute_query(
            _client()
            .table("app_users")
            .insert(
                {
                    "email": email,
                    "name": full_name,
                    "full_name": full_name,
                    "phone": phone,
                    "status": "active",
                    "role": "staff",
                    "secret_hash": "dev-only-admin-created",
                }
            )
        )
    )
    execute_query(
        _client()
        .table("user_roles")
        .insert({"user_id": user["id"], "role_id": role["id"]})
    )
    profile = _one(
        execute_query(
            _client()
            .table("staff_profiles")
            .insert(
                {
                    "user_id": user["id"],
                    "role_name": role_name,
                    "employee_code": employee_code
                    or f"SMEMP{str(user['id'])[:4].upper()}",
                    "is_active": True,
                }
            )
        )
    )
    profile.update(
        {"full_name": full_name, "email": email, "phone": phone, "status": "active"}
    )
    _audit(
        action_type="staff.created",
        entity_type="staff_profile",
        entity_id=profile.get("id"),
        new_value=profile,
        performed_by=performed_by,
        reason=reason,
    )
    return profile


def update_staff(
    staff_id: str,
    *,
    full_name: str,
    phone: str | None,
    role_name: str,
    is_active: bool,
    performed_by: str,
    reason: str | None = None,
) -> dict:
    profile = _one(
        execute_query(
            _client().table("staff_profiles").select("*").eq("id", staff_id).limit(1)
        )
    )
    if not profile:
        raise LookupError("Staff member not found.")
    execute_query(
        _client()
        .table("app_users")
        .update(
            {
                "full_name": full_name,
                "name": full_name,
                "phone": phone,
                "status": "active" if is_active else "inactive",
            }
        )
        .eq("id", profile["user_id"])
    )
    updated = _one(
        execute_query(
            _client()
            .table("staff_profiles")
            .update({"role_name": role_name, "is_active": is_active})
            .eq("id", staff_id)
        )
    )
    user = (
        _one(
            execute_query(
                _client()
                .table("app_users")
                .select("*")
                .eq("id", updated["user_id"])
                .limit(1)
            )
        )
        or {}
    )
    updated.update(
        {
            "full_name": user.get("full_name") or user.get("name"),
            "email": user.get("email"),
            "phone": user.get("phone"),
            "status": user.get("status"),
        }
    )
    _audit(
        action_type="staff.updated",
        entity_type="staff_profile",
        entity_id=staff_id,
        old_value=profile,
        new_value=updated,
        performed_by=performed_by,
        reason=reason,
    )
    return updated


def delete_staff(
    staff_id: str,
    *,
    performed_by: str,
    reason: str | None = None,
) -> dict:
    profile = _one(
        execute_query(
            _client().table("staff_profiles").select("*").eq("id", staff_id).limit(1)
        )
    )
    if not profile:
        raise LookupError("Staff member not found.")
    if str(profile.get("user_id")) == str(performed_by):
        raise ValueError("You cannot remove your own staff/admin account.")
    user = (
        _one(
            execute_query(
                _client()
                .table("app_users")
                .select("*")
                .eq("id", profile["user_id"])
                .limit(1)
            )
        )
        or {}
    )
    old = {
        **profile,
        "full_name": user.get("full_name") or user.get("name"),
        "email": user.get("email"),
        "phone": user.get("phone"),
        "status": user.get("status", "active"),
    }
    updated_user = (
        _one(
            execute_query(
                _client()
                .table("app_users")
                .update({"status": "inactive"})
                .eq("id", profile["user_id"])
            )
        )
        or {}
    )
    role = next((r for r in _select("roles") if r.get("name") == profile["role_name"]), None)
    if role:
        execute_query(
            _client()
            .table("user_roles")
            .delete()
            .eq("user_id", profile["user_id"])
            .eq("role_id", role["id"])
        )
    execute_query(_client().table("staff_profiles").delete().eq("id", staff_id))
    deleted = {
        **old,
        "status": updated_user.get("status", "inactive"),
    }
    _audit(
        action_type="staff.deleted",
        entity_type="staff_profile",
        entity_id=staff_id,
        old_value=old,
        new_value=deleted,
        performed_by=performed_by,
        reason=reason,
    )
    return deleted


def list_payments_and_refunds() -> dict:
    orders = {o["id"]: o for o in _orders()}
    payments = [
        {
            **p,
            "order_no": orders.get(p.get("order_id"), {}).get("order_no"),
            "customer_name": orders.get(p.get("order_id"), {}).get("customer_name"),
        }
        for p in _payments()
    ]
    refunds = [
        {
            **r,
            "order_no": orders.get(r.get("order_id"), {}).get("order_no"),
            "customer_name": orders.get(r.get("order_id"), {}).get("customer_name"),
        }
        for r in _select("refunds")
    ]
    return {"payments": payments, "refunds": refunds}


def request_refund(
    order_id: str, *, amount: float, reason: str, performed_by: str
) -> dict:
    if amount <= 0:
        raise ValueError("Refund amount must be positive.")
    order = _one(
        execute_query(_client().table("orders").select("*").eq("id", order_id).limit(1))
    )
    if not order:
        raise LookupError("Order not found.")
    row = _one(
        execute_query(
            _client()
            .table("refunds")
            .insert(
                {
                    "order_id": order_id,
                    "amount": amount,
                    "reason": reason,
                    "status": "Requested",
                    "requested_by": performed_by,
                }
            )
        )
    )
    return {
        **row,
        "order_no": order.get("order_no"),
        "customer_name": order.get("customer_name"),
    }


def decide_refund(
    refund_id: str, *, status: str, performed_by: str, reason: str | None = None
) -> dict:
    if status not in {"Approved", "Rejected", "Paid"}:
        raise ValueError("Unsupported refund status.")
    row = _one(
        execute_query(
            _client()
            .table("refunds")
            .update(
                {
                    "status": status,
                    "approved_by": performed_by,
                    "decided_at": _now(),
                }
            )
            .eq("id", refund_id)
        )
    )
    if not row:
        raise LookupError("Refund not found.")
    return row


def count_low_inventory() -> int:
    return len(
        [
            i
            for i in _select("ingredients")
            if i.get("is_active", True)
            and _num(i.get("stock_quantity")) <= _num(i.get("reorder_threshold"))
        ]
    )


def list_inventory() -> dict:
    ingredients = [
        {
            **i,
            "is_low_stock": _num(i.get("stock_quantity"))
            <= _num(i.get("reorder_threshold")),
        }
        for i in _select("ingredients")
    ]
    ing_by_id = {i["id"]: i for i in ingredients}
    transactions = [
        {**t, "ingredient_name": ing_by_id.get(t.get("ingredient_id"), {}).get("name")}
        for t in _select("stock_transactions")
    ]
    requests = [
        {
            **r,
            "ingredient_name": ing_by_id.get(r.get("ingredient_id"), {}).get("name"),
            "unit": ing_by_id.get(r.get("ingredient_id"), {}).get("unit"),
        }
        for r in _select("inventory_requests")
    ]
    menu = list_menu_items()["items"]
    menu_by_id = {m["id"]: m for m in menu}  # noqa: F841
    recipes_by_menu: dict[str, list] = defaultdict(list)
    for rec in _select("menu_item_ingredients"):
        ing = ing_by_id.get(rec.get("ingredient_id"), {})
        recipes_by_menu[rec.get("menu_item_id")].append(
            {**rec, "ingredient_name": ing.get("name"), "unit": ing.get("unit")}
        )
    recipes = [
        {
            **m,
            "menu_item_id": m["id"],
            "menu_item_name": m.get("name"),
            "ingredients": recipes_by_menu.get(m["id"], []),
        }
        for m in menu
    ]
    mapped = len([r for r in recipes if r["ingredients"]])
    total = len(recipes)
    return {
        "ingredients": ingredients,
        "transactions": transactions,
        "requests": requests,
        "recipes": recipes,
        "recipe_coverage": {
            "total_menu_items": total,
            "mapped_menu_items": mapped,
            "unmapped_menu_items": total - mapped,
            "coverage_percent": round((mapped / total) * 100, 1) if total else 0,
        },
    }


def create_ingredient(
    *,
    name: str,
    unit: str,
    stock_quantity: float,
    reorder_threshold: float,
    performed_by: str,
    reason: str | None = None,
) -> dict:
    row = _one(
        execute_query(
            _client()
            .table("ingredients")
            .insert(
                {
                    "name": name,
                    "unit": unit,
                    "stock_quantity": stock_quantity,
                    "reorder_threshold": reorder_threshold,
                    "is_active": True,
                }
            )
        )
    )
    _audit(
        action_type="inventory.ingredient.created",
        entity_type="ingredient",
        entity_id=row.get("id"),
        new_value=row,
        performed_by=performed_by,
        reason=reason,
    )
    return {
        **row,
        "is_low_stock": _num(row.get("stock_quantity"))
        <= _num(row.get("reorder_threshold")),
    }


def update_ingredient(
    ingredient_id: str,
    *,
    name: str,
    unit: str,
    reorder_threshold: float,
    is_active: bool,
    performed_by: str,
    reason: str | None = None,
) -> dict:
    old = _one(
        execute_query(
            _client().table("ingredients").select("*").eq("id", ingredient_id).limit(1)
        )
    )
    if not old:
        raise LookupError("Ingredient not found.")
    row = _one(
        execute_query(
            _client()
            .table("ingredients")
            .update(
                {
                    "name": name,
                    "unit": unit,
                    "reorder_threshold": reorder_threshold,
                    "is_active": is_active,
                    "updated_at": _now(),
                }
            )
            .eq("id", ingredient_id)
        )
    )
    return {
        **row,
        "is_low_stock": _num(row.get("stock_quantity"))
        <= _num(row.get("reorder_threshold")),
    }


def adjust_stock(
    ingredient_id: str,
    *,
    transaction_type: str,
    quantity: float,
    performed_by: str,
    reason: str | None = None,
) -> dict:
    ingredient = _one(
        execute_query(
            _client().table("ingredients").select("*").eq("id", ingredient_id).limit(1)
        )
    )
    if not ingredient:
        raise LookupError("Ingredient not found.")
    old_qty = _num(ingredient.get("stock_quantity"))
    new_qty = (
        old_qty + quantity if transaction_type == "StockIn" else old_qty - quantity
    )
    if new_qty < 0:
        raise ValueError("Stock cannot go below zero.")
    row = _one(
        execute_query(
            _client()
            .table("ingredients")
            .update({"stock_quantity": new_qty, "updated_at": _now()})
            .eq("id", ingredient_id)
        )
    )
    execute_query(
        _client()
        .table("stock_transactions")
        .insert(
            {
                "ingredient_id": ingredient_id,
                "transaction_type": transaction_type,
                "quantity": quantity,
                "old_quantity": old_qty,
                "new_quantity": new_qty,
                "reason": reason,
                "performed_by": performed_by,
            }
        )
    )
    return {
        **row,
        "is_low_stock": _num(row.get("stock_quantity"))
        <= _num(row.get("reorder_threshold")),
    }


def create_inventory_request(
    *, ingredient_id: str, requested_quantity: float, reason: str, performed_by: str
) -> dict:
    ing = _one(
        execute_query(
            _client().table("ingredients").select("*").eq("id", ingredient_id).limit(1)
        )
    )
    if not ing:
        raise LookupError("Ingredient not found.")
    row = _one(
        execute_query(
            _client()
            .table("inventory_requests")
            .insert(
                {
                    "ingredient_id": ingredient_id,
                    "requested_quantity": requested_quantity,
                    "reason": reason,
                    "status": "Requested",
                    "requested_by": performed_by,
                }
            )
        )
    )
    return {**row, "ingredient_name": ing.get("name"), "unit": ing.get("unit")}


def decide_inventory_request(
    request_id: str, *, status: str, performed_by: str, reason: str | None = None
) -> dict:
    if status not in {"Approved", "Rejected"}:
        raise ValueError("Unsupported request status.")
    row = _one(
        execute_query(
            _client()
            .table("inventory_requests")
            .update(
                {
                    "status": status,
                    "decided_by": performed_by,
                    "decided_at": _now(),
                }
            )
            .eq("id", request_id)
        )
    )
    if not row:
        raise LookupError("Inventory request not found.")
    return row


def upsert_menu_item_ingredient(
    *,
    menu_item_id: str,
    ingredient_id: str,
    quantity_per_unit: float,
    performed_by: str,
    reason: str | None = None,
) -> dict:
    row = _one(
        execute_query(
            _client()
            .table("menu_item_ingredients")
            .upsert(
                {
                    "menu_item_id": menu_item_id,
                    "ingredient_id": ingredient_id,
                    "quantity_per_unit": quantity_per_unit,
                },
                on_conflict="menu_item_id,ingredient_id",
            )
        )
    )
    ing = (
        _one(
            execute_query(
                _client()
                .table("ingredients")
                .select("*")
                .eq("id", ingredient_id)
                .limit(1)
            )
        )
        or {}
    )
    return {**row, "ingredient_name": ing.get("name"), "unit": ing.get("unit")}


def delete_menu_item_ingredient(
    recipe_id: str, *, performed_by: str, reason: str | None = None
) -> dict:
    row = _one(
        execute_query(
            _client().table("menu_item_ingredients").delete().eq("id", recipe_id)
        )
    )
    if not row:
        raise LookupError("Recipe mapping not found.")
    return row


def list_audit_logs(limit: int = 50) -> list[dict]:
    return _rows(
        execute_query(
            _client()
            .table("audit_logs")
            .select("*")
            .order("performed_at", desc=True)
            .limit(limit)
        )
    )


def get_analytics_report(
    date_from: str | None = None, date_to: str | None = None
) -> dict:
    rows = list_orders(date_from=date_from, date_to=date_to, limit=1000)
    total_orders = len(rows)
    revenue = sum(_num(r.get("total")) for r in rows)
    daily = defaultdict(lambda: {"orders": 0, "revenue": 0.0})
    hourly = defaultdict(lambda: {"orders": 0, "revenue": 0.0})
    items = Counter()
    toppings = Counter()
    customers = {}
    pay = defaultdict(lambda: {"orders": 0, "revenue": 0.0})
    source_map = defaultdict(lambda: {"orders": 0, "revenue": 0.0})
    weekdays = defaultdict(lambda: {"orders": 0, "revenue": 0.0})
    for r in rows:
        created = str(r.get("created_at") or "")
        day = created[:10]
        daily[day]["orders"] += 1
        daily[day]["revenue"] += _num(r.get("total"))
        try:
            dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
        except Exception:
            dt = datetime.now()
        hourly[dt.hour]["orders"] += 1
        hourly[dt.hour]["revenue"] += _num(r.get("total"))
        weekdays[dt.weekday()]["orders"] += 1
        weekdays[dt.weekday()]["revenue"] += _num(r.get("total"))
        for item in r.get("items") or []:
            items[item.get("pizza", "Unknown")] += int(item.get("quantity") or 1)
            for top in item.get("toppings") or []:
                toppings[top] += int(item.get("quantity") or 1)
        phone = r.get("customer_phone")
        if phone:
            c = customers.setdefault(
                phone,
                {
                    "customer_phone": phone,
                    "customer_name": r.get("customer_name"),
                    "orders": 0,
                    "revenue": 0.0,
                },
            )
            c["orders"] += 1
            c["revenue"] += _num(r.get("total"))
        pm = r.get("payment_mode") or "Unknown"
        pay[pm]["orders"] += 1
        pay[pm]["revenue"] += _num(r.get("total"))
        src = r.get("source") or "api"
        source_map[src]["orders"] += 1
        source_map[src]["revenue"] += _num(r.get("total"))
    cancelled = len(
        [r for r in rows if str(r.get("status", "")).lower() == "cancelled"]
    )
    refund_orders = len(_select("refunds"))
    return {
        "totals": {
            "total_orders": total_orders,
            "revenue": round(revenue, 2),
            "average_order_value": (
                round(revenue / total_orders, 2) if total_orders else 0
            ),
            "gst": round(sum(_num(r.get("gst")) for r in rows), 2),
            "discount": round(sum(_num(r.get("discount")) for r in rows), 2),
            "cancelled_orders": cancelled,
            "refund_orders": refund_orders,
        },
        "daily_revenue": [{"date": k, **v} for k, v in sorted(daily.items())],
        "hourly_revenue": [{"hour": k, **v} for k, v in sorted(hourly.items())],
        "top_items": [
            {"name": k, "quantity": v, "revenue": 0} for k, v in items.most_common(10)
        ],
        "top_toppings": [
            {"name": k, "quantity": v} for k, v in toppings.most_common(10)
        ],
        "repeat_customers": [v for v in customers.values() if v["orders"] > 1],
        "revenue_by_payment_mode": [{"payment_mode": k, **v} for k, v in pay.items()],
        "orders_by_source": [{"source": k, **v} for k, v in source_map.items()],
        "weekday_trend": [
            {
                "weekday_no": k,
                "weekday": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][k],
                **v,
            }
            for k, v in sorted(weekdays.items())
        ],
        "discount_impact": {
            "discount": round(sum(_num(r.get("discount")) for r in rows), 2),
            "discount_to_revenue_percent": (
                round((sum(_num(r.get("discount")) for r in rows) / revenue) * 100, 2)
                if revenue
                else 0
            ),
        },
        "refund_rate": (
            round((refund_orders / total_orders) * 100, 2) if total_orders else 0
        ),
        "cancellation_rate": (
            round((cancelled / total_orders) * 100, 2) if total_orders else 0
        ),
        "recommendation_impact": get_recommendation_impact(),
    }


def list_ai_insight_logs(
    provider: str | None = None, insight_type: str | None = None, limit: int = 50
) -> list[dict]:
    rows = _rows(
        execute_query(
            _client()
            .table("ai_insight_logs")
            .select("*")
            .order("created_at", desc=True)
            .limit(limit)
        )
    )
    if provider:
        rows = [r for r in rows if r.get("provider") == provider]
    if insight_type:
        rows = [r for r in rows if r.get("insight_type") == insight_type]
    return rows


def generate_ai_insights(*, performed_by: str, provider: str = "mock") -> dict:
    metrics = get_dashboard_metrics()
    insights = [
        {
            "type": "dashboard",
            "text": f"Today revenue is Rs {metrics['today']['revenue']:.0f}.",
            "metrics": metrics["today"],
        }
    ]
    for insight in insights:
        try:
            execute_query(
                _client()
                .table("ai_insight_logs")
                .insert(
                    {
                        "provider": provider,
                        "insight_type": insight["type"],
                        "insight_text": insight["text"],
                        "input_metrics": insight["metrics"],
                        "created_by": performed_by,
                    }
                )
            )
        except Exception:
            pass
    return {
        "provider": provider,
        "fallback_used": False,
        "provider_error": None,
        "insights": insights,
        "logs": list_ai_insight_logs(limit=5),
    }


def generate_forecast(*, performed_by: str, days: int = 7) -> dict:
    analytics = get_analytics_report()
    avg_orders = analytics["totals"]["total_orders"] / max(1, min(30, days))
    avg_revenue = analytics["totals"]["revenue"] / max(1, min(30, days))
    today = date.today()
    forecast = []
    for offset in range(1, days + 1):
        d = today + timedelta(days=offset)
        weekend = d.weekday() >= 5
        factor = 1.15 if weekend else 1.0
        forecast.append(
            {
                "forecast_date": d.isoformat(),
                "predicted_orders": round(avg_orders * factor, 1),
                "predicted_revenue": round(avg_revenue * factor, 2),
                "weekend_flag": weekend,
                "holiday_flag": False,
                "confidence": "medium",
                "rationale": "Supabase order history baseline.",
            }
        )
    return {
        "method": "supabase_deterministic_forecast",
        "baseline": {
            "avg_orders": round(avg_orders, 2),
            "avg_revenue": round(avg_revenue, 2),
        },
        "forecast": forecast,
    }


def get_ai_business_intelligence(days: int = 7) -> dict:
    analytics = get_analytics_report()
    forecast_res = generate_forecast(performed_by="system", days=days)
    forecast = forecast_res.get("forecast", [])
    peak = max(
        analytics["hourly_revenue"], key=lambda r: r.get("orders", 0), default={}
    )

    # Fetch orders list to run inventory and churn analyses
    rows = list_orders(limit=1000)

    peak_rush = {
        "top_hours": analytics["hourly_revenue"][:5],
        "busiest_hour": peak,
        "rush_window": _hour_window(peak.get("hour", 0)) if peak else None,
        "recommendation": (
            f"Prepare extra staff and ingredients around {_hour_window(int(peak.get('hour', 0)))}."
            if peak
            else "Add demo orders to detect peak rush windows."
        ),
    }

    return {
        "provider": "supabase_deterministic",
        "provider_status": {
            "provider": "supabase",
            "configured": True,
            "fallback_provider": "deterministic",
        },
        "source": "supabase_rest_metrics",
        "demand_forecast": forecast,
        "peak_rush": peak_rush,
        "inventory_forecast": _build_inventory_forecast(days, rows),
        "staff_scheduling": _build_staff_scheduling(peak_rush),
        "smart_upsells": _build_upsell_recommendations(analytics),
        "coupon_recommendations": _build_coupon_recommendations(analytics),
        "churn_risks": _build_churn_risks(rows),
        "ltv_recommendations": _build_ltv_recommendations(analytics),
        "sentiment_analysis": list_customer_feedback()["summary"],
        "voice_ordering_readiness": {
            "status": "ready",
            "channels": ["chat", "voice"],
            "tracked_order_source": "orders.source",
            "notes": ["Supabase mode active."],
        },
        "safety_rules": ["Use real metrics only.", "Do not invent refunds or revenue."],
        "recommendation_impact": get_recommendation_impact(),
    }


def _build_staff_scheduling(peak: dict) -> list[dict]:
    suggestions = []
    for row in peak.get("top_hours", []):
        orders = int(row.get("orders", 0) or 0)
        staff = 1 if orders <= 3 else 2 if orders <= 8 else 3
        suggestions.append(
            {
                "hour": row.get("hour"),
                "window": _hour_window(int(row.get("hour", 0))),
                "orders": orders,
                "suggested_staff": staff,
                "role_mix": (
                    "1 customer-facing, remaining kitchen"
                    if staff > 1
                    else "1 cross-trained staff"
                ),
            }
        )
    return suggestions


def _build_upsell_recommendations(metrics: dict) -> list[dict]:
    top_items = metrics.get("top_items", [])
    top_toppings = metrics.get("top_toppings", [])
    if not top_items:
        return []
    topping = top_toppings[0]["name"] if top_toppings else "extra cheese"
    return [
        {
            "recommendation_key": f"upsell:{item['name']}:{topping}",
            "trigger_item": item["name"],
            "recommendation": f"Suggest {topping} with {item['name']}.",
            "reason": "Based on top-selling item and topping trends.",
            "estimated_value": round(float(item.get("revenue", 0) or 0) * 0.05, 2),
            "source_metrics": {"item": item, "topping": topping},
        }
        for item in top_items[:5]
    ]


def _build_coupon_recommendations(metrics: dict) -> list[dict]:
    totals = metrics.get("totals", {})
    aov = float(totals.get("average_order_value", 0) or 0)
    slow_hours = sorted(
        metrics.get("hourly_revenue", []), key=lambda row: row.get("orders", 0)
    )[:3]
    recommendations = []
    if aov:
        recommendations.append(
            {
                "recommendation_key": "coupon:aov-booster",
                "name": "AOV Booster",
                "coupon": "BOOSTAOV",
                "discount_percent": 8,
                "threshold_amount": round(aov * 1.25, 2),
                "reason": "Encourage baskets above current average order value.",
                "estimated_value": round(aov * 0.08, 2),
                "source_metrics": {"average_order_value": aov},
            }
        )
    for row in slow_hours:
        recommendations.append(
            {
                "recommendation_key": f"coupon:hour-{row.get('hour')}",
                "name": f"Hour {row.get('hour')} Rush Builder",
                "coupon": f"HOUR{row.get('hour')}",
                "discount_percent": 10,
                "threshold_amount": round(aov or 299, 2),
                "reason": "Target low-order hours without changing core pricing.",
                "estimated_value": round(float(row.get("revenue", 0) or 0) * 0.1, 2),
                "source_metrics": row,
            }
        )
    return recommendations[:4]


def _build_ltv_recommendations(metrics: dict) -> list[dict]:
    repeat_customers = metrics.get("repeat_customers", [])
    recommendations = []
    for row in repeat_customers[:5]:
        revenue = float(row.get("revenue", 0) or 0)
        orders = int(row.get("orders", 0) or 0)
        if not orders:
            continue
        recommendations.append(
            {
                "customer_name": row.get("customer_name"),
                "customer_phone": row.get("customer_phone"),
                "estimated_ltv": round(revenue * 1.4, 2),
                "recommended_discount_percent": 8 if orders >= 3 else 5,
                "reason": "Prioritize repeat customers with controlled win-back offers.",
                "short_term_loss_note": "Small coupon cost can be justified if repeat order likelihood remains high.",
            }
        )
    return recommendations


def _build_inventory_forecast(days: int, rows: list[dict]) -> list[dict]:
    ingredients = _select("ingredients")
    menu_items = _select("menu_items")
    recipes = _select("menu_item_ingredients")

    active_ings = [i for i in ingredients if i.get("is_active") is True]

    today = date.today()
    orders_30_days = []
    for r in rows:
        created = r.get("created_at") or ""
        try:
            d = datetime.fromisoformat(created.replace("Z", "+00:00")).date()
            if d >= (today - timedelta(days=30)):
                orders_30_days.append(r)
        except Exception:
            pass

    if not orders_30_days:
        orders_30_days = rows

    num_days = 30.0
    item_quantities = defaultdict(float)
    for o in orders_30_days:
        for item in o.get("items") or []:
            p_name = item.get("pizza")
            b_name = item.get("base")
            qty = float(item.get("quantity") or 1)
            if p_name:
                item_quantities[p_name] += qty
            if b_name:
                item_quantities[b_name] += qty

    menu_item_avg_usage = {}
    for mi in menu_items:
        name = mi.get("name")
        menu_item_avg_usage[mi["id"]] = item_quantities[name] / num_days

    forecast = []
    for ing in active_ings:
        ing_id = ing["id"]
        avg_daily_usage = 0.0
        for mii in recipes:
            if mii.get("ingredient_id") == ing_id:
                menu_item_id = mii.get("menu_item_id")
                qty_per_unit = float(mii.get("quantity_per_unit") or 0)
                avg_daily_usage += (
                    menu_item_avg_usage.get(menu_item_id, 0.0) * qty_per_unit
                )

        usage = avg_daily_usage
        stock = float(ing.get("stock_quantity") or 0)
        days_until_stockout = round(stock / usage, 1) if usage else None
        projected_stock = stock - (usage * days)
        risk = (
            "high"
            if projected_stock <= 0
            else (
                "medium"
                if projected_stock <= float(ing.get("reorder_threshold") or 0)
                else "low"
            )
        )
        forecast.append(
            {
                "id": ing["id"],
                "name": ing["name"],
                "unit": ing["unit"],
                "stock_quantity": stock,
                "reorder_threshold": ing.get("reorder_threshold"),
                "avg_daily_usage": round(usage, 3),
                "forecast_days": days,
                "projected_stock": round(projected_stock, 3),
                "days_until_stockout": days_until_stockout,
                "risk": risk,
                "suggested_reorder_quantity": round(
                    max(0, (usage * (days + 3)) - stock), 3
                ),
            }
        )
    return forecast


def _build_churn_risks(rows: list[dict]) -> list[dict]:
    customer_orders = defaultdict(list)
    for r in rows:
        phone = r.get("customer_phone")
        if phone:
            customer_orders[phone].append(r)

    churn_list = []
    today = date.today()
    for phone, o_list in customer_orders.items():
        if len(o_list) < 2:
            continue
        dates = []
        for o in o_list:
            c_at = o.get("created_at")
            if c_at:
                try:
                    dates.append(
                        datetime.fromisoformat(c_at.replace("Z", "+00:00")).date()
                    )
                except Exception:
                    pass
        if not dates:
            continue
        max_date = max(dates)
        days_since = (today - max_date).days
        if days_since >= 21:
            revenue = sum(_num(o.get("total")) for o in o_list)
            name = next(
                (o.get("customer_name") for o in o_list if o.get("customer_name")),
                "Unknown",
            )
            churn_list.append(
                {
                    "customer_phone": phone,
                    "customer_name": name,
                    "orders": len(o_list),
                    "revenue": revenue,
                    "last_order_date": max_date.isoformat(),
                    "days_since_last_order": days_since,
                    "risk": "high" if days_since >= 45 else "medium",
                    "suggested_action": "Send win-back coupon with limited validity.",
                }
            )

    churn_list.sort(
        key=lambda x: (x["revenue"], x["days_since_last_order"]), reverse=True
    )
    return churn_list[:10]


def _hour_window(hour: int) -> str:
    return f"{hour:02d}:00-{(hour + 1) % 24:02d}:00"


def record_recommendation_event(**kwargs) -> dict:
    payload = dict(kwargs)
    performed_by = payload.pop("performed_by", None)
    if performed_by is not None:
        payload["created_by"] = performed_by
    payload["id"] = payload.get("id") or str(uuid4())
    row = _one(
        execute_query(_client().table("ai_recommendation_events").insert(payload))
    )
    return row


def get_recommendation_impact(limit: int = 20) -> dict:
    rows = _rows(
        execute_query(
            _client()
            .table("ai_recommendation_events")
            .select("*")
            .order("created_at", desc=True)
            .limit(500)
        )
    )
    total = len(rows)
    accepted = [r for r in rows if r.get("status") == "accepted"]
    rejected = [r for r in rows if r.get("status") == "rejected"]
    by_type_map = defaultdict(
        lambda: {
            "total": 0,
            "accepted": 0,
            "rejected": 0,
            "accepted_estimated_value": 0.0,
        }
    )
    for r in rows:
        bucket = by_type_map[r.get("recommendation_type") or "unknown"]
        bucket["total"] += 1
        if r.get("status") == "accepted":
            bucket["accepted"] += 1
            bucket["accepted_estimated_value"] += _num(r.get("estimated_value"))
        if r.get("status") == "rejected":
            bucket["rejected"] += 1
    return {
        "totals": {
            "total": total,
            "accepted": len(accepted),
            "rejected": len(rejected),
            "accepted_estimated_value": round(
                sum(_num(r.get("estimated_value")) for r in accepted), 2
            ),
            "acceptance_rate": round((len(accepted) / total) * 100, 2) if total else 0,
        },
        "by_type": [{"recommendation_type": k, **v} for k, v in by_type_map.items()],
        "recent": rows[:limit],
    }


def list_customer_feedback(limit: int = 50) -> dict:
    rows = _rows(
        execute_query(
            _client()
            .table("customer_feedback")
            .select("*")
            .order("created_at", desc=True)
            .limit(limit)
        )
    )
    total = len(rows)
    labels = Counter(r.get("sentiment_label") for r in rows)
    avg_rating = (
        round(sum(_num(r.get("rating")) for r in rows) / total, 2) if total else 0
    )

    topics_counter = Counter()
    for r in rows:
        topics = r.get("topics") or []
        for topic in topics:
            topics_counter[topic] += 1
    top_topics = [{"topic": k, "mentions": v} for k, v in topics_counter.most_common(8)]

    summary = {
        "status": "active",
        "source": "supabase_customer_feedback",
        "window_days": 30,
        "totals": {
            "total": total,
            "positive": labels["positive"],
            "neutral": labels["neutral"],
            "negative": labels["negative"],
            "positive_rate": (
                round((labels["positive"] / total) * 100, 2) if total else 0
            ),
            "negative_rate": (
                round((labels["negative"] / total) * 100, 2) if total else 0
            ),
            "average_rating": avg_rating,
            "average_sentiment_score": (
                round(sum(_num(r.get("sentiment_score")) for r in rows) / total, 2)
                if total
                else 0
            ),
        },
        "top_topics": top_topics,
        "recent": rows,
        "recommendation": "Collect more feedback for stronger sentiment insight.",
    }
    return {"summary": summary, "feedback": rows}


def record_customer_feedback(
    *,
    order_id: str | None = None,
    customer_name: str | None = None,
    customer_phone: str | None = None,
    channel: str = "app",
    rating: int,
    feedback_text: str,
    source_metadata: dict | None = None,
    performed_by: str | None = None,
) -> dict:
    label = "positive" if rating >= 4 else "negative" if rating <= 2 else "neutral"
    score = 0.75 if label == "positive" else -0.6 if label == "negative" else 0.0
    return _one(
        execute_query(
            _client()
            .table("customer_feedback")
            .insert(
                {
                    "order_id": order_id,
                    "customer_name": customer_name,
                    "customer_phone": customer_phone,
                    "channel": channel,
                    "rating": rating,
                    "feedback_text": feedback_text,
                    "sentiment_label": label,
                    "sentiment_score": score,
                    "topics": [],
                    "source_metadata": source_metadata or {},
                    "created_by": performed_by,
                }
            )
        )
    )


def simulate_revenue_scenario(**kwargs) -> dict:
    analytics = get_analytics_report()
    base = analytics["totals"]
    revenue_factor = 1 + (_num(kwargs.get("menu_price_adjustment_percent")) / 100)
    projected_revenue = base["revenue"] * revenue_factor
    fixed_increase = _num(kwargs.get("rent_increase_amount")) + _num(
        kwargs.get("other_fixed_cost_increase_amount")
    )
    margin_delta = projected_revenue - base["revenue"] - fixed_increase
    return {
        "method": "supabase_deterministic_margin_simulation",
        "inputs": kwargs,
        "baseline": {
            "orders": base["total_orders"],
            "revenue": base["revenue"],
            "average_order_value": base["average_order_value"],
            "estimated_food_cost": round(base["revenue"] * 0.35, 2),
            "estimated_fixed_cost": 0,
            "discount": base["discount"],
            "estimated_margin": round(base["revenue"] * 0.65, 2),
        },
        "projected": {
            "revenue": round(projected_revenue, 2),
            "estimated_food_cost": round(projected_revenue * 0.35, 2),
            "estimated_fixed_cost": fixed_increase,
            "discount": base["discount"],
            "estimated_margin": round(projected_revenue * 0.65 - fixed_increase, 2),
            "margin_delta": round(margin_delta, 2),
        },
        "recommended_actions": ["Review scenario before changing prices."],
        "safety_note": "Simulation uses current Supabase order data.",
    }


def list_notifications(limit: int = 100) -> dict:
    return {
        "logs": _rows(
            execute_query(
                _client()
                .table("notification_logs")
                .select("*")
                .order("created_at", desc=True)
                .limit(limit)
            )
        )
    }


def create_mock_notification(
    *,
    channel: str,
    recipient: str,
    template_name: str,
    payload: dict,
    performed_by: str,
    related_entity_type: str | None = None,
    related_entity_id: str | None = None,
) -> dict:
    return _one(
        execute_query(
            _client()
            .table("notification_logs")
            .insert(
                {
                    "channel": channel,
                    "provider": "mock",
                    "recipient": recipient,
                    "template_name": template_name,
                    "payload": payload,
                    "status": "mocked",
                    "created_by": performed_by,
                    "related_entity_type": related_entity_type,
                    "related_entity_id": related_entity_id,
                    "sent_at": _now(),
                }
            )
        )
    )


def get_settings() -> dict:
    return {"settings": _select("app_settings")}


def update_settings(
    *, values: dict, performed_by: str, reason: str | None = None
) -> dict:
    old = get_settings()
    for key, value in values.items():
        execute_query(
            _client()
            .table("app_settings")
            .upsert(
                {
                    "key": key,
                    "value": {"value": value},
                    "updated_by": performed_by,
                    "updated_at": _now(),
                },
                on_conflict="key",
            )
        )
    _audit(
        action_type="settings.updated",
        entity_type="app_settings",
        entity_id="global",
        old_value=old,
        new_value=values,
        performed_by=performed_by,
        reason=reason,
    )
    return get_settings()


def _json(value) -> str | None:
    import json

    if value is None:
        return None
    return json.dumps(value, default=str)
