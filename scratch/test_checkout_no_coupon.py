import uuid, json, random
from db.postgres import connect
from fastapi.testclient import TestClient
from ai.main import app

client = TestClient(app)

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
    "coupon_code": ""
}

response = client.post("/api/cart/checkout", json=payload)
print("Checkout NO COUPON:", response.json())
