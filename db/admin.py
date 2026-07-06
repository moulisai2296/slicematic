"""Admin/RBAC data access.

Stage 1 targets local Postgres through DATABASE_PROVIDER=postgres. The SQL is
plain Postgres so the same migration can move to Supabase Postgres later.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

from db import postgres


class AdminDatabaseNotConfigured(RuntimeError):
    pass


ORDER_STATUSES = {
    "Created",
    "PaymentPending",
    "Confirmed",
    "Preparing",
    "Ready",
    "Delivered",
    "Completed",
    "Cancelled",
    "RefundRequested",
    "Refunded",
    "received",
    "preparing",
    "ready_for_pickup",
    "out_for_delivery",
    "delivered",
    "confirmed",
    "cancelled",
    "completed",
}

STATUS_TRANSITIONS = {
    "received": {"Confirmed", "confirmed", "Preparing", "preparing", "Cancelled", "cancelled"},
    "Created": {"PaymentPending", "Confirmed", "confirmed", "Cancelled", "cancelled"},
    "PaymentPending": {"Confirmed", "confirmed", "Cancelled", "cancelled"},
    "Confirmed": {"Preparing", "preparing", "Cancelled", "cancelled"},
    "confirmed": {"Preparing", "preparing", "Cancelled", "cancelled"},
    "Preparing": {"Ready", "ready_for_pickup", "Cancelled", "cancelled"},
    "preparing": {"Ready", "ready_for_pickup", "Cancelled", "cancelled"},
    "Ready": {"Delivered", "delivered", "Cancelled", "cancelled"},
    "ready_for_pickup": {"Delivered", "delivered", "out_for_delivery", "Cancelled", "cancelled"},
    "Delivered": {"Completed", "completed", "RefundRequested"},
    "delivered": {"Completed", "completed", "RefundRequested"},
    "Completed": {"RefundRequested"},
    "completed": {"RefundRequested"},
    "RefundRequested": {"Refunded", "Completed", "completed"},
    "cancelled": set(),
    "Cancelled": set(),
    "Refunded": set(),
    "refunded": set(),
}

STAFF_ORDER_STATUSES = {
    "Created",
    "PaymentPending",
    "Confirmed",
    "Preparing",
    "Ready",
    "received",
    "confirmed",
    "preparing",
    "ready_for_pickup",
}

STAFF_NEXT_STATUS = {
    "Created": "Confirmed",
    "PaymentPending": "Confirmed",
    "Confirmed": "Preparing",
    "Preparing": "Ready",
    "Ready": "Delivered",
    "received": "Confirmed",
    "confirmed": "Preparing",
    "preparing": "ready_for_pickup",
    "ready_for_pickup": "delivered",
}


def _ensure_postgres() -> None:
    if not postgres.is_enabled():
        raise AdminDatabaseNotConfigured(
            "Admin local DB requires DATABASE_PROVIDER=postgres."
        )


def get_user_by_email(email: str) -> dict | None:
    _ensure_postgres()
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select id, email, full_name, phone, status, created_at
                from public.app_users
                where lower(email) = lower(%s)
                limit 1
                """,
                (email,),
            )
            row = cur.fetchone()
            if not row:
                return None
            cols = [desc.name for desc in cur.description]
            user = dict(zip(cols, row))

            cur.execute(
                """
                select r.name
                from public.roles r
                join public.user_roles ur on ur.role_id = r.id
                where ur.user_id = %s
                order by r.name
                """,
                (user["id"],),
            )
            user["roles"] = [r[0] for r in cur.fetchall()]

            cur.execute(
                """
                select distinct p.code
                from public.permissions p
                join public.role_permissions rp on rp.permission_id = p.id
                join public.user_roles ur on ur.role_id = rp.role_id
                where ur.user_id = %s
                order by p.code
                """,
                (user["id"],),
            )
            user["permissions"] = [r[0] for r in cur.fetchall()]
    return _serialize(user)


def get_dashboard_metrics() -> dict:
    _ensure_postgres()
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select
                    count(*)::int as total_orders,
                    coalesce(sum(total), 0) as revenue,
                    coalesce(avg(total), 0) as average_order_value,
                    count(*) filter (where lower(status) in ('received', 'created'))::int
                        as pending_orders,
                    count(*) filter (where lower(status) = 'preparing')::int
                        as preparing_orders,
                    count(*) filter (where lower(status) in ('completed', 'delivered'))::int
                        as completed_orders,
                    count(*) filter (where lower(status) = 'cancelled')::int
                        as cancelled_orders,
                    count(*) filter (where lower(status) in ('refundrequested', 'refund_requested'))::int
                        as refund_requests
                from public.orders
                where created_at::date = current_date
                """
            )
            today = _one(cur)

            cur.execute(
                """
                select order_no, customer_name, total, payment_mode, status, created_at
                from public.orders
                order by created_at desc
                limit 8
                """
            )
            recent_orders = _many(cur)

            cur.execute(
                """
                select item->>'pizza' as name,
                       coalesce(sum((item->>'quantity')::int), 0)::int as quantity
                from public.orders o
                cross join lateral jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) item
                where o.created_at >= now() - interval '30 days'
                  and item ? 'pizza'
                group by item->>'pizza'
                order by quantity desc, name
                limit 5
                """
            )
            top_pizzas = _many(cur)

            cur.execute(
                """
                select extract(hour from created_at)::int as hour,
                       count(*)::int as orders,
                       coalesce(sum(total), 0) as revenue
                from public.orders
                where created_at >= now() - interval '30 days'
                group by hour
                order by orders desc, revenue desc
                limit 1
                """
            )
            peak_hour = _one(cur)

    low_inventory_alerts = count_low_inventory()
    ai_summary = _build_dashboard_ai_summary(today=today, peak_hour=peak_hour)
    return {
        "today": today,
        "recent_orders": recent_orders,
        "top_pizzas": top_pizzas,
        "peak_hour": peak_hour,
        "low_inventory_alerts": low_inventory_alerts,
        "ai_summary": ai_summary,
        "ai_insights": [item["summary"] for item in ai_summary],
    }


def _build_dashboard_ai_summary(*, today: dict, peak_hour: dict) -> list[dict]:
    yesterday = _orders_summary_for_day(date.today() - timedelta(days=1))
    lifetime = _orders_summary_until_today()
    tomorrow_forecast = _dashboard_forecast_for_offset(1)
    today_projection = _dashboard_projection_for_today(today)
    peak_label = (
        f"{int(peak_hour['hour']):02d}:00"
        if peak_hour and peak_hour.get("hour") is not None
        else "not enough data"
    )
    return [
        {
            "title": "Yesterday",
            "value": f"{yesterday['orders']} orders",
            "summary": (
                f"Yesterday closed with {yesterday['orders']} orders and "
                f"INR {round(float(yesterday['revenue'] or 0), 2)} revenue."
            ),
            "detail": f"AOV INR {round(float(yesterday['average_order_value'] or 0), 2)}.",
        },
        {
            "title": "Till Now",
            "value": f"{lifetime['orders']} orders",
            "summary": (
                f"Till now SliceMatic has tracked {lifetime['orders']} orders, "
                f"INR {round(float(lifetime['revenue'] or 0), 2)} revenue, and "
                f"{lifetime['repeat_customers']} repeat customers."
            ),
            "detail": f"Best rush signal is around {peak_label}.",
        },
        {
            "title": "Today",
            "value": f"{today_projection['projected_orders']} projected",
            "summary": (
                f"Today is at {today['total_orders']} orders so far; projected close is "
                f"{today_projection['projected_orders']} orders and INR "
                f"{today_projection['projected_revenue']} revenue."
            ),
            "detail": "Projection uses current run-rate and local order history.",
        },
        {
            "title": "Tomorrow",
            "value": f"{tomorrow_forecast['predicted_orders']} forecast",
            "summary": (
                f"Tomorrow forecast is {tomorrow_forecast['predicted_orders']} orders "
                f"and INR {tomorrow_forecast['predicted_revenue']} revenue."
            ),
            "detail": tomorrow_forecast["rationale"],
        },
    ]


def _orders_summary_for_day(value: date) -> dict:
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select count(*)::int as orders,
                       coalesce(sum(total), 0) as revenue,
                       coalesce(avg(total), 0) as average_order_value
                from public.orders
                where created_at::date = %s::date
                """,
                (value,),
            )
            return _one(cur)


def _orders_summary_until_today() -> dict:
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select count(*)::int as orders,
                       coalesce(sum(total), 0) as revenue,
                       coalesce(avg(total), 0) as average_order_value,
                       count(distinct o.customer_phone) filter (
                           where o.customer_phone is not null and o.customer_phone <> ''
                       )::int as customers,
                       count(distinct o.customer_phone) filter (
                           where customer_order_count.orders >= 2
                       )::int as repeat_customers
                from public.orders o
                left join (
                    select customer_phone, count(*) as orders
                    from public.orders
                    group by customer_phone
                ) customer_order_count on customer_order_count.customer_phone = o.customer_phone
                """
            )
            return _one(cur)


def _dashboard_projection_for_today(today: dict) -> dict:
    current_orders = int(today.get("total_orders", 0) or 0)
    current_revenue = float(today.get("revenue", 0) or 0)
    now = datetime.now().astimezone()
    day_progress = max((now.hour + (now.minute / 60)) / 24, 0.2)
    projected_orders = max(current_orders, round(current_orders / day_progress))
    projected_revenue = max(current_revenue, current_revenue / day_progress)
    return {
        "projected_orders": projected_orders,
        "projected_revenue": round(projected_revenue, 2),
    }


def _dashboard_forecast_for_offset(offset: int) -> dict:
    demand = _build_demand_forecast(offset)
    forecast = demand["forecast"][-1] if demand["forecast"] else {}
    return {
        "predicted_orders": forecast.get("predicted_orders", 0),
        "predicted_revenue": forecast.get("predicted_revenue", 0),
        "rationale": forecast.get("rationale", "30-day local order average"),
    }


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
    _ensure_postgres()
    clauses = []
    params: list = []
    if status_filter:
        clauses.append("o.status = %s")
        params.append(status_filter)
    if payment_mode:
        clauses.append("o.payment_mode = %s")
        params.append(payment_mode)
    if payment_status:
        clauses.append("coalesce(p.payment_status, 'Pending') = %s")
        params.append(payment_status)
    if date_from:
        clauses.append("o.created_at::date >= %s::date")
        params.append(date_from)
    if date_to:
        clauses.append("o.created_at::date <= %s::date")
        params.append(date_to)
    if customer_search:
        clauses.append(
            "(o.customer_name ilike %s or o.customer_phone ilike %s or o.order_no ilike %s)"
        )
        search = f"%{customer_search.strip()}%"
        params.extend([search, search, search])
    if source:
        clauses.append("o.source = %s")
        params.append(source)
    if total_min is not None:
        clauses.append("o.total >= %s")
        params.append(total_min)
    if total_max is not None:
        clauses.append("o.total <= %s")
        params.append(total_max)
    where = f"where {' and '.join(clauses)}" if clauses else ""
    params.append(limit)
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                select o.id, o.order_no, o.customer_name, o.customer_phone,
                       o.items, o.subtotal, o.discount, o.gst, o.total,
                       o.payment_mode, o.status, o.source, o.created_at,
                       coalesce(p.payment_status, 'Pending') as payment_status,
                       coalesce(p.amount_paid, 0) as amount_paid
                 from public.orders o
                 left join lateral (
                     select payment_status, amount_paid
                     from public.payments p
                     where p.order_id = o.id
                     order by p.created_at desc
                     limit 1
                 ) p on true
                 {where}
                 order by o.created_at desc
                 limit %s
                 """,  # nosec B608
                params,
            )
            return _many(cur)


