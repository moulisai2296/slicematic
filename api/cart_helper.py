from typing import List, Optional
from pydantic import BaseModel
from api.menu_helper import load_active_menu
from core import pricing
from core.models import BillItem, MenuItem

class CartLineReq(BaseModel):
    item_id: str
    item_type: str = "generic" # "pizza" or "generic"
    size_code: Optional[str] = None
    crust_id: Optional[str] = None
    topping_ids: List[str] = []
    quantity: int = 1

def _find_item(m, item_id: str) -> Optional[MenuItem]:
    for cat in m.categories.values():
        for item in cat.items:
            if item.id == item_id:
                return item
    return None

def resolve_cart_line(m, line: CartLineReq):
    """Resolve a new style cart line into a BillItem."""
    item = _find_item(m, line.item_id)
    if not item:
        return None, {"item": f"Item {line.item_id} not found."}
    
    crust = None
    if line.crust_id:
        crust = _find_item(m, line.crust_id)
        if not crust:
            return None, {"crust": "Invalid crust selected."}
            
    toppings = []
    for tid in line.topping_ids:
        t = _find_item(m, tid)
        if not t:
            return None, {"topping": f"Invalid topping: {tid}"}
        toppings.append(t)
        
    unit_price = pricing.compute_item_price(item, line.size_code, crust, toppings)
    subtotal = round(unit_price * line.quantity, 2)
    
    bill_item = BillItem(
        item=item,
        size_code=line.size_code,
        crust=crust,
        toppings=toppings,
        quantity=line.quantity,
        unit_price=unit_price,
        subtotal=subtotal
    )
    return bill_item, None

def cart_line_to_dict(b_item: BillItem):
    """Serialize BillItem for the response."""
    from core import pricing as _pricing
    subtotal = b_item.subtotal
    # Compute tax on just this line so the frontend can display line totals
    gst = round(_pricing.get_gst_rate() * subtotal, 2)
    total = round(subtotal + gst, 2)
    discount = 0.0  # line-level discount; overall discount is in the cart totals
    return {
        "item": {"id": b_item.item.id, "name": b_item.item.name, "price": b_item.item.price},
        "item_type": b_item.item.item_type,
        "size_code": b_item.size_code,
        "crust": {"id": b_item.crust.id, "name": b_item.crust.name, "price": b_item.crust.price} if b_item.crust else None,
        "toppings": [{"id": t.id, "name": t.name, "price": t.price} for t in b_item.toppings],
        "quantity": b_item.quantity,
        "unit_price": b_item.unit_price,
        "subtotal": subtotal,
        "discount": discount,
        "taxable": subtotal,
        "gst": gst,
        "total": total,
    }
