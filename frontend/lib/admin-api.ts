const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") ?? "http://localhost:7861";

const ADMIN_TOKEN = process.env.NEXT_PUBLIC_ADMIN_DEV_TOKEN ?? "";

export interface AdminUser {
  id: string;
  email: string;
  full_name: string;
  phone?: string;
  status: string;
  roles: string[];
  permissions: string[];
}

export interface AdminTodayMetrics {
  total_orders: number;
  revenue: number;
  average_order_value: number;
  pending_orders: number;
  preparing_orders: number;
  completed_orders: number;
  cancelled_orders: number;
  refund_requests: number;
}

export interface AdminRecentOrder {
  order_no: string;
  customer_name: string;
  total: number;
  payment_mode: string;
  status: string;
  created_at: string;
}

export interface AdminTopPizza {
  name: string;
  quantity: number;
}

export interface AdminPeakHour {
  hour?: number;
  orders?: number;
  revenue?: number;
}

export interface AdminDashboard {
  today: AdminTodayMetrics;
  recent_orders: AdminRecentOrder[];
  top_pizzas: AdminTopPizza[];
  peak_hour: AdminPeakHour;
  low_inventory_alerts: number;
  ai_summary: Array<{
    title: string;
    value: string;
    summary: string;
    detail: string;
  }>;
  ai_insights: string[];
}

export interface AdminDashboardResponse {
  ok: boolean;
  user: AdminUser;
  dashboard: AdminDashboard;
}

export interface AdminMenuItem {
  id: string;
  item_code: string;
  category: string;
  category_name: string;
  name: string;
  price: number;
  is_available: boolean;
  image_url?: string;
  updated_at: string;
}

export interface AdminMenuCategory {
  id: string;
  code: string;
  name: string;
  sort_order: number;
}

export interface AdminPricing {
  gst_rate_percent: number;
  discount_rate_percent: number;
  discount_quantity_threshold: number;
  discount_rules: Array<{
    id: string;
    name: string;
    coupon_code?: string;
    description?: string;
    discount_percent: number;
    threshold_amount: number;
    min_quantity?: number;
    no_min_quantity?: boolean;
    no_min_value?: boolean;
    start_date?: string;
    end_date?: string;
    is_active: boolean;
  }>;
}

export interface AdminFestivalCouponSuggestion {
  festival_date: string;
  name: string;
  coupon_theme: string;
  suggested_discount_percent: number;
  suggested_threshold_amount: number;
  suggested_coupon_code: string;
  suggestion: string;
  source_type?: "calendar" | "analytics";
}

export interface AdminPriceHistoryEntry {
  id: string;
  menu_item_id: string;
  item_code: string;
  menu_item_name: string;
  category: string;
  category_name: string;
  old_price?: number;
  new_price: number;
  reason?: string;
  changed_at: string;
  changed_by_name?: string;
}

export interface AdminStaffMember {
  id: string;
  user_id?: string;
  employee_code: string;
  role_name: string;
  is_active: boolean;
  full_name: string;
  email: string;
  phone?: string;
  status: string;
}

export interface AdminAuditLog {
  id: string;
  action_type: string;
  entity_type: string;
  entity_id?: string;
  old_value?: unknown;
  new_value?: unknown;
  reason?: string;
  performed_at: string;
  performed_by_name?: string;
}

export interface AdminOrder {
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
  subtotal: number;
  discount: number;
  gst: number;
  total: number;
  payment_mode: string;
  payment_status: string;
  amount_paid: number;
  status: string;
  source: string;
  created_at: string;
}

export interface AdminOrderStatusHistory {
  id: string;
  old_status?: string;
  new_status: string;
  reason?: string;
  changed_at: string;
  changed_by_name?: string;
}

export interface AdminOrderInventoryDeduction {
  id: string;
  ingredient_name: string;
  unit: string;
  quantity: number;
  deducted_at: string;
  deducted_by_name?: string;
}

