"use client";

import {
  ArrowLeft,
  Banknote,
  Check,
  CreditCard,
  Gift,
  Loader2,
  Phone,
  ShoppingBag,
  Smartphone,
  Tag,
  User,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type CouponRule,
  checkoutCart,
  listAvailableCoupons,
  validateCoupon,
} from "@/lib/api";
import { toPayload, useStaffPos } from "@/lib/staff-store";
import { cn, formatINR, roundFinalAmount } from "@/lib/utils";

// ── Coupon picker popup (same as customer checkout) ────────────────────────

function CouponPicker({
  coupons,
  onSelect,
  onClose,
}: {
  coupons: CouponRule[];
  onSelect: (code: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-md rounded-t-2xl border border-border bg-card sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Gift className="size-5 text-primary" />
            <span className="font-heading text-base font-semibold">Available Coupons</span>
          </div>
          <button type="button" onClick={onClose} className="grid size-8 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors hover:bg-surface-2">
            <X className="size-4" />
          </button>
        </div>
        <div className="slick-scroll max-h-[55vh] overflow-y-auto p-3 space-y-2">
          {coupons.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No coupons available right now.</p>
          ) : (
            coupons.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => { onSelect(c.coupon_code); onClose(); }}
                className="group flex w-full cursor-pointer items-start gap-3 rounded-xl border border-dashed border-primary/40 bg-primary/5 p-3.5 text-left transition-colors hover:border-primary hover:bg-primary/10"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
                  <Tag className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-sm font-bold tracking-wider text-primary">{c.coupon_code}</span>
                  <span className="block text-sm font-medium">{c.name} — {c.discount_percent}% off</span>
                  {c.description && <span className="block text-xs text-muted-foreground">{c.description}</span>}
                  {c.threshold_amount > 0 && <span className="block text-xs text-muted-foreground">Min. order {formatINR(c.threshold_amount)}</span>}
                </span>
                <span className="shrink-0 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">Apply →</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * POS step 3 — take payment at the counter. Mirrors the customer checkout
 * screen section-for-section (contact, payment method, order summary, sticky
 * total footer, simulated UPI overlay), staffed for in-store: Cash or UPI
 * only, no delivery address, order `type` = store.
 */
const METHODS = [
  {
    id: "cash",
    label: "Cash",
    desc: "Collect cash at the counter",
    mode: "1",
    icon: Banknote,
  },
  {
    id: "card",
    label: "Card",
    desc: "Swipe or tap on the card machine",
    mode: "2",
    icon: CreditCard,
  },
  {
    id: "upi",
    label: "UPI",
    desc: "Customer scans the counter QR — GPay, PhonePe, Paytm",
    mode: "3",
    icon: Smartphone,
  },
] as const;

const ORDER_TYPE_LABEL = { dine_in: "Dine In", takeaway: "Takeaway" } as const;
const ORDER_TYPE_ICON = { dine_in: UtensilsCrossed, takeaway: ShoppingBag } as const;

export function PosPayment() {
  const {
    customerName,
    customerPhone,
    orderType,
    ticket,
    totals,
    reprice,
    setStep,
    setPlaced,
    clearTicket,
  } = useStaffPos();
  const OrderTypeIcon = ORDER_TYPE_ICON[orderType];

  const [methodId, setMethodId] =
    useState<(typeof METHODS)[number]["id"]>("cash");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Coupon state
  const [couponInput, setCouponInput] = useState("");
  const [couponApplied, setCouponApplied] = useState<{
    code: string;
    name: string;
    discountPercent: number;
    discountAmount: number;
    savings: number;
    newTotal: number;
  } | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [availableCoupons, setAvailableCoupons] = useState<CouponRule[]>([]);
  const [couponsLoaded, setCouponsLoaded] = useState(false);

  // Re-price on entry so the totals are always the server's latest numbers
  useEffect(() => {
    void reprice();
  }, [reprice]);

  const loadCoupons = useCallback(async () => {
    if (couponsLoaded) return;
    try {
      const res = await listAvailableCoupons();
      setAvailableCoupons(res.coupons ?? []);
    } catch {
      setAvailableCoupons([]);
    } finally {
      setCouponsLoaded(true);
    }
  }, [couponsLoaded]);

  const handleApplyCoupon = useCallback(async (code: string) => {
    const raw = code.trim().toUpperCase();
    if (!raw || !totals) return;
    setCouponLoading(true);
    setCouponError(null);
    try {
      const res = await validateCoupon(raw, totals.total);
      if (!res.ok) {
        setCouponError(Object.values(res.errors ?? {})[0] ?? "Invalid coupon.");
        setCouponApplied(null);
      } else {
        setCouponApplied({
          code: res.coupon_code!,
          name: res.coupon_name!,
          discountPercent: res.discount_percent!,
          discountAmount: res.discount_amount!,
          savings: res.savings!,
          newTotal: res.new_total!,
        });
        setCouponError(null);
        setCouponInput(res.coupon_code!);
      }
    } catch {
      setCouponError("Couldn't validate coupon.");
    } finally {
      setCouponLoading(false);
    }
  }, [totals]);

  const removeCoupon = () => {
    setCouponApplied(null);
    setCouponInput("");
    setCouponError(null);
  };

  const finalTotal = couponApplied ? couponApplied.newTotal : totals?.total;
  const finalSavings = couponApplied ? couponApplied.savings : 0;

  const method = METHODS.find((m) => m.id === methodId)!;
  const canPlace = ticket.length > 0 && !processing;

  const place = async () => {
    if (!canPlace) return;
    setError(null);
    setProcessing(true);

    if (method.id === "upi" || method.id === "card") {
      await new Promise((r) => setTimeout(r, 1600));
    }

    try {
      const res = await checkoutCart({
        user_id: "",
        name: customerName,
        phone: customerPhone,
        payment_mode: method.mode,
        address: "",
        type: orderType,
        lines: ticket.map(toPayload),
        ...(couponApplied ? { coupon_code: couponApplied.code } : {}),
      });
      if (!res.ok || !res.order_no) {
        const first = res.errors ? Object.values(res.errors)[0] : null;
        setError(first ?? "Couldn't place the order. Please try again.");
        setProcessing(false);
        return;
      }
      const placedTotal = couponApplied?.newTotal ?? res.total ?? totals?.total ?? 0;
      clearTicket();
      setPlaced(res.order_no, placedTotal);
    } catch {
      setError("Can't reach SliceMatic right now. Please try again.");
      setProcessing(false);
    }
  };

  return (
    <div className="relative flex h-full flex-col">
      {/* Panel header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-surface px-6 py-4">
        <button
          type="button"
          onClick={() => setStep("build")}
          disabled={processing}
          aria-label="Back to the order"
          className="grid size-11 cursor-pointer place-items-center rounded-full text-foreground transition-colors hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-5"
        >
          <ArrowLeft />
        </button>
        <h2 className="font-heading text-xl font-bold">Payment</h2>
      </div>

      <div className="slick-scroll flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-xl space-y-6 px-6 py-6">
          {/* Customer — compact contact card, like the customer checkout */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Customer</h3>
              {!processing && (
                <button
                  type="button"
                  onClick={() => setStep("details")}
                  className="cursor-pointer text-xs font-medium text-primary hover:underline"
                >
                  Edit
                </button>
              )}
            </div>
            <div className="space-y-2.5 rounded-xl border border-border bg-surface-2 p-3.5">
              <div className="flex items-center gap-3 text-sm">
                <User className="size-4 shrink-0 text-muted-foreground" />
                <span className="font-medium">{customerName}</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Phone className="size-4 shrink-0 text-muted-foreground" />
                <span className="font-medium">{customerPhone}</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <OrderTypeIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="font-medium">{ORDER_TYPE_LABEL[orderType]}</span>
              </div>
            </div>
          </section>

          {/* Payment method */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Payment method</h3>
            <div className="space-y-2">
              {METHODS.map((m) => {
                const Icon = m.icon;
                const active = methodId === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    disabled={processing}
                    onClick={() => setMethodId(m.id)}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-3 rounded-xl border p-3.5 text-left transition-colors",
                      active
                        ? "border-primary bg-primary/10"
                        : "border-border bg-surface-2 hover:border-primary/50",
                      processing && "pointer-events-none opacity-60"
                    )}
                  >
                    <span
                      className={cn(
                        "grid size-9 shrink-0 place-items-center rounded-lg [&_svg]:size-5",
                        active
                          ? "bg-primary text-primary-foreground"
                          : "bg-card text-muted-foreground"
                      )}
                    >
                      <Icon />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">
                        {m.label}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {m.desc}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "grid size-5 shrink-0 place-items-center rounded-full border",
                        active ? "border-primary bg-primary" : "border-border"
                      )}
                    >
                      {active && (
                        <Check className="size-3 text-primary-foreground" />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Coupon section */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Coupon / Promo</h3>
              <button
                id="pos-view-coupons"
                type="button"
                onClick={() => { void loadCoupons(); setShowPicker(true); }}
                className="flex cursor-pointer items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <Gift className="size-3.5" />
                View available
              </button>
            </div>
            {couponApplied ? (
              <div className="flex items-center gap-3 rounded-xl border border-green-500/40 bg-green-500/10 px-3.5 py-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-green-500/20 text-green-600 dark:text-green-400">
                  <Tag className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-sm font-bold tracking-wider text-green-600 dark:text-green-400">{couponApplied.code}</span>
                  <span className="block text-xs text-muted-foreground">
                    {couponApplied.name} — {couponApplied.discountPercent}% off · saving{" "}
                    <span className="font-medium text-green-600 dark:text-green-400">{formatINR(couponApplied.savings)}</span>
                  </span>
                </span>
                <button type="button" onClick={removeCoupon} aria-label="Remove coupon"
                  className="grid size-7 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors hover:bg-surface-2">
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input
                  id="pos-coupon-input"
                  className="bg-card font-mono tracking-wider uppercase"
                  placeholder="Enter coupon code"
                  value={couponInput}
                  onChange={(e) => { setCouponInput(e.target.value.toUpperCase()); setCouponError(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") void handleApplyCoupon(couponInput); }}
                />
                <Button
                  id="pos-apply-coupon"
                  type="button"
                  variant="secondary"
                  disabled={!couponInput.trim() || couponLoading}
                  onClick={() => void handleApplyCoupon(couponInput)}
                  className="shrink-0"
                >
                  {couponLoading ? <Loader2 className="size-4 animate-spin" /> : "Apply"}
                </Button>
              </div>
            )}
            {couponError && <p className="text-xs text-destructive">{couponError}</p>}
          </section>

          {/* Order summary — same rows as the customer checkout */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Order summary</h3>
            <ul className="space-y-2 rounded-xl border border-border bg-surface-2 p-3.5">
              {ticket.map((l) => (
                <li key={l.id} className="flex justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">
                      {l.quantity}× {l.item.name} {l.size_code && `(${l.size_code})`}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {l.crust?.name ? `${l.crust.name}` : ""}
                      {l.crust && l.toppings.length > 0 ? " · " : ""}
                      {l.toppings.length > 0 ? l.toppings.map((t) => t.name).join(", ") : ""}
                      {!l.crust && l.toppings.length === 0 && l.item.category_code !== 'pizza' ? l.item.item_type || '' : ""}
                    </span>
                  </span>
                </li>
              ))}
              {totals && totals.discount > 0 && (
                <li className="flex justify-between border-t border-border pt-2 text-sm text-success">
                  <span>Bulk discount</span>
                  <span className="tabular-nums">−{formatINR(totals.discount)}</span>
                </li>
              )}
              <li className={cn("flex justify-between text-sm text-muted-foreground", !(totals && totals.discount > 0) && "border-t border-border pt-2")}>
                <span>GST (18%) included</span>
                <span className="tabular-nums">{totals ? formatINR(totals.gst) : "…"}</span>
              </li>
              {couponApplied && (
                <li className="flex justify-between text-sm text-green-600 dark:text-green-400">
                  <span>Coupon savings ({couponApplied.code})</span>
                  <span className="tabular-nums">−{formatINR(couponApplied.savings)}</span>
                </li>
              )}
            </ul>
          </section>

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Sticky place-order footer */}
      <div className="shrink-0 border-t border-border bg-surface px-6 py-4">
        <div className="mx-auto flex w-full max-w-xl items-center gap-3">
          <div className="min-w-0">
            <span className="block text-xs text-muted-foreground">Total payable</span>
            <div className="flex items-baseline gap-1.5">
              <span className="font-heading text-xl font-bold tabular-nums">
                {finalTotal != null ? formatINR(roundFinalAmount(finalTotal)) : "…"}
              </span>
              {finalSavings > 0 && (
                <span className="text-xs font-medium text-green-600 dark:text-green-400">({formatINR(finalSavings)} saved)</span>
              )}
            </div>
          </div>
          <Button
            id="pos-place-order"
            size="lg"
            className="h-14 flex-1 text-base"
            disabled={!canPlace}
            onClick={place}
          >
            {processing
              ? "Placing…"
              : method.id === "cash"
                ? "Place order"
                : `Pay ${finalTotal != null ? formatINR(roundFinalAmount(finalTotal)) : ""}`}
          </Button>
        </div>
      </div>

      {/* Simulated UPI/card processing overlay */}
      {processing && method.id !== "cash" && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/90 backdrop-blur-sm">
          <Loader2 className="size-12 animate-spin text-primary" />
          <div className="text-center">
            <p className="font-heading text-xl font-semibold">
              {method.id === "card" ? "Processing card payment" : "Waiting for UPI payment"}
            </p>
            <p className="text-sm text-muted-foreground">
              {finalTotal != null ? formatINR(finalTotal) : ""} ·{" "}
              {method.id === "card" ? "complete on the card machine" : "ask the customer to approve"}
            </p>
          </div>
        </div>
      )}

      {/* Coupon picker popup */}
      {showPicker && (
        <CouponPicker
          coupons={availableCoupons}
          onSelect={(code) => { setCouponInput(code); void handleApplyCoupon(code); }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}
