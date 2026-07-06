"use client";

import { create } from "zustand";

import {
  type CartLinePayload,
  type CartTotals,
  getMenu,
  type Menu,
  type MenuItem,
  type PricedLine,
  priceCart,
} from "@/lib/api";

export const MAX_TOPPINGS = Number.POSITIVE_INFINITY;

/** One committed pizza in the cart (a distinct base + pizza + toppings combo). */
export interface CartLine {
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

export function toPayload(line: CartLine): CartLinePayload {
  return {
    item_id: line.item.id,
    item_type: line.item.item_type || "generic",
    size_code: line.size_code,
    crust_id: line.crust?.id || null,
    topping_ids: line.toppings.map((t) => t.id),
    quantity: line.quantity,
  };
}

interface MenuState {
  menu: Menu | null;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;

  cart: CartLine[];
  totals: CartTotals | null;
  pricedLines: PricedLine[] | null;
  pricing: boolean;

  // Cart sheet visibility — lifted to the store so the global header cart icon
  // can open it from any customer screen (not just the Menu tab).
  cartOpen: boolean;
  openCart: () => void;
  closeCart: () => void;

  loadMenu: () => Promise<void>;
  addLine: (line: Omit<CartLine, "id">) => void;
  setQuantity: (id: string, quantity: number) => void;
  removeLine: (id: string) => void;
  clearCart: () => void;
  reprice: () => Promise<void>;
}

export const useMenuStore = create<MenuState>((set, get) => ({
  menu: null,
  status: "idle",
  error: null,

  cart: [],
  totals: null,
  pricedLines: null,
  pricing: false,

  cartOpen: false,
  openCart: () => set({ cartOpen: true }),
  closeCart: () => set({ cartOpen: false }),

  loadMenu: async () => {
    if (get().status === "loading" || get().status === "ready") return;
    set({ status: "loading", error: null });
    try {
      const menu = await getMenu();
      if (menu.error) {
        set({ status: "error", error: menu.error });
        return;
      }
      set({ menu, status: "ready" });
    } catch (err) {
      set({
        status: "error",
        error: err instanceof Error ? err.message : "Couldn't load the menu.",
      });
    }
  },

  addLine: (line) => {
    set((s) => ({ cart: [...s.cart, { ...line, id: newId() }] }));
    void get().reprice();
  },

  setQuantity: (id, quantity) => {
    const q = Math.min(10, Math.max(1, Math.round(quantity)));
    set((s) => ({
      cart: s.cart.map((l) => (l.id === id ? { ...l, quantity: q } : l)),
    }));
    void get().reprice();
  },

  removeLine: (id) => {
    set((s) => ({ cart: s.cart.filter((l) => l.id !== id) }));
    void get().reprice();
  },

  clearCart: () => set({ cart: [], totals: null, pricedLines: null }),

  reprice: async () => {
    const { cart } = get();
    if (cart.length === 0) {
      set({ totals: null, pricedLines: null, pricing: false });
      return;
    }
    set({ pricing: true });
    try {
      const res = await priceCart(cart.map(toPayload));
      if (res.ok && res.cart && res.lines) {
        set({ totals: res.cart, pricedLines: res.lines, pricing: false });
      } else {
        set({ pricing: false });
      }
    } catch {
      set({ pricing: false });
    }
  },
}));