def get_order_detail(order_id: str) -> dict:
    _ensure_postgres()
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select o.id, o.order_no, o.customer_name, o.customer_phone,
                       o.items, o.subtotal, o.discount, o.gst, o.total,
                       o.payment_mode, o.status, o.source, o.created_at,
                       coalesce(p.payment_status, 'Pending') as payment_status,
                       coalesce(p.amount_paid, 0) as amount_paid
                from public.orders o
                left join lateral (
                    select payment_status, amount_paid
                    from public.payments p
                    where p.order_id = o.id
                    order by p.created_at desc
                    limit 1
                ) p on true
                where o.id = %s
                """,
                (order_id,),
            )
            order = _one(cur)
            if not order:
                raise LookupError("Order not found.")
            cur.execute(
                """
                select h.id, h.old_status, h.new_status, h.reason, h.changed_at,
                       u.full_name as changed_by_name
                from public.order_status_history h
                left join public.app_users u on u.id = h.changed_by
                where h.order_id = %s
                order by h.changed_at asc
                """,
                (order_id,),
            )
            status_history = _many(cur)
            cur.execute(
                """
                select id, payment_mode, payment_status, amount_paid,
                       transaction_reference, paid_at, created_at
                from public.payments
                where order_id = %s
                order by created_at desc
                """,
                (order_id,),
            )
            payments = _many(cur)
            cur.execute(
                """
                select id, amount, reason, status, requested_at, decided_at
                from public.refunds
                where order_id = %s
                order by requested_at desc
                """,
                (order_id,),
            )
            refunds = _many(cur)
            cur.execute(
                """
                select oid.id, i.name as ingredient_name, i.unit, oid.quantity,
                       oid.deducted_at, u.full_name as deducted_by_name
                from public.order_inventory_deductions oid
                join public.ingredients i on i.id = oid.ingredient_id
                left join public.app_users u on u.id = oid.deducted_by
                where oid.order_id = %s
                order by oid.deducted_at desc, i.name
                """,
                (order_id,),
            )
            inventory_deductions = _many(cur)
    return {
        "order": order,
        "status_history": status_history,
        "payments": payments,
        "refunds": refunds,
        "inventory_deductions": inventory_deductions,
    }


def list_staff_orders(limit: int = 50) -> list[dict]:
    _ensure_postgres()
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select o.id, o.order_no, o.customer_name, o.customer_phone,
                       o.items, o.subtotal, o.discount, o.gst, o.total,
                       o.payment_mode, o.status, o.source, o.created_at,
                       coalesce(p.payment_status, 'Pending') as payment_status,
                       coalesce(p.amount_paid, 0) as amount_paid
                from public.orders o
                left join lateral (
                    select payment_status, amount_paid
                    from public.payments p
                    where p.order_id = o.id
                    order by p.created_at desc
                    limit 1
                ) p on true
                where o.status = any(%s)
                order by
                    case o.status
                        when 'Confirmed' then 1
                        when 'confirmed' then 1
                        when 'Preparing' then 2
                        when 'Ready' then 3
                        when 'Created' then 4
                        when 'received' then 4
                        when 'PaymentPending' then 5
                        else 6
                    end,
                    o.created_at asc
                limit %s
                """,
                (list(STAFF_ORDER_STATUSES), limit),
            )
            return _many(cur)


def advance_staff_order(
    order_id: str,
    *,
    performed_by: str,
    reason: str | None = None,
) -> dict:
    _ensure_postgres()
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("select status from public.orders where id = %s", (order_id,))
            order = _one(cur)
    if not order:
        raise LookupError("Order not found.")
    next_status = STAFF_NEXT_STATUS.get(order["status"])
    if not next_status:
        raise ValueError(f"Order cannot be advanced from {order['status']}.")
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
    _ensure_postgres()
    if payment_mode not in {"Cash", "Card", "UPI"}:
        raise ValueError("Unsupported payment mode.")
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into public.orders (
                    user_id, source, customer_name, customer_phone, items,
                    subtotal, discount, gst, total, payment_mode, status, type
                )
                values (
                    %s, 'staff_pos', %s, %s, %s::jsonb,
                    %s, %s, %s, %s, %s, 'confirmed', %s
                )
                returning id, order_no, customer_name, customer_phone, items,
                          subtotal, discount, gst, total, payment_mode, status,
                          source, created_at, type
                """,
                (
                    None,
                    customer_name,
                    customer_phone,
                    _json(items),
                    subtotal,
                    discount,
                    gst,
                    total,
                    payment_mode,
                    type,
                ),
            )
            order = _one(cur)
            cur.execute(
                """
                insert into public.payments (
                    order_id, payment_mode, payment_status, amount_paid,
                    transaction_reference, paid_at
                )
                values (%s, %s, 'Paid', %s, %s, now())
                """,
                (
                    order["id"],
                    payment_mode,
                    total,
                    f"STAFF-POS-{order['order_no']}",
                ),
            )
            cur.execute(
                """
                insert into public.order_status_history (
                    order_id, old_status, new_status, changed_by, reason
                )
                values (%s, null, 'Confirmed', %s, 'Staff POS order created')
                """,
                (order["id"], performed_by),
            )
            _audit(
                cur,
                action_type="staff.order.created",
                entity_type="order",
                entity_id=order["id"],
                old_value=None,
                new_value=order,
                performed_by=performed_by,
                reason="Staff POS checkout",
            )
    return order


def update_order_status(
    order_id: str,
    *,
    new_status: str,
    performed_by: str,
    reason: str | None = None,
) -> dict:
    _ensure_postgres()
    if new_status not in ORDER_STATUSES:
        raise ValueError("Unsupported order status.")
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "select id, order_no, status, items from public.orders where id = %s",
                (order_id,),
            )
            old = _one(cur)
            if not old:
                raise LookupError("Order not found.")
            allowed = STATUS_TRANSITIONS.get(old["status"], set())
            if new_status != old["status"] and new_status not in allowed:
                raise ValueError(
                    f"Cannot move order from {old['status']} to {new_status}."
                )
            deduction = None
            if new_status in ("Preparing", "preparing") and old["status"] not in ("Preparing", "preparing"):
                deduction = _deduct_order_inventory(
                    cur,
                    order_id=order_id,
                    items=old.get("items") or [],
                    performed_by=performed_by,
                )
            cur.execute(
                """
                update public.orders
                set status = %s
                where id = %s
                returning id, order_no, status
                """,
                (new_status, order_id),
            )
            updated = _one(cur)
            cur.execute(
                """
                insert into public.order_status_history (
                    order_id, old_status, new_status, changed_by, reason
                )
                values (%s, %s, %s, %s, %s)
                """,
                (order_id, old["status"], new_status, performed_by, reason),
            )
            _audit(
                cur,
                action_type="order.status.updated",
                entity_type="order",
                entity_id=order_id,
                old_value=old,
                new_value=updated,
                performed_by=performed_by,
                reason=reason,
            )
            if deduction:
                _audit(
                    cur,
                    action_type="inventory.auto_deducted",
                    entity_type="order",
                    entity_id=order_id,
                    old_value=None,
                    new_value=deduction,
                    performed_by=performed_by,
                    reason="Order moved to Preparing",
                )
    return updated


def list_payments_and_refunds() -> dict:
    _ensure_postgres()
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select p.id, o.order_no, o.customer_name, p.payment_mode,
                       p.payment_status, p.amount_paid, p.transaction_reference,
                       p.paid_at, p.created_at
                from public.payments p
                join public.orders o on o.id = p.order_id
                order by p.created_at desc
                limit 100
                """
            )
            payments = _many(cur)
            cur.execute(
                """
                select r.id, o.order_no, o.customer_name, r.amount, r.reason,
                       r.status, r.requested_at, r.decided_at
                from public.refunds r
                join public.orders o on o.id = r.order_id
                order by r.requested_at desc
                limit 100
                """
            )
            refunds = _many(cur)
    return {"payments": payments, "refunds": refunds}


def request_refund(
    order_id: str,
    *,
    amount: float,
    reason: str,
    performed_by: str,
) -> dict:
    _ensure_postgres()
    if amount <= 0:
        raise ValueError("Refund amount must be greater than 0.")
    if not reason.strip():
        raise ValueError("Refund reason is required.")
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select o.id, o.order_no, o.total, o.status, p.id as payment_id,
                       p.amount_paid, p.payment_status
                from public.orders o
                left join lateral (
                    select id, amount_paid, payment_status
                    from public.payments p
                    where p.order_id = o.id
                    order by p.created_at desc
                    limit 1
                ) p on true
                where o.id = %s
                """,
                (order_id,),
            )
            order = _one(cur)
            if not order:
                raise LookupError("Order not found.")
            if order.get("payment_status") != "Paid":
                raise ValueError("Only paid orders can be refunded.")
            if amount > float(order["amount_paid"]):
                raise ValueError("Refund cannot exceed paid amount.")
            cur.execute(
                """
                insert into public.refunds (
                    order_id, payment_id, amount, reason, requested_by
                )
                values (%s, %s, %s, %s, %s)
                returning id, amount, reason, status, requested_at
                """,
                (order_id, order["payment_id"], amount, reason.strip(), performed_by),
            )
            refund = _one(cur)
            cur.execute(
                "update public.orders set status = 'RefundRequested' where id = %s",
                (order_id,),
            )
            _audit(
                cur,
                action_type="refund.requested",
                entity_type="refund",
                entity_id=refund["id"],
                old_value=order,
                new_value=refund,
                performed_by=performed_by,
                reason=reason,
            )
    return refund


def decide_refund(
    refund_id: str,
    *,
    status: str,
    performed_by: str,
    reason: str | None = None,
) -> dict:
    _ensure_postgres()
    if status not in {"Approved", "Rejected", "Paid"}:
        raise ValueError("Refund decision must be Approved, Rejected, or Paid.")
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select r.id, r.order_id, r.payment_id, r.amount, r.status,
                       o.status as order_status
                from public.refunds r
                join public.orders o on o.id = r.order_id
                where r.id = %s
                """,
                (refund_id,),
            )
            old = _one(cur)
            if not old:
                raise LookupError("Refund not found.")
            if old["status"] in {"Rejected", "Paid"}:
                raise ValueError(f"Refund is already {old['status']}.")
            if status == "Paid" and old["status"] != "Approved":
                raise ValueError(
                    "Refund must be approved before it can be marked paid."
                )
            cur.execute(
                """
                update public.refunds
                set status = %s, approved_by = %s, decided_at = now()
                where id = %s
                returning id, amount, reason, status, requested_at, decided_at
                """,
                (status, performed_by, refund_id),
            )
            updated = _one(cur)
            if status == "Paid":
                cur.execute(
                    """
                    update public.payments
                    set payment_status = 'Refunded'
                    where id = %s
                    """,
                    (old["payment_id"],),
                )
                cur.execute(
                    "update public.orders set status = 'Refunded' where id = %s",
                    (old["order_id"],),
                )
            elif status == "Rejected":
                cur.execute(
                    "update public.orders set status = 'Completed' where id = %s",
                    (old["order_id"],),
                )
            _audit(
                cur,
                action_type="refund.decided",
                entity_type="refund",
                entity_id=refund_id,
                old_value=old,
                new_value=updated,
                performed_by=performed_by,
                reason=reason,
            )
    return updated


