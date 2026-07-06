import {
  BarChart3,
  Bell,
  Brain,
  ClipboardList,
  CreditCard,
  FileClock,
  Gauge,
  Package,
  Percent,
  Pizza,
  Settings,
  ShieldCheck,
  Users,
  RefreshCcw,
} from "lucide-react";
import Link from "next/link";

import { AdminGate } from "@/components/admin/admin-gate";

const navItems = [
  { label: "Dashboard", href: "/admin", icon: Gauge },
  { label: "Orders", href: "/admin/orders", icon: ClipboardList },
  { label: "Menu", href: "/admin/menu", icon: Pizza },
  { label: "Pricing", href: "/admin/pricing", icon: Percent },
  { label: "Inventory", href: "/admin/inventory", icon: Package },
  { label: "Staff", href: "/admin/staff", icon: Users },
  { label: "Payments", href: "/admin/payments", icon: CreditCard },
  { label: "Analytics", href: "/admin/analytics", icon: BarChart3 },
  { label: "AI Insights", href: "/admin/ai-insights", icon: Brain },
  { label: "Refunds", href: "/admin/refunds", icon: RefreshCcw },
  { label: "Notifications", href: "/admin/notifications", icon: Bell },
  { label: "Audit Logs", href: "/admin/audit-logs", icon: FileClock },
  { label: "Settings", href: "/admin/settings", icon: Settings },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AdminGate>
      <div className="min-h-dvh bg-background text-foreground lg:grid lg:grid-cols-[260px_1fr]">
        <aside className="border-b border-border bg-surface lg:min-h-dvh lg:border-b-0 lg:border-r">
          <div className="flex h-16 items-center gap-3 px-4">
            <span className="grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground">
              <ShieldCheck className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="font-heading text-lg font-bold">SliceMatic</p>
              <p className="text-xs text-muted-foreground">Owner Control</p>
            </div>
          </div>

          <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:block lg:space-y-1 lg:overflow-visible">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex min-h-10 shrink-0 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground lg:w-full"
                >
                  <Icon className="size-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>

        <div className="min-w-0">{children}</div>
      </div>
    </AdminGate>
  );
}