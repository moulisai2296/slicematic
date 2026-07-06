"use client";

import {
  Bike,
  Check,
  ChefHat,
  ClipboardList,
  PackageCheck,
  PartyPopper,
  Receipt,
  Star,
  MessageSquare,
  RefreshCcw,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { BillModal } from "@/components/shared/bill-modal";
import { RefundModal } from "@/components/customer/refund-modal";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { 
  type UserOrder, 
  getOrderFeedback, 
  submitOrderFeedback 
} from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { orderStatus, useOrdersStore } from "@/lib/orders-store";
import { useRealtime } from "@/lib/useRealtime";
import { cn, formatINR } from "@/lib/utils";

// Received, Preparing, Ready for pickup, Out for delivery, Delivered.
const STEP_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  "Received": Check,
  "Preparing": ChefHat,
  "Ready for pickup": PackageCheck,
  "Out for delivery": Bike,
  "Delivered": PartyPopper,
};

export default function OrdersPage() {
  return (
    <Suspense fallback={null}>
      <OrdersContent />
    </Suspense>
  );
}

function OrdersContent() {
  const { orders, loading, error, load } = useOrdersStore();
  const phone = useAuthStore((s) => s.user?.phone);
  const placed = useSearchParams().get("placed");

  const refresh = useCallback(() => {
    // Per-user filter by the signed-in account's phone (chat/voice + checkout
    // orders all carry it); swapping to user_id is part of the authz step.
    if (phone) void load(phone);
  }, [load, phone]);

  useEffect(() => refresh(), [refresh]);

  // Listen to live status updates and fallback to polling automatically
  useRealtime(["order_status_updated"], refresh, refresh);

  if (loading && orders.length === 0) {
    return (
      <div className="slick-scroll h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-5">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="h-40 animate-pulse rounded-xl border border-border bg-surface-2"
            />
          ))}
        </div>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
        <span className="grid size-16 place-items-center rounded-2xl bg-surface-2 text-primary">
          <ClipboardList className="size-8" />
        </span>
        <div className="space-y-1">
          <h2 className="font-heading text-xl font-semibold">No orders yet</h2>
          <p className="max-w-xs text-sm text-muted-foreground">
            {error ?? "Your placed orders and live tracking show up here."}
          </p>
        </div>
        <Button asChild>
          <Link href="/menu">Start an order</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="slick-scroll h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-5">
        {placed && orders.some((o) => o.order_no === placed) && (
          <div className="flex items-center gap-3 rounded-xl border border-success/40 bg-success/10 px-4 py-3 text-success">
            <PartyPopper className="size-5 shrink-0" />
            <p className="text-sm font-medium">
              Order placed! We&apos;re on it — track it below.
            </p>
          </div>
        )}

        <h1 className="font-heading text-xl font-bold">Your orders</h1>

        {orders.map((order) => (
          <OrderCard
            key={order.order_no}
            order={order}
            highlight={order.order_no === placed}
          />
        ))}
      </div>
    </div>
  );
}

