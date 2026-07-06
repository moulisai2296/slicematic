"""The pricing engine. The ONLY place money is computed.

Order of operations:
    unit_price = item_price + size_price + crust_price + sum(topping_prices)
    subtotal   = sum(unit_price * quantity for each item)
    discount   = configured discount % of subtotal if quantity meets threshold
    taxable    = subtotal - discount
    gst        = 18% of taxable          (on the post-discount amount)
    total      = taxable + gst
All money values rounded to 2 decimals.
"""

from __future__ import annotations
import math
from typing import List

from core.models import Bill, BillItem, MenuItem

_discount_threshold = 999999  # legacy auto-discount disabled; use coupons.
_discount_rate = 0.0
_gst_rate = 0.18  # 18%
GST_RATE = 0.18  # Backward-compatible constant for old imports.

def get_discount_rate() -> float:
    return _discount_rate

def set_discount_rate(rate: float):
    global _discount_rate
    rate = float(rate)
    if rate < 0 or rate > 1:
        raise ValueError("Discount rate must be between 0 and 1.")
    _discount_rate = rate

def get_discount_threshold() -> int:
    return _discount_threshold

def set_discount_threshold(threshold: int):
    global _discount_threshold
    threshold = int(threshold)
    if threshold < 1:
        raise ValueError("Discount threshold must be at least 1.")
    _discount_threshold = threshold

def get_gst_rate() -> float:
    return _gst_rate

def set_gst_rate(rate: float):
    global _gst_rate, GST_RATE
    rate = float(rate)
    if rate < 0 or rate > 0.5:
        raise ValueError("GST rate must be between 0 and 0.5.")
    _gst_rate = rate
    GST_RATE = rate

def _money(value: float) -> float:
    return round(value, 2)

def round_final_amount(amount: float) -> int:
    """Round .50 or more up, .49 or less down as per business rules."""
    return math.floor(amount + 0.5)

def compute_item_price(
    item: MenuItem,
    size_code: str | None,
    crust: MenuItem | None,
    toppings: List[MenuItem]
) -> float:
    """Compute the unit price of a single customized item."""
    price = 0.0
    
    # 1. Base Item Price (if no size, use base price, else size price)
    if size_code:
        size_price = next((s.price for s in item.sizes if s.size_code == size_code), 0.0)
        price += size_price
    else:
        price += item.price

    # 2. Crust Price
    if crust:
        crust_price = next((s.price for s in crust.sizes if s.size_code == size_code), crust.price) if size_code else crust.price
        price += crust_price

    # 3. Toppings Price
    for topping in toppings:
        top_price = next((s.price for s in topping.sizes if s.size_code == size_code), topping.price) if size_code else topping.price
        price += top_price

    return _money(price)

def compute_bill(items: List[BillItem]) -> Bill:
    """Compute the total bill for a list of items."""
    subtotal = 0.0
    
    for b_item in items:
        # We assume b_item.unit_price and b_item.subtotal are already computed properly by the caller,
        # OR we compute them here. Since BillItem is immutable, the caller should compute unit_price
        # using compute_item_price() and pass it in. We just sum it up.
        subtotal += b_item.subtotal

    subtotal = _money(subtotal)
    
    # Legacy bulk discount logic
    total_qty = sum(i.quantity for i in items)
    discount = (
        _money(get_discount_rate() * subtotal)
        if total_qty >= get_discount_threshold()
        else 0.0
    )
    
    taxable = _money(subtotal - discount)
    gst = _money(get_gst_rate() * taxable)
    total = _money(taxable + gst)
    
    return Bill(
        items=items,
        subtotal=subtotal,
        discount=discount,
        taxable=taxable,
        gst=gst,
        total=total,
    )
