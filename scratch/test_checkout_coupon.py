import uuid, json, random
from db.postgres import connect
from fastapi.testclient import TestClient
from ai.main import app

client = TestClient(app)

with connect() as conn:
    with conn.cursor() as cur:
        # Create a test coupon
        coupon_id = str(uuid.uuid4())
        try:
            cur.execute(
                """
                INSERT INTO public.discount_rules (
                    id, name, discount_percent, threshold_amount, is_active, coupon_code, description
                )
                VALUES (
                    %s, 'Test Coupon', 10.0, 50.0, true, 'TEST10', '10%% off test'
                )
                ON CONFLICT (id) DO NOTHING
                """,
                (coupon_id,)
            )
            conn.commit()
        except Exception:
            conn.rollback()

# Now simulate a checkout using TEST10
payload = {
    "user_id": "",
    "name": "Test Customer",
    "phone": "9999999999",
    "payment_mode": "1",
    "address": "",
    "type": "online",
    "lines": [
        {
            "base_id": "B1",
            "pizza_id": "P1",
            "topping_ids": ["T1"],
            "quantity": 1
        }
    ],
    "coupon_code": "TEST10"
}

response = client.post("/api/cart/checkout", json=payload)
print("Checkout Response:", response.json())
