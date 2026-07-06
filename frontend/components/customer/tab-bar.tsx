"use client";

import { ClipboardList, MessageCircle, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "Chat", icon: MessageCircle },
  { href: "/menu", label: "Menu", icon: UtensilsCrossed },
  { href: "/orders", label: "Orders", icon: ClipboardList },
] as const;

// Checkout is a dedicated, focused payment screen — no bottom nav there.
const HIDE_ON = ["/checkout"];

export function TabBar() {
  const pathname = usePathname();

  if (HIDE_ON.some((p) => pathname.startsWith(p))) return null;

  return (
    <nav
      aria-label="Primary"
      className="shrink-0 border-t border-secondary bg-secondary pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto flex max-w-2xl items-stretch">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-1 cursor-pointer flex-col items-center gap-0.5 py-1.5 text-[11px] font-medium transition-colors",
                active
                  ? "text-secondary-foreground"
                  : "text-secondary-foreground/60 hover:text-secondary-foreground"
              )}
            >
              <Icon className={cn("size-5", active && "fill-secondary-foreground/20")} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
