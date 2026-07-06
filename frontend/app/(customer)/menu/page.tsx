"use client";

import { Leaf, Search, UtensilsCrossed } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { CartBar } from "@/components/menu/cart-bar";
import {
  CustomizationSheet,
  type CustomizationResult,
} from "@/components/menu/customization-sheet";
import { MenuItemCard } from "@/components/menu/menu-item-card";
import { Input } from "@/components/ui/input";
import type { MenuItem } from "@/lib/api";
import { useMenuStore } from "@/lib/menu-store";
import { cn } from "@/lib/utils";

type MenuTab = "all" | "pizza" | "sides" | "beverages" | "combos";

const HIDDEN_CATEGORIES = new Set(["crust", "sauce", "veg_topping", "non_veg_topping", "topping"]);

const CATEGORY_LABELS: Record<string, string> = {
  pizza: "🍕 Pizzas",
  value_pizza: "🍕 Value pizza",
  veg_pizza: "🍕 Veg Pizzas",
  classic_veg_pizza: "🌱 Classic veg pizza",
  special_veg_pizza: "🔥 Special veg pizza",
  non_veg_pizza: "🍖 Non-Veg Pizzas",
  premium_pizza: "⭐ Premium pizza",
  side: "🍟 Sides",
  dip: "🍯 Dips",
  beverage: "🥤 Beverages",
  dessert: "🍰 Desserts",
  combo: "🎉 Combos",
};

function getCategoryLabel(code: string): string {
  return CATEGORY_LABELS[code] || (code.charAt(0).toUpperCase() + code.slice(1).replace(/_/g, " "));
}