export interface AdminOrderDetail {
  ok: boolean;
  order: AdminOrder;
  status_history: AdminOrderStatusHistory[];
  payments: Array<{
    id: string;
    payment_mode: string;
    payment_status: string;
    amount_paid: number;
    transaction_reference?: string;
    paid_at?: string;
    created_at: string;
  }>;
  refunds: Array<{
    id: string;
    amount: number;
    reason: string;
    status: string;
    requested_at: string;
    decided_at?: string;
  }>;
  inventory_deductions: AdminOrderInventoryDeduction[];
}

export interface AdminPayment {
  id: string;
  order_no: string;
  customer_name: string;
  payment_mode: string;
  payment_status: string;
  amount_paid: number;
  transaction_reference?: string;
  paid_at?: string;
  created_at: string;
}

export interface AdminRefund {
  id: string;
  order_no: string;
  customer_name: string;
  amount: number;
  reason: string;
  status: string;
  requested_at: string;
  decided_at?: string;
}

export interface AdminInventoryRequest {
  id: string;
  ingredient_name: string;
  unit?: string;
  requested_quantity: number;
  status: string;
  reason?: string;
  created_at: string;
  decided_at?: string;
  updated_at?: string;
}

export interface AdminIngredient {
  id: string;
  name: string;
  unit: string;
  stock_quantity: number;
  reorder_threshold: number;
  is_low_stock: boolean;
  is_active: boolean;
  updated_at: string;
}

export interface AdminStockTransaction {
  id: string;
  ingredient_name: string;
  transaction_type: string;
  quantity: number;
  old_quantity: number;
  new_quantity: number;
  reason?: string;
  performed_at: string;
}

export interface AdminRecipeIngredient {
  id: string;
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  quantity_per_unit: number;
}

export interface AdminMenuRecipe {
  menu_item_id: string;
  item_code: string;
  menu_item_name: string;
  category: string;
  category_name: string;
  ingredients: AdminRecipeIngredient[];
}

export interface AdminRecipeCoverage {
  total_menu_items: number;
  mapped_menu_items: number;
  unmapped_menu_items: number;
  coverage_percent: number;
}

export interface AdminAnalytics {
  totals: {
    total_orders: number;
    revenue: number;
    average_order_value: number;
    gst: number;
    discount: number;
    cancelled_orders: number;
    refund_orders: number;
  };
  daily_revenue: Array<{ date: string; orders: number; revenue: number }>;
  hourly_revenue: Array<{ hour: number; orders: number; revenue: number }>;
  top_items: Array<{ name: string; quantity: number; revenue: number }>;
  top_toppings: Array<{ name: string; quantity: number }>;
  repeat_customers: Array<{
    customer_phone: string;
    customer_name: string;
    orders: number;
    revenue: number;
  }>;
  revenue_by_payment_mode: Array<{
    payment_mode: string;
    orders: number;
    revenue: number;
  }>;
  orders_by_source: Array<{ source: string; orders: number; revenue: number }>;
  weekday_trend: Array<{
    weekday: string;
    weekday_no: number;
    orders: number;
    revenue: number;
  }>;
  discount_impact: {
    discount: number;
    discount_to_revenue_percent: number;
  };
  refund_rate: number;
  cancellation_rate: number;
  recommendation_impact: AdminRecommendationImpact;
}

export interface AdminAiInsight {
  type: string;
  text: string;
  metrics: Record<string, unknown>;
}

export interface AdminAiInsightLog {
  id: string;
  provider: string;
  insight_type: string;
  insight_text: string;
  created_at: string;
}

export interface AdminAiProviderStatus {
  provider: string;
  configured: boolean;
  fallback_provider: string;
  error?: string;
}

