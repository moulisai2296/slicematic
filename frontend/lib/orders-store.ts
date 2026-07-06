"use client";

import { create } from "zustand";

import { getOrdersByPhone, type UserOrder } from "@/lib/api";

/**
 * Orders for the Orders tab, loaded from the DB (source of truth for API and
 * chat/voice orders) via GET /api/orders?phone= — the profile's phone is the
 * interim per-user filter until real auth lands (then: user_id). Status is
 * now the REAL kitchen/delivery pipeline status (db/orders.py:
 * ORDER_STATUS_SEQUENCE), refetched on a poll so it updates live without a
 * manual refresh — no more client-side simulation from elapsed time.
 */

// Pickup orders (no delivery_address) end at "ready_for_pickup" — no rider
// ever touches them, so the delivery-only steps don't apply.
export const DELIVERY_STEPS = [
  "Received",
  "Preparing",
  "Ready for pickup",
  "Out for delivery",
  "Delivered",
] as const;

export const PICKUP_STEPS = ["Received", "Preparing", "Ready for pickup", "Delivered"] as const;

export type OrderStep = (typeof DELIVERY_STEPS)[number];

const STATUS_INDEX: Record<string, number> = {
  received: 0,
  preparing: 1,
  ready_for_pickup: 2,
  out_for_delivery: 3,
  delivered: 4,
};

/** Real status -> step index + label, for whichever step list applies
 *  (delivery orders get all 5 steps; pickup orders cap at "Ready for pickup"). */
export function orderStatus(order: Pick<UserOrder, "status" | "delivery_address">) {
  const steps = order.delivery_address ? DELIVERY_STEPS : PICKUP_STEPS;
  const rawIndex = STATUS_INDEX[order.status] ?? 0;
  const index = Math.min(rawIndex, steps.length - 1);
  return { index, step: steps[index], steps };
}

interface OrdersState {
  orders: UserOrder[];
  loading: boolean;
  error: string | null;
  load: (phone: string) => Promise<void>;
}

export const useOrdersStore = create<OrdersState>((set) => ({
  orders: [],
  loading: false,
  error: null,

  load: async (phone: string) => {
    set({ loading: true, error: null });
    try {
      const res = await getOrdersByPhone(phone);
      if (res.ok && res.orders) {
        set({ orders: res.orders, loading: false });
      } else {
        const msg = res.errors ? Object.values(res.errors)[0] : null;
        set({ loading: false, error: msg ?? "Couldn't load your orders." });
      }
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Couldn't load your orders.",
      });
    }
  },
}));
