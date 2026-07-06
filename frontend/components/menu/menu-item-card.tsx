"use client";

import { Plus } from "lucide-react";
import Image from "next/image";

import { Badge } from "@/components/ui/badge";
import type { MenuItem } from "@/lib/api";
import { cn, formatMenuINR } from "@/lib/utils";

function getEmoji(categoryCode: string) {
  if (categoryCode.includes("pizza")) return "🍕";
  if (categoryCode === "beverage") return "🥤";
  if (categoryCode === "side" || categoryCode === "combo") return "🍟";
  if (categoryCode === "dessert") return "🍰";
  if (categoryCode === "dip") return "🍯";
  return "🍽️";
}

export function MenuItemCard({
  item,
  onSelect,
}: {
  item: MenuItem;
  onSelect: (item: MenuItem) => void;
}) {
  const desc = item.description || "Delicious selection from our menu.";
  const isNonVeg = item.item_type?.toLowerCase().includes("non-veg");
  const isBestSeller = item.name.includes("Margherita") || item.name.includes("Paneer") || item.category_code === "combo";

  const minPrice = item.sizes && item.sizes.length > 0 
    ? Math.min(...item.sizes.map(s => s.price))
    : item.price;
    
  const showStartsAt = item.sizes && item.sizes.length > 0;

  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className="group flex h-full w-full cursor-pointer flex-col rounded-2xl border border-border/70 bg-card p-4 text-left transition-all shadow-sm hover:border-primary/60 hover:shadow-lg hover:brightness-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* Visual Header */}
      <div className="relative mb-3.5 flex aspect-[16/10] w-full items-center justify-center overflow-hidden rounded-xl bg-gradient-to-tr from-amber-500/10 via-orange-500/15 to-red-500/10 border border-border/50">
        {item.image_url ? (
          <Image src={item.image_url} alt={item.name} fill className="object-cover transition-transform duration-500 group-hover:scale-105" />
        ) : (
          <span className="text-5xl filter drop-shadow-md select-none transition-transform duration-500 group-hover:scale-115 group-hover:rotate-12">
            {getEmoji(item.category_code)}
          </span>
        )}
        
        {/* Veg/Non-Veg Indicator */}
        {item.item_type && (
          <div className="absolute top-2.5 left-2.5 flex items-center justify-center p-0.5 rounded border border-border bg-background/90 z-10">
            <span className={cn("size-2 rounded-full", isNonVeg ? "bg-red-600" : "bg-green-600")} />
          </div>
        )}

        {/* Best Seller Tag */}
        {isBestSeller && (
          <Badge className="absolute top-2.5 right-2.5 bg-amber-500 hover:bg-amber-600 text-[9px] font-bold text-white uppercase px-1.5 py-0.5 border-none leading-none h-4 z-10">
            Bestseller
          </Badge>
        )}
      </div>

      <div className="space-y-1 w-full flex-1">
        <h3 className="line-clamp-2 min-h-[2.3rem] font-heading text-sm font-bold leading-snug text-foreground transition-colors group-hover:text-primary">
          {item.name}
        </h3>
        <p className="line-clamp-2 text-[11px] leading-normal text-muted-foreground min-h-[2rem]">
          {desc}
        </p>
      </div>

      <div className="mt-auto w-full flex items-center justify-between pt-2.5 border-t border-border/40">
        <div className="flex flex-col">
          <span className="text-sm font-bold text-foreground tabular-nums">{formatMenuINR(minPrice)}</span>
          <span className="text-[9px] text-muted-foreground">
            {showStartsAt ? "starts at" : "per item"}
          </span>
        </div>
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary hover:bg-primary/95 text-primary-foreground transition-transform group-hover:scale-105 shadow-sm">
          <Plus className="size-4.5" />
        </span>
      </div>
    </button>
  );
}
