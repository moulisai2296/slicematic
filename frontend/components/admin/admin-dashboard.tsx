"use client";

import {
  AlertTriangle,
  Brain,
  Clock3,
  IndianRupee,
  Pizza,
  ReceiptText,
  RefreshCw,
  ShoppingBag,
  Timer,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  getAdminDashboard,
  type AdminDashboardResponse,
  type AdminTodayMetrics,
} from "@/lib/admin-api";
import { useRealtime } from "@/lib/useRealtime";
import { formatINR } from "@/lib/utils";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: AdminDashboardResponse };

export function AdminDashboard() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  async function load(silent = false) {
    if (!silent) {
      setState({ status: "loading" });
    }
    try {
      const data = await getAdminDashboard();
      setState({ status: "ready", data });
    } catch (error) {
      if (!silent) {
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Admin API failed.",
        });
      }
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useRealtime(["order_created", "order_status_updated"], () => void load(true), () => void load(true));

  if (state.status === "loading") {
    return (
      <div className="grid min-h-[60dvh] place-items-center">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <RefreshCw className="size-4 animate-spin" />
          Loading admin dashboard
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="grid min-h-[60dvh] place-items-center px-4">
        <Card className="max-w-md rounded-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-5 text-destructive" />
              Admin API unavailable
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{state.message}</p>
            <Button onClick={() => void load()} variant="secondary">
              <RefreshCw />
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { dashboard, user } = state.data;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-2xl font-bold">Admin Dashboard</h1>
            <Badge variant="success">{user.roles[0] ?? "Admin"}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {user.full_name} - {user.email}
          </p>
        </div>
        <Button onClick={() => void load()} variant="secondary" size="sm">
          <RefreshCw />
          Refresh
        </Button>
      </header>

      <DashboardAiSummary summary={dashboard.ai_summary} />
      <MetricGrid today={dashboard.today} lowStock={dashboard.low_inventory_alerts} />

      <section className="grid gap-5 lg:grid-cols-[1.4fr_0.9fr]">
        <RecentOrders orders={dashboard.recent_orders} />
        <OperationalPulse
          topPizzas={dashboard.top_pizzas}
          peakHour={dashboard.peak_hour}
        />
      </section>
    </main>
  );
}

function DashboardAiSummary({
  summary,
}: {
  summary: AdminDashboardResponse["dashboard"]["ai_summary"];
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 font-heading text-lg font-semibold">
            <Brain className="size-5 text-primary" />
            AI Business Summary
          </h2>
          <p className="text-sm text-muted-foreground">
            Yesterday, till-now, today, and tomorrow signals from local orders.
          </p>
        </div>
        <Badge variant="primary">Gemini ready</Badge>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {summary.map((item) => (
          <article key={item.title} className="rounded-lg border border-border bg-surface-2 p-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              {item.title}
            </p>
            <p className="mt-1 text-xl font-semibold">{item.value}</p>
            <p className="mt-2 text-sm leading-6">{item.summary}</p>
            <p className="mt-2 text-xs text-muted-foreground">{item.detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function MetricGrid({
  today,
  lowStock,
}: {
  today: AdminTodayMetrics;
  lowStock: number;
}) {
  const metrics = useMemo(
    () => [
      { label: "Today Orders", value: today.total_orders.toString(), icon: ShoppingBag },
      { label: "Today Revenue", value: formatINR(today.revenue), icon: IndianRupee },
      { label: "AOV", value: formatINR(today.average_order_value), icon: ReceiptText },
      { label: "Pending", value: today.pending_orders.toString(), icon: Clock3 },
      { label: "Preparing", value: today.preparing_orders.toString(), icon: Timer },
      { label: "Completed", value: today.completed_orders.toString(), icon: ShoppingBag },
      {
        label: "Refund Requests",
        value: today.refund_requests.toString(),
        icon: ReceiptText,
      },
      { label: "Low Stock", value: lowStock.toString(), icon: AlertTriangle },
    ],
    [today, lowStock]
  );

  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map((metric) => {
        const Icon = metric.icon;
        return (
          <Card key={metric.label} className="rounded-lg">
            <CardContent className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  {metric.label}
                </p>
                <p className="mt-1 truncate text-2xl font-semibold">{metric.value}</p>
              </div>
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-2 text-primary">
                <Icon className="size-5" />
              </span>
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}

function RecentOrders({
  orders,
}: {
  orders: AdminDashboardResponse["dashboard"]["recent_orders"];
}) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border p-4">
        <h2 className="font-heading text-lg font-semibold">Recent Orders</h2>
        <Badge>{orders.length} latest</Badge>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className="bg-surface-2 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Order</th>
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Payment</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {orders.length ? (
              orders.map((order) => (
                <tr key={order.order_no} className="border-t border-border">
                  <td className="px-4 py-3 font-medium">{order.order_no}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {order.customer_name}
                  </td>
                  <td className="px-4 py-3">{order.payment_mode}</td>
                  <td className="px-4 py-3">
                    <Badge variant={statusVariant(order.status)}>{order.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">
                    {formatINR(order.total)}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-4 py-8 text-center text-muted-foreground" colSpan={5}>
                  No orders yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function OperationalPulse({
  topPizzas,
  peakHour,
}: {
  topPizzas: AdminDashboardResponse["dashboard"]["top_pizzas"];
  peakHour: AdminDashboardResponse["dashboard"]["peak_hour"];
}) {
  const peakLabel =
    typeof peakHour.hour === "number"
      ? `${peakHour.hour.toString().padStart(2, "0")}:00`
      : "Waiting";

  return (
    <aside className="space-y-5">
      <section className="rounded-lg border border-border bg-card p-4">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold">Peak Hour</h2>
          <Clock3 className="size-5 text-primary" />
        </div>
        <p className="text-3xl font-semibold">{peakLabel}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {peakHour.orders ?? 0} orders - {formatINR(peakHour.revenue ?? 0)}
        </p>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold">Top Pizzas</h2>
          <Pizza className="size-5 text-primary" />
        </div>
        <div className="space-y-3">
          {topPizzas.length ? (
            topPizzas.map((pizza) => (
              <div
                key={pizza.name}
                className="flex items-center justify-between gap-3 rounded-md bg-surface-2 px-3 py-2"
              >
                <span className="truncate text-sm font-medium">{pizza.name}</span>
                <Badge variant="primary">{pizza.quantity}</Badge>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No sales data yet</p>
          )}
        </div>
      </section>
    </aside>
  );
}

function statusVariant(status: string): BadgeProps["variant"] {
  const normalized = status.toLowerCase();
  if (["completed", "delivered", "paid"].includes(normalized)) return "success";
  if (["cancelled", "failed", "refunded"].includes(normalized)) return "destructive";
  if (["preparing", "ready", "confirmed"].includes(normalized)) return "primary";
  return "default";
}
