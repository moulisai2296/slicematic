from db.postgres import connect
with connect() as conn:
    with conn.cursor() as cur:
        cur.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'discount_rules'")
        print("discount_rules:", cur.fetchall())
        cur.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'discount_rule_conditions'")
        print("discount_rule_conditions:", cur.fetchall())