def count_low_inventory() -> int:
    _ensure_postgres()
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select count(*)::int
                from public.ingredients
                where is_active = true and stock_quantity <= reorder_threshold
                """
            )
            return cur.fetchone()[0]


def list_inventory() -> dict:
    _ensure_postgres()
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select id, name, unit, stock_quantity, reorder_threshold,
                       (stock_quantity <= reorder_threshold) as is_low_stock,
                       is_active, updated_at
                from public.ingredients
                order by is_active desc, is_low_stock desc, name
                """
            )
            ingredients = _many(cur)
            cur.execute(
                """
                select st.id, i.name as ingredient_name, st.transaction_type,
                       st.quantity, st.old_quantity, st.new_quantity,
                       st.reason, st.performed_at
                from public.stock_transactions st
                join public.ingredients i on i.id = st.ingredient_id
                order by st.performed_at desc
                limit 25
                """
            )
            transactions = _many(cur)
            cur.execute(
                """
                select ir.id, i.name as ingredient_name, i.unit,
                       ir.requested_quantity, ir.status, ir.reason,
                       ir.created_at, ir.decided_at, ir.updated_at
                from public.inventory_requests ir
                left join public.ingredients i on i.id = ir.ingredient_id
                order by ir.created_at desc
                limit 50
                """
            )
            requests = _many(cur)
            cur.execute(
                """
                select mi.id as menu_item_id, mi.item_code, mi.name as menu_item_name,
                       c.code as category, c.name as category_name,
                       coalesce(
                           jsonb_agg(
                               jsonb_build_object(
                                   'id', mii.id,
                                   'ingredient_id', i.id,
                                   'ingredient_name', i.name,
                                   'unit', i.unit,
                                   'quantity_per_unit', mii.quantity_per_unit
                               )
                               order by i.name
                           ) filter (where mii.id is not null),
                           '[]'::jsonb
                       ) as ingredients
                from public.menu_items mi
                join public.menu_categories c on c.id = mi.category_id
                left join public.menu_item_ingredients mii on mii.menu_item_id = mi.id
                left join public.ingredients i on i.id = mii.ingredient_id
                where mi.is_deleted = false
                group by mi.id, mi.item_code, mi.name, c.code, c.name, c.sort_order
                order by c.sort_order, mi.item_code
                """
            )
            recipes = _many(cur)
            total_recipes = len(recipes)
            mapped_recipes = sum(1 for row in recipes if row.get("ingredients"))
    return {
        "ingredients": ingredients,
        "transactions": transactions,
        "requests": requests,
        "recipes": recipes,
        "recipe_coverage": {
            "total_menu_items": total_recipes,
            "mapped_menu_items": mapped_recipes,
            "unmapped_menu_items": total_recipes - mapped_recipes,
            "coverage_percent": (
                round((mapped_recipes / total_recipes) * 100, 2) if total_recipes else 0
            ),
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
    _ensure_postgres()
    if not name.strip():
        raise ValueError("Ingredient name is required.")
    if not unit.strip():
        raise ValueError("Ingredient unit is required.")
    if stock_quantity < 0 or reorder_threshold < 0:
        raise ValueError("Stock and threshold must be non-negative.")
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into public.ingredients (
                    name, unit, stock_quantity, reorder_threshold, is_active
                )
                values (%s, %s, %s, %s, true)
                on conflict (name) do update set
                    unit = excluded.unit,
                    stock_quantity = excluded.stock_quantity,
                    reorder_threshold = excluded.reorder_threshold,
                    is_active = true,
                    updated_at = now()
                returning id, name, unit, stock_quantity, reorder_threshold,
                          (stock_quantity <= reorder_threshold) as is_low_stock,
                          is_active, updated_at
                """,
                (
                    name.strip(),
                    unit.strip(),
                    stock_quantity,
                    reorder_threshold,
                ),
            )
            ingredient = _one(cur)
            _audit(
                cur,
                action_type="inventory.ingredient.created",
                entity_type="ingredient",
                entity_id=ingredient["id"],
                old_value=None,
                new_value=ingredient,
                performed_by=performed_by,
                reason=reason,
            )
    return ingredient


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
    _ensure_postgres()
    if not name.strip():
        raise ValueError("Ingredient name is required.")
    if not unit.strip():
        raise ValueError("Ingredient unit is required.")
    if reorder_threshold < 0:
        raise ValueError("Reorder threshold must be non-negative.")
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "select * from public.ingredients where id = %s", (ingredient_id,)
            )
            old = _one(cur)
            if not old:
                raise LookupError("Ingredient not found.")
            cur.execute(
                """
                update public.ingredients
                set name = %s, unit = %s, reorder_threshold = %s,
                    is_active = %s, updated_at = now()
                where id = %s
                returning id, name, unit, stock_quantity, reorder_threshold,
                          (stock_quantity <= reorder_threshold) as is_low_stock,
                          is_active, updated_at
                """,
                (
                    name.strip(),
                    unit.strip(),
                    reorder_threshold,
                    is_active,
                    ingredient_id,
                ),
            )
            ingredient = _one(cur)
            _audit(
                cur,
                action_type="inventory.ingredient.updated",
                entity_type="ingredient",
                entity_id=ingredient_id,
                old_value=old,
                new_value=ingredient,
                performed_by=performed_by,
                reason=reason,
            )
    return ingredient


def upsert_menu_item_ingredient(
    *,
    menu_item_id: str,
    ingredient_id: str,
    quantity_per_unit: float,
    performed_by: str,
    reason: str | None = None,
) -> dict:
    _ensure_postgres()
    if quantity_per_unit <= 0:
        raise ValueError("Recipe quantity must be greater than 0.")
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "select id, name from public.menu_items where id = %s and is_deleted = false",
                (menu_item_id,),
            )
            menu_item = _one(cur)
            if not menu_item:
                raise LookupError("Menu item not found.")
            cur.execute(
                "select id, name from public.ingredients where id = %s",
                (ingredient_id,),
            )
            ingredient = _one(cur)
            if not ingredient:
                raise LookupError("Ingredient not found.")
            cur.execute(
                """
                select id, quantity_per_unit
                from public.menu_item_ingredients
                where menu_item_id = %s and ingredient_id = %s
                """,
                (menu_item_id, ingredient_id),
            )
            old = _one(cur)
            cur.execute(
                """
                insert into public.menu_item_ingredients (
                    menu_item_id, ingredient_id, quantity_per_unit
                )
                values (%s, %s, %s)
                on conflict (menu_item_id, ingredient_id) do update set
                    quantity_per_unit = excluded.quantity_per_unit,
                    updated_at = now()
                returning id, menu_item_id, ingredient_id, quantity_per_unit,
                          updated_at
                """,
                (menu_item_id, ingredient_id, quantity_per_unit),
            )
            recipe = _one(cur)
            recipe["menu_item_name"] = menu_item["name"]
            recipe["ingredient_name"] = ingredient["name"]
            _audit(
                cur,
                action_type="inventory.recipe.upserted",
                entity_type="menu_item_ingredient",
                entity_id=recipe["id"],
                old_value=old,
                new_value=recipe,
                performed_by=performed_by,
                reason=reason,
            )
    return recipe


def delete_menu_item_ingredient(
    recipe_id: str,
    *,
    performed_by: str,
    reason: str | None = None,
) -> dict:
    _ensure_postgres()
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                delete from public.menu_item_ingredients
                where id = %s
                returning id, menu_item_id, ingredient_id, quantity_per_unit
                """,
                (recipe_id,),
            )
            old = _one(cur)
            if not old:
                raise LookupError("Recipe mapping not found.")
            _audit(
                cur,
                action_type="inventory.recipe.deleted",
                entity_type="menu_item_ingredient",
                entity_id=recipe_id,
                old_value=old,
                new_value=None,
                performed_by=performed_by,
                reason=reason,
            )
    return old


def adjust_stock(
    ingredient_id: str,
    *,
    transaction_type: str,
    quantity: float,
    performed_by: str,
    reason: str | None = None,
) -> dict:
    _ensure_postgres()
    if transaction_type not in {"StockIn", "StockOut", "Wastage"}:
        raise ValueError("Unsupported stock transaction type.")
    if quantity <= 0:
        raise ValueError("Quantity must be greater than 0.")
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "select id, name, stock_quantity from public.ingredients where id = %s",
                (ingredient_id,),
            )
            old = _one(cur)
            if not old:
                raise LookupError("Ingredient not found.")
            old_qty = float(old["stock_quantity"])
            new_qty = (
                old_qty + quantity
                if transaction_type == "StockIn"
                else old_qty - quantity
            )
            if new_qty < 0:
                raise ValueError("Inventory cannot go negative.")
            cur.execute(
                """
                update public.ingredients
                set stock_quantity = %s, updated_at = now()
                where id = %s
                returning id, name, unit, stock_quantity, reorder_threshold,
                          (stock_quantity <= reorder_threshold) as is_low_stock,
                          is_active, updated_at
                """,
                (new_qty, ingredient_id),
            )
            updated = _one(cur)
            cur.execute(
                """
                insert into public.stock_transactions (
                    ingredient_id, transaction_type, quantity, old_quantity,
                    new_quantity, reason, performed_by
                )
                values (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    ingredient_id,
                    transaction_type,
                    quantity,
                    old_qty,
                    new_qty,
                    reason,
                    performed_by,
                ),
            )
            _audit(
                cur,
                action_type="inventory.stock.adjusted",
                entity_type="ingredient",
                entity_id=ingredient_id,
                old_value=old,
                new_value=updated,
                performed_by=performed_by,
                reason=reason,
            )
    return updated


def create_inventory_request(
    *,
    ingredient_id: str,
    requested_quantity: float,
    reason: str,
    performed_by: str,
) -> dict:
    _ensure_postgres()
    if requested_quantity <= 0:
        raise ValueError("Requested quantity must be greater than 0.")
    if not reason.strip():
        raise ValueError("Inventory request reason is required.")
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "select id, name from public.ingredients where id = %s",
                (ingredient_id,),
            )
            ingredient = _one(cur)
            if not ingredient:
                raise LookupError("Ingredient not found.")
            cur.execute(
                """
                insert into public.inventory_requests (
                    ingredient_id, requested_quantity, reason, requested_by
                )
                values (%s, %s, %s, %s)
                returning id, ingredient_id, requested_quantity, status, reason,
                          created_at, decided_at, updated_at
                """,
                (ingredient_id, requested_quantity, reason.strip(), performed_by),
            )
            request = _one(cur)
            request["ingredient_name"] = ingredient["name"]
            _audit(
                cur,
                action_type="inventory.request.created",
                entity_type="inventory_request",
                entity_id=request["id"],
                old_value=None,
                new_value=request,
                performed_by=performed_by,
                reason=reason,
            )
    return request


def decide_inventory_request(
    request_id: str,
    *,
    status: str,
    performed_by: str,
    reason: str | None = None,
) -> dict:
    _ensure_postgres()
    if status not in {"Approved", "Rejected"}:
        raise ValueError("Inventory request decision must be Approved or Rejected.")
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select ir.id, ir.ingredient_id, ir.requested_quantity, ir.status,
                       ir.reason, i.name as ingredient_name, i.stock_quantity
                from public.inventory_requests ir
                join public.ingredients i on i.id = ir.ingredient_id
                where ir.id = %s
                """,
                (request_id,),
            )
            old = _one(cur)
            if not old:
                raise LookupError("Inventory request not found.")
            if old["status"] != "Requested":
                raise ValueError(f"Inventory request is already {old['status']}.")
            cur.execute(
                """
                update public.inventory_requests
                set status = %s, decided_by = %s, decided_at = now(), updated_at = now()
                where id = %s
                returning id, ingredient_id, requested_quantity, status, reason,
                          created_at, decided_at, updated_at
                """,
                (status, performed_by, request_id),
            )
            updated = _one(cur)
            updated["ingredient_name"] = old["ingredient_name"]
            if status == "Approved":
                old_qty = float(old["stock_quantity"])
                qty = float(old["requested_quantity"])
                new_qty = old_qty + qty
                cur.execute(
                    """
                    update public.ingredients
                    set stock_quantity = %s, updated_at = now()
                    where id = %s
                    """,
                    (new_qty, old["ingredient_id"]),
                )
                cur.execute(
                    """
                    insert into public.stock_transactions (
                        ingredient_id, transaction_type, quantity, old_quantity,
                        new_quantity, reason, performed_by
                    )
                    values (%s, 'StockIn', %s, %s, %s, %s, %s)
                    """,
                    (
                        old["ingredient_id"],
                        qty,
                        old_qty,
                        new_qty,
                        reason or old["reason"],
                        performed_by,
                    ),
                )
            _audit(
                cur,
                action_type="inventory.request.decided",
                entity_type="inventory_request",
                entity_id=request_id,
                old_value=old,
                new_value=updated,
                performed_by=performed_by,
                reason=reason,
            )
    return updated


