"""Protected Admin API routes."""

from __future__ import annotations

import os
from typing import Callable

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel

from core import pricing
from db import admin_gateway as admin_db

router = APIRouter(prefix="/admin", tags=["admin"])


class MenuItemUpdate(BaseModel):
    name: str
    price: float
    is_available: bool = True
    image_url: str | None = None
    reason: str | None = None


class MenuItemCreate(BaseModel):
    category: str
    item_code: str
    name: str
    price: float
    is_available: bool = True
    reason: str | None = None


class MenuCategoryCreate(BaseModel):
    code: str
    name: str
    sort_order: int | None = None
    reason: str | None = None


class PricingUpdate(BaseModel):
    gst_rate_percent: float
    discount_rate_percent: float
    discount_quantity_threshold: int
    reason: str | None = None


class DiscountRuleUpdate(BaseModel):
    id: str | None = None
    name: str
    coupon_code: str | None = None
    description: str | None = None
    discount_percent: float
    threshold_amount: float = 0
    min_quantity: int | None = None
    no_min_quantity: bool = True
    no_min_value: bool = False
    start_date: str | None = None
    end_date: str | None = None
    is_active: bool = True
    reason: str | None = None


class StaffCreate(BaseModel):
    full_name: str
    email: str
    phone: str | None = None
    role_name: str
    employee_code: str | None = None
    pin: str | None = None
    reason: str | None = None


class StaffUpdate(BaseModel):
    full_name: str
    phone: str | None = None
    role_name: str
    is_active: bool = True
    pin: str | None = None
    reason: str | None = None


class OrderStatusUpdate(BaseModel):
    status: str
    reason: str | None = None


class RefundRequest(BaseModel):
    order_id: str
    amount: float
    reason: str


class RefundDecision(BaseModel):
    status: str
    reason: str | None = None


class StockAdjustment(BaseModel):
    transaction_type: str
    quantity: float
    reason: str | None = None


class IngredientCreate(BaseModel):
    name: str
    unit: str
    stock_quantity: float = 0
    reorder_threshold: float = 0
    reason: str | None = None


class IngredientUpdate(BaseModel):
    name: str
    unit: str
    reorder_threshold: float
    is_active: bool = True
    reason: str | None = None


class InventoryRequestCreate(BaseModel):
    ingredient_id: str
    requested_quantity: float
    reason: str


class InventoryRequestDecision(BaseModel):
    status: str
    reason: str | None = None


class RecipeMappingUpsert(BaseModel):
    menu_item_id: str
    ingredient_id: str
    quantity_per_unit: float
    reason: str | None = None


class ForecastRequest(BaseModel):
    days: int = 7


class RevenueScenarioRequest(BaseModel):
    menu_price_adjustment_percent: float = 0
    ingredient_price_increase_percent: float = 0
    rent_increase_amount: float = 0
    other_fixed_cost_increase_amount: float = 0
    discount_change_percent: float = 0


class RecommendationEventRequest(BaseModel):
    recommendation_type: str
    recommendation_key: str
    title: str
    detail: str | None = None
    status: str
    estimated_value: float = 0
    source_metrics: dict = {}
    related_entity_type: str | None = None
    related_entity_id: str | None = None


class CustomerFeedbackRequest(BaseModel):
    order_id: str | None = None
    customer_name: str | None = None
    customer_phone: str | None = None
    channel: str = "manual"
    rating: int
    feedback_text: str
    source_metadata: dict = {}


class NotificationRequest(BaseModel):
    channel: str
    recipient: str
    template_name: str
    payload: dict = {}
    related_entity_type: str | None = None
    related_entity_id: str | None = None


class SettingsUpdate(BaseModel):
    values: dict
    reason: str | None = None


def _admin_email() -> str:
    return os.environ.get("ADMIN_DEV_EMAIL", "admin@slicematic.local")


def _admin_token() -> str:
    return os.environ.get("ADMIN_DEV_TOKEN", "").strip()


def require_admin(
    authorization: str | None = Header(default=None),
) -> dict:
    expected = _admin_token()
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ADMIN_DEV_TOKEN is not configured.",
        )
    if authorization != f"Bearer {expected}":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Admin authorization failed.",
        )
    try:
        user = admin_db.get_user_by_email(_admin_email())
    except admin_db.AdminDatabaseNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc
    if not user or user.get("status") != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin user is not active or has not been seeded.",
        )
    if "admin.access" not in set(user.get("permissions", [])):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access permission is missing.",
        )
    return user


