"use client";

import { ArrowLeft, Check, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Menu, MenuItem, PricedLine } from "@/lib/api";
import { priceCart } from "@/lib/api";
import { useStaffPos } from "@/lib/staff-store";
import { cn, formatINR, formatMenuINR } from "@/lib/utils";

export interface PosCustomizationResult {
  item: MenuItem;
  size_code: string | null;
  crust: MenuItem | null;
  toppings: MenuItem[];
  quantity: number;
}

export function PosCustomize({
  item,
  menu,
  onAdd,
  onBack,
}: {
  item: MenuItem;
  menu: Menu;
  onAdd: (result: PosCustomizationResult) => void;
  onBack: () => void;
}) {
  const [sizeCode, setSizeCode] = useState<string | null>(null);
  const [crustId, setCrustId] = useState<string | null>(null);
  const [toppingCounts, setToppingCounts] = useState<Record<string, number>>({});
  const [quantity, setQuantity] = useState(1);
  const [line, setLine] = useState<PricedLine | null>(null);
  const [pricing, setPricing] = useState(false);

  const discountRate = useStaffPos((s) => s.discountRate);
  const discountThreshold = useStaffPos((s) => s.discountThreshold);
  const ticketQty = useStaffPos((s) =>
    s.ticket.reduce((n, l) => n + l.quantity, 0)
  );
  const ratePct = Math.round(discountRate * 100);
  const showDiscountHint =
    ratePct > 0 &&
    Number.isFinite(discountThreshold) &&
    discountThreshold > 1 &&
    discountThreshold < 1000;

  const hasSizes = item?.sizes && item.sizes.length > 0;
  const isPizza = item?.category_code?.includes("pizza");

  // Reset the builder whenever a different item is opened.
  useEffect(() => {
    if (item) {
      setSizeCode(hasSizes ? item.sizes[0].size_code : null);
      
      const crusts = menu.categories["crust"];
      setCrustId(isPizza && crusts && crusts.length > 0 ? crusts[0].id : null);
      
      setToppingCounts({});
      setQuantity(1);
      setLine(null);
    }
  }, [item, hasSizes, isPizza, menu.categories]);

  const ready = Boolean(
    item &&
    (!hasSizes || sizeCode) &&
    (!isPizza || crustId)
  );

  const pricedToppingIds = useMemo(
    () => Object.entries(toppingCounts).flatMap(([id, count]) => Array(count).fill(id) as string[]),
    [toppingCounts]
  );

  // Live line price — server-computed.
  useEffect(() => {
    if (!ready) {
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
  };

  const minPrice = item.sizes && item.sizes.length > 0 
    ? Math.min(...item.sizes.map(s => s.price))
    : item.price;

  return (
    <div className="flex h-full flex-col">
      {/* Panel header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-surface px-6 py-4">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to menu"
          className="grid size-11 cursor-pointer place-items-center rounded-full text-foreground transition-colors hover:bg-surface-2 [&_svg]:size-5"
        >
          <ArrowLeft />
        </button>
        <div className="min-w-0">
          <h2 className="truncate font-heading text-xl font-bold">
            {item.name}
          </h2>
          <p className="text-sm text-muted-foreground">
            {formatMenuINR(minPrice)} {hasSizes ? 'starts at' : ''} · build it for the customer
          </p>
        </div>
      </div>

      <div className="slick-scroll flex-1 space-y-8 overflow-y-auto px-6 py-6">
        
        {/* Step 1: Size */}
        {hasSizes && (
          <section>
            <h3 className="mb-3 flex items-center gap-2 text-base font-semibold">
              <StepDot n={1} done={!!sizeCode} />
              Choose Size
            </h3>
            <DragScroll className="slick-scroll flex select-none gap-3 overflow-x-auto pb-2">
              {item.sizes.map((s) => {
                const sizeName = menu.sizes.find(sz => sz.code === s.size_code)?.name || s.size_code;
                return (
                  <button
                    key={s.size_code}
                    type="button"
                    onClick={() => setSizeCode(s.size_code)}
                    className={cn(
                      "flex size-32 shrink-0 cursor-pointer flex-col items-start justify-between rounded-lg border p-4 text-left transition-colors",
                      sizeCode === s.size_code
                        ? "border-primary bg-primary/10"
                        : "border-border bg-surface-2 hover:border-primary/50"
                    )}
                  >
                    <span className="line-clamp-2 text-base font-medium leading-tight text-foreground">
                      {sizeName}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {formatMenuINR(s.price)}
                    </span>
                  </button>
                );
              })}
            </DragScroll>
          </section>
        )}

        {/* Step 2: Crust (only for pizzas) */}
        {isPizza && (
          <section>
            <h3 className="mb-3 flex items-center gap-2 text-base font-semibold">
              <StepDot n={hasSizes ? 2 : 1} done={!!crustId} />
              Choose Crust
            </h3>
            <DragScroll className="slick-scroll flex select-none gap-3 overflow-x-auto pb-2">
              {(menu.categories["crust"] || []).map((c) => {
                const priceInfo = c.sizes?.find(s => s.size_code === sizeCode)?.price || c.price || 0;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCrustId(c.id)}
                    className={cn(
                      "flex size-32 shrink-0 cursor-pointer flex-col items-start justify-between rounded-lg border p-4 text-left transition-colors",
                      crustId === c.id
                        ? "border-primary bg-primary/10"
                        : "border-border bg-surface-2 hover:border-primary/50"
                    )}
                  >
                    <span className="line-clamp-3 text-base font-medium leading-tight text-foreground">
                      {c.name}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {priceInfo > 0 ? `+${formatMenuINR(priceInfo)}` : "Free"}
                    </span>
                  </button>
                );
              })}
            </DragScroll>
          </section>
        )}

        {/* Step 3: toppings */}
        {isPizza && (
          <section>
            <h3 className="mb-3 flex items-center gap-2 text-base font-semibold">
              <StepDot n={hasSizes ? 3 : 2} done={toppingIds.length > 0} />
              Add toppings
              <Badge variant={toppingIds.length ? "primary" : "default"}>
                {toppingIds.length ? `${toppingIds.length} added` : "Any number"}
              </Badge>
            </h3>
            <DragScroll className="slick-scroll flex select-none gap-3 overflow-x-auto pb-2">
              {allToppings.map((t) => {
                const count = toppingCounts[t.id] ?? 0;
                const active = count > 0;
                const priceInfo = t.sizes?.find(s => s.size_code === sizeCode)?.price || t.price || 0;
                return (
                  <div key={t.id} className="flex w-32 shrink-0 flex-col items-center gap-2">
                    <div
                      onClick={() => addTopping(t.id)}
                      className={cn(
                        "flex h-32 w-full cursor-pointer flex-col items-start justify-between rounded-lg border p-3 text-left text-sm transition-colors",
                        active
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border bg-surface-2 text-foreground hover:border-primary/50"
                      )}
                    >
                      <span className="flex min-w-0 items-start gap-2">
                        {active && <Check className="size-4 shrink-0" />}
                        <span className="line-clamp-3 leading-tight">{t.name}</span>
                      </span>
                      <span className="mt-1 shrink-0 text-sm text-muted-foreground">
                        +{formatMenuINR(priceInfo)}
                      </span>
                    </div>
                    <div
                      className={cn(
                        "flex h-9 items-center gap-2 rounded-full transition-opacity",
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
                      <span className="min-w-5 text-center text-sm font-semibold tabular-nums">
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

      {/* Footer */}
      <div className="shrink-0 border-t border-border bg-surface px-6 py-4">
        {showDiscountHint && (
          <div className="mb-3 flex justify-end">
            {ticketQty + quantity >= discountThreshold ? (
              <Badge variant="success">
                {ratePct}% off — order has {discountThreshold}+ items
              </Badge>
            ) : (
              <span className="text-sm text-muted-foreground">
                Order {discountThreshold}+ items in total for {ratePct}% off
              </span>
            )}
          </div>
        )}
        <div className="mb-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <QtyButton
              label="Decrease quantity"
              disabled={quantity <= 1}
              onClick={() => setQuantity(quantity - 1)}
            >
              <Minus />
            </QtyButton>
            <span
              aria-live="polite"
              className="min-w-8 text-center text-xl font-semibold tabular-nums"
            >
              {quantity}
            </span>
            <QtyButton
              label="Increase quantity"
              disabled={quantity >= 10}
              onClick={() => setQuantity(quantity + 1)}
            >
              <Plus />
            </QtyButton>
          </div>
          <div className="text-right">
            <span className="block text-sm text-muted-foreground">
              {ready ? "Line total (incl. GST)" : "Complete the selection"}
            </span>
            <span className="font-heading text-3xl font-bold tabular-nums">
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
          size="lg"
          className="h-14 w-full text-base"
          disabled={!ready || pricing || !line}
          onClick={handleAdd}
        >
          {pricing ? "Pricing…" : "Save to ticket"}
        </Button>
      </div>
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

function StepDot({ n, done }: { n: number; done?: boolean }) {
  return (
    <span
      className={cn(
        "grid size-6 place-items-center rounded-full text-xs font-bold",
        done
          ? "bg-primary text-primary-foreground"
          : "bg-surface-2 text-muted-foreground"
      )}
    >
      {done ? <Check className="size-3.5" /> : n}
    </span>
  );
}

function QtyButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-12 cursor-pointer place-items-center rounded-full border border-border bg-surface-2 text-foreground transition-colors hover:border-primary hover:text-primary disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-5"
    >
      {children}
    </button>
  );
}