export interface AdminForecast {
  method: string;
  baseline: { avg_orders: number; avg_revenue: number };
  weekday_profile?: Array<{
    weekday: string;
    weekday_no: number;
    avg_orders: number;
    avg_revenue: number;
  }>;
  hourly_profile?: Array<{ hour: number; orders: number; revenue: number }>;
  campaign_activity?: {
    active_campaigns: number;
    avg_discount_percent: number;
  };
  forecast: Array<{
    forecast_date: string;
    predicted_orders: number;
    predicted_revenue: number;
    weekend_flag: boolean;
    holiday_flag?: boolean;
    confidence?: string;
    rationale?: string;
  }>;
}

export interface AdminAiBusinessIntelligence {
  provider: string;
  provider_status: AdminAiProviderStatus;
  source: string;
  demand_forecast: AdminForecast;
  peak_rush: {
    top_hours: Array<{ hour: number; orders: number; revenue: number }>;
    busiest_hour?: { hour?: number; orders?: number; revenue?: number };
    rush_window?: string;
    recommendation: string;
  };
  inventory_forecast: Array<{
    id: string;
    name: string;
    unit: string;
    stock_quantity: number;
    reorder_threshold: number;
    avg_daily_usage: number;
    forecast_days: number;
    projected_stock: number;
    days_until_stockout?: number;
    risk: "low" | "medium" | "high";
    suggested_reorder_quantity: number;
  }>;
  staff_scheduling: Array<{
    hour: number;
    window: string;
    orders: number;
    suggested_staff: number;
    role_mix: string;
  }>;
  smart_upsells: Array<{
    recommendation_key: string;
    trigger_item: string;
    recommendation: string;
    reason: string;
    estimated_value: number;
    source_metrics: Record<string, unknown>;
  }>;
  coupon_recommendations: Array<{
    recommendation_key: string;
    name: string;
    coupon: string;
    discount_percent: number;
    threshold_amount: number;
    reason: string;
    estimated_value: number;
    source_metrics: Record<string, unknown>;
  }>;
  churn_risks: Array<{
    customer_phone: string;
    customer_name: string;
    orders: number;
    revenue: number;
    last_order_date: string;
    days_since_last_order: number;
    risk: "medium" | "high";
    suggested_action: string;
  }>;
  ltv_recommendations: Array<{
    customer_name: string;
    customer_phone: string;
    estimated_ltv: number;
    recommended_discount_percent: number;
    reason: string;
    short_term_loss_note: string;
  }>;
  sentiment_analysis: {
    status: string;
    source: string;
    window_days: number;
    totals: {
      total: number;
      positive: number;
      neutral: number;
      negative: number;
      positive_rate: number;
      negative_rate: number;
      average_rating: number;
      average_sentiment_score: number;
    };
    top_topics: Array<{
      topic: string;
      mentions: number;
    }>;
    recent: Array<{
      id: string;
      customer_name?: string;
      customer_phone?: string;
      channel: string;
      rating: number;
      feedback_text: string;
      sentiment_label: "positive" | "neutral" | "negative";
      sentiment_score: number;
      topics: string[];
      created_at: string;
    }>;
    recommendation: string;
  };
  voice_ordering_readiness: {
    status: string;
    channels: string[];
    tracked_order_source: string;
    notes: string[];
  };
  safety_rules: string[];
  recommendation_impact: AdminRecommendationImpact;
}

export interface AdminCustomerFeedback {
  id: string;
  order_id?: string;
  customer_name?: string;
  customer_phone?: string;
  channel: string;
  rating: number;
  feedback_text: string;
  sentiment_label: "positive" | "neutral" | "negative";
  sentiment_score: number;
  topics: string[];
  source_metadata?: Record<string, unknown>;
  created_at: string;
}

export interface AdminRecommendationEvent {
  id: string;
  recommendation_type: string;
  recommendation_key: string;
  title: string;
  detail?: string;
  status: "presented" | "accepted" | "rejected";
  estimated_value: number;
  source_metrics: Record<string, unknown>;
  related_entity_type?: string;
  related_entity_id?: string;
  created_at: string;
}