def require_permission(permission: str) -> Callable:
    def _guard(user: dict = Depends(require_admin)) -> dict:
        if permission not in set(user.get("permissions", [])):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing permission: {permission}",
            )
        return user

    return _guard


@router.get("/me")
def me(user: dict = Depends(require_admin)) -> dict:
    return {"ok": True, "user": user}


@router.get("/dashboard")
def dashboard(
    user: dict = Depends(require_permission("admin.dashboard.read")),
) -> dict:
    return {"ok": True, "user": user, "dashboard": admin_db.get_dashboard_metrics()}


@router.get("/orders")
def orders(
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
    user: dict = Depends(require_permission("orders.read")),
) -> dict:
    return {
        "ok": True,
        "orders": admin_db.list_orders(
            status_filter=status_filter,
            payment_mode=payment_mode,
            payment_status=payment_status,
            date_from=date_from,
            date_to=date_to,
            customer_search=customer_search,
            source=source,
            total_min=total_min,
            total_max=total_max,
            limit=limit,
        ),
    }


@router.get("/orders/{order_id}")
def order_detail(
    order_id: str,
    user: dict = Depends(require_permission("orders.read")),
) -> dict:
    try:
        detail = admin_db.get_order_detail(order_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"ok": True, **detail}


@router.put("/orders/{order_id}/status")
def update_order_status(
    order_id: str,
    req: OrderStatusUpdate,
    user: dict = Depends(require_permission("orders.update_status")),
) -> dict:
    try:
        order = admin_db.update_order_status(
            order_id,
            new_status=req.status,
            performed_by=user["id"],
            reason=req.reason,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "order": order}


@router.get("/menu")
def menu(user: dict = Depends(require_permission("menu.manage"))) -> dict:
    return {"ok": True, "menu": admin_db.list_menu_items()}


@router.post("/menu/categories")
def create_menu_category(
    req: MenuCategoryCreate,
    user: dict = Depends(require_permission("menu.manage")),
) -> dict:
    try:
        category = admin_db.create_menu_category(
            code=req.code,
            name=req.name,
            sort_order=req.sort_order,
            performed_by=user["id"],
            reason=req.reason,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "category": category}


@router.delete("/menu/categories/{category_id}")
def delete_menu_category(
    category_id: str,
    user: dict = Depends(require_permission("menu.manage")),
) -> dict:
    try:
        category = admin_db.delete_menu_category(
            category_id,
            performed_by=user["id"],
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "category": category}


@router.post("/menu")
def create_menu_item(
    req: MenuItemCreate,
    user: dict = Depends(require_permission("menu.manage")),
) -> dict:
    try:
        item = admin_db.create_menu_item(
            category=req.category,
            item_code=req.item_code,
            name=req.name,
            price=req.price,
            is_available=req.is_available,
            performed_by=user["id"],
            reason=req.reason,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "item": item}


@router.put("/menu/{item_id}")
def update_menu_item(
    item_id: str,
    req: MenuItemUpdate,
    user: dict = Depends(require_permission("menu.manage")),
) -> dict:
    try:
        item = admin_db.update_menu_item(
            item_id,
            name=req.name,
            price=req.price,
            is_available=req.is_available,
            image_url=req.image_url,
            performed_by=user["id"],
            reason=req.reason,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "item": item}


@router.delete("/menu/{item_id}")
def delete_menu_item(
    item_id: str,
    user: dict = Depends(require_permission("menu.manage")),
) -> dict:
    try:
        item = admin_db.soft_delete_menu_item(
            item_id,
            performed_by=user["id"],
            reason="Admin soft delete",
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"ok": True, "item": item}


@router.get("/pricing")
def pricing_settings(
    user: dict = Depends(require_permission("pricing.manage")),
) -> dict:
    return {"ok": True, "pricing": admin_db.get_pricing_settings()}


@router.get("/pricing/price-history")
def price_history(
    limit: int = 100,
    user: dict = Depends(require_permission("pricing.manage")),
) -> dict:
    return {"ok": True, "price_history": admin_db.list_price_history(limit=limit)}


@router.get("/pricing/festival-coupon-suggestions")
def festival_coupon_suggestions(
    limit: int = 6,
    year: int | None = None,
    user: dict = Depends(require_permission("pricing.manage")),
) -> dict:
    return {
        "ok": True,
        "suggestions": admin_db.list_festival_coupon_suggestions(
            limit=limit, year=year
        ),
    }


