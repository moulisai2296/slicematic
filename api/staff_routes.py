"""Protected Staff API routes for kitchen/backstage workflows."""

from __future__ import annotations

import os
from typing import Callable

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel

from api import routes as public_routes
from core import validation as v
from core.menu import MenuError
from db import admin_gateway as admin_db

router = APIRouter(prefix="/staff", tags=["staff"])


class StaffOrderAdvance(BaseModel):
    reason: str | None = None


class StaffInventoryRequest(BaseModel):
    ingredient_id: str
    requested_quantity: float
    reason: str


class StaffCheckout(BaseModel):
    name: str
    phone: str
    payment_mode: str
    type: str = "dine_in"
    lines: list[public_routes.CartLineReq]
    coupon_code: str = ""


def _staff_email() -> str:
    return os.environ.get("STAFF_DEV_EMAIL", "kitchen@slicematic.local")


def _staff_token() -> str:
    return os.environ.get("STAFF_DEV_TOKEN", "").strip()


def require_staff(
    authorization: str | None = Header(default=None),
) -> dict:
    expected = _staff_token()
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="STAFF_DEV_TOKEN is not configured.",
        )
    if authorization != f"Bearer {expected}":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Staff authorization failed.",
        )
    try:
        user = admin_db.get_user_by_email(_staff_email())
    except admin_db.AdminDatabaseNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc
    if not user or user.get("status") != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Staff user is not active or has not been seeded.",
        )
    if "staff.kitchen.access" not in set(user.get("permissions", [])):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Staff kitchen access permission is missing.",
        )
    return user


def require_staff_permission(permission: str) -> Callable:
    def _guard(user: dict = Depends(require_staff)) -> dict:
        if permission not in set(user.get("permissions", [])):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing permission: {permission}",
            )
        return user

    return _guard


@router.get("/me")
def me(user: dict = Depends(require_staff)) -> dict:
    return {"ok": True, "user": user}


@router.get("/orders")
def kitchen_orders(
    user: dict = Depends(require_staff_permission("orders.read")),
) -> dict:
    return {"ok": True, "orders": admin_db.list_staff_orders()}


@router.post("/orders/{order_id}/advance")
def advance_order(
    order_id: str,
    req: StaffOrderAdvance,
    user: dict = Depends(require_staff_permission("orders.update_status")),
) -> dict:
    try:
        order = admin_db.advance_staff_order(
            order_id,
            performed_by=user["id"],
            reason=req.reason,
        )
        try:
            from ai.realtime import broadcast_event
            broadcast_event("order_status_updated", order)
        except Exception as ws_exc:
            import logging
            logging.getLogger(__name__).warning("Failed to broadcast order_status_updated: %s", ws_exc)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "order": order}


@router.post("/checkout")
def checkout(
    req: StaffCheckout,
    user: dict = Depends(require_staff_permission("orders.update_status")),
) -> dict:
    try:
        menu = public_routes._load_active_menu()
    except MenuError as exc:
        return {"ok": False, "errors": {"menu": str(exc)}}

    ok_n, name = v.validate_name(req.name)
    ok_p, phone = v.validate_phone(req.phone)
    ok_pay, mode = v.validate_payment(req.payment_mode)
    errors: dict[str, str] = {}
    if not ok_n:
        errors["name"] = name
    if not ok_p:
        errors["phone"] = phone
    if not ok_pay:
        errors["payment_mode"] = mode
    if not req.lines:
        errors["lines"] = "Order is empty."

    items, totals = [], {"subtotal": 0.0, "discount": 0.0, "gst": 0.0, "total": 0.0}
    for idx, line in enumerate(req.lines):
        bill, toppings, err = public_routes._resolve_cart_line(menu, line)
        if err:
            return {"ok": False, "line_index": idx, "errors": err}
        items.append(
            {
                "pizza": bill.pizza.name,
                "base": bill.base.name,
                "toppings": [t.name for t in toppings],
                "quantity": bill.quantity,
                "unit_price": bill.unit_price,
                "line_total": bill.total,
            }
        )
        for key in totals:
            totals[key] = round(totals[key] + getattr(bill, key), 2)

    if req.type not in {"dine_in", "takeaway"}:
        errors["type"] = "Type must be either 'dine_in' or 'takeaway'."

    if errors:
        return {"ok": False, "errors": errors}

    if req.coupon_code:
        coupon_err = None
        code = req.coupon_code.strip().upper()
        from db import postgres as local_postgres
        if local_postgres.is_enabled():
            try:
                with local_postgres.connect() as conn:
                    with conn.cursor() as cur:
                        cur.execute("""
                            select discount_percent, threshold_amount, start_date, end_date, is_active
                            from public.discount_rules where upper(coupon_code) = %s limit 1
                        """, (code,))
                        row = cur.fetchone()
                if not row:
                    coupon_err = f"Coupon '{code}' not found."
                else:
                    d_pct, t_amt, s_date, e_date, is_act = row
                    from datetime import date as _d2
                    today = _d2.today()
                    if not is_act:
                        coupon_err = "This coupon is no longer active."
                    elif s_date and today < s_date:
                        coupon_err = f"Coupon valid from {s_date}."
                    elif e_date and today > e_date:
                        coupon_err = "This coupon has expired."
                    elif t_amt and t_amt > 0 and totals["total"] < t_amt:
                        coupon_err = f"Minimum order \u20b9{float(t_amt):.0f} required."
                    else:
                        gst_rate = 0.18
                        subtotal = totals["subtotal"]
                        discount_amount = round(subtotal * float(d_pct) / 100.0, 2)
                        new_subtotal = round(subtotal - discount_amount, 2)
                        new_gst = round(new_subtotal * gst_rate, 2)
                        new_total = round(new_subtotal + new_gst, 2)
                        totals["discount"] = discount_amount
                        totals["gst"] = new_gst
                        totals["total"] = new_total
            except Exception as exc:
                coupon_err = f"Coupon check failed: {exc}"
        if coupon_err:
            return {"ok": False, "errors": {"coupon_code": coupon_err}}

    try:
        order = admin_db.create_staff_order(
            customer_name=name,
            customer_phone=phone,
            items=items,
            subtotal=totals["subtotal"],
            discount=totals["discount"],
            gst=totals["gst"],
            total=totals["total"],
            payment_mode=mode,
            performed_by=user["id"],
            type=req.type,
        )
        try:
            from ai.realtime import broadcast_event
            broadcast_event("order_created", order)
        except Exception as ws_exc:
            import logging
            logging.getLogger(__name__).warning("Failed to broadcast order_created: %s", ws_exc)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "order": order}


@router.get("/inventory")
def inventory(
    user: dict = Depends(require_staff_permission("inventory.request")),
) -> dict:
    inventory_data = admin_db.list_inventory()
    return {
        "ok": True,
        "inventory": {
            "ingredients": [
                ingredient
                for ingredient in inventory_data["ingredients"]
                if ingredient.get("is_active")
            ],
            "requests": inventory_data["requests"],
        },
    }


@router.post("/inventory/requests")
def create_inventory_request(
    req: StaffInventoryRequest,
    user: dict = Depends(require_staff_permission("inventory.request")),
) -> dict:
    try:
        inventory_request = admin_db.create_inventory_request(
            ingredient_id=req.ingredient_id,
            requested_quantity=req.requested_quantity,
            reason=req.reason,
            performed_by=user["id"],
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "request": inventory_request}
