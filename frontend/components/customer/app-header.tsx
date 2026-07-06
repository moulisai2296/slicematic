"use client";

import { Pizza, ShoppingBag, RotateCcw } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { initials, useAuthStore } from "@/lib/auth-store";
import { useMenuStore } from "@/lib/menu-store";
import { useChatStore } from "@/lib/store";

// Checkout is a dedicated screen with its own back/title header — hide the
// global brand header there.
const HIDE_ON = ["/checkout"];

export function AppHeader() {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const cart = useMenuStore((s) => s.cart);
  const openCart = useMenuStore((s) => s.openCart);
  const count = cart.reduce((n, l) => n + l.quantity, 0);
  const resetChat = useChatStore((s) => s.reset);

  if (HIDE_ON.some((p) => pathname.startsWith(p))) return null;

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-secondary bg-secondary px-3 text-secondary-foreground">
      <Link
        href="/"
        className="flex items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Pizza className="size-4" />
        </span>
        <span className="font-heading text-lg font-bold tracking-tight text-secondary-foreground">
          SliceMatic
        </span>
      </Link>

      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          aria-label="Start new chat"
          onClick={() => {
            resetChat();
            if (pathname !== "/") window.location.href = "/";
          }}
          className="relative grid size-9 cursor-pointer place-items-center rounded-full text-secondary-foreground transition-colors hover:bg-secondary-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-5"
        >
          <RotateCcw />
        </button>

        <button
          type="button"
          aria-label={`View order${count ? `, ${count} item${count === 1 ? "" : "s"}` : ""}`}
          onClick={openCart}
          className="relative grid size-9 cursor-pointer place-items-center rounded-full text-secondary-foreground transition-colors hover:bg-secondary-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-5"
        >
          <ShoppingBag />
          {count > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid min-w-[18px] place-items-center rounded-full bg-primary px-1 text-[10px] font-bold leading-4 text-primary-foreground">
              {count}
            </span>
          )}
        </button>

        <Link
          href="/profile"
          aria-label="Your profile"
          className="grid size-9 cursor-pointer place-items-center rounded-full border border-secondary-foreground/20 bg-secondary-foreground/10 text-xs font-bold text-secondary-foreground transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {initials(user?.name ?? "")}
        </Link>
      </div>
    </header>
  );
}
