"use client";

import { create } from "zustand";

import {
  type CartLinePayload,
  type CartTotals,
  getConfig,
  getMenu,
  type Menu,
  type MenuItem,
  type PricedLine,
  priceCart,
} from "@/lib/api";

/**
 * Staff kiosk POS store — the (staff) surface's own state slice.
 *
 * Deliberately independent from lib/menu-store.ts (the customer slice) per the
 * surface-isolation seam in CLAUDE.md: staff state can evolve (held orders,
 * shift info, …) without touching — or being able to break — the customer app.
 * All money is server-priced via /api/cart/price; nothing is computed here.
 */

export const MAX_TOPPINGS = Number.POSITIVE_INFINITY;

/** POS flow: details -> build -> pay -> done. */
export type PosStep = "details" | "build" | "payment" | "done";

/** How the walk-in is being served — staff-only, frontend-only (not sent to
 *  the API; core/ and the DB schema are untouched). Dine In is the default. */
export type OrderType = "dine_in" | "takeaway";

/** One committed item on the ticket (generic item + size + crust + toppings + qty). */
export interface TicketLine {
  id: string;
  item: MenuItem;
  size_code: string | null;
  crust: MenuItem | null;
  toppings: MenuItem[];
  quantity: number;
}

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

export function toPayload(line: TicketLine): CartLinePayload {
  return {
    item_id: line.item.id,
    item_type: line.item.item_type || "generic",
    size_code: line.size_code,
    crust_id: line.crust?.id ?? null,
    topping_ids: line.toppings.map((t) => t.id),
    quantity: line.quantity,
  };
}

interface StaffPosState {
  // Flow
  step: PosStep;
  setStep: (step: PosStep) => void;

  // Customer details, validated by the components and core rules.
  // with the same core rules; re-validated server-side at checkout).
  customerName: string;
  customerPhone: string;
  setCustomer: (name: string, phone: string) => void;

  // Order type — required before the build step; defaults to Dine In.
  orderType: OrderType;
  setOrderType: (type: OrderType) => void;

  // Menu
  menu: Menu | null;
  menuStatus: "idle" | "loading" | "ready" | "error";
  menuError: string | null;
  loadMenu: () => Promise<void>;

  // Live bulk-discount rule (/api/config — the admin can change it at runtime;
  // the UI reads it so badges/hints never show a stale rate). Server defaults.
  discountRate: number;
  discountThreshold: number;

  // Ticket (cart)
  ticket: TicketLine[];
  totals: CartTotals | null;
  pricedLines: PricedLine[] | null;
  pricing: boolean;
  addLine: (line: Omit<TicketLine, "id">) => void;
  setQuantity: (id: string, quantity: number) => void;
  removeLine: (id: string) => void;
  clearTicket: () => void;
  reprice: () => Promise<void>;

  // Completed order (confirmation screen)
  placedOrderNo: string | null;
  placedTotal: number | null;
  setPlaced: (orderNo: string, total: number) => void;

  /** Full reset for the next walk-in customer. */
  newOrder: () => void;
}

export const useStaffPos = create<StaffPosState>((set, get) => ({
  step: "details",
  setStep: (step) => set({ step }),

  customerName: "",
  customerPhone: "",
  setCustomer: (name, phone) =>
    set({ customerName: name, customerPhone: phone }),

  orderType: "dine_in",
  setOrderType: (type) => set({ orderType: type }),

  menu: null,
  menuStatus: "idle",
  menuError: null,

  discountRate: 0.1,
  discountThreshold: 5,

  loadMenu: async () => {
    const { menuStatus } = get();
    if (menuStatus === "loading" || menuStatus === "ready") return;
    set({ menuStatus: "loading", menuError: null });
    // Best-effort config refresh — pricing itself is always server-computed,
    // this only keeps the discount badge/hint copy honest.
    getConfig()
      .then((cfg) =>
        set({
          discountRate: cfg.discount_rate,
          discountThreshold: cfg.discount_threshold,
        })
      )
      .catch(() => {});
    try {
      const menu = await getMenu();
      if (menu.error) {
        set({ menuStatus: "error", menuError: menu.error });
        return;
      }
      set({ menu, menuStatus: "ready" });
    } catch (err) {
      set({
        menuStatus: "error",
        menuError:
          err instanceof Error ? err.message : "Couldn't load the menu.",
      });
    }
  },

  ticket: [],
  totals: null,
  pricedLines: null,
  pricing: false,

  addLine: (line) => {
    set((s) => ({ ticket: [...s.ticket, { ...line, id: newId() }] }));
    void get().reprice();
  },

  setQuantity: (id, quantity) => {
    const q = Math.min(10, Math.max(1, Math.round(quantity)));
    set((s) => ({
      ticket: s.ticket.map((l) => (l.id === id ? { ...l, quantity: q } : l)),
    }));
    void get().reprice();
  },

  removeLine: (id) => {
    set((s) => ({ ticket: s.ticket.filter((l) => l.id !== id) }));
    void get().reprice();
  },

  clearTicket: () => set({ ticket: [], totals: null, pricedLines: null }),

  reprice: async () => {
    const { ticket } = get();
    if (ticket.length === 0) {
      set({ totals: null, pricedLines: null, pricing: false });
      return;
    }
    set({ pricing: true });
    try {
      const res = await priceCart(ticket.map(toPayload));
      if (res.ok && res.cart && res.lines) {
        set({ totals: res.cart, pricedLines: res.lines, pricing: false });
      } else {
        set({ pricing: false });
      }
    } catch {
      set({ pricing: false });
    }
  },

  placedOrderNo: null,
  placedTotal: null,
  setPlaced: (orderNo, total) =>
    set({ placedOrderNo: orderNo, placedTotal: total, step: "done" }),

  newOrder: () =>
    set({
      step: "details",
      customerName: "",
      customerPhone: "",
      orderType: "dine_in",
      ticket: [],
      totals: null,
      pricedLines: null,
      pricing: false,
      placedOrderNo: null,
      placedTotal: null,
    }),
}));
