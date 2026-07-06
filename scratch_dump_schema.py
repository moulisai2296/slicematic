import psycopg
import os

url = os.environ.get('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/slicematic_local')

def dump_schema():
    with psycopg.connect(url, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public'
            """)
            tables = [r[0] for r in cur.fetchall()]
            for table in tables:
                print(f"Table: {table}")
                cur.execute(f"SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '{table}'")
                cols = cur.fetchall()
                for c in cols:
                    print(f"  {c[0]} ({c[1]})")
                print()

if __name__ == '__main__':
    dump_schema()