def list_menu_items() -> dict:
    _ensure_postgres()
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select mi.id, mi.item_code, c.code as category, c.name as category_name,
                       mi.name, mi.price, mi.is_available, mi.is_deleted,
                       mi.updated_at
                from public.menu_items mi
                join public.menu_categories c on c.id = mi.category_id
                where mi.is_deleted = false
                order by c.sort_order, mi.item_code
                """
            )
            rows = _many(cur)
            cur.execute(
                """
                select id, code, name, sort_order
                from public.menu_categories
                order by sort_order, name
                """
            )
            categories = _many(cur)
    return {"items": rows, "categories": categories}


def create_menu_category(
    *,
    code: str,
    name: str,
    performed_by: str,
    sort_order: int | None = None,
    reason: str | None = None,
) -> dict:
    _ensure_postgres()
    normalized_code = code.strip().lower().replace(" ", "_")
    if not normalized_code:
        raise ValueError("Category code is required.")
    if not name.strip():
        raise ValueError("Category name is required.")
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            if sort_order is None:
                cur.execute(
                    "select coalesce(max(sort_order), 0) + 1 as next_order from public.menu_categories"
                )
                sort_order = int(_one(cur).get("next_order", 1))
            cur.execute(
                """
                insert into public.menu_categories (code, name, sort_order)
                values (%s, %s, %s)
                on conflict (code) do update set
                    name = excluded.name,
                    sort_order = excluded.sort_order
                returning id, code, name, sort_order
                """,
                (normalized_code, name.strip(), sort_order),
            )
            category = _one(cur)
            _audit(
                cur,
                action_type="menu.category.upserted",
                entity_type="menu_category",
                entity_id=category["id"],
                old_value=None,
                new_value=category,
                performed_by=performed_by,
                reason=reason,
            )
    return category


def delete_menu_category(category_id: str, performed_by: str) -> dict:
    _ensure_postgres()
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "select id, code, name, sort_order from public.menu_categories where id = %s",
                (category_id,),
            )
            category = _one(cur)
            if not category:
                raise LookupError("Menu category not found.")

            if category["code"] in ("base", "pizza", "topping", "side"):
                raise ValueError(
                    "Core categories (base, pizza, topping, side) cannot be deleted."
                )

            cur.execute(
                "delete from public.menu_items where category_id = %s",
                (category_id,),
            )

            cur.execute(
                "delete from public.menu_categories where id = %s returning id, code, name, sort_order",
                (category_id,),
            )
            deleted_cat = _one(cur)

            _audit(
                cur,
                action_type="menu.category.deleted",
                entity_type="menu_category",
                entity_id=category_id,
                old_value=category,
                new_value=None,
                performed_by=performed_by,
                reason="Admin hard delete",
            )
    return deleted_cat


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
    _ensure_postgres()
    if not item_code.strip():
        raise ValueError("Menu item code is required.")
    if not name.strip():
        raise ValueError("Menu item name is required.")
    if price < 0:
        raise ValueError("Price must be non-negative.")
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "select id, name from public.menu_categories where code = %s",
                (category,),
            )
            category_row = _one(cur)
            if not category_row:
                raise LookupError("Menu category not found.")
            cur.execute(
                """
                insert into public.menu_items (
                    item_code, category_id, name, price, is_available
                )
                values (%s, %s, %s, %s, %s)
                returning id, item_code, name, price, is_available, is_deleted,
                          created_at, updated_at
                """,
                (
                    item_code.strip().upper(),
                    category_row["id"],
                    name.strip(),
                    price,
                    is_available,
                ),
            )
            item = _one(cur)
            item["category"] = category
            item["category_name"] = category_row["name"]
            cur.execute(
                """
                insert into public.price_history (
                    menu_item_id, old_price, new_price, changed_by, reason
                )
                values (%s, null, %s, %s, %s)
                """,
                (item["id"], price, performed_by, reason),
            )
            _audit(
                cur,
                action_type="menu.item.created",
                entity_type="menu_item",
                entity_id=item["id"],
                old_value=None,
                new_value=item,
                performed_by=performed_by,
                reason=reason,
            )
    return item


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
    _ensure_postgres()
    if not name.strip():
        raise ValueError("Menu item name is required.")
    if price < 0:
        raise ValueError("Price must be non-negative.")
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select mi.id, mi.item_code, c.code as category,
                       c.name as category_name, mi.name, mi.price,
                       mi.is_available
                from public.menu_items mi
                join public.menu_categories c on c.id = mi.category_id
                where mi.id = %s and mi.is_deleted = false
                """,
                (item_id,),
            )
            old = _one(cur)
            if not old:
                raise LookupError("Menu item not found.")
            if image_url is not None:
                cur.execute(
                    """
                    update public.menu_items
                    set name = %s, price = %s, is_available = %s, image_url = %s, updated_at = now()
                    where id = %s
                    returning id, item_code, category_id, name, price, image_url,
                              is_available, updated_at
                    """,
                    (name.strip(), price, is_available, image_url, item_id),
                )
            else:
                cur.execute(
                    """
                    update public.menu_items
                    set name = %s, price = %s, is_available = %s, updated_at = now()
                    where id = %s
                    returning id, item_code, category_id, name, price, image_url,
                              is_available, updated_at
                    """,
                    (name.strip(), price, is_available, item_id),
                )
            updated = _one(cur)
            cur.execute(
                "select code as category, name as category_name from public.menu_categories where id = %s",
                (updated.pop("category_id"),),
            )
            updated.update(_one(cur))
            if float(old["price"]) != float(price):
                cur.execute(
                    """
                    insert into public.price_history (
                        menu_item_id, old_price, new_price, changed_by, reason
                    )
                    values (%s, %s, %s, %s, %s)
                    """,
                    (item_id, old["price"], price, performed_by, reason),
                )
            _audit(
                cur,
                action_type="menu.item.updated",
                entity_type="menu_item",
                entity_id=item_id,
                old_value=old,
                new_value=updated,
                performed_by=performed_by,
                reason=reason,
            )
    return updated


def soft_delete_menu_item(
    item_id: str,
    *,
    performed_by: str,
    reason: str | None = None,
) -> dict:
    _ensure_postgres()
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select id, item_code, name, price, is_available, is_deleted
                from public.menu_items
                where id = %s and is_deleted = false
                """,
                (item_id,),
            )
            old = _one(cur)
            if not old:
                raise LookupError("Menu item not found.")
            cur.execute(
                """
                update public.menu_items
                set is_deleted = true, is_available = false, updated_at = now()
                where id = %s
                returning id, item_code, name, price, is_available, is_deleted,
                          updated_at
                """,
                (item_id,),
            )
            updated = _one(cur)
            _audit(
                cur,
                action_type="menu.item.soft_deleted",
                entity_type="menu_item",
                entity_id=item_id,
                old_value=old,
                new_value=updated,
                performed_by=performed_by,
                reason=reason,
            )
    return updated


def list_price_history(limit: int = 100) -> list[dict]:
    _ensure_postgres()
    limit = max(1, min(limit, 500))
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select ph.id,
                       mi.id as menu_item_id,
                       mi.item_code,
                       mi.name as menu_item_name,
                       c.code as category,
                       c.name as category_name,
                       ph.old_price,
                       ph.new_price,
                       ph.reason,
                       ph.changed_at,
                       u.full_name as changed_by_name
                from public.price_history ph
                join public.menu_items mi on mi.id = ph.menu_item_id
                join public.menu_categories c on c.id = mi.category_id
                left join public.app_users u on u.id = ph.changed_by
                order by ph.changed_at desc
                limit %s
                """,
                (limit,),
            )
            rows = _many(cur)
    return rows


