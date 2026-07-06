/**
 * Typed client for the SliceMatic AI service.
 *
 * Wraps the FastAPI backend (ai.main:app): the conversational /chat + /voice/*
 * endpoints and the shared /api/* routes (menu, summary, order) that are mounted
 * on the same process. All money/validation stays server-side in core/ — this
 * client never computes prices.
 */

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") ?? "http://localhost:7861";

export const WS_BASE = API_BASE.replace(/^http/, "ws");

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function requestJSON<T>(
  path: string,
  init: RequestInit,
  headers?: Record<string, string>
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), ...headers },
    });
  } catch {
    throw new ApiError("Can't reach SliceMatic right now. Check your connection.");
  }
  if (res.status === 401) {
    throw new ApiError("Your session has expired — sign in again.", 401);
  }
  if (!res.ok) {
    throw new ApiError(`Request failed (${res.status}).`, res.status);
  }
  return res.json() as Promise<T>;
}

async function postJSON<T>(
  path: string,
  body: unknown,
  headers?: Record<string, string>
): Promise<T> {
  return requestJSON<T>(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    headers
  );
}

async function getJSON<T>(
  path: string,
  headers?: Record<string, string>
): Promise<T> {
  return requestJSON<T>(path, {}, headers);
}

/** Authorization header for authenticated calls (JWT from the auth store). */
export function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/* --------------------------- Auth --------------------------- */
// /api/auth/* — user + role management. Business errors come back as
// { ok: false, errors: {...} } with HTTP 200; only token failures are 401/403.

export type Role = "user" | "admin" | "staff" | "kitchen_staff" | "delivery";

export interface SavedAddress {
  id: string;
  label: string;
  line: string;
  isDefault?: boolean;
}

export interface AuthUser {
  id: string;
  role: Role;
  name: string;
  phone: string | null;
  email: string | null;
  emp_id: string | null;
  address: SavedAddress[] | null;
  is_active: boolean;
  created_at: string;
}

export interface AuthResponse {
  ok: boolean;
  token?: string;
  user?: AuthUser;
  errors?: Record<string, string>;
}

export function signup(payload: {
  name: string;
  phone: string;
  pin: string;
  confirm_pin: string;
}): Promise<AuthResponse> {
  return postJSON<AuthResponse>("/api/auth/signup", payload);
}

export function login(
  role: Role,
  identifier: string,
  secret: string
): Promise<AuthResponse> {
  return postJSON<AuthResponse>("/api/auth/login", { role, identifier, secret });
}

export function getMe(token: string): Promise<AuthResponse> {
  return getJSON<AuthResponse>("/api/auth/me", authHeader(token));
}

export function saveAddresses(
  token: string,
  address: SavedAddress[]
): Promise<AuthResponse> {
  return requestJSON<AuthResponse>(
    "/api/auth/me/address",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    },
    authHeader(token)
  );
}

export interface EmployeesResponse {
  ok: boolean;
  employees?: AuthUser[];
  employee?: AuthUser;
  errors?: Record<string, string>;
}

export function listEmployees(token: string): Promise<EmployeesResponse> {
  return getJSON<EmployeesResponse>("/api/auth/employees", authHeader(token));
}

export function createEmployee(
  token: string,
  payload: { name: string; phone: string; role: Role; pin: string }
): Promise<EmployeesResponse> {
  return postJSON<EmployeesResponse>(
    "/api/auth/employees",
    payload,
    authHeader(token)
  );
}

