import uuid, json, random
from db.postgres import connect
from db.admin import advance_staff_order

with connect() as conn:
    with conn.cursor() as cur:
        # Create a test dine_in order
        order_no = f"TST-{random.randint(1000, 9999)}"
        order_id = str(uuid.uuid4())
        user_id = str(uuid.uuid4())
        cur.execute(
            """
            INSERT INTO public.orders (
                id, user_id, order_no, source, customer_name, customer_phone, items,
                subtotal, discount, gst, total, payment_mode, status, type
            )
            VALUES (
                %s, %s, %s, 'staff_pos', 'Test Customer', '9999999999', '[]'::jsonb,
                100.0, 0.0, 5.0, 105.0, 'Cash', 'ready_for_pickup', 'dine_in'
            )
            RETURNING id
            """,
            (order_id, user_id, order_no)
        )
        conn.commit()
        print(f"Created order {order_no} in ready_for_pickup")

try:
    updated = advance_staff_order(order_id, performed_by=str(uuid.uuid4()))
    print('Success:', updated['status'])
except Exception as e:
    print('Error:', e)