def get_pricing_settings() -> dict:
    _ensure_postgres()
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("select key, value from public.app_settings order by key")
            settings = {key: value["value"] for key, value in cur.fetchall()}
            cur.execute(
                """
                select dr.id, dr.name, dr.coupon_code, dr.description,
                       dr.discount_percent, dr.threshold_amount, dr.start_date,
                       dr.end_date, dr.is_active, dr.updated_at,
                       coalesce(drc.min_quantity, 0) as min_quantity,
                       coalesce(drc.no_min_quantity, true) as no_min_quantity,
                       coalesce(drc.no_min_value, dr.threshold_amount = 0) as no_min_value
                from public.discount_rules dr
                left join public.discount_rule_conditions drc
                    on drc.discount_rule_id = dr.id
                order by dr.is_active desc, dr.updated_at desc
                """
            )
            discounts = _many(cur)
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
    _ensure_postgres()
    if gst_rate_percent < 0 or gst_rate_percent > 50:
        raise ValueError("GST percentage must be between 0 and 50.")
    if discount_rate_percent < 0 or discount_rate_percent > 100:
        raise ValueError("Discount percentage must be between 0 and 100.")
    if discount_quantity_threshold < 1:
        raise ValueError("Discount threshold must be at least 1.")
    old = get_pricing_settings()
    values = {
        "gst_rate_percent": gst_rate_percent,
        "discount_rate_percent": discount_rate_percent,
        "discount_quantity_threshold": discount_quantity_threshold,
    }
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            for key, value in values.items():
                cur.execute(
                    """
                    insert into public.app_settings (key, value, updated_by, updated_at)
                    values (%s, jsonb_build_object('value', %s::numeric), %s, now())
                    on conflict (key) do update set
                        value = excluded.value,
                        updated_by = excluded.updated_by,
                        updated_at = excluded.updated_at
                    """,
                    (key, value, performed_by),
                )
            _audit(
                cur,
                action_type="pricing.settings.updated",
                entity_type="pricing_settings",
                entity_id="global",
                old_value=old,
                new_value=values,
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
    _ensure_postgres()
    if not name.strip():
        raise ValueError("Discount name is required.")
    if discount_percent < 0 or discount_percent > 100:
        raise ValueError("Discount percentage must be between 0 and 100.")
    if no_min_value:
        threshold_amount = 0
    if threshold_amount < 0:
        raise ValueError("Discount threshold must be non-negative.")
    if not no_min_quantity and (min_quantity or 0) < 1:
        raise ValueError("Minimum quantity must be at least 1 or disabled.")
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            old = None
            if rule_id:
                cur.execute(
                    "select * from public.discount_rules where id = %s", (rule_id,)
                )
                old = _one(cur)
                if not old:
                    raise LookupError("Discount rule not found.")
                cur.execute(
                    """
                    update public.discount_rules
                    set name = %s, coupon_code = nullif(%s, ''), description = %s,
                        discount_percent = %s, threshold_amount = %s,
                        start_date = nullif(%s, '')::date,
                        end_date = nullif(%s, '')::date,
                        is_active = %s, updated_at = now()
                    where id = %s
                    returning id, name, coupon_code, description, discount_percent,
                              threshold_amount, start_date, end_date, is_active,
                              updated_at
                    """,
                    (
                        name.strip(),
                        (coupon_code or "").strip().upper(),
                        description,
                        discount_percent,
                        threshold_amount,
                        start_date or "",
                        end_date or "",
                        is_active,
                        rule_id,
                    ),
                )
            else:
                cur.execute(
                    """
                    insert into public.discount_rules (
                        name, coupon_code, description, discount_percent,
                        threshold_amount, start_date, end_date, is_active
                    )
                    values (%s, nullif(%s, ''), %s, %s, %s,
                            nullif(%s, '')::date, nullif(%s, '')::date, %s)
                    returning id, name, coupon_code, description, discount_percent,
                              threshold_amount, start_date, end_date, is_active,
                              updated_at
                    """,
                    (
                        name.strip(),
                        (coupon_code or "").strip().upper(),
                        description,
                        discount_percent,
                        threshold_amount,
                        start_date or "",
                        end_date or "",
                        is_active,
                    ),
                )
            updated = _one(cur)
            cur.execute(
                """
                insert into public.discount_rule_conditions (
                    discount_rule_id, min_quantity, no_min_quantity,
                    no_min_value, updated_at
                )
                values (%s, %s, %s, %s, now())
                on conflict (discount_rule_id) do update set
                    min_quantity = excluded.min_quantity,
                    no_min_quantity = excluded.no_min_quantity,
                    no_min_value = excluded.no_min_value,
                    updated_at = excluded.updated_at
                """,
                (
                    updated["id"],
                    None if no_min_quantity else min_quantity,
                    no_min_quantity,
                    no_min_value,
                ),
            )
            _audit(
                cur,
                action_type="discount.rule.upserted",
                entity_type="discount_rule",
                entity_id=updated["id"],
                old_value=old,
                new_value=updated,
                performed_by=performed_by,
                reason=reason,
            )
    return updated


def list_festival_coupon_suggestions(
    limit: int = 6, year: int | None = None
) -> list[dict]:
    _ensure_postgres()
    limit = max(1, min(limit, 20))
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            calendar_limit = max(1, limit - 3)
            params: list[object] = []
            where = "where festival_date >= current_date"
            if year is not None:
                where = "where extract(year from festival_date) = %s"
                params.append(year)
                if year == date.today().year:
                    where += " and festival_date >= current_date"
            cur.execute(
                f"""
                select festival_date, name, coupon_theme,
                       suggested_discount_percent, suggested_threshold_amount
                from public.indian_festival_calendar
                {where}
                order by festival_date
                limit %s
                """,  # nosec B608
                (*params, calendar_limit),
            )
            rows = _many(cur)
            cur.execute(
                """
                select
                    coalesce(avg(total), 0) as aov,
                    coalesce(count(*), 0) as orders,
                    coalesce(sum(total), 0) as revenue
                from public.orders
                where created_at >= now() - interval '60 days'
                  and status not in ('Cancelled', 'Refunded')
                """
            )
            summary = _one(cur) or {"aov": 0, "orders": 0, "revenue": 0}
            cur.execute(
                """
                select coalesce(extract(hour from created_at)::int, 0) as hour,
                       count(*) as orders
                from public.orders
                where created_at >= now() - interval '60 days'
                  and status not in ('Cancelled', 'Refunded')
                group by 1
                order by orders desc
                limit 1
                """
            )
            peak = _one(cur) or {"hour": 18, "orders": 0}
            cur.execute(
                """
                select coalesce(customer_name, 'Guest') as customer_name,
                       count(*) as orders
                from public.orders
                where created_at >= now() - interval '90 days'
                  and customer_phone is not null
                group by customer_phone, customer_name
                having count(*) >= 2
                order by orders desc
                limit 1
                """
            )
            repeat = _one(cur)
    suggestions = [
        {
            **row,
            "source_type": "calendar",
            "suggested_coupon_code": _coupon_code_for_festival(row["name"]),
            "suggestion": (
                f"{row['coupon_theme']}: {row['suggested_discount_percent']}% off "
                f"above INR {row['suggested_threshold_amount']}."
            ),
        }
        for row in rows
    ]
    target_year = year or date.today().year
    aov = float(summary["aov"] or 0)
    generic_rows = [
        {
            "festival_date": date(target_year, 12, 31),
            "name": "Average Order Booster",
            "coupon_theme": "Increase cart value",
            "suggested_discount_percent": 8,
            "suggested_threshold_amount": round(max(aov * 1.25, 599), 2),
            "source_type": "analytics",
            "suggested_coupon_code": "BOOSTAOV",
            "suggestion": "Encourage customers to add one more item by setting the minimum value slightly above current AOV.",
        },
        {
            "festival_date": date(target_year, 12, 31),
            "name": "Slow Hour Builder",
            "coupon_theme": "Improve non-peak orders",
            "suggested_discount_percent": 10,
            "suggested_threshold_amount": round(max(aov, 499), 2),
            "source_type": "analytics",
            "suggested_coupon_code": "SLOWHOUR",
            "suggestion": f"Use outside peak hour {int(peak['hour']):02d}:00 to create demand without crowding rush prep.",
        },
        {
            "festival_date": date(target_year, 12, 31),
            "name": "Repeat Customer Thank You",
            "coupon_theme": "Retain loyal customers",
            "suggested_discount_percent": 12,
            "suggested_threshold_amount": round(max(aov, 499), 2),
            "source_type": "analytics",
            "suggested_coupon_code": "COMEBACK",
            "suggestion": (
                f"Reward repeat customers like {repeat['customer_name']}."
                if repeat
                else "Reward customers after their second order to improve repeat purchase rate."
            ),
        },
    ]
    return (suggestions + generic_rows)[:limit]


def _coupon_code_for_festival(name: str) -> str:
    return "".join(ch for ch in name.upper() if ch.isalnum())[:10]


def list_staff() -> list[dict]:
    _ensure_postgres()
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select sp.id, sp.employee_code, sp.role_name, sp.is_active,
                       u.full_name, u.email, u.phone, u.status,
                       sp.updated_at
                from public.staff_profiles sp
                join public.app_users u on u.id = sp.user_id
                order by sp.created_at desc
                """
            )
            return _many(cur)


def list_roles() -> list[dict]:
    _ensure_postgres()
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("select id, name, description from public.roles order by name")
            return _many(cur)


def _map_role_name_to_app_role(role_name: str) -> str:
    r = role_name.lower().strip()
    if "admin" in r:
        return "admin"
    elif "kitchen" in r or "backstage" in r:
        return "kitchen_staff"
    elif "delivery" in r or "rider" in r:
        return "delivery"
    elif "customer" in r:
        return "user"
    else:
        return "staff"


def create_staff(
    *,
    full_name: str,
    email: str,
    phone: str | None,
    role_name: str,
    employee_code: str | None,
    pin: str | None = None,
    performed_by: str,
    reason: str | None = None,
) -> dict:
    _ensure_postgres()
    if not full_name.strip():
        raise ValueError("Staff name is required.")
    if "@" not in email:
        raise ValueError("Valid staff email is required.")
    
    app_role = _map_role_name_to_app_role(role_name)
    from api import security
    p = pin or employee_code or "123456"
    secret_hash = security.hash_secret(p)

    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("select id from public.roles where name = %s", (role_name,))
            role = _one(cur)
            if not role:
                raise ValueError("Unknown staff role.")
            cur.execute(
                """
                insert into public.app_users (
                    email, name, full_name, phone, role, emp_id, secret_hash, is_active, status
                )
                values (%s, %s, %s, %s, %s, %s, %s, true, 'active')
                on conflict (email) do update set
                    name = excluded.name,
                    full_name = excluded.full_name,
                    phone = excluded.phone,
                    role = excluded.role,
                    emp_id = excluded.emp_id,
                    secret_hash = excluded.secret_hash,
                    status = 'active',
                    updated_at = now()
                returning id, role, name, phone, email, emp_id, is_active, status
                """,
                (
                    email.strip().lower(),
                    full_name.strip(),
                    full_name.strip(),
                    phone,
                    app_role,
                    (employee_code or "").strip() or None,
                    secret_hash,
                ),
            )
            user = _one(cur)
            cur.execute(
                "delete from public.user_roles where user_id = %s", (user["id"],)
            )
            cur.execute(
                "insert into public.user_roles (user_id, role_id) values (%s, %s)",
                (user["id"], role["id"]),
            )
            cur.execute(
                """
                insert into public.staff_profiles (
                    user_id, role_name, employee_code, is_active
                )
                values (%s, %s, nullif(%s, ''), true)
                on conflict (user_id) do update set
                    role_name = excluded.role_name,
                    employee_code = excluded.employee_code,
                    is_active = true,
                    updated_at = now()
                returning id, user_id, role_name, employee_code, is_active
                """,
                (user["id"], role_name, (employee_code or "").strip()),
            )
            profile = _one(cur)
            staff = {**user, **profile}
            _audit(
                cur,
                action_type="staff.created",
                entity_type="staff",
                entity_id=profile["id"],
                old_value=None,
                new_value=staff,
                performed_by=performed_by,
                reason=reason,
            )
    return staff


def update_staff(
    staff_id: str,
    *,
    full_name: str,
    phone: str | None,
    role_name: str,
    is_active: bool,
    pin: str | None = None,
    performed_by: str,
    reason: str | None = None,
) -> dict:
    _ensure_postgres()
    app_role = _map_role_name_to_app_role(role_name)
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select sp.id, sp.user_id, sp.role_name, sp.employee_code,
                       sp.is_active, u.full_name, u.email, u.phone, u.status
                from public.staff_profiles sp
                join public.app_users u on u.id = sp.user_id
                where sp.id = %s
                """,
                (staff_id,),
            )
            old = _one(cur)
            if not old:
                raise LookupError("Staff profile not found.")
            cur.execute("select id from public.roles where name = %s", (role_name,))
            role = _one(cur)
            if not role:
                raise ValueError("Unknown staff role.")
            status = "active" if is_active else "inactive"
            
            if pin:
                from api import security
                secret_hash = security.hash_secret(pin)
                cur.execute(
                    """
                    update public.app_users
                    set role = %s, name = %s, full_name = %s, phone = %s, secret_hash = %s, status = %s, updated_at = now()
                    where id = %s
                    returning id, email, full_name, phone, status
                    """,
                    (app_role, full_name.strip(), full_name.strip(), phone, secret_hash, status, old["user_id"]),
                )
            else:
                cur.execute(
                    """
                    update public.app_users
                    set role = %s, name = %s, full_name = %s, phone = %s, status = %s, updated_at = now()
                    where id = %s
                    returning id, email, full_name, phone, status
                    """,
                    (app_role, full_name.strip(), full_name.strip(), phone, status, old["user_id"]),
                )
            user = _one(cur)
            cur.execute(
                "delete from public.user_roles where user_id = %s", (old["user_id"],)
            )
            cur.execute(
                "insert into public.user_roles (user_id, role_id) values (%s, %s)",
                (old["user_id"], role["id"]),
            )
            cur.execute(
                """
                update public.staff_profiles
                set role_name = %s, is_active = %s, updated_at = now()
                where id = %s
                returning id, user_id, role_name, employee_code, is_active
                """,
                (role_name, is_active, staff_id),
            )
            profile = _one(cur)
            updated = {**user, **profile}
            _audit(
                cur,
                action_type="staff.updated",
                entity_type="staff",
                entity_id=staff_id,
                old_value=old,
                new_value=updated,
                performed_by=performed_by,
                reason=reason,
            )
    return updated


def list_audit_logs(limit: int = 50) -> list[dict]:
    _ensure_postgres()
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select al.id, al.action_type, al.entity_type, al.entity_id,
                       al.old_value, al.new_value, al.reason, al.performed_at,
                       u.full_name as performed_by_name
                from public.audit_logs al
                left join public.app_users u on u.id = al.performed_by
                order by al.performed_at desc
                limit %s
                """,
                (limit,),
            )
            return _many(cur)


def get_analytics_report(
    *,
    date_from: str | None = None,
    date_to: str | None = None,
) -> dict:
    _ensure_postgres()
    clauses = []
    params: list = []
    if date_from:
        clauses.append("created_at::date >= %s::date")
        params.append(date_from)
    if date_to:
        clauses.append("created_at::date <= %s::date")
        params.append(date_to)
    where = f"where {' and '.join(clauses)}" if clauses else ""
    item_where = (
        f"where {' and '.join('o.' + clause for clause in clauses)}" if clauses else ""
    )
    item_and = (
        f"and {' and '.join('o.' + clause for clause in clauses)}" if clauses else ""
    )
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                select count(*)::int as total_orders,
                       coalesce(sum(total), 0) as revenue,
                       coalesce(avg(total), 0) as average_order_value,
                       coalesce(sum(gst), 0) as gst,
                       coalesce(sum(discount), 0) as discount,
                       count(*) filter (where status in ('Cancelled', 'cancelled'))::int
                           as cancelled_orders,
                       count(*) filter (where status in ('RefundRequested', 'Refunded'))::int
                           as refund_orders
                from public.orders
                {where}
                """,  # nosec B608
                params,
            )
            totals = _one(cur)

            cur.execute(
                f"""
                select created_at::date as date,
                       count(*)::int as orders,
                       coalesce(sum(total), 0) as revenue
                from public.orders
                {where}
                group by created_at::date
                order by date desc
                limit 14
                """,  # nosec B608
                params,
            )
            daily_revenue = _many(cur)

            cur.execute(
                f"""
                select extract(hour from created_at)::int as hour,
                       count(*)::int as orders,
                       coalesce(sum(total), 0) as revenue
                from public.orders
                {where}
                group by hour
                order by hour
                """,  # nosec B608
                params,
            )
            hourly_revenue = _many(cur)

            cur.execute(
                f"""
                select item->>'pizza' as name,
                       coalesce(sum((item->>'quantity')::int), 0)::int as quantity,
                       coalesce(sum((item->>'line_total')::numeric), 0) as revenue
                from public.orders o
                cross join lateral jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) item
                where item ? 'pizza'
                {item_and}
                group by item->>'pizza'
                order by quantity desc, revenue desc, name
                limit 10
                """,  # nosec B608
                params,
            )
            top_items = _many(cur)

            cur.execute(
                f"""
                select topping as name, count(*)::int as quantity
                from public.orders o
                cross join lateral jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) item
                cross join lateral jsonb_array_elements_text(coalesce(item->'toppings', '[]'::jsonb)) topping
                {item_where}
                group by topping
                order by quantity desc, name
                limit 10
                """,  # nosec B608
                params,
            )
            top_toppings = _many(cur)

            cur.execute(
                f"""
                select payment_mode,
                       count(*)::int as orders,
                       coalesce(sum(total), 0) as revenue
                from public.orders
                {where}
                group by payment_mode
                order by revenue desc
                """,  # nosec B608
                params,
            )
            revenue_by_payment_mode = _many(cur)

            cur.execute(
                f"""
                select source,
                       count(*)::int as orders,
                       coalesce(sum(total), 0) as revenue
                from public.orders
                {where}
                group by source
                order by orders desc
                """,  # nosec B608
                params,
            )
            orders_by_source = _many(cur)

            cur.execute(
                f"""
                select trim(to_char(created_at, 'Day')) as weekday,
                       extract(isodow from created_at)::int as weekday_no,
                       count(*)::int as orders,
                       coalesce(sum(total), 0) as revenue
                from public.orders
                {where}
                group by weekday, weekday_no
                order by weekday_no
                """,  # nosec B608
                params,
            )
            weekday_trend = _many(cur)

            cur.execute(
                f"""
                select customer_phone,
                       max(customer_name) as customer_name,
                       count(*)::int as orders,
                       coalesce(sum(total), 0) as revenue
                from public.orders
                {where}
                group by customer_phone
                having count(*) > 1
                order by orders desc, revenue desc
                limit 10
                """,  # nosec B608
                params,
            )
            repeat_customers = _many(cur)

    total_orders = totals.get("total_orders", 0) or 0
    refund_rate = (
        round((totals.get("refund_orders", 0) / total_orders) * 100, 2)
        if total_orders
        else 0
    )
    cancellation_rate = (
        round((totals.get("cancelled_orders", 0) / total_orders) * 100, 2)
        if total_orders
        else 0
    )
    discount_impact = {
        "discount": totals.get("discount", 0),
        "discount_to_revenue_percent": (
            round(((totals.get("discount", 0) or 0) / totals["revenue"]) * 100, 2)
            if totals.get("revenue")
            else 0
        ),
    }
    return {
        "totals": totals,
        "daily_revenue": daily_revenue,
        "hourly_revenue": hourly_revenue,
        "top_items": top_items,
        "top_toppings": top_toppings,
        "repeat_customers": repeat_customers,
        "revenue_by_payment_mode": revenue_by_payment_mode,
        "orders_by_source": orders_by_source,
        "weekday_trend": weekday_trend,
        "discount_impact": discount_impact,
        "refund_rate": refund_rate,
        "cancellation_rate": cancellation_rate,
        "recommendation_impact": get_recommendation_impact(),
        "date_filter": {"date_from": date_from, "date_to": date_to},
    }


