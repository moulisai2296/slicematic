"use client";

import {
  ChefHat,
  Clock,
  Package,
  RefreshCw,
  ShoppingBag,
  Smartphone,
  UtensilsCrossed,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  getRecentOrders,
  type OrderChannel,
  updateOrderStatus,
  type UserOrder,
} from "@/lib/api";
import { useRoleUser } from "@/lib/auth-store";
import { useRealtime } from "@/lib/useRealtime";
import { cn } from "@/lib/utils";

function normalizedOrderType(order: UserOrder): OrderChannel {
  const channel = order.type;
  return channel === "dine_in" || channel === "takeaway" || channel === "online"
    ? channel
    : "online";
}

export default function KitchenHomePage() {
  const { token } = useRoleUser("kitchen_staff");
  const [orders, setOrders] = useState<UserOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyOrder, setBusyOrder] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  // Keep time indicators ticking every 15s
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [received, preparing] = await Promise.all([
        getRecentOrders({ status: "received" }),
        getRecentOrders({ status: "preparing" }),
      ]);
      const combined = [...(received.orders ?? []), ...(preparing.orders ?? [])];
      if (received.ok || preparing.ok) {
        combined.sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        setOrders(combined);
      } else {
        const first = received.errors ?? preparing.errors;
        setError(first ? Object.values(first)[0] : "Couldn't load orders.");
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

  // Real-time updates and fallback polling
  useRealtime(["order_created", "order_status_updated"], load, load);

  const advance = async (order: UserOrder, nextStatus: string) => {
    if (!token || busyOrder) return;
    setBusyOrder(order.order_no);
    try {
      const res = await updateOrderStatus(order.order_no, nextStatus, token);
      if (res.ok) {
        await load();
      } else {
        const first = res.errors ? Object.values(res.errors)[0] : null;
        setError(first ?? "Couldn't update that order.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update that order.");
    } finally {
      setBusyOrder(null);
    }
  };

  const dineIn = orders.filter((o) => normalizedOrderType(o) === "dine_in");
  const takeaway = orders.filter((o) => normalizedOrderType(o) === "takeaway");
  const delivery = orders.filter((o) => normalizedOrderType(o) === "online");

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card shrink-0 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <ChefHat className="size-6" />
            </div>
            <div>
              <h1 className="font-heading text-lg font-bold text-foreground">Kitchen Display System</h1>
              <p className="text-xs text-muted-foreground">Active food preparation queue</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            aria-label="Refresh orders"
            className="grid size-10 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <RefreshCw className="size-5 animate-spin-slow" />
          </button>
        </div>
      </header>

      {/* Main Board */}
      <main className="flex-1 overflow-hidden p-6">
        {error && (
          <div
            role="alert"
            className="mb-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-full">
          {/* Column 1: Dine In */}
          <KitchenColumn
            title="Dine In"
            icon={UtensilsCrossed}
            orders={dineIn}
            colorClass="border-orange-500/30 bg-orange-500/5 text-orange-600 dark:text-orange-400"
            busyOrder={busyOrder}
            onAdvance={advance}
            now={now}
            loading={loading}
          />

          {/* Column 2: Takeaway */}
          <KitchenColumn
            title="Takeaway"
            icon={ShoppingBag}
            orders={takeaway}
            colorClass="border-blue-500/30 bg-blue-500/5 text-blue-600 dark:text-blue-400"
            busyOrder={busyOrder}
            onAdvance={advance}
            now={now}
            loading={loading}
          />

          {/* Column 3: Delivery */}
          <KitchenColumn
            title="Delivery"
            icon={Smartphone}
            orders={delivery}
            colorClass="border-green-500/30 bg-green-500/5 text-green-600 dark:text-green-400"
            busyOrder={busyOrder}
            onAdvance={advance}
            now={now}
            loading={loading}
          />
        </div>
      </main>
    </div>
  );
}

interface ColumnProps {
  title: string;
  icon: typeof ChefHat;
  orders: UserOrder[];
  colorClass: string;
  busyOrder: string | null;
  onAdvance: (order: UserOrder, nextStatus: string) => void;
  now: number;
  loading: boolean;
}

function KitchenColumn({
  title,
  icon: Icon,
  orders,
  colorClass,
  busyOrder,
  onAdvance,
  now,
  loading,
}: ColumnProps) {
  return (
    <div className="flex flex-col h-full rounded-2xl border border-border bg-card overflow-hidden">
      {/* Column Header */}
      <div className={cn("flex items-center justify-between border-b px-4 py-3.5", colorClass.split(" ")[0])}>
        <div className="flex items-center gap-2">
          <Icon className="size-4.5" />
          <h2 className="font-heading text-sm font-bold text-foreground">{title}</h2>
        </div>
        <Badge variant="default" className="font-mono text-xs font-semibold">
          {orders.length}
        </Badge>
      </div>

      {/* Ticket List */}
      <div className="slick-scroll flex-1 overflow-y-auto p-4 space-y-3 bg-surface-1/10">
        {loading && orders.length === 0 && (
          <div className="space-y-3">
            <div className="h-32 animate-pulse rounded-xl bg-surface-2" />
            <div className="h-32 animate-pulse rounded-xl bg-surface-2" />
          </div>
        )}

        {!loading && orders.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 border border-dashed border-border rounded-xl text-center p-4">
            <Package className="size-8 text-muted-foreground/50 mb-2" />
            <p className="text-xs text-muted-foreground font-medium">No tickets</p>
          </div>
        )}

        {orders.map((o) => {
          const isPreparing = o.status === "preparing";
          const elapsedMins = Math.floor((now - new Date(o.created_at).getTime()) / 60000);
          const timeString = elapsedMins < 1 ? "Just now" : `${elapsedMins}m ago`;
          const isLate = elapsedMins >= 15;

          return (
            <Card
              key={o.order_no}
              className={cn(
                "relative flex flex-col justify-between border border-border p-4 transition-all hover:shadow-md",
                isPreparing && "border-l-4 border-l-primary",
                isLate && !isPreparing && "border-r-4 border-r-destructive"
              )}
            >
              <div>
                <div className="flex items-start justify-between gap-2 border-b border-border/50 pb-2 mb-2">
                  <div>
                    <h3 className="font-heading text-sm font-bold">{o.order_no}</h3>
                    <p className="flex items-center gap-1 mt-0.5 text-[10px] text-muted-foreground">
                      <Clock className="size-3" />
                      {timeString}
                    </p>
                  </div>
                  <Badge variant={isPreparing ? "primary" : "default"} className="text-[10px]">
                    {isPreparing ? "Preparing" : "New"}
                  </Badge>
                </div>

                <div className="space-y-1.5 py-1 text-xs">
                  {o.items?.map((it, i) => (
                    <div key={i} className="text-muted-foreground leading-normal">
                      <span className="font-bold text-foreground">
                        {it.quantity}× {it.item_name}
                      </span>{" "}
                      {it.crust && <>· <span className="text-[11px]">{it.crust}</span></>}
                      {it.toppings.length > 0 && (
                        <p className="text-[10px] pl-4 text-muted-foreground/80">
                          + {it.toppings.join(", ")}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-3 pt-2 border-t border-border/50">
                <Button
                  size="sm"
                  className={cn(
                    "w-full cursor-pointer text-xs font-semibold h-8",
                    isPreparing ? "bg-green-600 hover:bg-green-700 text-white" : "bg-primary hover:bg-primary/95 text-primary-foreground"
                  )}
                  disabled={busyOrder === o.order_no}
                  onClick={() =>
                    onAdvance(o, isPreparing ? "ready_for_pickup" : "preparing")
                  }
                >
                  {isPreparing ? "Mark Ready" : "Start Prep"}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