export interface AdminRecommendationImpact {
  totals: {
    total: number;
    accepted: number;
    rejected: number;
    accepted_estimated_value: number;
    acceptance_rate: number;
  };
  by_type: Array<{
    recommendation_type: string;
    total: number;
    accepted: number;
    rejected: number;
    accepted_estimated_value: number;
  }>;
  recent: AdminRecommendationEvent[];
}

export interface AdminRevenueScenario {
  method: string;
  inputs: {
    menu_price_adjustment_percent: number;
    ingredient_price_increase_percent: number;
    rent_increase_amount: number;
    other_fixed_cost_increase_amount: number;
    discount_change_percent: number;
  };
  baseline: {
    orders: number;
    revenue: number;
    average_order_value: number;
    estimated_food_cost: number;
    estimated_fixed_cost: number;
    discount: number;
    estimated_margin: number;
  };
  projected: {
    revenue: number;
    estimated_food_cost: number;
    estimated_fixed_cost: number;
    discount: number;
    estimated_margin: number;
    margin_delta: number;
  };
  recommended_actions: string[];
  safety_note: string;
}

export interface AdminNotificationLog {
  id: string;
  channel: string;
  provider: string;
  recipient: string;
  template_name: string;
  payload: Record<string, unknown>;
  status: string;
  error_message?: string;
  related_entity_type?: string;
  related_entity_id?: string;
  created_at: string;
  sent_at?: string;
  created_by_name?: string;
}

export interface AdminSetting {
  key: string;
  value: { value: string | number | boolean };
  updated_at: string;
}

export interface AdminRole {
  id: string;
  name: string;
  description?: string;
}

export async function getAdminDashboard(): Promise<AdminDashboardResponse> {
  return adminGet<AdminDashboardResponse>("/admin/dashboard");
}

export async function getAdminMenu(): Promise<{
  ok: boolean;
  menu: { items: AdminMenuItem[]; categories: AdminMenuCategory[] };
}> {
  return adminGet("/admin/menu");
}

export interface AdminOrderFilters {
  status_filter?: string;
  payment_mode?: string;
  payment_status?: string;
  date_from?: string;
  date_to?: string;
  customer_search?: string;
  source?: string;
  total_min?: number;
  total_max?: number;
  limit?: number;
}

export async function getAdminOrders(
  filters: AdminOrderFilters = {}
): Promise<{ ok: boolean; orders: AdminOrder[] }> {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  });
  const query = params.toString();
  return adminGet(`/admin/orders${query ? `?${query}` : ""}`);
}

export async function getAdminOrderDetail(orderId: string): Promise<AdminOrderDetail> {
  return adminGet(`/admin/orders/${orderId}`);
}

export async function updateAdminOrderStatus(
  orderId: string,
  status: string,
  reason?: string
): Promise<{ ok: boolean; order: Pick<AdminOrder, "id" | "order_no" | "status"> }> {
  return adminJSON(`/admin/orders/${orderId}/status`, "PUT", { status, reason });
}

export async function updateAdminMenuItem(
  item: Pick<AdminMenuItem, "id" | "name" | "price" | "is_available"> & {
    image_url?: string | null;
    reason?: string;
  }
): Promise<{ ok: boolean; item: AdminMenuItem }> {
  return adminJSON(`/admin/menu/${item.id}`, "PUT", {
    name: item.name,
    price: item.price,
    is_available: item.is_available,
    image_url: item.image_url,
    reason: item.reason,
  });
}

export async function createAdminMenuItem(payload: {
  category: string;
  item_code: string;
  name: string;
  price: number;
  is_available: boolean;
  reason?: string;
}): Promise<{ ok: boolean; item: AdminMenuItem }> {
  return adminJSON("/admin/menu", "POST", payload);
}

export async function createAdminMenuCategory(payload: {
  code: string;
  name: string;
  sort_order?: number;
  reason?: string;
}): Promise<{ ok: boolean; category: AdminMenuCategory }> {
  return adminJSON("/admin/menu/categories", "POST", payload);
}

