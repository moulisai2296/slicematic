from db.postgres import connect
with connect() as conn:
    with conn.cursor() as cur:
        cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")
        tables = [r[0] for r in cur.fetchall()]
        print('Tables:', tables)
