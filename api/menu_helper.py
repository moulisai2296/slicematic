from db import postgres as local_postgres
from core.models import Menu, MenuCategory, MenuItem, MenuSize, MenuItemSize

_cached_menu = None
_cached_version = None

def get_current_menu_version():
    current_version = 1
    if local_postgres.is_enabled():
        from db import postgres
        try:
            with postgres.connect() as conn:
                with conn.cursor() as cur:
                    cur.execute("select value from public.app_settings where key = 'menu_version'")
                    row = cur.fetchone()
                    if row:
                        current_version = int(row[0].get("value", 1))
        except Exception:
            pass
    return current_version

def load_active_menu() -> Menu:
    global _cached_menu, _cached_version
    current_version = get_current_menu_version()
    
    if _cached_menu is not None and _cached_version == current_version:
        return _cached_menu

    categories = {}
    sizes = []
    
    if not local_postgres.is_enabled():
        return Menu()

    from db import postgres
    try:
        with postgres.connect() as conn:
            with conn.cursor() as cur:
                # 1. Load sizes
                cur.execute("SELECT id, code, name FROM public.menu_sizes ORDER BY sort_order")
                for sid, code, name in cur.fetchall():
                    sizes.append(MenuSize(id=sid, code=code, name=name))

                # 2. Load categories
                cur.execute("SELECT id, code, name FROM public.menu_categories ORDER BY sort_order")
                cat_rows = cur.fetchall()
                for cid, code, name in cat_rows:
                    categories[cid] = MenuCategory(id=cid, code=code, name=name, items=[])

                # 3. Load items
                cur.execute("""
                    SELECT id, item_code, category_id, name, price, item_type, description, image_url
                    FROM public.menu_items
                    WHERE is_available = true AND is_deleted = false
                """)
                items_dict = {}
                for row in cur.fetchall():
                    iid, icode, cid, name, price, itype, desc, img = row
                    if cid in categories:
                        item = MenuItem(
                            id=icode, # using item_code as ID for frontend
                            category_id=cid,
                            category_code=categories[cid].code,
                            name=name,
                            price=float(price),
                            item_type=itype,
                            description=desc,
                            image_url=img,
                            sizes=[]
                        )
                        categories[cid].items.append(item)
                        items_dict[iid] = item

                # 4. Load item sizes
                cur.execute("""
                    SELECT s.menu_item_id, ms.code, s.price
                    FROM public.menu_item_sizes s
                    JOIN public.menu_sizes ms ON s.size_id = ms.id
                    WHERE s.is_available = true
                """)
                for iid, scode, price in cur.fetchall():
                    if iid in items_dict:
                        items_dict[iid].sizes.append(MenuItemSize(size_id="temp", size_code=scode, price=float(price)))

    except Exception as e:
        print("Error loading menu:", e)

    # Convert categories to dict keyed by category code for easier lookup
    cat_by_code = {c.code: c for c in categories.values()}
    _cached_menu = Menu(categories=cat_by_code, all_sizes=sizes)
    _cached_version = current_version
    return _cached_menu
