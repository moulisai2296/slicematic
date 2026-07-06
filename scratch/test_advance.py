import uuid, json
from db.postgres import connect
from db.admin import advance_staff_order

with connect() as conn:
    with conn.cursor() as cur:
        cur.execute("SELECT id, order_no FROM public.orders WHERE type IN ('takeaway', 'dine_in') AND status = 'ready_for_pickup' LIMIT 1")
        row = cur.fetchone()

if row:
    order_id, order_no = row
    print('Advancing order', order_no)
    try:
        updated = advance_staff_order(order_id, performed_by=str(uuid.uuid4()))
        print('Success:', updated['status'])
    except Exception as e:
        print('Error:', e)
else:
    print('No ready_for_pickup takeaway/dine_in order found')
