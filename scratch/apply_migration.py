import psycopg
import os

url = os.environ.get('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/slicematic_local')
conn = psycopg.connect(url, autocommit=True)

# Drop existing refunds table if it's messed up
conn.execute("DROP TABLE IF EXISTS public.refunds CASCADE;")

with open('supabase/migrations/20260706020000_create_refunds_table.sql') as f:
    conn.execute(f.read())

print('Migration applied successfully!')
