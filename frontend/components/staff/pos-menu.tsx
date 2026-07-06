"use client";

import { Plus, Search, UtensilsCrossed } from "lucide-react";
import Image from "next/image";
import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import type { Menu, MenuItem } from "@/lib/api";
import { cn, formatMenuINR } from "@/lib/utils";

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

function getEmoji(categoryCode: string) {
  if (categoryCode.includes("pizza")) return "🍕";
  if (categoryCode === "beverage") return "🥤";
  if (categoryCode === "side" || categoryCode === "combo") return "🍟";
  if (categoryCode === "dessert") return "🍰";
  if (categoryCode === "dip") return "🍯";
  return "🍽️";
}

/**
 * POS step 2a — categorized menu grid with persistent category nav.
 * Left sidebar shows categories; main area shows items in that category.
 */
export function PosMenu({
  menu,
  onSelect,
  selectedId,
  onCategoryChange,
}: {
  menu: Menu;
  onSelect: (item: MenuItem) => void;
  selectedId?: string | null;
  onCategoryChange?: (code: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState<string | null>(null);

  const categories = useMemo(() => {
    if (!menu || !menu.categories) return [];
    return Object.entries(menu.categories)
      .filter(([code]) => !HIDDEN_CATEGORIES.has(code))
      .filter(([, items]) => items.length > 0)
      .map(([code, items]) => ({ code, label: getCategoryLabel(code), items: items as MenuItem[] }));
  }, [menu]);

  // Default to first category on load
  const currentCat = activeCat ?? categories[0]?.code ?? null;

  const displayItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) {
      // search across all categories
      const all: MenuItem[] = [];
      for (const { items } of categories) all.push(...items);
      return all.filter((p) => p.name.toLowerCase().includes(q));
    }
    const cat = categories.find((c) => c.code === currentCat);
    return cat ? cat.items : [];
  }, [categories, currentCat, query]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-surface px-4 py-3">
        <div className="flex items-center gap-3">
          <h2 className="font-heading text-lg font-bold">Menu</h2>
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-input bg-surface-2 px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <label htmlFor="pos-search" className="sr-only">Search menu</label>
            <Input
              id="pos-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search menu…"
              className="h-9 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0 text-sm"
            />
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left: Category nav */}
        {!query && (
          <nav className="slick-scroll w-[150px] shrink-0 overflow-y-auto overscroll-contain border-r border-border bg-surface-2/50">
            {categories.map(({ code, label }) => (
              <button
                key={code}
                type="button"
                onClick={() => {
                  setActiveCat(code);
                  onCategoryChange?.(code);
                }}
                className={cn(
                  "w-full px-2 py-3 text-left text-xs font-medium transition-colors border-l-2",
                  currentCat === code
                    ? "border-l-primary bg-primary/10 text-primary"
                    : "border-l-transparent text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </nav>
        )}

        {/* Right: Item grid */}
        <div className="slick-scroll min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain p-4 pb-24">
          {displayItems.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <UtensilsCrossed className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {query ? `No items match "${query}".` : "No items in this category."}
              </p>
            </div>
          ) : (
            <ul className="grid grid-cols-2 gap-3 xl:grid-cols-3">
              {displayItems.map((item) => {
                const minPrice = item.sizes && item.sizes.length > 0
                  ? Math.min(...item.sizes.map(s => s.price))
                  : item.price;
                const hasSizes = item.sizes && item.sizes.length > 0;
                const isSelected = selectedId === item.id;

                return (
                  <li key={item.id} className="flex">
                    <button
                      type="button"
                      onClick={() => onSelect(item)}
                      className={cn(
                        "group flex h-full min-h-48 w-full cursor-pointer flex-col rounded-xl border p-3 text-left transition-all",
                        isSelected
                          ? "border-primary bg-primary/10 shadow-md ring-1 ring-primary/30"
                          : "border-border bg-card hover:border-primary/60 hover:shadow-md"
                      )}
                    >
                      <span
                        aria-hidden
                        className="relative mb-2 flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-surface-2 text-4xl"
                      >
                        {item.image_url ? (
                          <Image src={item.image_url} alt={item.name} fill className="object-cover" />
                        ) : (
                          getEmoji(item.category_code)
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 min-h-[2.4rem] text-sm font-semibold leading-tight text-foreground">
                          {item.name}
                        </span>
                        <span className="mt-2 flex flex-col">
                          <span className="text-sm font-semibold tabular-nums text-foreground">
                            {formatMenuINR(minPrice)}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {hasSizes ? "starts at" : "per item"}
                          </span>
                        </span>
                      </span>
                      <span className={cn(
                        "mt-2 grid size-8 shrink-0 place-items-center self-end rounded-full transition-all [&_svg]:size-4",
                        isSelected
                          ? "bg-primary text-primary-foreground"
                          : "bg-primary/15 text-primary group-hover:bg-primary group-hover:text-primary-foreground"
                      )}>
                        <Plus />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