def list_ai_insight_logs(
    *,
    provider: str | None = None,
    insight_type: str | None = None,
    limit: int = 50,
) -> list[dict]:
    _ensure_postgres()
    limit = max(1, min(limit, 200))
    clauses = []
    params: list = []
    if provider:
        clauses.append("provider = %s")
        params.append(provider)
    if insight_type:
        clauses.append("insight_type = %s")
        params.append(insight_type)
    where = f"where {' and '.join(clauses)}" if clauses else ""
    params.append(limit)
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                select id, provider, insight_type, input_metrics, insight_text,
                       created_at
                from public.ai_insight_logs
                {where}
                order by created_at desc
                limit %s
                """,  # nosec B608
                params,
            )
            return _many(cur)


def generate_ai_insights(*, performed_by: str, provider: str = "mock") -> dict:
    _ensure_postgres()
    from ai.admin_provider import refine_admin_insights

    metrics = get_analytics_report()
    deterministic_insights = _build_metric_insights(metrics)
    provider_result = refine_admin_insights(
        metrics=metrics,
        insights=deterministic_insights,
    )
    insights = provider_result.insights
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            for insight in insights:
                cur.execute(
                    """
                    insert into public.ai_insight_logs (
                        provider, insight_type, input_metrics, insight_text, created_by
                    )
                    values (%s, %s, %s::jsonb, %s, %s)
                    """,
                    (
                        provider_result.provider,
                        insight["type"],
                        _json(insight["metrics"]),
                        insight["text"],
                        performed_by,
                    ),
                )
            cur.execute(
                """
                select id, provider, insight_type, insight_text, created_at
                from public.ai_insight_logs
                order by created_at desc
                limit 20
                """
            )
            logs = _many(cur)
    return {
        "provider": provider_result.provider,
        "fallback_used": provider_result.fallback_used,
        "provider_error": provider_result.error,
        "insights": insights,
        "logs": logs,
    }


def generate_forecast(*, performed_by: str, days: int = 7) -> dict:
    _ensure_postgres()
    days = max(1, min(days, 14))
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select coalesce(avg(daily.orders), 0) as avg_orders,
                       coalesce(avg(daily.revenue), 0) as avg_revenue
                from (
                    select created_at::date as day,
                           count(*)::numeric as orders,
                           coalesce(sum(total), 0)::numeric as revenue
                    from public.orders
                    where created_at >= current_date - interval '30 days'
                    group by created_at::date
                ) daily
                """
            )
            baseline = _one(cur)
            avg_orders = float(baseline.get("avg_orders", 0) or 0)
            avg_revenue = float(baseline.get("avg_revenue", 0) or 0)
            cur.execute(
                """
                select day::date as forecast_date,
                       case when extract(isodow from day) in (6, 7)
                            then %s * 1.15 else %s end as predicted_orders,
                       case when extract(isodow from day) in (6, 7)
                            then %s * 1.15 else %s end as predicted_revenue,
                       extract(isodow from day) in (6, 7) as weekend_flag
                from generate_series(
                    current_date + interval '1 day',
                    current_date + (%s || ' days')::interval,
                    interval '1 day'
                ) day
                """,
                (avg_orders, avg_orders, avg_revenue, avg_revenue, days),
            )
            forecast = _many(cur)
            for row in forecast:
                cur.execute(
                    """
                    insert into public.forecast_results (
                        forecast_date, predicted_orders, predicted_revenue,
                        method, factors, created_by
                    )
                    values (%s, %s, %s, %s, %s::jsonb, %s)
                    """,
                    (
                        row["forecast_date"],
                        row["predicted_orders"],
                        row["predicted_revenue"],
                        "rule_based_30_day_average_with_weekend_uplift",
                        _json({"weekend_flag": row["weekend_flag"]}),
                        performed_by,
                    ),
                )
    return {
        "method": "rule_based_30_day_average_with_weekend_uplift",
        "baseline": baseline,
        "forecast": forecast,
    }


def get_ai_business_intelligence(days: int = 7) -> dict:
    _ensure_postgres()
    from ai.admin_provider import admin_ai_provider_status

    days = max(1, min(days, 30))
    analytics = get_analytics_report()
    demand = _build_demand_forecast(days)
    peak = _build_peak_rush(analytics)
    inventory = _build_inventory_forecast(days)
    provider_status = admin_ai_provider_status()
    return {
        "provider": provider_status["provider"],
        "provider_status": provider_status,
        "source": "local_postgres_metrics",
        "demand_forecast": demand,
        "peak_rush": peak,
        "inventory_forecast": inventory,
        "staff_scheduling": _build_staff_scheduling(peak),
        "smart_upsells": _build_upsell_recommendations(analytics),
        "coupon_recommendations": _build_coupon_recommendations(analytics),
        "churn_risks": _build_churn_risks(),
        "ltv_recommendations": _build_ltv_recommendations(analytics),
        "sentiment_analysis": _build_sentiment_analysis(),
        "voice_ordering_readiness": _build_voice_ordering_readiness(),
        "recommendation_impact": get_recommendation_impact(),
        "safety_rules": [
            "AI recommendations never calculate final bill totals.",
            "GST, discounts, and payment correctness remain deterministic.",
            "Every recommendation is derived from database metrics.",
        ],
    }


def record_recommendation_event(
    *,
    recommendation_type: str,
    recommendation_key: str,
    title: str,
    detail: str | None,
    status: str,
    estimated_value: float = 0,
    source_metrics: dict | None = None,
    related_entity_type: str | None = None,
    related_entity_id: str | None = None,
    performed_by: str | None = None,
) -> dict:
    _ensure_postgres()
    if recommendation_type not in {"upsell", "coupon", "inventory", "staff", "churn"}:
        raise ValueError("Unsupported recommendation type.")
    if status not in {"presented", "accepted", "rejected"}:
        raise ValueError(
            "Recommendation status must be presented, accepted, or rejected."
        )
    if not recommendation_key.strip():
        raise ValueError("Recommendation key is required.")
    if not title.strip():
        raise ValueError("Recommendation title is required.")
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into public.ai_recommendation_events (
                    recommendation_type, recommendation_key, title, detail, status,
                    estimated_value, source_metrics, related_entity_type,
                    related_entity_id, created_by
                )
                values (%s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s)
                returning id, recommendation_type, recommendation_key, title, detail,
                          status, estimated_value, source_metrics,
                          related_entity_type, related_entity_id, created_at
                """,
                (
                    recommendation_type,
                    recommendation_key.strip(),
                    title.strip(),
                    detail,
                    status,
                    estimated_value,
                    _json(source_metrics or {}),
                    related_entity_type,
                    related_entity_id,
                    performed_by,
                ),
            )
            event = _one(cur)
            _audit(
                cur,
                action_type="ai.recommendation.event",
                entity_type="ai_recommendation",
                entity_id=event["id"],
                old_value=None,
                new_value=event,
                performed_by=performed_by,
                reason=f"{recommendation_type}:{status}",
            )
    return event


def get_recommendation_impact(limit: int = 20) -> dict:
    _ensure_postgres()
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select recommendation_type,
                       count(*)::int as total,
                       count(*) filter (where status = 'accepted')::int as accepted,
                       count(*) filter (where status = 'rejected')::int as rejected,
                       coalesce(sum(estimated_value) filter (where status = 'accepted'), 0)
                           as accepted_estimated_value
                from public.ai_recommendation_events
                group by recommendation_type
                order by recommendation_type
                """
            )
            summary = _many(cur)
            cur.execute(
                """
                select id, recommendation_type, recommendation_key, title, detail,
                       status, estimated_value, source_metrics, related_entity_type,
                       related_entity_id, created_at
                from public.ai_recommendation_events
                order by created_at desc
                limit %s
                """,
                (limit,),
            )
            recent = _many(cur)
    totals = {
        "total": sum(row.get("total", 0) for row in summary),
        "accepted": sum(row.get("accepted", 0) for row in summary),
        "rejected": sum(row.get("rejected", 0) for row in summary),
        "accepted_estimated_value": round(
            sum(row.get("accepted_estimated_value", 0) for row in summary),
            2,
        ),
    }
    totals["acceptance_rate"] = (
        round((totals["accepted"] / totals["total"]) * 100, 2) if totals["total"] else 0
    )
    return {"totals": totals, "by_type": summary, "recent": recent}


def list_customer_feedback(limit: int = 50) -> dict:
    _ensure_postgres()
    limit = max(1, min(limit, 200))
    return {
        "summary": _build_sentiment_analysis(limit=limit),
        "feedback": _recent_customer_feedback(limit=limit),
    }


