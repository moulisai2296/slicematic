"use client";

import {
  Banknote,
  Check,
  ChefHat,
  Filter,
  PartyPopper,
  Receipt,
  RefreshCw,
  Smartphone,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Card } from "@/components/ui/card";
import { getRecentOrders, type UserOrder } from "@/lib/api";
import { orderStatus } from "@/lib/orders-store";
import { advanceStaffOrder } from "@/lib/staff-api";
import { useRealtime } from "@/lib/useRealtime";
import { cn, formatINR } from "@/lib/utils";

/**
 * Recent orders — shown in the Order Ticket sidebar while no order is being
 * built (the details step), so staff always see what's in flight without
 * leaving the kiosk's single screen.
 *
 * Uses the REAL kitchen pipeline status (orderStatus() in lib/orders-store.ts
 * — same source of truth as the customer Orders tab), not a simulated
 * elapsed-time tracker. Staff/POS orders never carry a delivery_address, so
 * orderStatus() always returns the 3-step pickup sequence (Received →
 * Preparing → Ready for pickup) — relabeled "Served" here since for a
 * dine-in/takeaway order, staff handing it over at the counter *is* that
 * final step; there's no separate DB-tracked "served" state beyond it.
 *
 * Dine In / Takeaway filters the real persisted `order.type` field (see
 * pos-payment.tsx). The status filter (All / Preparing / Served) narrows by
 * the real step index (index < 2 vs index === 2) — same "any status but the
 * done one" rule used elsewhere. "All" (default) shows both sections.
 */
const STAFF_STEP_LABELS = ["Received", "Preparing", "Served"];
const STEP_ICONS = [Check, ChefHat, PartyPopper];

type StatusFilter = "all" | "preparing" | "served";
type TypeFilter = "dine_in" | "takeaway";

const STATUS_OPTIONS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "preparing", label: "Preparing" },
  { id: "served", label: "Served" },
];

