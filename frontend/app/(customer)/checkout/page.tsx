"use client";

import {
  ArrowLeft,
  Bike,
  Check,
  CreditCard,
  Gift,
  Loader2,
  MapPin,
  Phone,
  ShoppingBag,
  Smartphone,
  Store,
  Tag,
  User,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type CouponRule,
  checkoutCart,
  listAvailableCoupons,
  validateCoupon,
} from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { toPayload, useMenuStore } from "@/lib/menu-store";
import { cn, formatINR, roundFinalAmount } from "@/lib/utils";

const METHODS = [
  {
    id: "cod",
    label: "Cash on Delivery",
    desc: "Pay cash when it arrives",
    mode: "1",
    icon: Bike,
  },
  {
    id: "cash",
    label: "Cash at Store",
    desc: "Pay at the counter on pickup",
    mode: "1",
    icon: Store,
  },
  {
    id: "upi",
    label: "UPI",
    desc: "Pay now — GPay, PhonePe, Paytm",
    mode: "3",
    icon: Smartphone,
  },
  {
    id: "card",
    label: "Credit / Debit Card",
    desc: "Visa, Mastercard, RuPay",
    mode: "2",
    icon: CreditCard,
  },
] as const;

// ── Coupon picker popup ────────────────────────────────────────────────────

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
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Gift className="size-5 text-primary" />
            <span className="font-heading text-base font-semibold">
              Available Coupons
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-8 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors hover:bg-surface-2"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Coupon list */}
        <div className="slick-scroll max-h-[60vh] overflow-y-auto p-3 space-y-2">
          {coupons.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No coupons available right now.
            </p>
          ) : (
            coupons.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  onSelect(c.coupon_code);
                  onClose();
                }}
                className="group flex w-full cursor-pointer items-start gap-3 rounded-xl border border-dashed border-primary/40 bg-primary/5 p-3.5 text-left transition-colors hover:border-primary hover:bg-primary/10"
              >
                {/* Left: tag icon + code */}
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
                  <Tag className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-sm font-bold tracking-wider text-primary">
                    {c.coupon_code}
                  </span>
                  <span className="block text-sm font-medium">
                    {c.name} — {c.discount_percent}% off
                  </span>
                  {c.description && (
                    <span className="block text-xs text-muted-foreground">
                      {c.description}
                    </span>
                  )}
                  {c.threshold_amount > 0 && (
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      Min. order {formatINR(c.threshold_amount)}
                    </span>
                  )}
                  {c.end_date && (
                    <span className="mt-0.5 block text-xs text-amber-600 dark:text-amber-400">
                      Valid until {new Date(c.end_date).toLocaleDateString("en-IN")}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                  Apply →
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main checkout page ─────────────────────────────────────────────────────

export default function CheckoutPage() {
  const router = useRouter();
  const { cart, totals, reprice, clearCart } = useMenuStore();
  const user = useAuthStore((s) => s.user);
  const addresses = useMemo(() => user?.address ?? [], [user]);

  const [name, setName] = useState(user?.name ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [addressId, setAddressId] = useState(
    addresses.find((a) => a.isDefault)?.id ?? addresses[0]?.id
  );
  const [methodId, setMethodId] = useState<(typeof METHODS)[number]["id"]>("cod");
  const [editingContact, setEditingContact] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvv, setCardCvv] = useState("");

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

  const handleApplyCoupon = useCallback(
    async (code: string) => {
      const raw = code.trim().toUpperCase();
      if (!raw) return;
      if (!totals) {
        setCouponError("Cart total not loaded yet. Please wait.");
        return;
      }
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
        setCouponError("Couldn't validate coupon. Please try again.");
      } finally {
        setCouponLoading(false);
      }
    },
    [totals]
  );

  const removeCoupon = () => {
    setCouponApplied(null);
    setCouponInput("");
    setCouponError(null);
  };

  const finalTotal = couponApplied ? couponApplied.newTotal : totals?.total;
  const finalSavings = couponApplied ? couponApplied.savings : 0;

  const nameOk = /^[A-Za-z ]{2,40}$/.test(name.trim());
  const phoneOk = /^[6-9]\d{9}$/.test(phone.trim());
  const showContactEditor = editingContact || !nameOk || !phoneOk;
  const method = METHODS.find((m) => m.id === methodId)!;
  const address = useMemo(
    () => addresses.find((a) => a.id === addressId),
    [addresses, addressId]
  );
  const needsAddress = method.id !== "cash";
  const cardOk =
    method.id !== "card" ||
    (/^\d{16}$/.test(cardNumber.replace(/\s/g, "")) &&
      /^\d{2}\/\d{2}$/.test(cardExpiry) &&
      /^\d{3,4}$/.test(cardCvv));
  const canPlace =
    nameOk &&
    phoneOk &&
    cardOk &&
    cart.length > 0 &&
    !processing &&
    (!needsAddress || !!address);

  const place = async () => {
    if (!canPlace) return;
    setError(null);
    setProcessing(true);

    // Simulated payment step for UPI/Card (no real gateway).
    if (method.id === "upi" || method.id === "card") {
      await new Promise((r) => setTimeout(r, 1600));
    }

    try {
      const res = await checkoutCart({
        user_id: user?.id ?? "",
        name: name.trim(),
        phone: phone.trim(),
        payment_mode: method.mode,
        address: needsAddress && address ? `${address.label}: ${address.line}` : "",
        type: needsAddress ? "online" : "takeaway",
        lines: cart.map(toPayload),
        ...(couponApplied ? { coupon_code: couponApplied.code } : {}),
      });
      if (!res.ok || !res.order_no) {
        const first = res.errors ? Object.values(res.errors)[0] : null;
        setError(first ?? "Couldn't place your order. Please try again.");
        setProcessing(false);
        return;
      }
      clearCart();
      router.push(`/orders?placed=${encodeURIComponent(res.order_no)}`);
    } catch {
      setError("Can't reach SliceMatic right now. Please try again.");
      setProcessing(false);
    }
  };

  if (cart.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
        <ShoppingBag className="size-9 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Your order is empty — add a pizza first.
        </p>
        <Button asChild>
          <Link href="/menu">Browse the menu</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col">
      {/* Screen header */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Go back"
          className="grid size-9 cursor-pointer place-items-center rounded-full text-foreground transition-colors hover:bg-surface-2 [&_svg]:size-5"
        >
          <ArrowLeft />
        </button>
        <h1 className="font-heading text-lg font-bold">Checkout</h1>
      </div>

      <div className="slick-scroll flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-5">
          {/* Delivery contact */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Delivery contact</h2>
              {!showContactEditor && (
                <button
                  type="button"
                  onClick={() => setEditingContact(true)}
                  className="cursor-pointer text-xs font-medium text-primary hover:underline"
                >
                  Edit
                </button>
              )}
            </div>

            {showContactEditor ? (
              <div className="space-y-3 rounded-xl border border-border bg-surface-2 p-3.5">
                <div>
                  <label htmlFor="co-name" className="mb-1 block text-xs text-muted-foreground">
                    Name
                  </label>
                  <Input
                    id="co-name"
                    className="bg-card"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    aria-invalid={!nameOk}
                  />
                  {!nameOk && (
                    <p className="mt-1 text-xs text-destructive">
                      Use letters only, 2–40 characters.
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="co-phone" className="mb-1 block text-xs text-muted-foreground">
                    Phone
                  </label>
                  <Input
                    id="co-phone"
                    type="tel"
                    inputMode="numeric"
                    className="bg-card"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    aria-invalid={!phoneOk}
                  />
                  {!phoneOk && (
                    <p className="mt-1 text-xs text-destructive">
                      Enter a 10-digit number starting 6–9.
                    </p>
                  )}
                </div>
                {nameOk && phoneOk && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setEditingContact(false)}
                  >
                    Done
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-2.5 rounded-xl border border-border bg-surface-2 p-3.5">
                <div className="flex items-center gap-3 text-sm">
                  <User className="size-4 shrink-0 text-muted-foreground" />
                  <span className="font-medium">{name}</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <Phone className="size-4 shrink-0 text-muted-foreground" />
                  <span className="font-medium">{phone}</span>
                </div>
              </div>
            )}
          </section>

          {/* Address */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">
              {needsAddress ? "Deliver to" : "Pickup"}
            </h2>
            {!needsAddress ? (
              <div className="rounded-xl border border-border bg-surface-2 p-3.5 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  SliceMatic, New Ashok Nagar
                </span>{" "}
                — pay at the counter and collect your order.
              </div>
            ) : addresses.length === 0 ? (
              <div
                role="alert"
                className="space-y-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3.5"
              >
                <p className="text-sm text-destructive">
                  No delivery address saved — add one to your profile before
                  placing a delivery order.
                </p>
                <Button asChild size="sm" variant="secondary">
                  <Link href="/profile">Add an address</Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {addresses.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setAddressId(a.id)}
                    className={cn(
                      "flex w-full cursor-pointer items-start gap-3 rounded-xl border p-3.5 text-left transition-colors",
                      addressId === a.id
                        ? "border-primary bg-primary/10"
                        : "border-border bg-surface-2 hover:border-primary/50"
                    )}
                  >
                    <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{a.label}</span>
                      <span className="block text-sm text-muted-foreground">
                        {a.line}
                      </span>
                    </span>
                    {addressId === a.id && (
                      <Check className="size-4 shrink-0 text-primary" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Payment */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Payment method</h2>
            <div className="space-y-2">
              {METHODS.map((m) => {
                const Icon = m.icon;
                const active = methodId === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMethodId(m.id)}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-3 rounded-xl border p-3.5 text-left transition-colors",
                      active
                        ? "border-primary bg-primary/10"
                        : "border-border bg-surface-2 hover:border-primary/50"
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
                      <span className="block text-sm font-medium">{m.label}</span>
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

            {methodId === "card" && (
              <div className="space-y-3 rounded-xl border border-border bg-surface-2 p-3.5">
                <div>
                  <label
                    htmlFor="co-card-number"
                    className="mb-1 block text-xs text-muted-foreground"
                  >
                    Card number
                  </label>
                  <Input
                    id="co-card-number"
                    className="bg-card"
                    inputMode="numeric"
                    placeholder="1234 5678 9012 3456"
                    maxLength={16}
                    value={cardNumber}
                    onChange={(e) => setCardNumber(e.target.value.replace(/\D/g, ""))}
                  />
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label
                      htmlFor="co-card-expiry"
                      className="mb-1 block text-xs text-muted-foreground"
                    >
                      MM/YY
                    </label>
                    <Input
                      id="co-card-expiry"
                      className="bg-card"
                      placeholder="MM/YY"
                      maxLength={5}
                      value={cardExpiry}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
                        setCardExpiry(
                          digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits
                        );
                      }}
                    />
                  </div>
                  <div className="flex-1">
                    <label
                      htmlFor="co-card-cvv"
                      className="mb-1 block text-xs text-muted-foreground"
                    >
                      CVV
                    </label>
                    <Input
                      id="co-card-cvv"
                      className="bg-card"
                      type="password"
                      inputMode="numeric"
                      placeholder="123"
                      maxLength={4}
                      value={cardCvv}
                      onChange={(e) => setCardCvv(e.target.value.replace(/\D/g, ""))}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Simulated payment — no real card is charged.
                </p>
              </div>
            )}
          </section>

          {/* ── Coupon section ── */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Coupon / Promo</h2>
              <button
                id="checkout-view-coupons"
                type="button"
                onClick={() => {
                  void loadCoupons();
                  setShowPicker(true);
                }}
                className="flex cursor-pointer items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <Gift className="size-3.5" />
                View available coupons
              </button>
            </div>

            {couponApplied ? (
              /* Applied coupon strip */
              <div className="flex items-center gap-3 rounded-xl border border-green-500/40 bg-green-500/10 px-3.5 py-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-green-500/20 text-green-600 dark:text-green-400">
                  <Tag className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-sm font-bold tracking-wider text-green-600 dark:text-green-400">
                    {couponApplied.code}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {couponApplied.name} — {couponApplied.discountPercent}% off · saving{" "}
                    <span className="font-medium text-green-600 dark:text-green-400">
                      {formatINR(couponApplied.savings)}
                    </span>
                  </span>
                </span>
                <button
                  id="checkout-remove-coupon"
                  type="button"
                  onClick={removeCoupon}
                  aria-label="Remove coupon"
                  className="grid size-7 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors hover:bg-surface-2"
                >
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              /* Coupon input */
              <div className="flex gap-2">
                <Input
                  id="checkout-coupon-input"
                  className="bg-card font-mono tracking-wider uppercase"
                  placeholder="Enter coupon code"
                  value={couponInput}
                  onChange={(e) => {
                    setCouponInput(e.target.value.toUpperCase());
                    setCouponError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleApplyCoupon(couponInput);
                  }}
                />
                <Button
                  id="checkout-apply-coupon"
                  type="button"
                  variant="secondary"
                  disabled={!couponInput.trim() || couponLoading}
                  onClick={() => void handleApplyCoupon(couponInput)}
                  className="shrink-0"
                >
                  {couponLoading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    "Apply"
                  )}
                </Button>
              </div>
            )}

            {couponError && (
              <p className="text-xs text-destructive">{couponError}</p>
            )}
          </section>

          {/* Order summary */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Order summary</h2>
            <ul className="space-y-2 rounded-xl border border-border bg-surface-2 p-3.5">
              {cart.map((l) => (
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
              <li className="flex justify-between border-t border-border pt-2 text-sm text-muted-foreground">
                <span>GST (18%) included</span>
                <span className="tabular-nums">{totals ? formatINR(totals.gst) : "…"}</span>
              </li>
              {couponApplied && (
                <>
                  <li className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Original total</span>
                    <span className="tabular-nums line-through text-muted-foreground">
                      {totals ? formatINR(totals.total) : "…"}
                    </span>
                  </li>
                  <li className="flex justify-between text-sm text-green-600 dark:text-green-400">
                    <span>Coupon savings ({couponApplied.code})</span>
                    <span className="tabular-nums">−{formatINR(couponApplied.savings)}</span>
                  </li>
                </>
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
      <div className="shrink-0 border-t border-border bg-surface px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-3">
          <div className="min-w-0">
            <span className="block text-xs text-muted-foreground">Total payable</span>
            <div className="flex items-baseline gap-1.5">
              <span className="font-heading text-xl font-bold tabular-nums">
                {finalTotal != null ? formatINR(roundFinalAmount(finalTotal)) : "…"}
              </span>
              {finalSavings > 0 && (
                <span className="text-xs font-medium text-green-600 dark:text-green-400">
                  ({formatINR(finalSavings)} saved)
                </span>
              )}
            </div>
          </div>
          <Button
            id="checkout-place-order"
            className="flex-1"
            size="lg"
            disabled={!canPlace}
            onClick={place}
          >
            {processing
              ? "Placing…"
              : method.id === "upi" || method.id === "card"
                ? `Pay ${finalTotal != null ? formatINR(roundFinalAmount(finalTotal)) : ""}`
                : "Place order"}
          </Button>
        </div>
      </div>

      {/* Simulated payment overlay */}
      {processing && (method.id === "upi" || method.id === "card") && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/90 backdrop-blur-sm">
          <Loader2 className="size-10 animate-spin text-primary" />
          <div className="text-center">
            <p className="font-heading text-lg font-semibold">
              {method.id === "upi" ? "Processing UPI payment" : "Processing card payment"}
            </p>
            <p className="text-sm text-muted-foreground">
              {finalTotal != null ? formatINR(finalTotal) : ""} · do not close this screen
            </p>
          </div>
        </div>
      )}

      {/* Coupon picker popup */}
      {showPicker && (
        <CouponPicker
          coupons={availableCoupons}
          onSelect={(code) => {
            setCouponInput(code);
            void handleApplyCoupon(code);
          }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}
