"use client";

import { Check } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { Menu, MenuItem, PricedLine } from "@/lib/api";
import { priceCart } from "@/lib/api";
import { cn, formatINR, formatMenuINR } from "@/lib/utils";

import { QuantityStepper } from "./quantity-stepper";

export interface CustomizationResult {
  item: MenuItem;
  size_code: string | null;
  crust: MenuItem | null;
  toppings: MenuItem[];
  quantity: number;
}

export function CustomizationSheet({
  item,
  menu,
  open,
  onOpenChange,
  onAdd,
}: {
  item: MenuItem | null;
  menu: Menu;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (result: CustomizationResult) => void;
}) {
  const [sizeCode, setSizeCode] = useState<string | null>(null);
  const [crustId, setCrustId] = useState<string | null>(null);
  const [toppingCounts, setToppingCounts] = useState<Record<string, number>>({});
  const [quantity, setQuantity] = useState(1);
  const [line, setLine] = useState<PricedLine | null>(null);
  const [pricing, setPricing] = useState(false);

  const hasSizes = item?.sizes && item.sizes.length > 0;
  const isPizza = item?.category_code?.includes("pizza");

  // Reset the builder each time a new item opens.
  useEffect(() => {
    if (open && item) {
      setSizeCode(hasSizes ? item.sizes[0].size_code : null);
      
      const crusts = menu.categories["crust"];
      setCrustId(isPizza && crusts && crusts.length > 0 ? crusts[0].id : null);
      
      setToppingCounts({});
      setQuantity(1);
      setLine(null);
    }
  }, [open, item, hasSizes, isPizza, menu.categories]);

  // A pizza is ready if it doesn't need sizes OR it has a size selected, and it has a crust selected.
  // Wait, some pizzas might not strictly require crusts? Actually, if it's a pizza, crust is required.
  const ready = Boolean(
    item &&
    (!hasSizes || sizeCode) &&
    (!isPizza || crustId)
  );

  const pricedToppingIds = useMemo(
    () => Object.entries(toppingCounts).flatMap(([id, count]) => Array(count).fill(id) as string[]),
    [toppingCounts]
  );

  // Live line price — server-computed (never client-side math).
  useEffect(() => {
    if (!item || !ready) {
      setLine(null);
      return;
    }
    let cancelled = false;
    setPricing(true);
    priceCart([
      {
        item_id: item.id,
        item_type: item.item_type || "generic",
        size_code: sizeCode,
        crust_id: crustId,
        topping_ids: pricedToppingIds,
        quantity,
      },
    ])
      .then((res) => {
        if (!cancelled) setLine(res.ok && res.lines ? res.lines[0] : null);
      })
      .catch(() => !cancelled && setLine(null))
      .finally(() => !cancelled && setPricing(false));
    return () => {
      cancelled = true;
    };
  }, [item, sizeCode, crustId, pricedToppingIds, quantity, ready]);

  const allToppings = useMemo(() => {
    return [
      ...(menu.categories["veg_topping"] || []),
      ...(menu.categories["non_veg_topping"] || []),
    ];
  }, [menu.categories]);

  const toppingIds = useMemo(
    () => Object.entries(toppingCounts).flatMap(([id, count]) => Array(count).fill(id) as string[]),
    [toppingCounts]
  );

  const selectedToppings = useMemo(
    () =>
      toppingIds
        .map((id) => allToppings.find((t) => t.id === id))
        .filter((t): t is MenuItem => Boolean(t)),
    [allToppings, toppingIds]
  );

  const addTopping = (id: string) => {
    setToppingCounts((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
  };

  const removeTopping = (id: string) => {
    setToppingCounts((prev) => {
      const nextCount = (prev[id] ?? 0) - 1;
      const next = { ...prev };
      if (nextCount > 0) next[id] = nextCount;
      else delete next[id];
      return next;
    });
  };

  const handleAdd = () => {
    if (!item) return;
    
    let crust = null;
    if (crustId) {
      const allCrusts = menu.categories["crust"] || [];
      crust = allCrusts.find((c) => c.id === crustId) || null;
    }

    onAdd({
      item,
      size_code: sizeCode,
      crust,
      toppings: selectedToppings,
      quantity,
    });
    onOpenChange(false);
  };

  if (!item) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title={item.name} description={isPizza ? "Build it your way" : "Choose your options"}>
        <div className="slick-scroll flex-1 space-y-6 overflow-y-auto px-5 py-5">
          
          {/* Step 1: Size */}
          {hasSizes && (
            <section>
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <StepDot n={1} done={!!sizeCode} />
                Choose Size
              </h3>
              <DragScroll className="slick-scroll flex select-none gap-2 overflow-x-auto pb-2">
                {item.sizes.map((s) => {
                  const sizeName = menu.sizes.find(sz => sz.code === s.size_code)?.name || s.size_code;
                  return (
                    <OptionButton
                      key={s.size_code}
                      selected={sizeCode === s.size_code}
                      onClick={() => setSizeCode(s.size_code)}
                      label={sizeName}
                      sub={formatMenuINR(s.price)}
                    />
                  );
                })}
              </DragScroll>
            </section>
          )}

          {/* Step 2: Crust (only for pizzas) */}
          {isPizza && (
            <section>
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <StepDot n={hasSizes ? 2 : 1} done={!!crustId} />
                Choose Crust
              </h3>
              <DragScroll className="slick-scroll flex select-none gap-2 overflow-x-auto pb-2">
                {(menu.categories["crust"] || []).map((c) => {
                  const priceInfo = c.sizes?.find(s => s.size_code === sizeCode)?.price || c.price || 0;
                  return (
                    <OptionButton
                      key={c.id}
                      selected={crustId === c.id}
                      onClick={() => setCrustId(c.id)}
                      label={c.name}
                      sub={priceInfo > 0 ? `+${formatMenuINR(priceInfo)}` : "Free"}
                    />
                  );
                })}
              </DragScroll>
            </section>
          )}

          {/* Step 3: Toppings */}
          {isPizza && (
            <section>
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <StepDot n={hasSizes ? 3 : 2} done={toppingIds.length > 0} />
                Add toppings
                <Badge variant={toppingIds.length ? "primary" : "default"}>
                  {toppingIds.length ? `${toppingIds.length} added` : "Any number"}
                </Badge>
              </h3>
              <DragScroll className="slick-scroll flex select-none gap-2 overflow-x-auto pb-2">
                {allToppings.map((t) => {
                  const count = toppingCounts[t.id] ?? 0;
                  const active = count > 0;
                  const priceInfo = t.sizes?.find(s => s.size_code === sizeCode)?.price || t.price || 0;
                  return (
                    <div key={t.id} className="flex w-28 shrink-0 flex-col items-center gap-2">
                      <div
                        onClick={() => addTopping(t.id)}
                        className={cn(
                          "flex h-28 w-full cursor-pointer flex-col items-start justify-between rounded-lg border p-3 text-left text-sm transition-colors",
                          active
                            ? "border-primary bg-primary/15 text-primary"
                            : "border-border bg-surface-2 text-foreground hover:border-primary/50"
                        )}
                      >
                        <span className="flex min-w-0 items-start gap-2">
                          {active && <Check className="size-3.5 shrink-0" />}
                          <span className="line-clamp-3 leading-tight">{t.name}</span>
                        </span>
                        <span className="mt-1 shrink-0 text-xs text-muted-foreground">
                          +{formatMenuINR(priceInfo)}
                        </span>
                      </div>
                      <div
                        className={cn(
                          "flex h-8 items-center gap-2 rounded-full transition-opacity",
                          active ? "opacity-100" : "opacity-0 pointer-events-none"
                        )}
                      >
                        <button
                          type="button"
                          aria-label={`Remove ${t.name}`}
                          onClick={(e) => { e.stopPropagation(); removeTopping(t.id); }}
                          className="grid size-7 place-items-center rounded-full bg-primary text-primary-foreground [&_svg]:size-3.5"
                        >
                          -
                        </button>
                        <span className="min-w-4 text-center text-sm font-semibold tabular-nums">
                          {count}
                        </span>
                        <button
                          type="button"
                          aria-label={`Add ${t.name}`}
                          onClick={(e) => { e.stopPropagation(); addTopping(t.id); }}
                          className="grid size-7 place-items-center rounded-full bg-primary text-primary-foreground [&_svg]:size-3.5"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
              </DragScroll>
            </section>
          )}


        </div>

        {/* Footer: live total + add */}
        <div className="shrink-0 border-t border-border bg-surface px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
          <div className="mb-4 flex items-center justify-between gap-4">
            <QuantityStepper value={quantity} onChange={setQuantity} />
            <div className="text-right">
              <span className="block text-xs text-muted-foreground">
                {ready ? "Line total (incl. GST)" : "Complete your selection"}
              </span>
              <span className="font-heading text-2xl font-bold tabular-nums">
                {line ? formatINR(line.total) : "—"}
              </span>
            </div>
          </div>
          {line && line.discount > 0 && (
            <div className="mb-3 text-right text-sm text-success">
              saved {formatINR(line.discount)}
            </div>
          )}
          <Button
            className="w-full"
            size="lg"
            disabled={!ready || pricing || !line}
            onClick={handleAdd}
          >
            {pricing ? "Pricing…" : "Add to order"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
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

function StepDot({ n, done }: { n: number; done?: boolean }) {
  return (
    <span
      className={cn(
        "grid size-5 place-items-center rounded-full text-xs font-bold",
        done
          ? "bg-primary text-primary-foreground"
          : "bg-surface-2 text-muted-foreground"
      )}
    >
      {done ? <Check className="size-3" /> : n}
    </span>
  );
}

function OptionButton({
  selected,
  onClick,
  label,
  sub,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex size-28 shrink-0 cursor-pointer flex-col items-start justify-between rounded-lg border p-3 text-left transition-colors",
        selected
          ? "border-primary bg-primary/10"
          : "border-border bg-surface-2 hover:border-primary/50"
      )}
    >
      <span className="line-clamp-3 text-sm font-medium leading-tight text-foreground">{label}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{sub}</span>
    </button>
  );
}