function OrderCard({
  order,
  highlight,
}: {
  order: UserOrder;
  highlight?: boolean;
}) {
  const [showBill, setShowBill] = useState(false);
  const [showRefund, setShowRefund] = useState(false);
  
  const placedMs = Date.parse(order.created_at);
  const { index, step, steps } = orderStatus(order);
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
    <Card className={cn("overflow-hidden p-0", highlight && "border-primary/60")}>
      <div className="flex items-start justify-between gap-3 border-b border-border p-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium">
            <Receipt className="size-4 text-muted-foreground" />
            {order.order_no}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {placedTime} · {order.payment_mode}
          </p>
        </div>
        <Badge variant={index === steps.length - 1 ? "success" : "primary"}>
          {step}
        </Badge>
      </div>

      {/* Status stepper */}
      <div className="flex items-center px-4 py-4">
        {steps.map((label, i) => {
          const Icon = STEP_ICON_MAP[label] ?? Check;
          const done = i <= index;
          return (
            <div key={label} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center gap-1">
                <span
                  className={cn(
                    "grid size-8 place-items-center rounded-full border-2 transition-colors [&_svg]:size-4",
                    done
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-surface-2 text-muted-foreground"
                  )}
                >
                  <Icon />
                </span>
                <span
                  className={cn(
                    "w-14 text-center text-[10px] leading-tight",
                    done ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <span
                  className={cn(
                    "-mt-4 h-0.5 flex-1 rounded",
                    i < index ? "bg-primary" : "bg-border"
                  )}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Items + total */}
      <div className="space-y-1 border-t border-border p-4">
        {items.map((item, i) => (
          <div key={i} className="flex justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-muted-foreground">
              {item.quantity}× {item.item_name} {item.size_code && `(${item.size_code})`}
              <span className="text-xs">
                {item.crust ? ` · ${item.crust}` : ""}
                {item.crust && item.toppings.length > 0 ? " · " : ""}
                {item.toppings.length > 0 ? item.toppings.join(", ") : ""}
                {!item.crust && item.toppings.length === 0 && item.item_type ? ` · ${item.item_type}` : ""}
              </span>
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {formatINR(item.line_total)}
            </span>
          </div>
        ))}
        <div className="flex justify-between border-t border-border pt-2 text-sm font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{formatINR(order.total)}</span>
        </div>
      </div>

      {/* Bill & Refund Actions */}
      <div className="flex gap-2 border-t border-border p-4">
        <Button variant="outline" size="sm" className="w-full gap-2" onClick={() => setShowBill(true)}>
          <Receipt className="size-4" /> View Bill
        </Button>
        <Button variant="outline" size="sm" className="w-full gap-2" onClick={() => setShowRefund(true)}>
          <RefreshCcw className="size-4" /> Ask Refund
        </Button>
      </div>

      <BillModal open={showBill} onOpenChange={setShowBill} order={order} />
      <RefundModal open={showRefund} onOpenChange={setShowRefund} order={order} />

      {/* Feedback section (only for delivered orders) */}
      {index === steps.length - 1 && (
        <OrderFeedback orderNo={order.order_no} />
      )}
    </Card>
  );
}

function OrderFeedback({ orderNo }: { orderNo: string }) {
  const [status, setStatus] = useState<"loading" | "prompt" | "form" | "submitting" | "submitted" | "error">("loading");
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [text, setText] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let active = true;
    void getOrderFeedback(orderNo).then((res) => {
      if (!active) return;
      if (res.ok && res.has_feedback) {
        setRating(res.rating || 0);
        setStatus("submitted");
      } else {
        setStatus("prompt");
      }
    });
    return () => { active = false; };
  }, [orderNo]);

  const submit = async () => {
    if (rating < 1) return;
    setStatus("submitting");
    try {
      const res = await submitOrderFeedback(orderNo, rating, text);
      if (res.ok) {
        setStatus("submitted");
      } else {
        setStatus("error");
        setErrorMsg(Object.values(res.errors || {})[0] || "Failed to submit feedback.");
      }
    } catch {
      setStatus("error");
      setErrorMsg("Network error.");
    }
  };

  if (status === "loading") {
    return <div className="p-4 text-center text-xs text-muted-foreground bg-surface-2 border-t border-border">Checking feedback...</div>;
  }

  if (status === "submitted") {
    return (
      <div className="flex items-center justify-between border-t border-border bg-surface-2 px-4 py-3 text-sm">
        <span className="flex items-center gap-2 font-medium text-success">
          <PartyPopper className="size-4" /> Feedback received
        </span>
        <span className="flex items-center gap-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <Star key={i} className={cn("size-5", i < rating ? "fill-accent text-amber-600" : "text-amber-600/50")} />
          ))}
        </span>
      </div>
    );
  }

  return (
    <div className="border-t border-border bg-surface-2 p-4">
      {status === "prompt" ? (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <MessageSquare className="size-4 text-primary" />
            How was your order?
          </div>
          <div className="flex gap-1" onMouseLeave={() => setHoverRating(0)}>
            {Array.from({ length: 5 }).map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => { setRating(i + 1); setStatus("form"); }}
                onMouseEnter={() => setHoverRating(i + 1)}
                className="cursor-pointer transition-colors hover:scale-110 active:scale-95"
              >
                <Star className={cn("size-8", (hoverRating || rating) > i ? "fill-accent text-amber-600" : "text-amber-600/50 hover:text-amber-600")} />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Rate your experience</span>
            <div className="flex gap-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setRating(i + 1)}
                  className="cursor-pointer transition-colors hover:scale-110 active:scale-95"
                >
                  <Star className={cn("size-8", rating > i ? "fill-accent text-amber-600" : "text-amber-600/50 hover:text-amber-600")} />
                </button>
              ))}
            </div>
          </div>
          <textarea
            placeholder="Tell us what you liked or what we can improve..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="flex min-h-[80px] w-full rounded-md border border-input bg-card px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
            disabled={status === "submitting"}
          />
          {status === "error" && (
            <p className="text-xs text-destructive">{errorMsg}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { setStatus("prompt"); setRating(0); setText(""); }}
              disabled={status === "submitting"}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={submit}
              disabled={rating < 1 || status === "submitting"}
            >
              {status === "submitting" ? "Submitting..." : "Submit"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
