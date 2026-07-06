import os
import uuid
import psycopg

url = os.environ.get('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/slicematic_local')

def seed_menu():
    with psycopg.connect(url, autocommit=True) as conn:
        with conn.cursor() as cur:
            # 1. Fetch categories
            cur.execute("SELECT code, id FROM menu_categories")
            categories = dict(cur.fetchall())
            
            # 2. Fetch sizes
            cur.execute("SELECT code, id FROM menu_sizes")
            sizes = dict(cur.fetchall())

            def insert_item(category_code, code, name, item_type, desc, price=0):
                iid = str(uuid.uuid4())
                cur.execute("""
                    INSERT INTO menu_items (id, item_code, category_id, name, price, item_type, description)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                """, (iid, code, categories[category_code], name, price, item_type, desc))
                return iid

            def insert_size(iid, size_code, price):
                cur.execute("""
                    INSERT INTO menu_item_sizes (menu_item_id, size_id, price)
                    VALUES (%s, %s, %s)
                """, (iid, sizes[size_code], price))

            print("Seeding Value Pizzas...")
            # Value Pizzas
            vp = [
                ("VP1", "Classic Margherita", "Veg", "Mozzarella, pizza sauce, oregano", {"PERSONAL": 79, "REGULAR": 129, "MEDIUM": 249, "LARGE": 399}),
                ("VP2", "Onion Capsicum", "Veg", "Onion, capsicum, cheese", {"PERSONAL": 99, "REGULAR": 159, "MEDIUM": 299, "LARGE": 459}),
                ("VP3", "Corn & Cheese", "Veg", "Sweet corn, mozzarella", {"PERSONAL": 109, "REGULAR": 169, "MEDIUM": 319, "LARGE": 499}),
                ("VP4", "Tomato Onion Chilli", "Veg", "Tomato, onion, green chilli", {"PERSONAL": 109, "REGULAR": 179, "MEDIUM": 329, "LARGE": 499}),
                ("VP5", "Spicy Paneer Pocket Pizza", "Veg", "Paneer chunks, onion, chilli", {"PERSONAL": 129, "REGULAR": 199, "MEDIUM": 369, "LARGE": 569})
            ]
            for c, n, t, d, szs in vp:
                iid = insert_item("value_pizza", c, n, t, d, 0)
                for s_code, p in szs.items():
                    insert_size(iid, s_code, p)

            print("Seeding Classic Veg Pizzas...")
            cv = [
                ("CV1", "Double Cheese Margherita", "Veg", "Extra mozzarella, classic sauce", {"REGULAR": 219, "MEDIUM": 399, "LARGE": 599}),
                ("CV2", "Farm Fresh Veggie", "Veg", "Onion, capsicum, tomato, corn", {"REGULAR": 229, "MEDIUM": 429, "LARGE": 649}),
                ("CV3", "Mexican Green Wave", "Veg", "Onion, capsicum, tomato, jalapeño, Mexican herbs", {"REGULAR": 249, "MEDIUM": 459, "LARGE": 699}),
                ("CV4", "Veggie Overload", "Veg", "Onion, capsicum, corn, mushroom, olives, jalapeño", {"REGULAR": 269, "MEDIUM": 499, "LARGE": 749}),
                ("CV5", "Cheese Burst Veggie", "Veg", "Classic veggie pizza with cheese filled crust", {"REGULAR": 309, "MEDIUM": 579, "LARGE": 849})
            ]
            for c, n, t, d, szs in cv:
                iid = insert_item("classic_veg_pizza", c, n, t, d, 0)
                for s_code, p in szs.items(): insert_size(iid, s_code, p)

            print("Seeding Special Veg Pizzas...")
            sv = [
                ("SV1", "Tandoori Paneer Tikka", "Veg", "Tandoori paneer, onion, capsicum, mint mayo drizzle", {"REGULAR": 279, "MEDIUM": 529, "LARGE": 799}),
                ("SV2", "Paneer Makhani Pizza", "Veg", "Makhani sauce, paneer, onion, capsicum, cheese", {"REGULAR": 289, "MEDIUM": 549, "LARGE": 829}),
                ("SV3", "Achari Paneer Pizza", "Veg", "Achari sauce, paneer, onion, green chilli", {"REGULAR": 279, "MEDIUM": 529, "LARGE": 799}),
                ("SV4", "Butter Masala Corn Pizza", "Veg", "Makhani base, corn, onion, capsicum", {"REGULAR": 249, "MEDIUM": 469, "LARGE": 719}),
                ("SV5", "Schezwan Veggie Blast", "Veg", "Schezwan sauce, onion, capsicum, mushroom, chilli flakes", {"REGULAR": 269, "MEDIUM": 499, "LARGE": 759}),
                ("SV6", "Chole Kulcha Pizza", "Veg", "Chole masala spread, onion, coriander, cheese", {"REGULAR": 259, "MEDIUM": 489, "LARGE": 739}),
                ("SV7", "Mumbai Masala Pizza", "Veg", "Spicy potato, onion, capsicum, green chutney drizzle", {"REGULAR": 239, "MEDIUM": 449, "LARGE": 679})
            ]
            for c, n, t, d, szs in sv:
                iid = insert_item("special_veg_pizza", c, n, t, d, 0)
                for s_code, p in szs.items(): insert_size(iid, s_code, p)

            print("Seeding Non-Veg Pizzas...")
            nv = [
                ("NV1", "Chicken Sausage Pizza", "Non-Veg", "Chicken sausage, onion, cheese", {"REGULAR": 249, "MEDIUM": 479, "LARGE": 729}),
                ("NV2", "BBQ Chicken Pizza", "Non-Veg", "BBQ chicken, onion, capsicum, smoky sauce", {"REGULAR": 279, "MEDIUM": 549, "LARGE": 849}),
                ("NV3", "Tandoori Chicken Tikka", "Non-Veg", "Tandoori chicken, onion, capsicum, mint mayo", {"REGULAR": 299, "MEDIUM": 579, "LARGE": 899}),
                ("NV4", "Butter Chicken Pizza", "Non-Veg", "Makhani sauce, chicken tikka, onion, cheese", {"REGULAR": 319, "MEDIUM": 599, "LARGE": 929}),
                ("NV5", "Chicken Keema Pizza", "Non-Veg", "Spicy chicken keema, onion, chilli, cheese", {"REGULAR": 299, "MEDIUM": 579, "LARGE": 899}),
                ("NV6", "Peri Peri Chicken Pizza", "Non-Veg", "Peri peri chicken, jalapeño, onion, spicy mayo", {"REGULAR": 319, "MEDIUM": 619, "LARGE": 949}),
                ("NV7", "Meat Overload", "Non-Veg", "Chicken sausage, chicken tikka, keema, BBQ chicken", {"REGULAR": 369, "MEDIUM": 699, "LARGE": 1049})
            ]
            for c, n, t, d, szs in nv:
                iid = insert_item("non_veg_pizza", c, n, t, d, 0)
                for s_code, p in szs.items(): insert_size(iid, s_code, p)

            print("Seeding Premium Pizzas...")
            pm = [
                ("PM1", "Four Cheese Pizza", "Veg", "Mozzarella, cheddar, processed cheese, cheese sauce", {"REGULAR": 329, "MEDIUM": 629, "LARGE": 949}),
                ("PM2", "Mushroom Truffle Style", "Veg", "Mushroom, onion, white sauce, garlic, cheese", {"REGULAR": 329, "MEDIUM": 629, "LARGE": 949}),
                ("PM3", "Pesto Paneer Pizza", "Veg", "Basil pesto, paneer, olives, capsicum", {"REGULAR": 349, "MEDIUM": 649, "LARGE": 999}),
                ("PM4", "Smoky BBQ Veg Supreme", "Veg", "BBQ sauce, mushroom, capsicum, corn, jalapeño", {"REGULAR": 329, "MEDIUM": 619, "LARGE": 949}),
                ("PM5", "Creamy Peri Peri Chicken", "Non-Veg", "Chicken, peri peri sauce, cheese sauce, jalapeño", {"REGULAR": 369, "MEDIUM": 699, "LARGE": 1049})
            ]
            for c, n, t, d, szs in pm:
                iid = insert_item("premium_pizza", c, n, t, d, 0)
                for s_code, p in szs.items(): insert_size(iid, s_code, p)

            print("Seeding Crusts...")
            crusts = [
                ("CR1", "Classic Hand Tossed", {"PERSONAL": 0, "REGULAR": 0, "MEDIUM": 0, "LARGE": 0}),
                ("CR2", "Thin Crust", {"PERSONAL": 20, "REGULAR": 30, "MEDIUM": 50, "LARGE": 70}),
                ("CR3", "Cheese Burst", {"PERSONAL": 50, "REGULAR": 80, "MEDIUM": 130, "LARGE": 180}),
                ("CR4", "Wheat Thin Crust", {"PERSONAL": 30, "REGULAR": 40, "MEDIUM": 70, "LARGE": 90}),
                ("CR5", "Garlic Butter Crust", {"PERSONAL": 20, "REGULAR": 30, "MEDIUM": 50, "LARGE": 70}),
                ("CR6", "Stuffed Cheese Crust", {"REGULAR": 90, "MEDIUM": 150, "LARGE": 220}),
                ("CR7", "Multigrain Base", {"PERSONAL": 30, "REGULAR": 50, "MEDIUM": 80, "LARGE": 110})
            ]
            for c, n, szs in crusts:
                iid = insert_item("crust", c, n, None, None, 0)
                for s_code, p in szs.items(): insert_size(iid, s_code, p)

            print("Seeding Sauces...")
            sauces = [
                ("SA1", "Classic Pizza Sauce", 0),
                ("SA2", "Makhani Sauce", 30),
                ("SA3", "Tandoori Sauce", 30),
                ("SA4", "Achari Sauce", 30),
                ("SA5", "Schezwan Sauce", 30),
                ("SA6", "BBQ Sauce", 40),
                ("SA7", "Peri Peri Sauce", 40),
                ("SA8", "Creamy White Sauce", 40),
                ("SA9", "Basil Pesto Sauce", 60)
            ]
            for c, n, p in sauces:
                insert_item("sauce", c, n, None, None, p)

            print("Seeding Veg Toppings...")
            vt = [
                ("VT1", "Onion", {"PERSONAL": 25, "REGULAR": 25, "MEDIUM": 40, "LARGE": 60}),
                ("VT2", "Capsicum", {"PERSONAL": 25, "REGULAR": 25, "MEDIUM": 40, "LARGE": 60}),
                ("VT3", "Tomato", {"PERSONAL": 25, "REGULAR": 25, "MEDIUM": 40, "LARGE": 60}),
                ("VT4", "Sweet Corn", {"PERSONAL": 30, "REGULAR": 30, "MEDIUM": 50, "LARGE": 70}),
                ("VT5", "Jalapeño", {"PERSONAL": 35, "REGULAR": 35, "MEDIUM": 60, "LARGE": 80}),
                ("VT6", "Black Olive", {"PERSONAL": 40, "REGULAR": 40, "MEDIUM": 70, "LARGE": 100}),
                ("VT7", "Mushroom", {"PERSONAL": 40, "REGULAR": 40, "MEDIUM": 70, "LARGE": 100}),
                ("VT8", "Paneer", {"PERSONAL": 60, "REGULAR": 60, "MEDIUM": 100, "LARGE": 150}),
                ("VT9", "Extra Cheese", {"PERSONAL": 60, "REGULAR": 60, "MEDIUM": 110, "LARGE": 170}),
                ("VT10", "Cheese Sauce Drizzle", {"PERSONAL": 40, "REGULAR": 40, "MEDIUM": 70, "LARGE": 100})
            ]
            for c, n, szs in vt:
                iid = insert_item("veg_topping", c, n, "Veg", None, 0)
                for s_code, p in szs.items(): insert_size(iid, s_code, p)

            print("Seeding Non-Veg Toppings...")
            nvt = [
                ("NVT1", "Chicken Sausage", {"PERSONAL": 70, "REGULAR": 70, "MEDIUM": 120, "LARGE": 180}),
                ("NVT2", "Chicken Tikka", {"PERSONAL": 80, "REGULAR": 80, "MEDIUM": 140, "LARGE": 210}),
                ("NVT3", "BBQ Chicken", {"PERSONAL": 90, "REGULAR": 90, "MEDIUM": 150, "LARGE": 230}),
                ("NVT4", "Chicken Keema", {"PERSONAL": 90, "REGULAR": 90, "MEDIUM": 150, "LARGE": 230}),
                ("NVT5", "Peri Peri Chicken", {"PERSONAL": 90, "REGULAR": 90, "MEDIUM": 160, "LARGE": 240})
            ]
            for c, n, szs in nvt:
                iid = insert_item("non_veg_topping", c, n, "Non-Veg", None, 0)
                for s_code, p in szs.items(): insert_size(iid, s_code, p)

            print("Seeding Sides & Others...")
            sides = [
                ("SD1", "Classic Garlic Breadsticks", 109, "Veg"),
                ("SD2", "Cheese Garlic Bread", 149, "Veg"),
                ("SD3", "Stuffed Garlic Bread", 169, "Veg"),
                ("SD4", "Paneer Tikka Stuffed Garlic Bread", 199, "Veg"),
                ("SD5", "Chicken Stuffed Garlic Bread", 219, "Non-Veg"),
                ("SD6", "Cheesy Dip Garlic Bites", 159, "Veg"),
                ("SD7", "Masala Potato Wedges", 129, "Veg"),
                ("SD8", "Peri Peri Fries", 129, "Veg"),
                ("SD9", "Cheese Loaded Fries", 179, "Veg"),
                ("SD10", "Nachos with Cheese Sauce", 179, "Veg"),
                ("SD11", "Veg Pizza Pockets", 129, "Veg"),
                ("SD12", "Chicken Pizza Pockets", 159, "Non-Veg"),
                ("SD13", "Baked Cheese Pasta - Veg", 199, "Veg"),
                ("SD14", "Baked Cheese Pasta - Chicken", 249, "Non-Veg"),
                ("SD15", "Chilli Cheese Toast", 139, "Veg"),
                ("SD16", "Tandoori Paneer Bites", 199, "Veg"),
                ("SD17", "Chicken Popcorn", 199, "Non-Veg"),
                ("SD18", "Peri Peri Chicken Wings", 249, "Non-Veg")
            ]
            for c, n, p, t in sides: insert_item("side", c, n, t, None, p)

            dips = [
                ("D1", "Cheesy Dip", 35, "Veg"),
                ("D2", "Jalapeño Cheese Dip", 45, "Veg"),
                ("D3", "Peri Peri Mayo", 35, "Veg"),
                ("D4", "Garlic Mayo", 35, "Veg"),
                ("D5", "Mint Mayo", 35, "Veg"),
                ("D6", "Tandoori Mayo", 40, "Veg"),
                ("D7", "Makhani Dip", 45, "Veg"),
                ("D8", "BBQ Dip", 45, "Veg"),
                ("D9", "Schezwan Dip", 35, "Veg")
            ]
            for c, n, p, t in dips: insert_item("dip", c, n, t, None, p)

            bevs = [
                ("B1", "Water Bottle 500 ml", 20, "Veg"),
                ("B2", "Coke / Pepsi / Sprite 250 ml", 40, "Veg"),
                ("B3", "Coke / Pepsi / Sprite 475 ml", 60, "Veg"),
                ("B4", "Coke / Pepsi / Sprite 750 ml", 80, "Veg"),
                ("B5", "Coke / Pepsi / Sprite 1.25 L", 110, "Veg"),
                ("B6", "Masala Lemon Soda", 79, "Veg"),
                ("B7", "Fresh Lime Soda", 79, "Veg"),
                ("B8", "Iced Tea", 99, "Veg"),
                ("B9", "Cold Coffee", 129, "Veg"),
                ("B10", "Chocolate Shake", 149, "Veg"),
                ("B11", "Mango Shake", 149, "Veg"),
                ("B12", "Oreo Shake", 169, "Veg")
            ]
            for c, n, p, t in bevs: insert_item("beverage", c, n, t, None, p)

            desserts = [
                ("DS1", "Choco Lava Cake", 109, "Veg"),
                ("DS2", "Double Chocolate Brownie", 129, "Veg"),
                ("DS3", "Brownie with Chocolate Sauce", 159, "Veg"),
                ("DS4", "Cinnamon Sugar Sticks", 119, "Veg"),
                ("DS5", "Nutella Style Dessert Pizza", 199, "Veg"),
                ("DS6", "Ice Cream Cup", 69, "Veg"),
                ("DS7", "Chocolate Mousse Cup", 99, "Veg")
            ]
            for c, n, p, t in desserts: insert_item("dessert", c, n, t, None, p)

            combos = [
                ("CB1", "Solo Meal Veg", 249, "Veg", "1 Regular Veg Pizza + 1 Dip + 250 ml Drink"),
                ("CB2", "Solo Meal Non-Veg", 299, "Non-Veg", "1 Regular Non-Veg Pizza + 1 Dip + 250 ml Drink"),
                ("CB3", "Couple Veg Combo", 599, "Veg", "1 Medium Veg Pizza + Garlic Bread + 2 Drinks"),
                ("CB4", "Couple Non-Veg Combo", 699, "Non-Veg", "1 Medium Non-Veg Pizza + Garlic Bread + 2 Drinks"),
                ("CB5", "Family Veg Feast", 1099, "Veg", "2 Medium Veg Pizzas + Stuffed Garlic Bread + 4 Drinks"),
                ("CB6", "Family Mixed Feast", 1249, "Non-Veg", "1 Medium Veg Pizza + 1 Medium Non-Veg Pizza + Fries + Garlic Bread + 4 Drinks"),
                ("CB7", "Party Box Veg", 1899, "Veg", "2 Large Veg Pizzas + 2 Garlic Breads + 4 Dips + 1.25 L Drink"),
                ("CB8", "Party Box Mixed", 2099, "Non-Veg", "1 Large Veg Pizza + 1 Large Non-Veg Pizza + 2 Sides + 4 Dips + 1.25 L Drink"),
                ("CB9", "Student Saver", 199, "Veg", "2 Personal Pizzas + 2 Dips"),
                ("CB10", "Office Lunch Box", 249, "Veg", "1 Personal Pizza + Fries + Drink")
            ]
            for c, n, p, t, d in combos: insert_item("combo", c, n, t, d, p)
            print("Done seeding.")

if __name__ == '__main__':
    seed_menu()
