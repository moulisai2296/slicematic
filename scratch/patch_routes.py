import os
import re

def patch_routes():
    file_path = "f:\\FDE Project\\Hackathon 3\\slicematic\\api\\routes.py"
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Replace _load_active_menu logic
    pattern_menu = re.compile(r'def _load_active_menu\(\).*?return _cached_menu', re.DOTALL)
    new_menu = """def _load_active_menu():
    from api.menu_helper import load_active_menu
    return load_active_menu()"""
    content = pattern_menu.sub(new_menu, content)

    # 2. Replace _bill_dict, _resolve, _combined_topping, _resolve_cart_line, _cart_line_numbers, _cart_line_dict
    pattern_helpers = re.compile(r'def _bill_dict\(bill\):.*?def _cart_line_dict\(bill, toppings: list\[MenuItem\], nums: dict\) -> dict:.*?\n\n', re.DOTALL)
    content = pattern_helpers.sub("", content)

    # 3. Replace CartLineReq
    pattern_cart_req = re.compile(r'class CartLineReq\(BaseModel\):.*?quantity: str \| int = ""', re.DOTALL)
    new_cart_req = """class CartLineReq(BaseModel):
    item_id: str = ""
    item_type: str = "generic"
    size_code: str | None = None
    crust_id: str | None = None
    topping_ids: list[str] = []
    quantity: str | int = 1"""
    content = pattern_cart_req.sub(new_cart_req, content)

    # 4. Replace price_cart
    pattern_price_cart = re.compile(r'@router\.post\("/cart/price"\)\ndef price_cart\(req: CartReq\):.*?return \{"ok": True, "lines": out_lines, "cart": totals\}', re.DOTALL)
    new_price_cart = """@router.post("/cart/price")
def price_cart(req: CartReq):
    try:
        m = _load_active_menu()
    except Exception as exc:
        return {"ok": False, "errors": {"menu": str(exc)}}
    if not req.lines:
        return {"ok": False, "errors": {"lines": "Your order is empty."}}

    from api.cart_helper import resolve_cart_line, cart_line_to_dict
    from core import pricing

    resolved_items = []
    out_lines = []
    
    for idx, line in enumerate(req.lines):
        # Convert string quantity if needed
        if isinstance(line.quantity, str) and line.quantity.isdigit():
            line.quantity = int(line.quantity)
        
        bill_item, err = resolve_cart_line(m, line)
        if err:
            return {"ok": False, "line_index": idx, "errors": err}
        resolved_items.append(bill_item)
        out_lines.append(cart_line_to_dict(bill_item))

    bill = pricing.compute_bill(resolved_items)
    
    totals = {
        "subtotal": bill.subtotal,
        "discount": bill.discount,
        "taxable": bill.taxable,
        "gst": bill.gst,
        "total": bill.total,
    }

    return {"ok": True, "lines": out_lines, "cart": totals}"""
    content = pattern_price_cart.sub(new_price_cart, content)
    
    # 5. Replace checkout_cart items logic
    pattern_checkout = re.compile(r'    items, totals = \[\], \{"subtotal": 0\.0, "discount": 0\.0, "gst": 0\.0, "total": 0\.0\}.*?totals\[k\] = round\(totals\[k\] \+ getattr\(bill, k\), 2\)', re.DOTALL)
    new_checkout = """    from api.cart_helper import resolve_cart_line
    from core import pricing
    
    resolved_items = []
    for idx, line in enumerate(req.lines):
        if isinstance(line.quantity, str) and line.quantity.isdigit():
            line.quantity = int(line.quantity)
        bill_item, err = resolve_cart_line(m, line)
        if err:
            return {"ok": False, "line_index": idx, "errors": err}
        resolved_items.append(bill_item)

    bill = pricing.compute_bill(resolved_items)
    
    items = []
    for b_item in resolved_items:
        items.append({
            "item_name": b_item.item.name,
            "item_type": b_item.item.item_type,
            "size_code": b_item.size_code,
            "crust": b_item.crust.name if b_item.crust else None,
            "toppings": [t.name for t in b_item.toppings],
            "quantity": b_item.quantity,
            "unit_price": b_item.unit_price,
            "line_total": b_item.subtotal,
        })
        
    totals = {
        "subtotal": bill.subtotal,
        "discount": bill.discount,
        "gst": bill.gst,
        "total": bill.total,
    }"""
    content = pattern_checkout.sub(new_checkout, content)
    
    # 6. Replace get_menu
    pattern_get_menu = re.compile(r'@router\.get\("/menu"\)\ndef get_menu\(\):.*?return \{(.*?)\}', re.DOTALL)
    new_get_menu = """@router.get("/menu")
def get_menu():
    try:
        m = _load_active_menu()
    except Exception as exc:
        return {"error": str(exc)}
    
    def serialize_item(item):
        return {
            "id": item.id,
            "category_code": item.category_code,
            "name": item.name,
            "price": item.price,
            "item_type": item.item_type,
            "description": item.description,
            "image_url": item.image_url,
            "sizes": [{"size_code": s.size_code, "price": s.price} for s in item.sizes]
        }
        
    out_cats = {}
    for code, cat in m.categories.items():
        out_cats[code] = [serialize_item(item) for item in cat.items]
        
    return {
        "categories": out_cats,
        "sizes": [{"id": s.id, "code": s.code, "name": s.name} for s in m.all_sizes]
    }"""
    content = pattern_get_menu.sub(new_get_menu, content)
    
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)
        
    print("Patched api/routes.py")

if __name__ == '__main__':
    patch_routes()