def record_customer_feedback(
    *,
    order_id: str | None = None,
    customer_name: str | None = None,
    customer_phone: str | None = None,
    channel: str = "manual",
    rating: int,
    feedback_text: str,
    source_metadata: dict | None = None,
    performed_by: str | None = None,
) -> dict:
    _ensure_postgres()
    if channel not in {
        "manual",
        "app",
        "web",
        "whatsapp",
        "voice",
        "google",
        "zomato",
        "swiggy",
    }:
        raise ValueError("Unsupported feedback channel.")
    if rating < 1 or rating > 5:
        raise ValueError("Rating must be between 1 and 5.")
    if not feedback_text.strip():
        raise ValueError("Feedback text is required.")
    sentiment = _score_feedback_sentiment(rating=rating, text=feedback_text)
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into public.customer_feedback (
                    order_id, customer_name, customer_phone, channel, rating,
                    feedback_text, sentiment_label, sentiment_score, topics,
                    source_metadata, created_by
                )
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s)
                returning id, order_id, customer_name, customer_phone, channel,
                          rating, feedback_text, sentiment_label, sentiment_score,
                          topics, source_metadata, created_at
                """,
                (
                    order_id,
                    customer_name,
                    customer_phone,
                    channel,
                    rating,
                    feedback_text.strip(),
                    sentiment["label"],
                    sentiment["score"],
                    _json(sentiment["topics"]),
                    _json(source_metadata or {}),
                    performed_by,
                ),
            )
            feedback = _one(cur)
            _audit(
                cur,
                action_type="customer_feedback.create",
                entity_type="customer_feedback",
                entity_id=feedback["id"],
                old_value=None,
                new_value=feedback,
                performed_by=performed_by,
                reason="Admin sentiment feedback source",
            )
    return feedback


def simulate_revenue_scenario(
    *,
    menu_price_adjustment_percent: float = 0,
    ingredient_price_increase_percent: float = 0,
    rent_increase_amount: float = 0,
    other_fixed_cost_increase_amount: float = 0,
    discount_change_percent: float = 0,
) -> dict:
    _ensure_postgres()
    metrics = get_analytics_report()
    totals = metrics["totals"]
    revenue = float(totals.get("revenue", 0) or 0)
    orders = int(totals.get("total_orders", 0) or 0)
    avg_order_value = float(totals.get("average_order_value", 0) or 0)
    discount = float(totals.get("discount", 0) or 0)

    estimated_food_cost = revenue * 0.35
    estimated_fixed_cost = revenue * 0.18
    baseline_margin = revenue - estimated_food_cost - estimated_fixed_cost - discount

    projected_revenue = revenue * (1 + menu_price_adjustment_percent / 100)
    projected_food_cost = estimated_food_cost * (
        1 + ingredient_price_increase_percent / 100
    )
    projected_discount = max(0, discount * (1 + discount_change_percent / 100))
    projected_fixed_cost = (
        estimated_fixed_cost + rent_increase_amount + other_fixed_cost_increase_amount
    )
    projected_margin = (
        projected_revenue
        - projected_food_cost
        - projected_fixed_cost
        - projected_discount
    )

    actions: list[str] = []
    if ingredient_price_increase_percent >= 8 and menu_price_adjustment_percent < 5:
        actions.append("Consider a 5-8% price increase on high-margin pizzas.")
    if discount_change_percent > 0 or projected_discount > discount:
        actions.append("Avoid increasing discounts while costs are rising.")
    if projected_margin < baseline_margin:
        actions.append(
            "Promote high-margin items and reduce wastage before expanding offers."
        )
    if not actions:
        actions.append("Scenario keeps margin stable against current local data.")

    return {
        "method": "deterministic_margin_simulation",
        "inputs": {
            "menu_price_adjustment_percent": menu_price_adjustment_percent,
            "ingredient_price_increase_percent": ingredient_price_increase_percent,
            "rent_increase_amount": rent_increase_amount,
            "other_fixed_cost_increase_amount": other_fixed_cost_increase_amount,
            "discount_change_percent": discount_change_percent,
        },
        "baseline": {
            "orders": orders,
            "revenue": revenue,
            "average_order_value": avg_order_value,
            "estimated_food_cost": estimated_food_cost,
            "estimated_fixed_cost": estimated_fixed_cost,
            "discount": discount,
            "estimated_margin": baseline_margin,
        },
        "projected": {
            "revenue": projected_revenue,
            "estimated_food_cost": projected_food_cost,
            "estimated_fixed_cost": projected_fixed_cost,
            "discount": projected_discount,
            "estimated_margin": projected_margin,
            "margin_delta": projected_margin - baseline_margin,
        },
        "recommended_actions": actions,
        "safety_note": "Simulation uses deterministic math first; AI text is explanatory only.",
    }


def _build_demand_forecast(days: int) -> dict:
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select coalesce(avg(daily.orders), 0) as avg_orders,
                       coalesce(avg(daily.revenue), 0) as avg_revenue
                from (
                    select created_at::date as day,
                           count(*)::numeric as orders,
                           coalesce(sum(total), 0)::numeric as revenue
                    from public.orders
                    where created_at >= current_date - interval '30 days'
                    group by created_at::date
                ) daily
                """
            )
            baseline = _one(cur)
    avg_orders = float(baseline.get("avg_orders", 0) or 0)
    avg_revenue = float(baseline.get("avg_revenue", 0) or 0)
    rows = []
    for offset in range(1, days + 1):
        forecast_date = date.today() + timedelta(days=offset)
        weekend = forecast_date.isoweekday() in {6, 7}
        holiday = _is_indian_holiday(forecast_date)
        multiplier = 1 + (0.15 if weekend else 0) + (0.25 if holiday else 0)
        rows.append(
            {
                "forecast_date": forecast_date.isoformat(),
                "predicted_orders": round(avg_orders * multiplier, 2),
                "predicted_revenue": round(avg_revenue * multiplier, 2),
                "weekend_flag": weekend,
                "holiday_flag": holiday,
                "confidence": _forecast_confidence(avg_orders),
                "rationale": _forecast_rationale(weekend, holiday),
            }
        )
    return {
        "method": "30_day_average_with_weekend_and_indian_holiday_uplift",
        "baseline": baseline,
        "weekday_profile": _forecast_weekday_profile(),
        "hourly_profile": _forecast_hourly_profile(),
        "campaign_activity": _active_campaign_activity(),
        "forecast": rows,
    }


def _forecast_weekday_profile() -> list[dict]:
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select trim(to_char(created_at, 'Day')) as weekday,
                       extract(isodow from created_at)::int as weekday_no,
                       coalesce(avg(daily.orders), 0) as avg_orders,
                       coalesce(avg(daily.revenue), 0) as avg_revenue
                from (
                    select created_at::date as day,
                           count(*)::numeric as orders,
                           coalesce(sum(total), 0)::numeric as revenue
                    from public.orders
                    where created_at >= current_date - interval '60 days'
                    group by created_at::date
                ) daily
                join public.orders o on o.created_at::date = daily.day
                group by weekday, weekday_no
                order by weekday_no
                """
            )
            return _many(cur)


def _forecast_hourly_profile() -> list[dict]:
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select extract(hour from created_at)::int as hour,
                       count(*)::int as orders,
                       coalesce(sum(total), 0) as revenue
                from public.orders
                where created_at >= current_date - interval '60 days'
                group by hour
                order by hour
                """
            )
            return _many(cur)


def _active_campaign_activity() -> dict:
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select count(*)::int as active_campaigns,
                       coalesce(avg(discount_percent), 0) as avg_discount_percent
                from public.discount_rules
                where is_active = true
                  and (start_date is null or start_date <= current_date)
                  and (end_date is null or end_date >= current_date)
                """
            )
            return _one(cur)


def _build_peak_rush(metrics: dict) -> dict:
    rows = sorted(
        metrics.get("hourly_revenue", []),
        key=lambda row: (row.get("orders", 0), row.get("revenue", 0)),
        reverse=True,
    )
    top = rows[:5]
    busiest = top[0] if top else {}
    return {
        "top_hours": top,
        "busiest_hour": busiest,
        "rush_window": _hour_window(int(busiest.get("hour", 0))) if busiest else None,
        "recommendation": (
            f"Prepare extra staff and ingredients around {_hour_window(int(busiest.get('hour', 0)))}."
            if busiest
            else "Add demo orders to detect peak rush windows."
        ),
    }


def _build_inventory_forecast(days: int) -> list[dict]:
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                with item_usage as (
                    select mi.id as menu_item_id,
                           coalesce(sum((item->>'quantity')::numeric), 0) / 30.0
                               as avg_units_per_day
                    from public.menu_items mi
                    left join public.orders o
                        on o.created_at >= current_date - interval '30 days'
                    left join lateral jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) item
                        on item->>'pizza' = mi.name or item->>'base' = mi.name
                    group by mi.id
                )
                select i.id, i.name, i.unit, i.stock_quantity, i.reorder_threshold,
                       coalesce(sum(iu.avg_units_per_day * mii.quantity_per_unit), 0)
                           as avg_daily_usage
                from public.ingredients i
                left join public.menu_item_ingredients mii on mii.ingredient_id = i.id
                left join item_usage iu on iu.menu_item_id = mii.menu_item_id
                where i.is_active = true
                group by i.id, i.name, i.unit, i.stock_quantity, i.reorder_threshold
                order by i.name
                """
            )
            rows = _many(cur)
    forecast = []
    for row in rows:
        usage = float(row.get("avg_daily_usage", 0) or 0)
        stock = float(row.get("stock_quantity", 0) or 0)
        days_until_stockout = round(stock / usage, 1) if usage else None
        projected_stock = stock - (usage * days)
        risk = (
            "high"
            if projected_stock <= 0
            else (
                "medium"
                if projected_stock <= row.get("reorder_threshold", 0)
                else "low"
            )
        )
        forecast.append(
            {
                **row,
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

    # Query upcoming Indian holidays from database
    upcoming_festival = None
    try:
        with postgres.connect() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    select name, coupon_theme, suggested_discount_percent, suggested_threshold_amount, festival_date
                    from public.indian_festival_calendar
                    where festival_date >= current_date
                    order by festival_date
                    limit 1
                """)
                upcoming_festival = _one(cur)
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("Failed to fetch festival for coupon recommendations: %s", e)

    if upcoming_festival and upcoming_festival.get("name"):
        name = upcoming_festival["name"]
        theme = upcoming_festival["coupon_theme"]
        discount = int(upcoming_festival.get("suggested_discount_percent") or 15)
        clean_name = "".join(c for c in name if c.isalnum()).upper()
        coupon_code = f"{clean_name}{discount}"
        
        recommendations.append(
            {
                "recommendation_key": f"coupon:festival-{clean_name.lower()}",
                "name": f"{name} Special",
                "coupon": coupon_code,
                "discount_percent": discount,
                "threshold_amount": round(float(upcoming_festival.get("suggested_threshold_amount") or aov or 499), 2),
                "reason": f"FESTIVAL CAMPAIGN: {theme} for {name}.",
                "estimated_value": round(aov * (discount / 100.0), 2) if aov else 50.0,
                "source_metrics": upcoming_festival,
            }
        )

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


def _build_churn_risks() -> list[dict]:
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select customer_phone,
                       max(customer_name) as customer_name,
                       count(*)::int as orders,
                       coalesce(sum(total), 0) as revenue,
                       max(created_at)::date as last_order_date,
                       (current_date - max(created_at)::date)::int as days_since_last_order
                from public.orders
                group by customer_phone
                having count(*) >= 2 and (current_date - max(created_at)::date)::int >= 21
                order by revenue desc, days_since_last_order desc
                limit 10
                """
            )
            rows = _many(cur)
    return [
        {
            **row,
            "risk": "high" if row.get("days_since_last_order", 0) >= 45 else "medium",
            "suggested_action": "Send win-back coupon with limited validity.",
        }
        for row in rows
    ]


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


def _build_sentiment_analysis(limit: int = 20) -> dict:
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select count(*)::int as total,
                       coalesce(avg(rating), 0) as average_rating,
                       coalesce(avg(sentiment_score), 0) as average_sentiment_score,
                       count(*) filter (where sentiment_label = 'positive')::int as positive,
                       count(*) filter (where sentiment_label = 'neutral')::int as neutral,
                       count(*) filter (where sentiment_label = 'negative')::int as negative
                from public.customer_feedback
                where created_at >= now() - interval '90 days'
                """
            )
            totals = _one(cur)
            cur.execute(
                """
                select topic, count(*)::int as mentions
                from public.customer_feedback
                cross join lateral jsonb_array_elements_text(topics) topic
                where created_at >= now() - interval '90 days'
                group by topic
                order by mentions desc, topic
                limit 8
                """
            )
            topics = _many(cur)
    total = int(totals.get("total", 0) or 0)
    positive = int(totals.get("positive", 0) or 0)
    neutral = int(totals.get("neutral", 0) or 0)
    negative = int(totals.get("negative", 0) or 0)
    avg_score = float(totals.get("average_sentiment_score", 0) or 0)
    return {
        "status": "active" if total else "waiting_for_feedback",
        "source": "customer_feedback",
        "window_days": 90,
        "totals": {
            "total": total,
            "positive": positive,
            "neutral": neutral,
            "negative": negative,
            "positive_rate": round((positive / total) * 100, 2) if total else 0,
            "negative_rate": round((negative / total) * 100, 2) if total else 0,
            "average_rating": round(float(totals.get("average_rating", 0) or 0), 2),
            "average_sentiment_score": round(avg_score, 3),
        },
        "top_topics": topics,
        "recent": _recent_customer_feedback(limit=limit),
        "recommendation": _sentiment_recommendation(total, negative, avg_score, topics),
    }


def _recent_customer_feedback(limit: int = 20) -> list[dict]:
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select id, order_id, customer_name, customer_phone, channel,
                       rating, feedback_text, sentiment_label, sentiment_score,
                       topics, source_metadata, created_at
                from public.customer_feedback
                order by created_at desc
                limit %s
                """,
                (limit,),
            )
            return _many(cur)


def _score_feedback_sentiment(*, rating: int, text: str) -> dict:
    normalized = f" {text.lower()} "
    positive_terms = {
        "amazing",
        "awesome",
        "best",
        "crispy",
        "delicious",
        "fast",
        "fresh",
        "good",
        "great",
        "hot",
        "loved",
        "perfect",
        "quick",
        "tasty",
    }
    negative_terms = {
        "bad",
        "burnt",
        "cold",
        "delay",
        "late",
        "missing",
        "oily",
        "poor",
        "slow",
        "soggy",
        "stale",
        "wrong",
    }
    topic_terms = {
        "delivery": {"delivery", "delivered", "late", "delay", "fast", "quick"},
        "taste": {"taste", "tasty", "delicious", "bland", "spicy"},
        "temperature": {"hot", "cold", "warm"},
        "quality": {"fresh", "stale", "burnt", "soggy", "crispy", "oily"},
        "accuracy": {"wrong", "missing", "order", "topping"},
        "service": {"staff", "service", "support", "rude", "friendly"},
    }
    positive_hits = sum(1 for term in positive_terms if f" {term} " in normalized)
    negative_hits = sum(1 for term in negative_terms if f" {term} " in normalized)
    rating_score = (rating - 3) / 2
    keyword_score = (positive_hits - negative_hits) * 0.18
    score = max(-1, min(1, rating_score + keyword_score))
    label = "positive" if score >= 0.25 else "negative" if score <= -0.25 else "neutral"
    topics = [
        topic
        for topic, terms in topic_terms.items()
        if any(f" {term} " in normalized for term in terms)
    ]
    if not topics:
        topics = ["general"]
    return {"label": label, "score": round(score, 3), "topics": topics}