@router.put("/discounts")
def upsert_discount_rule(
    req: DiscountRuleUpdate,
    user: dict = Depends(require_permission("discounts.manage")),
) -> dict:
    try:
        rule = admin_db.upsert_discount_rule(
            rule_id=req.id,
            name=req.name,
            coupon_code=req.coupon_code,
            description=req.description,
            discount_percent=req.discount_percent,
            threshold_amount=req.threshold_amount,
            min_quantity=req.min_quantity,
            no_min_quantity=req.no_min_quantity,
            no_min_value=req.no_min_value,
            start_date=req.start_date,
            end_date=req.end_date,
            is_active=req.is_active,
            performed_by=user["id"],
            reason=req.reason,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "discount": rule}


@router.put("/pricing")
def update_pricing_settings(
    req: PricingUpdate,
    user: dict = Depends(require_permission("pricing.manage")),
) -> dict:
    try:
        updated = admin_db.update_pricing_settings(
            gst_rate_percent=req.gst_rate_percent,
            discount_rate_percent=req.discount_rate_percent,
            discount_quantity_threshold=req.discount_quantity_threshold,
            performed_by=user["id"],
            reason=req.reason,
        )
        pricing.set_gst_rate(updated["gst_rate_percent"] / 100)
        pricing.set_discount_rate(0)
        pricing.set_discount_threshold(999999)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "pricing": updated}


@router.get("/staff")
def staff(user: dict = Depends(require_permission("staff.manage"))) -> dict:
    return {"ok": True, "staff": admin_db.list_staff(), "roles": admin_db.list_roles()}


@router.post("/staff")
def create_staff(
    req: StaffCreate,
    user: dict = Depends(require_permission("staff.manage")),
) -> dict:
    try:
        staff = admin_db.create_staff(
            full_name=req.full_name,
            email=req.email,
            phone=req.phone,
            role_name=req.role_name,
            employee_code=req.employee_code,
            pin=req.pin,
            performed_by=user["id"],
            reason=req.reason,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "staff": staff}


@router.put("/staff/{staff_id}")
def update_staff(
    staff_id: str,
    req: StaffUpdate,
    user: dict = Depends(require_permission("staff.manage")),
) -> dict:
    try:
        staff = admin_db.update_staff(
            staff_id,
            full_name=req.full_name,
            phone=req.phone,
            role_name=req.role_name,
            is_active=req.is_active,
            pin=req.pin,
            performed_by=user["id"],
            reason=req.reason,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "staff": staff}


@router.get("/payments")
def payments(user: dict = Depends(require_permission("refunds.manage"))) -> dict:
    return {"ok": True, **admin_db.list_payments_and_refunds()}


@router.post("/refunds")
def request_refund(
    req: RefundRequest,
    user: dict = Depends(require_permission("refunds.manage")),
) -> dict:
    try:
        refund = admin_db.request_refund(
            req.order_id,
            amount=req.amount,
            reason=req.reason,
            performed_by=user["id"],
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "refund": refund}


@router.put("/refunds/{refund_id}/decision")
def decide_refund(
    refund_id: str,
    req: RefundDecision,
    user: dict = Depends(require_permission("refunds.manage")),
) -> dict:
    try:
        refund = admin_db.decide_refund(
            refund_id,
            status=req.status,
            performed_by=user["id"],
            reason=req.reason,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "refund": refund}


@router.get("/inventory")
def inventory(user: dict = Depends(require_permission("inventory.manage"))) -> dict:
    return {"ok": True, "inventory": admin_db.list_inventory()}


@router.post("/inventory/ingredients")
def create_ingredient(
    req: IngredientCreate,
    user: dict = Depends(require_permission("inventory.manage")),
) -> dict:
    try:
        ingredient = admin_db.create_ingredient(
            name=req.name,
            unit=req.unit,
            stock_quantity=req.stock_quantity,
            reorder_threshold=req.reorder_threshold,
            performed_by=user["id"],
            reason=req.reason,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "ingredient": ingredient}


@router.put("/inventory/ingredients/{ingredient_id}")
def update_ingredient(
    ingredient_id: str,
    req: IngredientUpdate,
    user: dict = Depends(require_permission("inventory.manage")),
) -> dict:
    try:
        ingredient = admin_db.update_ingredient(
            ingredient_id,
            name=req.name,
            unit=req.unit,
            reorder_threshold=req.reorder_threshold,
            is_active=req.is_active,
            performed_by=user["id"],
            reason=req.reason,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "ingredient": ingredient}