export async function deleteAdminMenuItem(
  itemId: string
): Promise<{ ok: boolean; item: AdminMenuItem }> {
  return adminJSON(`/admin/menu/${itemId}`, "DELETE", {});
}

export async function deleteAdminMenuCategory(
  categoryId: string
): Promise<{ ok: boolean; category: AdminMenuCategory }> {
  return adminJSON(`/admin/menu/categories/${categoryId}`, "DELETE", {});
}

export async function getAdminPricing(): Promise<{ ok: boolean; pricing: AdminPricing }> {
  return adminGet("/admin/pricing");
}

export async function getAdminPriceHistory(
  limit = 100
): Promise<{ ok: boolean; price_history: AdminPriceHistoryEntry[] }> {
  return adminGet(`/admin/pricing/price-history?limit=${limit}`);
}

export async function getFestivalCouponSuggestions(limit = 6, year?: number): Promise<{
  ok: boolean;
  suggestions: AdminFestivalCouponSuggestion[];
}> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (year) params.set("year", String(year));
  return adminGet(`/admin/pricing/festival-coupon-suggestions?${params.toString()}`);
}

export async function updateAdminPricing(
  pricing: Omit<AdminPricing, "discount_rules"> & { reason?: string }
): Promise<{ ok: boolean; pricing: AdminPricing }> {
  return adminJSON("/admin/pricing", "PUT", pricing);
}

export async function upsertAdminDiscount(rule: {
  id?: string;
  name: string;
  coupon_code?: string;
  description?: string;
  discount_percent: number;
  threshold_amount: number;
  min_quantity?: number;
  no_min_quantity?: boolean;
  no_min_value?: boolean;
  start_date?: string;
  end_date?: string;
  is_active: boolean;
  reason?: string;
}): Promise<{ ok: boolean; discount: AdminPricing["discount_rules"][number] }> {
  return adminJSON("/admin/discounts", "PUT", rule);
}

export async function getAdminStaff(): Promise<{
  ok: boolean;
  staff: AdminStaffMember[];
  roles: AdminRole[];
}> {
  return adminGet("/admin/staff");
}

export async function createAdminStaff(payload: {
  full_name: string;
  email: string;
  phone?: string;
  role_name: string;
  employee_code?: string;
  reason?: string;
}): Promise<{ ok: boolean; staff: AdminStaffMember }> {
  return adminJSON("/admin/staff", "POST", payload);
}

export async function updateAdminStaff(
  staffId: string,
  payload: {
    full_name: string;
    phone?: string;
    role_name: string;
    is_active: boolean;
    reason?: string;
  }
): Promise<{ ok: boolean; staff: AdminStaffMember }> {
  return adminJSON(`/admin/staff/${staffId}`, "PUT", payload);
}

export async function deleteAdminStaff(
  staffId: string
): Promise<{ ok: boolean; staff: AdminStaffMember }> {
  return adminJSON(`/admin/staff/${staffId}`, "DELETE", {});
}

export async function getAdminPayments(): Promise<{
  ok: boolean;
  payments: AdminPayment[];
  refunds: AdminRefund[];
}> {
  return adminGet("/admin/payments");
}

export async function requestAdminRefund(
  orderId: string,
  amount: number,
  reason: string
): Promise<{ ok: boolean; refund: AdminRefund }> {
  return adminJSON("/admin/refunds", "POST", {
    order_id: orderId,
    amount,
    reason,
  });
}

export async function decideAdminRefund(
  refundId: string,
  status: "Approved" | "Rejected" | "Paid",
  reason?: string
): Promise<{ ok: boolean; refund: AdminRefund }> {
  return adminJSON(`/admin/refunds/${refundId}/decision`, "PUT", { status, reason });
}

export async function getAdminInventory(): Promise<{
  ok: boolean;
  inventory: {
    ingredients: AdminIngredient[];
    transactions: AdminStockTransaction[];
    requests: AdminInventoryRequest[];
    recipes: AdminMenuRecipe[];
    recipe_coverage: AdminRecipeCoverage;
  };
}> {
  return adminGet("/admin/inventory");
}

