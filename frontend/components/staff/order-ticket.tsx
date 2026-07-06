"use client";

import {
  ArrowRight,
  Minus,
  Pencil,
  Plus,
  ShoppingBag,
  Trash2,
  UtensilsCrossed,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RecentOrders } from "@/components/staff/recent-orders";
import { useStaffPos } from "@/lib/staff-store";
import { formatINR } from "@/lib/utils";

const ORDER_TYPE_LABEL = { dine_in: "Dine In", takeaway: "Takeaway" } as const;
const ORDER_TYPE_ICON = { dine_in: UtensilsCrossed, takeaway: ShoppingBag } as const;

/**
 * The running order ticket — the POS's persistent right sidebar. Lines with
 * quantity steppers, server-priced totals (same summary rows as the customer
 * cart sheet), and the hand-off to the payment step.
 */
export function OrderTicket() {
  const {
    step,
    customerName,
    customerPhone,
    orderType,
    setStep,
    ticket,
    pricedLines,
    totals,
    pricing,
    setQuantity,
    removeLine,
  } = useStaffPos();

  const count = ticket.reduce((n, l) => n + l.quantity, 0);
  const inPayment = step === "payment";
  const OrderTypeIcon = ORDER_TYPE_ICON[orderType];

  return (
    <aside className="flex h-full w-full flex-col border-l border-border bg-surface">
      {/* Ticket header: the walk-in customer + order type */}
      <div className="shrink-0 border-b border-border px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="font-heading text-lg font-bold">
                {/* "Current ticket" once past details (menu selection or
                    beyond) even before the first item is added, and it stays
                    that way if Edit brings us back to details with items
                    already on it. Only the very first, still-empty details
                    screen shows "Order tickets" (recent orders). */}
                {ticket.length > 0 || step !== "details"
                  ? "Current ticket"
                  : "Order tickets"}
              </h2>
              {customerName && (
                <Badge variant="primary">
                  <OrderTypeIcon className="size-3" />
                  {ORDER_TYPE_LABEL[orderType]}
                </Badge>
              )}
            </div>
            {customerName ? (
              <p className="truncate text-sm text-muted-foreground">
                {customerName} · {customerPhone}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">No customer yet</p>
            )}
          </div>
          {customerName && !inPayment && (
            <button
              type="button"
              onClick={() => setStep("details")}
              aria-label="Edit customer details"
              className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground [&_svg]:size-4"
            >
              <Pencil />
            </button>
          )}
        </div>
      </div>

      {/* Lines, or — while no order is in progress — recent orders */}
      <div className="slick-scroll flex-1 overflow-y-auto px-5 py-4">
        {ticket.length === 0 ? (
          step === "details" ? (
            <RecentOrders />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm text-muted-foreground">
                The ticket is empty — add pizzas from the menu.
              </p>
            </div>
          )
        ) : (
          <ul className="space-y-3">
            {ticket.map((line, i) => {
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
                    {!inPayment && (
                      <button
                        type="button"
                        aria-label={`Remove ${line.item.name}`}
                        onClick={() => removeLine(line.id)}
                        className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive [&_svg]:size-4"
                      >
                        <Trash2 />
                      </button>
                    )}
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    {inPayment ? (
                      <span className="text-sm text-muted-foreground">
                        × {line.quantity}
                      </span>
                    ) : (
                      <div className="flex items-center gap-3">
                        <TicketQtyButton
                          label="Decrease quantity"
                          disabled={line.quantity <= 1}
                          onClick={() => setQuantity(line.id, line.quantity - 1)}
                        >
                          <Minus />
                        </TicketQtyButton>
                        <span className="min-w-6 text-center text-sm font-semibold tabular-nums">
                          {line.quantity}
                        </span>
                        <TicketQtyButton
                          label="Increase quantity"
                          disabled={line.quantity >= 10}
                          onClick={() => setQuantity(line.id, line.quantity + 1)}
                        >
                          <Plus />
                        </TicketQtyButton>
                      </div>
                    )}
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

      {/* Totals + take payment */}
      {ticket.length > 0 && (
        <div className="shrink-0 border-t border-border bg-surface px-5 py-4">
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
            <div className="flex items-center justify-between border-t border-border pt-2 text-lg font-bold">
              <dt>Total</dt>
              <dd className="tabular-nums">
                {totals ? formatINR(totals.total) : pricing ? "…" : "—"}
              </dd>
            </div>
          </dl>
          {!inPayment && (
            <Button
              size="lg"
              className="h-14 w-full text-base"
              disabled={pricing || !totals || count === 0}
              onClick={() => setStep("payment")}
            >
              Take payment
              <ArrowRight />
            </Button>
          )}
        </div>
      )}
    </aside>
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

function TicketQtyButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-9 cursor-pointer place-items-center rounded-full border border-border bg-card text-foreground transition-colors hover:border-primary hover:text-primary disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4"
    >
      {children}
    </button>
  );
}
