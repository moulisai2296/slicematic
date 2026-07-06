const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") ?? "http://localhost:7861";

const STAFF_TOKEN = process.env.NEXT_PUBLIC_STAFF_DEV_TOKEN ?? "";

export interface StaffOrder {
  id: string;
  order_no: string;
  customer_name: string;
  customer_phone: string;
  items: Array<{
    pizza: string;
    base: string;
    toppings: string[];
    quantity: number;
    unit_price: number;
    line_total: number;
  }> | null;
  total: number;
  payment_mode: string;
  payment_status: string;
  status: string;
  created_at: string;
}

export interface StaffIngredient {
  id: string;
  name: string;
  unit: string;
  stock_quantity: number;
  reorder_threshold: number;
  is_low_stock: boolean;
}

export interface StaffInventoryRequest {
  id: string;
  ingredient_name: string;
  requested_quantity: number;
  status: string;
  reason?: string;
  created_at: string;
}

export interface StaffCartLinePayload {
  base_id: string;
  pizza_id: string;
  topping_ids: string[];
  quantity: number;
}

export async function getStaffOrders(): Promise<{ ok: boolean; orders: StaffOrder[] }> {
  return staffGet("/staff/orders");
}

export async function advanceStaffOrder(
  orderId: string,
  reason?: string
): Promise<{ ok: boolean; order: Pick<StaffOrder, "id" | "order_no" | "status"> }> {
  return staffJSON(`/staff/orders/${orderId}/advance`, "POST", { reason });
}

export async function getStaffInventory(): Promise<{
  ok: boolean;
  inventory: {
    ingredients: StaffIngredient[];
    requests: StaffInventoryRequest[];
  };
}> {
  return staffGet("/staff/inventory");
}

export async function createStaffInventoryRequest(payload: {
  ingredient_id: string;
  requested_quantity: number;
  reason: string;
}): Promise<{ ok: boolean; request: StaffInventoryRequest }> {
  return staffJSON("/staff/inventory/requests", "POST", payload);
}

export async function checkoutStaffOrder(payload: {
  name: string;
  phone: string;
  payment_mode: string;
  lines: StaffCartLinePayload[];
  coupon_code?: string;
}): Promise<{
  ok: boolean;
  order?: StaffOrder;
  errors?: Record<string, string>;
  line_index?: number;
}> {
  return staffJSON("/staff/checkout", "POST", payload);
}

async function staffGet<T>(path: string): Promise<T> {
  if (!STAFF_TOKEN) {
    throw new Error("Staff dev token is missing in frontend/.env.local.");
  }
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${STAFF_TOKEN}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Staff request failed (${res.status}).`);
  }
  return res.json() as Promise<T>;
}

async function staffJSON<T>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body: unknown
): Promise<T> {
  if (!STAFF_TOKEN) {
    throw new Error("Staff dev token is missing in frontend/.env.local.");
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${STAFF_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const response = await res.json().catch(() => null);
    throw new Error(response?.detail ?? `Staff request failed (${res.status}).`);
  }
  return res.json() as Promise<T>;
}
