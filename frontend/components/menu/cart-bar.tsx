"use client";

import { ShoppingBag } from "lucide-react";

import { useMenuStore } from "@/lib/menu-store";
import { formatINR, roundFinalAmount } from "@/lib/utils";

/** Floating "view order" bar — sits above the tab bar when the cart is filled. */
export function CartBar() {
  const cart = useMenuStore((s) => s.cart);
  const totals = useMenuStore((s) => s.totals);
  const openCart = useMenuStore((s) => s.openCart);

  if (cart.length === 0) return null;
  const count = cart.reduce((n, l) => n + l.quantity, 0);

  return (
    <div className="pointer-events-none sticky bottom-0 z-30 px-4 pb-3">
      <button
        type="button"
        onClick={openCart}
        className="pointer-events-auto mx-auto flex w-full max-w-2xl cursor-pointer items-center justify-between gap-3 rounded-xl bg-primary px-4 py-3 text-primary-foreground shadow-lg transition-transform hover:scale-[1.01] active:scale-100"
      >
        <span className="flex items-center gap-2 font-medium">
          <span className="relative grid size-8 place-items-center rounded-full bg-black/15 [&_svg]:size-4">
            <ShoppingBag />
          </span>
          View order
          <span className="rounded-full bg-black/15 px-2 py-0.5 text-xs tabular-nums">
            {count}
          </span>
        </span>
        <span className="font-heading text-lg font-bold tabular-nums">
          {totals ? formatINR(roundFinalAmount(totals.total)) : "…"}
        </span>
      </button>
    </div>
  );
}
