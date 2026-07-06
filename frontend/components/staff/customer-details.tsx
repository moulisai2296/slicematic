"use client";

import { ArrowRight, ShoppingBag, UserRound, UtensilsCrossed } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type OrderType, useStaffPos } from "@/lib/staff-store";
import { cn } from "@/lib/utils";

const ORDER_TYPES = [
  { id: "dine_in", label: "Dine In", icon: UtensilsCrossed },
  { id: "takeaway", label: "Takeaway", icon: ShoppingBag },
] as const satisfies readonly { id: OrderType; label: string; icon: typeof UtensilsCrossed }[];

/**
 * POS step 1 - walk-in customer details. Validates name (letters/spaces, 2-40) and phone
 * (10 digits starting 6–9) on Next, list every error, advance only when both
 * pass. The API re-validates via core/validation.py at checkout.
 *
 * Order type (Dine In / Takeaway) is required here too — Dine In is the
 * default so it's always specified, staff just confirm or switch it before
 * proceeding. Frontend-only: kept in staff-store, never sent to the API.
 */
export function CustomerDetails() {
  const { customerName, customerPhone, setCustomer, orderType, setOrderType, setStep } =
    useStaffPos();
  const [name, setName] = useState(customerName);
  const [phone, setPhone] = useState(customerPhone);
  const [errors, setErrors] = useState<string[]>([]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim();
    const cleanPhone = phone.trim();
    // Mirror core/validation.py so staff orders use the same customer rules.
    const errs: string[] = [];
    if (!/^[A-Za-z ]{2,40}$/.test(cleanName)) {
      errs.push("Name must be 2–40 characters, letters and spaces only.");
    }
    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      errs.push("Phone must be exactly 10 digits and start with 6, 7, 8 or 9.");
    }
    if (errs.length > 0) {
      setErrors(errs);
      return;
    }
    setErrors([]);
    setCustomer(cleanName, cleanPhone);
    setStep("build");
  };

  return (
    <div className="flex h-full items-center justify-center px-8">
      <div className="w-full max-w-lg space-y-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="grid size-16 place-items-center rounded-2xl bg-surface-2 text-primary">
            <UserRound className="size-8" />
          </span>
          <div>
            <h2 className="font-heading text-2xl font-bold">
              Customer details
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Take the walk-in customer&apos;s name and phone to start the
              order.
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-5">
          <div>
            <span className="mb-1.5 block text-sm font-medium text-muted-foreground">
              Order type <span className="text-destructive">*</span>
            </span>
            <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Order type">
              {ORDER_TYPES.map(({ id, label, icon: Icon }) => {
                const active = orderType === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setOrderType(id)}
                    className={cn(
                      "flex h-14 cursor-pointer items-center justify-center gap-2 rounded-lg border text-base font-medium transition-colors",
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-surface-2 text-foreground hover:border-primary/50"
                    )}
                  >
                    <Icon className="size-5" />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label
              htmlFor="pos-name"
              className="mb-1.5 block text-sm font-medium text-muted-foreground"
            >
              Customer name
            </label>
            <Input
              id="pos-name"
              className="h-14 text-base"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Asha Rao"
              autoComplete="off"
            />
          </div>
          <div>
            <label
              htmlFor="pos-phone"
              className="mb-1.5 block text-sm font-medium text-muted-foreground"
            >
              Phone number
            </label>
            <Input
              id="pos-phone"
              type="tel"
              inputMode="numeric"
              maxLength={10}
              className="h-14 text-base"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
              placeholder="10-digit mobile number"
              autoComplete="off"
            />
          </div>

          {errors.length > 0 && (
            <ul
              role="alert"
              className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {errors.map((err) => (
                <li key={err}>• {err}</li>
              ))}
            </ul>
          )}

          <Button type="submit" size="lg" className="h-14 w-full text-base">
            Start order
            <ArrowRight />
          </Button>
        </form>
      </div>
    </div>
  );
}