export function updateEmployee(
  token: string,
  id: string,
  payload: { is_active?: boolean; pin?: string }
): Promise<EmployeesResponse> {
  return requestJSON<EmployeesResponse>(
    `/api/auth/employees/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    authHeader(token)
  );
}

/* --------------------------- Chat --------------------------- */

export interface ChatResponse {
  reply: string;
  session_id: string;
  escalated: boolean;
  blocked: boolean;
}

export function sendChat(
  message: string,
  sessionId: string | null,
  token?: string | null
): Promise<ChatResponse> {
  return postJSON<ChatResponse>(
    "/chat",
    { message, session_id: sessionId },
    token ? authHeader(token) : undefined
  );
}

/* --------------------------- Menu --------------------------- */

export interface MenuItem {
  id: string;
  category_code: string;
  name: string;
  price: number;
  item_type: string | null;
  description: string | null;
  image_url: string | null;
  sizes: { size_code: string; price: number }[];
}

export interface MenuSize {
  id: string;
  code: string;
  name: string;
}

export interface Menu {
  categories: Record<string, MenuItem[]>;
  sizes: MenuSize[];
  error?: string;
}

export function getMenu(): Promise<Menu> {
  return getJSON<Menu>("/api/menu");
}

/** Runtime pricing config — the admin can adjust the bulk-discount rule. */
export interface PricingConfig {
  discount_rate: number; // fraction, e.g. 0.1
  discount_threshold: number; // min quantity per line
}

export function getConfig(): Promise<PricingConfig> {
  return getJSON<PricingConfig>("/api/config");
}

/* ------------------------- Cart pricing --------------------- */
// Multi-line, multi-topping pricing. All money is computed server-side
// by core/ — the client only sends ids + quantities and renders the result.

export interface CartLinePayload {
  item_id: string;
  item_type: string;
  size_code: string | null;
  crust_id: string | null;
  topping_ids: string[];
  quantity: number;
}

export interface PricedComponent {
  id: string;
  name: string;
  price: number;
}

export interface PricedLine {
  item: PricedComponent;
  item_type: string;
  size_code: string | null;
  crust: PricedComponent | null;
  toppings: PricedComponent[];
  quantity: number;
  unit_price: number;
  subtotal: number;
  discount: number;
  taxable: number;
  gst: number;
  total: number;
}

export interface CartTotals {
  subtotal: number;
  discount: number;
  taxable: number;
  gst: number;
  total: number;
}

export interface CartPriceResponse {
  ok: boolean;
  lines?: PricedLine[];
  cart?: CartTotals;
  errors?: Record<string, string>;
  line_index?: number;
}

export function priceCart(
  lines: CartLinePayload[]
): Promise<CartPriceResponse> {
  return postJSON<CartPriceResponse>("/api/cart/price", { lines });
}

/* --------------------------- Checkout ----------------------- */
// Places the whole cart. Server re-validates + writes one orders_log block per
// line (core.persistence). payment_mode: "1"/"Cash" (COD & Cash) or "3"/"UPI".

/** The only three order channels — enforced server-side too (api/routes.py
 *  checkout_cart). "online" is the customer app's default; the staff kiosk
 *  sends "dine_in"/"takeaway" (see components/staff/pos-payment.tsx). */
export type OrderChannel = "online" | "dine_in" | "takeaway";

export interface CheckoutPayload {
  user_id: string;
  name: string;
  phone: string;
  payment_mode: string;
  /** Delivery address line — required by the UI for delivery orders. */
  address: string;
  /** Order channel — server default "online" if omitted. */
  type?: OrderChannel;
  lines: CartLinePayload[];
  coupon_code?: string;
}

export interface CheckoutResponse {
  ok: boolean;
  order_no?: string;
  total?: number;
  name?: string;
  payment_mode?: string;
  line_count?: number;
  errors?: Record<string, string>;
  line_index?: number;
}

export function checkoutCart(
  payload: CheckoutPayload
): Promise<CheckoutResponse> {
  return postJSON<CheckoutResponse>("/api/cart/checkout", payload);
}

/* --------------------------- Coupons ----------------------- */

export interface CouponRule {
  id: string;
  name: string;
  coupon_code: string;
  description?: string | null;
  discount_percent: number;
  threshold_amount: number;
  start_date?: string | null;
  end_date?: string | null;
}

export interface CouponsResponse {
  ok: boolean;
  coupons: CouponRule[];
  errors?: Record<string, string>;
}

export interface CouponValidateResponse {
  ok: boolean;
  coupon_code?: string;
  coupon_name?: string;
  description?: string | null;
  discount_percent?: number;
  discount_amount?: number;
  original_total?: number;
  new_total?: number;
  savings?: number;
  errors?: Record<string, string>;
}

export function listAvailableCoupons(): Promise<CouponsResponse> {
  return getJSON<CouponsResponse>("/api/coupons/available");
}

export function validateCoupon(
  code: string,
  cartTotal: number
): Promise<CouponValidateResponse> {
  return postJSON<CouponValidateResponse>("/api/coupons/validate", {
    code,
    cart_total: cartTotal,
  });
}

export function acceptOrder(
  orderNo: string,
  token: string
): Promise<{ ok: boolean; order?: UserOrder; errors?: Record<string, string> }> {
  return postJSON(`/api/orders/${orderNo}/accept`, {}, authHeader(token));
}

/* --------------------------- Feedback ---------------------- */

export interface FeedbackStatusResponse {
  ok: boolean;
  has_feedback?: boolean;
  rating?: number;
  feedback_text?: string;
  created_at?: string;
  errors?: Record<string, string>;
}

export interface SubmitFeedbackResponse {
  ok: boolean;
  already_submitted?: boolean;
  feedback_id?: string;
  rating?: number;
  message?: string;
  errors?: Record<string, string>;
}

export function getOrderFeedback(
  orderNo: string
): Promise<FeedbackStatusResponse> {
  return getJSON<FeedbackStatusResponse>(`/api/orders/${encodeURIComponent(orderNo)}/feedback`);
}

export function submitOrderFeedback(
  orderNo: string,
  rating: number,
  feedbackText: string
): Promise<SubmitFeedbackResponse> {
  return postJSON<SubmitFeedbackResponse>(
    `/api/orders/${encodeURIComponent(orderNo)}/feedback`,
    { rating, feedback_text: feedbackText }
  );
}

/* ------------------------- Orders (DB) ---------------------- */
// API orders live in Supabase (source of truth). Listed by user_id.

export interface OrderItem {
  item_name: string;
  item_type: string | null;
  size_code: string | null;
  crust: string | null;
  toppings: string[];
  quantity: number;
  unit_price: number;
  line_total: number;
  base_price?: number;
  crust_price?: number;
  toppings_breakdown?: { name: string; price: number }[];
}

export interface UserOrder {
  id?: string;
  order_no: string;
  items: OrderItem[] | null;
  subtotal: number;
  discount: number;
  gst: number;
  total: number;
  payment_mode: string;
  status: string;
  created_at: string;
  customer_name: string;
  customer_phone?: string;
  delivery_address?: string | null;
  source?: string;
  /** Canonical order channel. */
  type?: OrderChannel | null;
  rider_id?: string | null;
  preparing_at?: string | null;
  ready_at?: string | null;
  out_for_delivery_at?: string | null;
  delivered_at?: string | null;
}

export interface OrdersResponse {
  ok: boolean;
  orders?: UserOrder[];
  errors?: Record<string, string>;
}

export function getUserOrders(userId: string): Promise<OrdersResponse> {
  return getJSON<OrdersResponse>(
    `/api/orders?user_id=${encodeURIComponent(userId)}`
  );
}

/** Interim filter until real auth: list orders by the profile's phone number
 *  (chat/voice + checkout orders all carry it). Swap back to user_id later. */
export function getOrdersByPhone(phone: string): Promise<OrdersResponse> {
  return getJSON<OrdersResponse>(`/api/orders?phone=${encodeURIComponent(phone)}`);
}

/** ALL recent orders — the kitchen/delivery work queues (every rider sees
 *  every order for now; per-rider assignment arrives with the authorization
 *  step). Optional type/status filter the same way the backend does. */
export function getRecentOrders(filters?: {
  type?: OrderChannel;
  status?: string;
}): Promise<OrdersResponse> {
  const params = new URLSearchParams();
  if (filters?.type) params.set("type", filters.type);
  if (filters?.status) params.set("status", filters.status);
  const qs = params.toString();
  return getJSON<OrdersResponse>(`/api/orders/recent${qs ? `?${qs}` : ""}`);
}

export interface OrderStatusResponse {
  ok: boolean;
  order?: UserOrder;
  errors?: Record<string, string>;
}

/** Advance one order one step (kitchen: preparing/ready_for_pickup; delivery:
 *  out_for_delivery/delivered) — db_orders.update_order_status enforces the
 *  legal sequence server-side, so an illegal call just comes back as an error. */
export function updateOrderStatus(
  orderNo: string,
  status: string,
  token: string
): Promise<OrderStatusResponse> {
  return postJSON<OrderStatusResponse>(
    `/api/orders/${encodeURIComponent(orderNo)}/status`,
    { status },
    authHeader(token)
  );
}

export interface DeliveryStatsOrder {
  order_no: string;
  delivered_at: string | null;
  pickup_to_delivered_minutes: number | null;
}

export interface DeliveryStatsResponse {
  ok: boolean;
  delivered_today?: number;
  orders?: DeliveryStatsOrder[];
  errors?: Record<string, string>;
}

export function getDeliveryStats(token: string): Promise<DeliveryStatsResponse> {
  return getJSON<DeliveryStatsResponse>(
    "/api/orders/delivery-stats",
    authHeader(token)
  );
}

/* --------------------------- Voice -------------------------- */

/** wss://.../voice/call (or ws:// for local dev) — the realtime call socket. */
export function voiceCallWsUrl(): string {
  return `${API_BASE.replace(/^http/, "ws")}/voice/call`;
}

export interface TranscribeResponse {
  session_id: string;
  transcript: string;
  confidence?: number;
  call_ended?: boolean;
  error?: string;
}

/** Start a voice call — resets the per-call 3-minute budget on the server. */
export async function startVoiceCall(sessionId: string): Promise<void> {
  const form = new FormData();
  form.append("session_id", sessionId);
  try {
    await fetch(`${API_BASE}/voice/start`, { method: "POST", body: form });
  } catch {
    /* best-effort — the call can still proceed */
  }
}

export async function transcribeVoice(
  audio: Blob,
  sessionId: string
): Promise<TranscribeResponse> {
  const form = new FormData();
  form.append("session_id", sessionId);
  form.append("audio", audio, "clip.webm");
  const res = await fetch(`${API_BASE}/voice/transcribe`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new ApiError(`Transcription failed (${res.status}).`, res.status);
  return res.json() as Promise<TranscribeResponse>;
}

export interface VoiceRespondResponse {
  reply: string;
  session_id: string;
  escalated: boolean;
  blocked: boolean;
}

export function voiceRespond(
  transcript: string,
  sessionId: string | null,
  token?: string | null
): Promise<VoiceRespondResponse> {
  return postJSON<VoiceRespondResponse>(
    "/voice/respond",
    { transcript, session_id: sessionId },
    token ? authHeader(token) : undefined
  );
}

export async function synthesizeSpeech(
  text: string,
  language = "en"
): Promise<Blob> {
  const res = await fetch(`${API_BASE}/voice/synthesize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, language }),
  });
  if (!res.ok) throw new ApiError(`Speech synthesis failed (${res.status}).`, res.status);
  return res.blob();
}