export async function createAdminIngredient(payload: {
  name: string;
  unit: string;
  stock_quantity: number;
  reorder_threshold: number;
  reason?: string;
}): Promise<{ ok: boolean; ingredient: AdminIngredient }> {
  return adminJSON("/admin/inventory/ingredients", "POST", payload);
}

export async function updateAdminIngredient(
  ingredientId: string,
  payload: {
    name: string;
    unit: string;
    reorder_threshold: number;
    is_active: boolean;
    reason?: string;
  }
): Promise<{ ok: boolean; ingredient: AdminIngredient }> {
  return adminJSON(`/admin/inventory/ingredients/${ingredientId}`, "PUT", payload);
}

export async function adjustAdminStock(
  ingredientId: string,
  transactionType: string,
  quantity: number,
  reason?: string
): Promise<{ ok: boolean; ingredient: AdminIngredient }> {
  return adminJSON(`/admin/inventory/${ingredientId}/adjust`, "POST", {
    transaction_type: transactionType,
    quantity,
    reason,
  });
}

export async function createAdminInventoryRequest(payload: {
  ingredient_id: string;
  requested_quantity: number;
  reason: string;
}): Promise<{ ok: boolean; request: AdminInventoryRequest }> {
  return adminJSON("/admin/inventory/requests", "POST", payload);
}

export async function decideAdminInventoryRequest(
  requestId: string,
  status: "Approved" | "Rejected",
  reason?: string
): Promise<{ ok: boolean; request: AdminInventoryRequest }> {
  return adminJSON(`/admin/inventory/requests/${requestId}/decision`, "PUT", {
    status,
    reason,
  });
}

export async function upsertAdminRecipeMapping(payload: {
  menu_item_id: string;
  ingredient_id: string;
  quantity_per_unit: number;
  reason?: string;
}): Promise<{ ok: boolean; recipe: AdminRecipeIngredient }> {
  return adminJSON("/admin/inventory/recipes", "PUT", payload);
}

export async function deleteAdminRecipeMapping(
  recipeId: string
): Promise<{ ok: boolean; recipe: AdminRecipeIngredient }> {
  return adminJSON(`/admin/inventory/recipes/${recipeId}`, "DELETE", {});
}

export async function getAdminAuditLogs(): Promise<{
  ok: boolean;
  audit_logs: AdminAuditLog[];
}> {
  return adminGet("/admin/audit-logs");
}

export async function getAdminAnalytics(filters: {
  date_from?: string;
  date_to?: string;
} = {}): Promise<{
  ok: boolean;
  analytics: AdminAnalytics;
}> {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const query = params.toString();
  return adminGet(`/admin/analytics${query ? `?${query}` : ""}`);
}

export async function getAdminAiInsights(): Promise<{
  ok: boolean;
  provider: string;
  fallback_used: boolean;
  provider_error?: string;
  insights: AdminAiInsight[];
  logs: AdminAiInsightLog[];
}> {
  return adminGet("/admin/ai/insights");
}

export async function getAdminAiProviderStatus(): Promise<{
  ok: boolean;
  provider_status: AdminAiProviderStatus;
}> {
  return adminGet("/admin/ai/provider-status");
}

export async function getAdminAiInsightLogs(filters: {
  provider?: string;
  insight_type?: string;
  limit?: number;
} = {}): Promise<{ ok: boolean; logs: AdminAiInsightLog[] }> {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  });
  const query = params.toString();
  return adminGet(`/admin/ai/insight-logs${query ? `?${query}` : ""}`);
}

export async function createAdminForecast(days = 7): Promise<{
  ok: boolean;
  forecast: AdminForecast;
}> {
  return adminJSON("/admin/ai/forecast", "POST", { days });
}

export async function getAdminAiBusinessIntelligence(days = 7): Promise<{
  ok: boolean;
  ai: AdminAiBusinessIntelligence;
}> {
  return adminGet(`/admin/ai/business-intelligence?days=${days}`);
}

