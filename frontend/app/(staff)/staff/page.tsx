"use client";

import { UtensilsCrossed } from "lucide-react";
import { useEffect, useState } from "react";

import { CustomerDetails } from "@/components/staff/customer-details";
import { OrderTicket } from "@/components/staff/order-ticket";
import { PosConfirmation } from "@/components/staff/pos-confirmation";
import {
  PosCustomize,
  type PosCustomizationResult,
} from "@/components/staff/pos-customize";
import { PosMenu } from "@/components/staff/pos-menu";
import { PosPayment } from "@/components/staff/pos-payment";
import type { MenuItem } from "@/lib/api";
import { useStaffPos } from "@/lib/staff-store";

/**
 * Staff kiosk POS — desktop-wide, touch-first.
 * Three-pane layout:
 *   Left   = category nav + menu grid (persistent while building)
 *   Middle = customization panel (appears when item is tapped)
 *   Right  = order ticket sidebar
 */
export default function StaffPosPage() {
  const { step, menu, menuStatus, menuError, loadMenu, addLine } =
    useStaffPos();
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);

  useEffect(() => {
    void loadMenu();
  }, [loadMenu]);

  // Clear selection when leaving the build step
  useEffect(() => {
    if (step !== "build") setSelectedItem(null);
  }, [step]);

  const handleAdd = (result: PosCustomizationResult) => {
    addLine(result);
    setSelectedItem(null); // back to grid for next item
  };

  // Non-build steps take the full pane
  if (step === "details") {
    return (
      <div className="flex h-full min-h-0">
        <main className="min-w-0 flex-1"><CustomerDetails /></main>
        <div className="w-[340px] shrink-0"><OrderTicket /></div>
      </div>
    );
  }
  if (step === "payment") {
    return (
      <div className="flex h-full min-h-0">
        <main className="min-w-0 flex-1"><PosPayment /></main>
        <div className="w-[340px] shrink-0"><OrderTicket /></div>
      </div>
    );
  }
  if (step === "done") {
    return <div className="flex h-full min-h-0"><main className="min-w-0 flex-1"><PosConfirmation /></main></div>;
  }

  // step === "build" — three-column layout
  if (menuStatus === "loading" || menuStatus === "idle") {
    return (
      <div className="flex h-full min-h-0">
        <main className="min-w-0 flex-1">
          <div className="grid h-full grid-cols-3 gap-4 p-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-56 animate-pulse rounded-xl border border-border bg-surface-2" />
            ))}
          </div>
        </main>
        <div className="w-[340px] shrink-0"><OrderTicket /></div>
      </div>
    );
  }

  if (menuStatus === "error" || !menu) {
    return (
      <div className="flex h-full min-h-0">
        <main className="min-w-0 flex-1 flex flex-col items-center justify-center gap-3 px-8 text-center">
          <UtensilsCrossed className="size-9 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{menuError ?? "Couldn't load the menu."}</p>
          <button
            onClick={() => void loadMenu()}
            className="cursor-pointer text-sm font-medium text-primary hover:underline"
          >
            Try again
          </button>
        </main>
        <div className="w-[340px] shrink-0"><OrderTicket /></div>
      </div>
    );
  }

  return (
    <div className="relative grid h-full min-h-0 grid-cols-[minmax(0,1fr)_minmax(340px,24%)] overflow-hidden">
      {/* Left: Menu grid — always visible while building */}
      <div className="min-h-0 min-w-0 overflow-hidden border-r border-border">
        <PosMenu
          menu={menu}
          onSelect={setSelectedItem}
          selectedId={selectedItem?.id ?? null}
          onCategoryChange={() => setSelectedItem(null)}
        />
      </div>

      {/* Middle: Customization panel — slides in when item selected */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <button
            type="button"
            aria-label="Close customization"
            className="absolute inset-0 cursor-default"
            onClick={() => setSelectedItem(null)}
          />
          <div className="relative h-[min(900px,92vh)] w-full max-w-3xl overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
            <PosCustomize
              item={selectedItem}
              menu={menu}
              onAdd={handleAdd}
              onBack={() => setSelectedItem(null)}
            />
          </div>
        </div>
      )}

      {/* Right: Order ticket */}
      <div className="min-h-0 min-w-0 overflow-hidden">
        <OrderTicket />
      </div>
    </div>
  );
}
