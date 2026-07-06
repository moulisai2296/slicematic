import psycopg
import os
url = os.environ.get('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/slicematic_local')
conn = psycopg.connect(url, autocommit=True)
res = conn.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'orders';").fetchall()
print(res)