@router.post("/inventory/requests")
def create_inventory_request(
    req: InventoryRequestCreate,
    user: dict = Depends(require_permission("inventory.manage")),
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


@router.put("/inventory/recipes")
def upsert_recipe_mapping(
    req: RecipeMappingUpsert,
    user: dict = Depends(require_permission("inventory.manage")),
) -> dict:
    try:
        recipe = admin_db.upsert_menu_item_ingredient(
            menu_item_id=req.menu_item_id,
            ingredient_id=req.ingredient_id,
            quantity_per_unit=req.quantity_per_unit,
            performed_by=user["id"],
            reason=req.reason,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "recipe": recipe}


@router.delete("/inventory/recipes/{recipe_id}")
def delete_recipe_mapping(
    recipe_id: str,
    user: dict = Depends(require_permission("inventory.manage")),
) -> dict:
    try:
        recipe = admin_db.delete_menu_item_ingredient(
            recipe_id,
            performed_by=user["id"],
            reason="Admin recipe mapping delete",
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"ok": True, "recipe": recipe}


@router.put("/inventory/requests/{request_id}/decision")
def decide_inventory_request(
    request_id: str,
    req: InventoryRequestDecision,
    user: dict = Depends(require_permission("inventory.manage")),
) -> dict:
    try:
        inventory_request = admin_db.decide_inventory_request(
            request_id,
            status=req.status,
            performed_by=user["id"],
            reason=req.reason,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "request": inventory_request}


@router.post("/inventory/{ingredient_id}/adjust")
def adjust_inventory(
    ingredient_id: str,
    req: StockAdjustment,
    user: dict = Depends(require_permission("inventory.manage")),
) -> dict:
    try:
        ingredient = admin_db.adjust_stock(
            ingredient_id,
            transaction_type=req.transaction_type,
            quantity=req.quantity,
            performed_by=user["id"],
            reason=req.reason,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "ingredient": ingredient}


@router.get("/audit-logs")
def audit_logs(user: dict = Depends(require_permission("audit.read"))) -> dict:
    return {"ok": True, "audit_logs": admin_db.list_audit_logs()}


@router.get("/analytics")
def analytics(
    date_from: str | None = None,
    date_to: str | None = None,
    user: dict = Depends(require_permission("analytics.read")),
) -> dict:
    return {
        "ok": True,
        "analytics": admin_db.get_analytics_report(
            date_from=date_from,
            date_to=date_to,
        ),
    }


@router.get("/ai/insights")
def ai_insights(
    user: dict = Depends(require_permission("ai.insights.read")),
) -> dict:
    return {"ok": True, **admin_db.generate_ai_insights(performed_by=user["id"])}


@router.get("/ai/provider-status")
def ai_provider_status(
    user: dict = Depends(require_permission("ai.insights.read")),
) -> dict:
    from ai.admin_provider import admin_ai_provider_status

    return {"ok": True, "provider_status": admin_ai_provider_status()}


@router.get("/ai/insight-logs")
def ai_insight_logs(
    provider: str | None = None,
    insight_type: str | None = None,
    limit: int = 50,
    user: dict = Depends(require_permission("ai.insights.read")),
) -> dict:
    return {
        "ok": True,
        "logs": admin_db.list_ai_insight_logs(
            provider=provider,
            insight_type=insight_type,
            limit=limit,
        ),
    }


@router.post("/ai/forecast")
def ai_forecast(
    req: ForecastRequest,
    user: dict = Depends(require_permission("ai.insights.read")),
) -> dict:
    return {
        "ok": True,
        "forecast": admin_db.generate_forecast(performed_by=user["id"], days=req.days),
    }


@router.get("/ai/business-intelligence")
def ai_business_intelligence(
    days: int = 7,
    user: dict = Depends(require_permission("ai.insights.read")),
) -> dict:
    return {"ok": True, "ai": admin_db.get_ai_business_intelligence(days=days)}


@router.post("/ai/revenue-scenario")
def ai_revenue_scenario(
    req: RevenueScenarioRequest,
    user: dict = Depends(require_permission("ai.insights.read")),
) -> dict:
    return {
        "ok": True,
        "scenario": admin_db.simulate_revenue_scenario(
            menu_price_adjustment_percent=req.menu_price_adjustment_percent,
            ingredient_price_increase_percent=req.ingredient_price_increase_percent,
            rent_increase_amount=req.rent_increase_amount,
            other_fixed_cost_increase_amount=req.other_fixed_cost_increase_amount,
            discount_change_percent=req.discount_change_percent,
        ),
    }


@router.get("/ai/recommendation-impact")
def ai_recommendation_impact(
    user: dict = Depends(require_permission("ai.insights.read")),
) -> dict:
    return {"ok": True, "impact": admin_db.get_recommendation_impact()}


@router.get("/ai/customer-feedback")
def ai_customer_feedback(
    limit: int = 50,
    user: dict = Depends(require_permission("ai.insights.read")),
) -> dict:
    return {"ok": True, **admin_db.list_customer_feedback(limit=limit)}


@router.post("/ai/customer-feedback")
def ai_create_customer_feedback(
    req: CustomerFeedbackRequest,
    user: dict = Depends(require_permission("ai.insights.read")),
) -> dict:
    try:
        feedback = admin_db.record_customer_feedback(
            order_id=req.order_id,
            customer_name=req.customer_name,
            customer_phone=req.customer_phone,
            channel=req.channel,
            rating=req.rating,
            feedback_text=req.feedback_text,
            source_metadata=req.source_metadata,
            performed_by=user["id"],
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "feedback": feedback}


@router.post("/ai/recommendation-events")
def ai_recommendation_event(
    req: RecommendationEventRequest,
    user: dict = Depends(require_permission("ai.insights.read")),
) -> dict:
    try:
        event = admin_db.record_recommendation_event(
            recommendation_type=req.recommendation_type,
            recommendation_key=req.recommendation_key,
            title=req.title,
            detail=req.detail,
            status=req.status,
            estimated_value=req.estimated_value,
            source_metrics=req.source_metrics,
            related_entity_type=req.related_entity_type,
            related_entity_id=req.related_entity_id,
            performed_by=user["id"],
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "event": event}


@router.get("/notifications")
def notifications(user: dict = Depends(require_permission("audit.read"))) -> dict:
    return {"ok": True, "notifications": admin_db.list_notifications()}


@router.post("/notifications/mock")
def create_notification(
    req: NotificationRequest,
    user: dict = Depends(require_permission("audit.read")),
) -> dict:
    try:
        notification = admin_db.create_mock_notification(
            channel=req.channel,
            recipient=req.recipient,
            template_name=req.template_name,
            payload=req.payload,
            performed_by=user["id"],
            related_entity_type=req.related_entity_type,
            related_entity_id=req.related_entity_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "notification": notification}


@router.get("/settings")
def settings(user: dict = Depends(require_permission("admin.access"))) -> dict:
    return {"ok": True, **admin_db.get_settings()}


@router.put("/settings")
def update_settings(
    req: SettingsUpdate,
    user: dict = Depends(require_permission("admin.access")),
) -> dict:
    try:
        updated = admin_db.update_settings(
            values=req.values,
            performed_by=user["id"],
            reason=req.reason,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, **updated}


class AdminRefundAction(BaseModel):
    admin_response: str

@router.get("/refunds")
def list_refunds(status: str | None = None, user: dict = Depends(require_permission("orders.read"))):
    try:
        from db import refunds
        return {"ok": True, "refunds": refunds.list_refunds(status)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

@router.post("/refunds/{refund_id}/approve")
def approve_refund(refund_id: str, req: AdminRefundAction, user: dict = Depends(require_permission("orders.write"))):
    try:
        from db import refunds
        from db import postgres
        res = refunds.update_refund_status(refund_id, "APPROVED", req.admin_response, user["id"])
        
        # Mark order as refunded
        order_id = res["order_id"]
        if postgres.is_enabled():
            with postgres.connect() as conn:
                with conn.cursor() as cur:
                    cur.execute("UPDATE public.orders SET status = 'refunded' WHERE id = %s", (order_id,))
        else:
            from db.client import execute_query, get_client
            client = get_client()
            execute_query(client.table("orders").update({"status": "refunded"}).eq("id", order_id))
            
        return {"ok": True, "refund": res}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

@router.post("/refunds/{refund_id}/reject")
def reject_refund(refund_id: str, req: AdminRefundAction, user: dict = Depends(require_permission("orders.write"))):
    try:
        from db import refunds
        res = refunds.update_refund_status(refund_id, "REJECTED", req.admin_response, user["id"])
        return {"ok": True, "refund": res}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
