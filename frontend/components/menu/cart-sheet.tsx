"use client";

import { ArrowRight, Trash2 } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useMenuStore } from "@/lib/menu-store";
import { formatINR, roundFinalAmount } from "@/lib/utils";

import { QuantityStepper } from "./quantity-stepper";

export function CartSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { cart, pricedLines, totals, pricing, setQuantity, removeLine } =
    useMenuStore();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title="Your order"
        description={`${cart.length} ${cart.length === 1 ? "item" : "items"} in your order`}
      >
        <div className="slick-scroll flex-1 overflow-y-auto px-5 py-4">
          {cart.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Your order is empty. Add items from the menu to get started.
            </p>
          ) : (
            <ul className="space-y-3">
              {cart.map((line, i) => {
                const priced = pricedLines?.[i];
                return (
                  <li
                    key={line.id}
                    className="rounded-xl border border-border bg-surface-2 p-3.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-foreground">
                          {line.item.name} {line.size_code && `(${line.size_code})`}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {line.crust?.name ? `${line.crust.name}` : ""}
                          {line.crust && line.toppings.length > 0 ? " · " : ""}
                          {line.toppings.length > 0 ? line.toppings.map((t) => t.name).join(", ") : ""}
                          {!line.crust && line.toppings.length === 0 && line.item.category_code !== 'pizza' ? line.item.item_type || '' : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        aria-label={`Remove ${line.item.name}`}
                        onClick={() => removeLine(line.id)}
                        className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive [&_svg]:size-4"
                      >
                        <Trash2 />
                      </button>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <QuantityStepper
                        size="sm"
                        value={line.quantity}
                        onChange={(q) => setQuantity(line.id, q)}
                      />
                      <span className="font-semibold tabular-nums">
                        {priced ? formatINR(priced.total) : "…"}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {cart.length > 0 && (
          <div className="shrink-0 border-t border-border bg-surface px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
            <dl className="mb-4 space-y-1.5 text-sm">
              <Row label="Subtotal" value={totals?.subtotal} />
              {totals && totals.discount > 0 && (
                <Row
                  label="Bulk discount"
                  value={-totals.discount}
                  className="text-success"
                />
              )}
              <Row label="GST (18%)" value={totals?.gst} />
              <div className="flex items-center justify-between border-t border-border pt-2 text-base font-bold">
                <dt>Total</dt>
                <dd className="tabular-nums">
                  {totals ? formatINR(roundFinalAmount(totals.total)) : pricing ? "…" : "—"}
                </dd>
              </div>
            </dl>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => onOpenChange(false)}
              >
                Add another
              </Button>
              <Button variant="accent" className="flex-1" asChild>
                <Link href="/checkout" onClick={() => onOpenChange(false)}>
                  Checkout
                  <ArrowRight />
                </Link>
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Row({
  label,
  value,
  className,
}: {
  label: string;
  value: number | undefined;
  className?: string;
}) {
  return (
    <div className="flex items-center justify-between text-muted-foreground">
      <dt>{label}</dt>
      <dd className={`tabular-nums ${className ?? ""}`}>
        {value === undefined ? "…" : formatINR(value)}
      </dd>
    </div>
  );
}