def _sentiment_recommendation(
    total: int,
    negative: int,
    avg_score: float,
    topics: list[dict],
) -> str:
    if not total:
        return "Collect customer reviews from app, WhatsApp, voice, and marketplace channels."
    top_topic = topics[0]["topic"] if topics else "general experience"
    if negative and negative / total >= 0.25:
        return f"Prioritize recovery for negative {top_topic} feedback before expanding promotions."
    if avg_score >= 0.45:
        return f"Use positive {top_topic} feedback in upsell and campaign messaging."
    return f"Monitor {top_topic} feedback and respond to low-rating customers within 24 hours."


def _build_voice_ordering_readiness() -> dict:
    return {
        "status": "ready",
        "channels": ["voice", "chat"],
        "tracked_order_source": "voice",
        "notes": [
            "Orders can already carry source=voice.",
            "AI forecasts and source analytics include voice orders once present.",
        ],
    }


def _is_indian_holiday(value: date) -> bool:
    fixed = {(1, 26), (8, 15), (10, 2), (12, 25)}
    return (value.month, value.day) in fixed


def _forecast_confidence(avg_orders: float) -> str:
    if avg_orders >= 20:
        return "high"
    if avg_orders >= 5:
        return "medium"
    return "low"


def _forecast_rationale(weekend: bool, holiday: bool) -> str:
    factors = ["30-day average"]
    if weekend:
        factors.append("weekend uplift")
    if holiday:
        factors.append("Indian holiday uplift")
    return ", ".join(factors)


def _hour_window(hour: int) -> str:
    return f"{hour:02d}:00-{(hour + 1) % 24:02d}:00"


def list_notifications(limit: int = 100) -> dict:
    _ensure_postgres()
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select nl.id, nl.channel, nl.provider, nl.recipient,
                       nl.template_name, nl.payload, nl.status, nl.error_message,
                       nl.related_entity_type, nl.related_entity_id,
                       nl.created_at, nl.sent_at, u.full_name as created_by_name
                from public.notification_logs nl
                left join public.app_users u on u.id = nl.created_by
                order by nl.created_at desc
                limit %s
                """,
                (limit,),
            )
            logs = _many(cur)
    return {"logs": logs}


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
    _ensure_postgres()
    if channel not in {"whatsapp", "email", "mock"}:
        raise ValueError("Unsupported notification channel.")
    if not recipient.strip():
        raise ValueError("Recipient is required.")
    if not template_name.strip():
        raise ValueError("Template name is required.")
    provider = "mock"
    status = "mocked"
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into public.notification_logs (
                    channel, provider, recipient, template_name, payload, status,
                    related_entity_type, related_entity_id, created_by, sent_at
                )
                values (%s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, now())
                returning id, channel, provider, recipient, template_name,
                          payload, status, created_at, sent_at
                """,
                (
                    channel,
                    provider,
                    recipient.strip(),
                    template_name.strip(),
                    _json(payload),
                    status,
                    related_entity_type,
                    related_entity_id,
                    performed_by,
                ),
            )
            log = _one(cur)
            if channel == "whatsapp":
                cur.execute(
                    """
                    insert into public.whatsapp_messages (
                        notification_id, phone, message, status
                    )
                    values (%s, %s, %s, %s)
                    """,
                    (
                        log["id"],
                        recipient.strip(),
                        str(payload.get("message", template_name)),
                        status,
                    ),
                )
            if channel == "email":
                cur.execute(
                    """
                    insert into public.email_logs (
                        notification_id, email, subject, body, status
                    )
                    values (%s, %s, %s, %s, %s)
                    """,
                    (
                        log["id"],
                        recipient.strip(),
                        str(payload.get("subject", template_name)),
                        str(payload.get("body", payload.get("message", template_name))),
                        status,
                    ),
                )
            _audit(
                cur,
                action_type="notification.mock.sent",
                entity_type="notification",
                entity_id=log["id"],
                old_value=None,
                new_value=log,
                performed_by=performed_by,
                reason=f"{channel} notification mock",
            )
    return log


def get_settings() -> dict:
    _ensure_postgres()
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "select key, value, updated_at from public.app_settings order by key"
            )
            rows = _many(cur)
    return {"settings": rows}


def update_settings(
    *,
    values: dict,
    performed_by: str,
    reason: str | None = None,
) -> dict:
    _ensure_postgres()
    allowed = {
        "restaurant_name",
        "restaurant_gstin",
        "restaurant_phone",
        "restaurant_address",
        "notification_whatsapp_provider",
        "notification_email_provider",
    }
    clean = {k: v for k, v in values.items() if k in allowed}
    if not clean:
        raise ValueError("No supported settings were provided.")
    old = get_settings()
    with postgres.connect() as conn:
        with conn.cursor() as cur:
            for key, value in clean.items():
                cur.execute(
                    """
                    insert into public.app_settings (key, value, updated_by, updated_at)
                    values (%s, jsonb_build_object('value', %s::text), %s, now())
                    on conflict (key) do update set
                        value = excluded.value,
                        updated_by = excluded.updated_by,
                        updated_at = excluded.updated_at
                    """,
                    (key, str(value), performed_by),
                )
            _audit(
                cur,
                action_type="settings.updated",
                entity_type="settings",
                entity_id="global",
                old_value=old,
                new_value=clean,
                performed_by=performed_by,
                reason=reason,
            )
    return get_settings()


def _build_metric_insights(metrics: dict) -> list[dict]:
    insights: list[dict] = []

    # Check for upcoming holidays in the next 45 days
    try:
        with postgres.connect() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    select name, festival_date
                    from public.indian_festival_calendar
                    where festival_date >= current_date and festival_date <= current_date + interval '45 days'
                    order by festival_date
                    limit 1
                """)
                holiday = _one(cur)
                if holiday and holiday.get("name"):
                    insights.append(
                        {
                            "type": "upcoming_holiday",
                            "text": f"Upcoming holiday: {holiday['name']} on {holiday['festival_date']}. Plan campaign and launch holiday menu coupons.",
                            "metrics": {"holiday_name": holiday["name"], "date": str(holiday["festival_date"])},
                        }
                    )
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("Failed to check upcoming holidays: %s", e)

    hourly = metrics.get("hourly_revenue") or []
    if hourly:
        peak = max(
            hourly, key=lambda row: (row.get("orders", 0), row.get("revenue", 0))
        )
        insights.append(
            {
                "type": "peak_hour",
                "text": f"Peak hour is {peak['hour']}:00 with {peak['orders']} orders and INR {peak['revenue']:.2f} revenue.",
                "metrics": peak,
            }
        )
    payments = metrics.get("revenue_by_payment_mode") or []
    if payments:
        top = max(payments, key=lambda row: row.get("orders", 0))
        insights.append(
            {
                "type": "payment_mode",
                "text": f"{top['payment_mode']} is the most used payment mode with {top['orders']} orders.",
                "metrics": top,
            }
        )
    items = metrics.get("top_items") or []
    if items:
        top_item = items[0]
        insights.append(
            {
                "type": "top_item",
                "text": f"{top_item['name']} is the top-selling pizza with {top_item['quantity']} units sold.",
                "metrics": top_item,
            }
        )
    totals = metrics.get("totals") or {}
    insights.append(
        {
            "type": "business_health",
            "text": f"Refund rate is {metrics['refund_rate']}% and cancellation rate is {metrics['cancellation_rate']}% across {totals.get('total_orders', 0)} orders.",
            "metrics": {
                "refund_rate": metrics["refund_rate"],
                "cancellation_rate": metrics["cancellation_rate"],
                "total_orders": totals.get("total_orders", 0),
            },
        }
    )
    return insights


def _deduct_order_inventory(
    cur,
    *,
    order_id: str,
    items: list[dict],
    performed_by: str,
) -> dict | None:
    cur.execute(
        "select count(*)::int from public.order_inventory_deductions where order_id = %s",
        (order_id,),
    )
    if cur.fetchone()[0] > 0:
        return None

    requirements: dict[str, float] = {}
    for item in items:
        quantity = float(item.get("quantity") or 0)
        names = [item.get("base"), item.get("pizza"), *(item.get("toppings") or [])]
        for name in [n for n in names if n]:
            cur.execute(
                """
                select mii.ingredient_id, mii.quantity_per_unit
                from public.menu_items mi
                join public.menu_item_ingredients mii on mii.menu_item_id = mi.id
                where lower(mi.name) = lower(%s)
                  and mi.is_deleted = false
                """,
                (name,),
            )
            for ingredient_id, quantity_per_unit in cur.fetchall():
                key = str(ingredient_id)
                requirements[key] = requirements.get(key, 0.0) + (
                    float(quantity_per_unit) * quantity
                )

    if not requirements:
        return {"deductions": [], "message": "No recipe mappings found for order."}

    ingredient_ids = list(requirements.keys())
    cur.execute(
        """
        select id, name, stock_quantity
        from public.ingredients
        where id = any(%s)
        """,
        (ingredient_ids,),
    )
    stocks = {
        str(row[0]): {"name": row[1], "stock": float(row[2])} for row in cur.fetchall()
    }
    shortages = []
    for ingredient_id, required in requirements.items():
        stock = stocks.get(ingredient_id, {}).get("stock", 0.0)
        if stock < required:
            shortages.append(
                {
                    "ingredient_name": stocks.get(ingredient_id, {}).get(
                        "name", "Unknown"
                    ),
                    "required": round(required, 3),
                    "available": round(stock, 3),
                }
            )
    if shortages:
        names = ", ".join(
            f"{s['ingredient_name']} ({s['available']} < {s['required']})"
            for s in shortages
        )
        raise ValueError(f"Insufficient stock for order preparation: {names}.")

    deductions = []
    for ingredient_id, required in requirements.items():
        old_qty = stocks[ingredient_id]["stock"]
        new_qty = old_qty - required
        cur.execute(
            """
            update public.ingredients
            set stock_quantity = %s, updated_at = now()
            where id = %s
            """,
            (new_qty, ingredient_id),
        )
        cur.execute(
            """
            insert into public.stock_transactions (
                ingredient_id, transaction_type, quantity, old_quantity,
                new_quantity, reason, performed_by
            )
            values (%s, 'StockOut', %s, %s, %s, %s, %s)
            returning id
            """,
            (
                ingredient_id,
                required,
                old_qty,
                new_qty,
                "Auto deduction for order preparation",
                performed_by,
            ),
        )
        stock_transaction_id = cur.fetchone()[0]
        cur.execute(
            """
            insert into public.order_inventory_deductions (
                order_id, ingredient_id, quantity, stock_transaction_id, deducted_by
            )
            values (%s, %s, %s, %s, %s)
            on conflict (order_id, ingredient_id) do nothing
            returning id
            """,
            (order_id, ingredient_id, required, stock_transaction_id, performed_by),
        )
        deduction_id = cur.fetchone()
        deductions.append(
            {
                "id": str(deduction_id[0]) if deduction_id else None,
                "ingredient_id": ingredient_id,
                "ingredient_name": stocks[ingredient_id]["name"],
                "quantity": round(required, 3),
                "old_quantity": round(old_qty, 3),
                "new_quantity": round(new_qty, 3),
            }
        )
    return {"deductions": deductions}


def _audit(
    cur,
    *,
    action_type: str,
    entity_type: str,
    entity_id: str,
    old_value: dict | None,
    new_value: dict | None,
    performed_by: str,
    reason: str | None = None,
) -> None:
    cur.execute(
        """
        insert into public.audit_logs (
            action_type, entity_type, entity_id, old_value, new_value,
            performed_by, reason
        )
        values (%s, %s, %s, %s::jsonb, %s::jsonb, %s, %s)
        """,
        (
            action_type,
            entity_type,
            entity_id,
            _json(old_value),
            _json(new_value),
            performed_by,
            reason,
        ),
    )


def _one(cur) -> dict:
    row = cur.fetchone()
    if not row:
        return {}
    cols = [desc.name for desc in cur.description]
    return _serialize(dict(zip(cols, row)))


def _many(cur) -> list[dict]:
    cols = [desc.name for desc in cur.description]
    return [_serialize(dict(zip(cols, row))) for row in cur.fetchall()]


def _serialize(value):
    if isinstance(value, dict):
        return {k: _serialize(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_serialize(v) for v in value]
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return value


def _json(value) -> str | None:
    if value is None:
        return None
    import json

    return json.dumps(_serialize(value))