export async function simulateAdminRevenueScenario(payload: {
  menu_price_adjustment_percent: number;
  ingredient_price_increase_percent: number;
  rent_increase_amount: number;
  other_fixed_cost_increase_amount: number;
  discount_change_percent: number;
}): Promise<{ ok: boolean; scenario: AdminRevenueScenario }> {
  return adminJSON("/admin/ai/revenue-scenario", "POST", payload);
}

export async function recordAdminRecommendationEvent(payload: {
  recommendation_type: "upsell" | "coupon" | "inventory" | "staff" | "churn";
  recommendation_key: string;
  title: string;
  detail?: string;
  status: "presented" | "accepted" | "rejected";
  estimated_value?: number;
  source_metrics?: Record<string, unknown>;
  related_entity_type?: string;
  related_entity_id?: string;
}): Promise<{ ok: boolean; event: AdminRecommendationEvent }> {
  return adminJSON("/admin/ai/recommendation-events", "POST", payload);
}

export async function getAdminRecommendationImpact(): Promise<{
  ok: boolean;
  impact: AdminRecommendationImpact;
}> {
  return adminGet("/admin/ai/recommendation-impact");
}

export async function getAdminCustomerFeedback(limit = 50): Promise<{
  ok: boolean;
  summary: AdminAiBusinessIntelligence["sentiment_analysis"];
  feedback: AdminCustomerFeedback[];
}> {
  return adminGet(`/admin/ai/customer-feedback?limit=${limit}`);
}

export async function createAdminCustomerFeedback(payload: {
  order_id?: string;
  customer_name?: string;
  customer_phone?: string;
  channel?: string;
  rating: number;
  feedback_text: string;
  source_metadata?: Record<string, unknown>;
}): Promise<{ ok: boolean; feedback: AdminCustomerFeedback }> {
  return adminJSON("/admin/ai/customer-feedback", "POST", payload);
}

export async function getAdminNotifications(): Promise<{
  ok: boolean;
  notifications: { logs: AdminNotificationLog[] };
}> {
  return adminGet("/admin/notifications");
}

export async function createMockNotification(payload: {
  channel: string;
  recipient: string;
  template_name: string;
  payload: Record<string, unknown>;
}): Promise<{ ok: boolean; notification: AdminNotificationLog }> {
  return adminJSON("/admin/notifications/mock", "POST", payload);
}

export async function getAdminSettings(): Promise<{
  ok: boolean;
  settings: AdminSetting[];
}> {
  return adminGet("/admin/settings");
}

export async function updateAdminSettings(
  values: Record<string, string>,
  reason?: string
): Promise<{ ok: boolean; settings: AdminSetting[] }> {
  return adminJSON("/admin/settings", "PUT", { values, reason });
}

export async function uploadAdminMenuItemPhoto(
  _itemId: string,
  file: File
): Promise<{ ok: boolean; image_url: string; error?: string }> {
  if (!ADMIN_TOKEN) {
    throw new Error("Admin dev token is missing in frontend/.env.local.");
  }

  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${API_BASE}/api/admin/menu/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    body: formData,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.detail ?? `Admin upload failed (${res.status}).`);
  }
  return body as { ok: boolean; image_url: string; error?: string };
}

async function adminGet<T>(path: string): Promise<T> {
  if (!ADMIN_TOKEN) {
    throw new Error("Admin dev token is missing in frontend/.env.local.");
  }
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Admin request failed (${res.status}).`);
  }
  return res.json() as Promise<T>;
}

async function adminJSON<T>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body: unknown
): Promise<T> {
  if (!ADMIN_TOKEN) {
    throw new Error("Admin dev token is missing in frontend/.env.local.");
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const response = await res.json().catch(() => null);
    throw new Error(response?.detail ?? `Admin request failed (${res.status}).`);
  }
  return res.json() as Promise<T>;
}