/* --------------------------- Observability dashboard --------------------------- */
// /api/dashboard/* — admin-only, read-side of the Langfuse tracing data (see
// dashboard/langfuse_query.py). Distinct from /api/analytics (business/order
// analytics from core/analytics.py) — this is LLM cost + session + tool usage.

export interface DashboardChannelStats {
  cost: number;
  turns: number;
  sessions: number;
  voice_duration?: number;
  voice_cost_inr?: number;
}

export interface DashboardSummary {
  days: number;
  total_cost: number;
  total_turns: number;
  total_sessions: number;
  total_voice_duration?: number;
  total_voice_cost_inr?: number;
  avg_voice_duration?: number;
  avg_voice_cost_inr?: number;
  by_channel: {
    chat: DashboardChannelStats;
    voice: DashboardChannelStats;
  };
}

export function getDashboardSummary(
  token: string,
  days = 30
): Promise<DashboardSummary> {
  return getJSON<DashboardSummary>(
    `/api/dashboard/summary?days=${days}`,
    authHeader(token)
  );
}

export interface DashboardSessionRow {
  session_id: string;
  channel: "chat" | "voice" | "mixed" | "unknown";
  turn_count: number;
  total_cost: number;
  first_seen: string;
  last_seen: string;
  voice_duration: number;
  voice_cost_inr: number;
}