export default function MenuPage() {
  const { menu, status, error, loadMenu, addLine } = useMenuStore();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<MenuItem | null>(null);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<MenuTab>("all");
  const [vegOnly, setVegOnly] = useState(false);

  useEffect(() => {
    void loadMenu();
  }, [loadMenu]);

  // Build a list of {sectionTitle, items} for grouped rendering
  const sections = useMemo(() => {
    if (!menu || !menu.categories) return [];

    const q = query.trim().toLowerCase();

    const result: { code: string; label: string; items: MenuItem[] }[] = [];

    for (const [code, cat] of Object.entries(menu.categories)) {
      if (HIDDEN_CATEGORIES.has(code)) continue;

      let catItems = cat as MenuItem[];

      // Filter by active tab
      if (activeTab === "pizza" && !code.includes("pizza")) continue;
      if (activeTab === "sides" && code !== "side" && code !== "dip") continue;
      if (activeTab === "beverages" && code !== "beverage" && code !== "dessert") continue;
      if (activeTab === "combos" && code !== "combo") continue;

      if (vegOnly) {
        if (code === "non_veg_pizza" || code === "non_veg_topping") continue;
        catItems = catItems.filter((item) => {
          const type = item.item_type?.toLowerCase() ?? "";
          return !type.includes("non-veg") && !item.category_code.includes("non_veg");
        });
      }

      // Filter by search
      if (q) {
        catItems = catItems.filter((p) => p.name.toLowerCase().includes(q));
      }

      if (catItems.length > 0) {
        result.push({ code, label: getCategoryLabel(code), items: catItems });
      }
    }

    return result;
  }, [menu, query, activeTab, vegOnly]);

  const openCustomize = (item: MenuItem) => {
    // If it's a generic item with NO sizes/crusts, add 1 qty directly
    if (
      !item.category_code.includes("pizza") &&
      (!item.sizes || item.sizes.length === 0)
    ) {
      addLine({
        item: item,
        size_code: null,
        crust: null,
        toppings: [],
        quantity: 1,
      });
      return;
    }

    // Otherwise open the sheet for size/crust/topping selection
    setSelected(item);
    setCustomizeOpen(true);
  };

  const handleAdd = (result: CustomizationResult) => {
    addLine(result);
  };

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Search & Categories */}
      <div className="shrink-0 border-b border-border bg-card/60 backdrop-blur-md px-4 py-4 space-y-4">
        {/* Search */}
        <div className="mx-auto flex w-full max-w-2xl items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-input bg-surface-2/40 px-3 shadow-inner transition-all focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <label htmlFor="menu-search" className="sr-only">
            Search menu
          </label>
          <Input
            id="menu-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search our menu..."
            className="h-10 border-0 bg-transparent px-1 text-sm font-medium shadow-none focus-visible:ring-0"
          />
          </div>
          <button
            type="button"
            onClick={() => setVegOnly((current) => !current)}
            className={cn(
              "flex h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border-2 border-green-800 px-3 text-xs font-semibold shadow-sm transition-all",
              vegOnly
                ? "bg-green-700 text-white"
                : "bg-background text-foreground hover:bg-green-50"
            )}
          >
            <Leaf className={cn("size-4", vegOnly ? "text-white" : "text-green-700")} />
            Veg only
          </button>
        </div>

        {/* Category Selector Tabs */}
        <DragScroll className="slick-scroll mx-auto flex w-full max-w-2xl touch-pan-x select-none items-center gap-2 overflow-x-auto overscroll-x-contain pb-2">
          <TabButton active={activeTab === "all"} onClick={() => setActiveTab("all")}>
            All
          </TabButton>
          <TabButton active={activeTab === "pizza"} onClick={() => setActiveTab("pizza")}>
            🍕 Pizzas
          </TabButton>
          <TabButton active={activeTab === "sides"} onClick={() => setActiveTab("sides")}>
            🍟 Sides & Dips
          </TabButton>
          <TabButton active={activeTab === "beverages"} onClick={() => setActiveTab("beverages")}>
            🥤 Bev & Desserts
          </TabButton>
          <TabButton active={activeTab === "combos"} onClick={() => setActiveTab("combos")}>
            🎉 Combos
          </TabButton>
        </DragScroll>
      </div>

      {/* List */}
      <div className="slick-scroll flex-1 overflow-y-auto" style={{ background: "hsl(var(--surface-1) / 0.08)" }}>
        <div className="mx-auto w-full max-w-2xl px-4 py-6">
          {status === "loading" && (
            <ul className="grid grid-cols-2 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <li
                  key={i}
                  className="h-[210px] animate-pulse rounded-2xl border border-border bg-surface-2"
                />
              ))}
            </ul>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <UtensilsCrossed className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {error ?? "Couldn't load the menu."}
              </p>
              <button
                onClick={() => void loadMenu()}
                className="cursor-pointer text-sm font-medium text-primary hover:underline"
              >
                Try again
              </button>
            </div>
          )}

          {status === "ready" && (
            <>
              {sections.length === 0 ? (
                <p className="py-16 text-center text-sm text-muted-foreground">
                  No items found matching your filter.
                </p>
              ) : (
                <div className="space-y-8 pb-4">
                  {sections.map((section) => (
                    <section key={section.code}>
                      {/* Section header — always shown to separate categories */}
                      <h2 className="mb-3 text-base font-bold text-foreground tracking-tight">
                        {section.label}
                      </h2>
                      <ul className="grid grid-cols-2 gap-4">
                        {section.items.map((item) => (
                          <li key={item.id} className="flex">
                            <MenuItemCard item={item} onSelect={openCustomize} />
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <CartBar />

      {menu && selected && (
        <CustomizationSheet
          item={selected}
          menu={menu}
          open={customizeOpen}
          onOpenChange={setCustomizeOpen}
          onAdd={handleAdd}
        />
      )}
    </div>
  );
}

function DragScroll({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef({ x: 0, scrollLeft: 0, dragging: false, hasDragged: false });

  return (
    <div
      ref={ref}
      className={className}
      onPointerDown={(event) => {
        const el = ref.current;
        if (!el) return;
        start.current = {
          x: event.clientX,
          scrollLeft: el.scrollLeft,
          dragging: true,
          hasDragged: false,
        };
      }}
      onPointerMove={(event) => {
        const el = ref.current;
        if (!el || !start.current.dragging) return;
        const dx = event.clientX - start.current.x;
        if (Math.abs(dx) > 5) {
          start.current.hasDragged = true;
        }
        el.scrollLeft = start.current.scrollLeft - dx;
      }}
      onPointerUp={() => {
        start.current.dragging = false;
      }}
      onPointerLeave={() => {
        start.current.dragging = false;
      }}
      onPointerCancel={() => {
        start.current.dragging = false;
      }}
      onClickCapture={(event) => {
        if (start.current.hasDragged) {
          event.stopPropagation();
          event.preventDefault();
        }
      }}
    >
      {children}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-4 text-xs font-semibold transition-all shadow-sm shrink-0",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}
