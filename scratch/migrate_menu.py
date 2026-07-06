import os
import uuid
import psycopg

url = os.environ.get('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/slicematic_local')

def run_migration():
    with psycopg.connect(url, autocommit=True) as conn:
        with conn.cursor() as cur:
            print("1. Cleaning old history data...")
            tables_to_clean = [
                "customer_feedback",
                "payments",
                "refunds",
                "order_inventory_deductions",
                "order_status_history",
                "orders",
                "messages",
                "escalations",
                "sessions",
                "menu_item_ingredients", # we might need to recreate these
            ]
            for t in tables_to_clean:
                try:
                    cur.execute(f"TRUNCATE TABLE {t} CASCADE;")
                    print(f"  - Truncated {t}")
                except Exception as e:
                    print(f"  - Error truncating {t}: {e}")

            print("2. Schema updates for sizes & images...")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS menu_sizes (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    code TEXT UNIQUE NOT NULL,
                    name TEXT NOT NULL,
                    diameter_inches INTEGER,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS menu_item_sizes (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
                    size_id UUID NOT NULL REFERENCES menu_sizes(id) ON DELETE CASCADE,
                    price NUMERIC(10, 2) NOT NULL,
                    is_available BOOLEAN NOT NULL DEFAULT true,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    UNIQUE(menu_item_id, size_id)
                );
            """)

            # Add columns to menu_items
            for col, type_def in [
                ("image_url", "TEXT"),
                ("description", "TEXT"),
                ("item_type", "TEXT")
            ]:
                try:
                    cur.execute(f"ALTER TABLE menu_items ADD COLUMN {col} {type_def};")
                except psycopg.errors.DuplicateColumn:
                    pass

            print("3. Resetting menu categories & items...")
            cur.execute("DELETE FROM menu_items;")
            cur.execute("DELETE FROM menu_categories;")
            cur.execute("DELETE FROM menu_sizes;")

            # Seed Sizes
            sizes = [
                ("PERSONAL", "Personal", 6, 10),
                ("REGULAR", "Regular", 7, 20),
                ("MEDIUM", "Medium", 10, 30),
                ("LARGE", "Large", 12, 40)
            ]
            for code, name, diam, sort in sizes:
                cur.execute(
                    "INSERT INTO menu_sizes (code, name, diameter_inches, sort_order) VALUES (%s, %s, %s, %s)",
                    (code, name, diam, sort)
                )

            # Insert Categories
            categories = [
                ("value_pizza", "Value Pizzas", 10),
                ("classic_veg_pizza", "Classic Veg Pizzas", 20),
                ("special_veg_pizza", "Indian Chef Special Veg Pizzas", 30),
                ("non_veg_pizza", "Non-Veg Pizzas", 40),
                ("premium_pizza", "Premium / Gourmet Pizzas", 50),
                ("crust", "Crust Options", 60),
                ("sauce", "Sauce Options", 70),
                ("veg_topping", "Extra Veg Toppings", 80),
                ("non_veg_topping", "Extra Non-Veg Toppings", 90),
                ("side", "Sides", 100),
                ("dip", "Dips", 110),
                ("beverage", "Beverages", 120),
                ("dessert", "Desserts", 130),
                ("combo", "Combos", 140)
            ]
            cat_ids = {}
            for code, name, sort in categories:
                cid = str(uuid.uuid4())
                cat_ids[code] = cid
                cur.execute(
                    "INSERT INTO menu_categories (id, code, name, sort_order) VALUES (%s, %s, %s, %s)",
                    (cid, code, name, sort)
                )

            print("Migration schema successful!")

if __name__ == '__main__':
    run_migration()