export interface DashboardSessionsResponse {
  page: number;
  limit: number;
  total: number;
  rows: DashboardSessionRow[];
}

export function getDashboardSessions(
  token: string,
  opts?: { days?: number; page?: number; limit?: number }
): Promise<DashboardSessionsResponse> {
  const params = new URLSearchParams();
  if (opts?.days) params.set("days", String(opts.days));
  if (opts?.page) params.set("page", String(opts.page));
  if (opts?.limit) params.set("limit", String(opts.limit));
  return getJSON<DashboardSessionsResponse>(
    `/api/dashboard/sessions?${params.toString()}`,
    authHeader(token)
  );
}

export interface DashboardToolCall {
  name: string | null;
  start_time: string | null;
  end_time: string | null;
}

export interface DashboardModelCall {
  model: string | null;
  cost: number | null;
}

export interface DashboardTurn {
  trace_id: string;
  timestamp: string;
  cost: number;
  latency: number | null;
  tools_used: DashboardToolCall[];
  models_used: DashboardModelCall[];
  user_message: string | null;
  assistant_message: string | null;
  system_message: string | null;
}

export interface DashboardSessionDetail {
  session_id: string;
  turn_count: number;
  total_cost: number;
  voice_duration: number;
  voice_cost_inr: number;
  turns: DashboardTurn[];
}

export function getDashboardSessionDetail(
  token: string,
  sessionId: string
): Promise<DashboardSessionDetail> {
  return getJSON<DashboardSessionDetail>(
    `/api/dashboard/sessions/${encodeURIComponent(sessionId)}`,
    authHeader(token)
  );
}

export interface DashboardEscalation {
  id: string;
  session_id: string;
  reason?: string;
  channel?: string;
  language?: string;
  customer_name?: string;
  customer_phone?: string;
  langfuse_session_id?: string;
  langfuse_url?: string;
  created_at: string;
}

export interface DashboardScore {
  id: string;
  name: string;
  value: number;
  session_id?: string;
  trace_id?: string;
  comment?: string;
  timestamp?: string;
}

export function getDashboardEscalations(
  token: string,
  limit = 50
): Promise<DashboardEscalation[]> {
  return getJSON<DashboardEscalation[]>(
    `/api/dashboard/escalations?limit=${limit}`,
    authHeader(token)
  );
}

export function getDashboardScores(
  token: string,
  days = 30
): Promise<DashboardScore[]> {
  return getJSON<DashboardScore[]>(
    `/api/dashboard/scores?days=${days}`,
    authHeader(token)
  );
}