export function RecentOrders() {
  const [orders, setOrders] = useState<UserOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("dine_in");
  const statusMenuRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await getRecentOrders();
      if (res.ok && res.orders) {
        setOrders(res.orders);
      } else {
        const first = res.errors ? Object.values(res.errors)[0] : null;
        setError(first ?? "Couldn't load orders.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load orders.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtime(["order_created", "order_status_updated"], load, load);

  useEffect(() => {
    if (!statusMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!statusMenuRef.current?.contains(e.target as Node)) {
        setStatusMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [statusMenuOpen]);

  const byStatus =
    statusFilter === "all"
      ? orders
      : orders.filter((o) => {
          const { index } = orderStatus(o);
          return statusFilter === "served" ? index === 2 : index < 2;
        });
  const visible = byStatus.filter((o) => o.type === typeFilter);

  const statusButtonLabel =
    STATUS_OPTIONS.find((o) => o.id === statusFilter)?.label ?? "All";

  return (
    <div className="flex h-full flex-col">
      {/* Filters */}
      <div className="flex shrink-0 items-center gap-2 pb-3">
        <div
          role="radiogroup"
          aria-label="Filter by order type"
          className="grid flex-1 grid-cols-2 gap-2"
        >
          {(
            [
              { id: "dine_in", label: "Dine In" },
              { id: "takeaway", label: "Takeaway" },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={typeFilter === f.id}
              onClick={() => setTypeFilter(f.id)}
              className={cn(
                "h-9 cursor-pointer rounded-full border text-sm font-medium transition-colors",
                typeFilter === f.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-surface-2 text-foreground hover:border-primary/50"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div ref={statusMenuRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setStatusMenuOpen((o) => !o)}
            aria-haspopup="true"
            aria-expanded={statusMenuOpen}
            aria-label={`Filter by order status (${statusButtonLabel})`}
            title={statusButtonLabel}
            className={cn(
              "grid size-9 cursor-pointer place-items-center rounded-full border transition-colors",
              statusFilter !== "all"
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-surface-2 text-foreground hover:border-primary/50"
            )}
          >
            <Filter className="size-4" />
          </button>

          {statusMenuOpen && (
            <div
              role="menu"
              aria-label="Filter by order status"
              className="absolute top-full right-0 z-20 mt-2 w-40 overflow-hidden rounded-lg border border-border bg-card shadow-lg"
            >
              {STATUS_OPTIONS.map((opt) => {
                const active = statusFilter === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => {
                      setStatusFilter(opt.id);
                      setStatusMenuOpen(false);
                    }}
                    className="flex h-10 w-full cursor-pointer items-center justify-between px-3 text-sm font-medium text-foreground transition-colors hover:bg-surface-2"
                  >
                    {opt.label}
                    <span
                      className={cn(
                        "grid size-4 shrink-0 place-items-center rounded border",
                        active ? "border-primary bg-primary" : "border-border"
                      )}
                    >
                      {active && (
                        <Check className="size-3 text-primary-foreground" />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => void load()}
          aria-label="Refresh"
          className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground [&_svg]:size-4"
        >
          <RefreshCw />
        </button>
      </div>

      {/* List */}
      <div className="slick-scroll -mx-1 flex-1 overflow-y-auto px-1">
        {loading && orders.length === 0 && (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-44 animate-pulse rounded-xl border border-border bg-surface-2"
              />
            ))}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </div>
        )}

        {!loading && !error && visible.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              {statusFilter === "served"
                ? "No served orders yet."
                : statusFilter === "preparing"
                  ? "Nothing in preparation right now."
                  : "No orders match this filter."}
            </p>
          </div>
        )}

        {visible.length > 0 && (
          <ul className="space-y-3 pb-2">
            {visible.map((o) => (
              <li key={o.order_no}>
                <StaffOrderCard order={o} onRefresh={load} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StaffOrderCard({ order, onRefresh }: { order: UserOrder; onRefresh?: () => void }) {
  const placedMs = Date.parse(order.created_at);
  const { index } = orderStatus(order);
  const placedTime = Number.isNaN(placedMs)
    ? ""
    : new Date(placedMs).toLocaleString([], {
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "short",
      });
  const items = order.items ?? [];

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-start justify-between gap-3 border-b border-border p-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Receipt className="size-3.5 text-muted-foreground" />
            {order.order_no}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {placedTime} · {order.customer_name}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1 text-xs font-semibold tabular-nums">
          {order.payment_mode === "UPI" ? (
            <Smartphone className="size-3 text-muted-foreground" />
          ) : (
            <Banknote className="size-3 text-muted-foreground" />
          )}
          {formatINR(order.total)}
        </span>
      </div>

      {/* Status stepper — real kitchen pipeline status, staff labels */}
      <div className="flex items-center px-3 py-3">
        {STAFF_STEP_LABELS.map((_, i) => {
          const Icon = STEP_ICONS[i];
          const done = i <= index;
          return (
            <div key={i} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center gap-1">
                <span
                  className={cn(
                    "grid size-6 place-items-center rounded-full border-2 transition-colors [&_svg]:size-3",
                    done
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-surface-2 text-muted-foreground"
                  )}
                >
                  <Icon />
                </span>
                <span
                  className={cn(
                    "w-11 text-center text-[9px] leading-tight",
                    done ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {STAFF_STEP_LABELS[i]}
                </span>
              </div>
              {i < STAFF_STEP_LABELS.length - 1 && (
                <span
                  className={cn(
                    "-mt-3.5 h-0.5 flex-1 rounded",
                    i < index ? "bg-primary" : "bg-border"
                  )}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Items */}
      <div className="space-y-1 border-t border-border p-3">
        {items.map((item, i) => (
          <div key={i} className="flex justify-between gap-2 text-xs">
            <span className="min-w-0 truncate text-muted-foreground">
              {item.quantity}× {item.item_name}
            </span>
          </div>
        ))}
      </div>

      {/* Action Button: Mark Served */}
      {order.status === "ready_for_pickup" && (
        <div className="border-t border-border p-2 bg-surface-2/20">
          <button
            type="button"
            onClick={async (e) => {
              e.stopPropagation();
              try {
                await advanceStaffOrder(order.id!);
                if (onRefresh) {
                  onRefresh();
                }
              } catch (err) {
                alert(err instanceof Error ? err.message : "Failed to serve order");
              }
            }}
            className="flex items-center justify-center gap-1.5 w-full h-8 cursor-pointer rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-semibold transition-colors shadow-sm"
          >
            <Check className="size-3.5" />
            Mark Served
          </button>
        </div>
      )}
    </Card>
  );
}
