"use client";

import { ChefHat, Loader2, LogOut } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { login } from "@/lib/api";
import { useAuthStore, useRoleUser } from "@/lib/auth-store";

/**
 * Kitchen kiosk gate: emp_id + 6-digit PIN (issued by the admin), role
 * `kitchen_staff`. Own copy — surfaces stay isolated (the staff surface has
 * its own). UX gate only; the API verifies the JWT server-side.
 */
export function KitchenKioskGate({ children }: { children: React.ReactNode }) {
  const { hydrated, user } = useRoleUser("kitchen_staff");
  const signOut = useAuthStore((s) => s.signOut);

  if (!hydrated) return null;

  if (!user) return <KioskLogin />;

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-surface px-4">
        <span className="text-sm font-medium">
          Kitchen ·{" "}
          <span className="text-muted-foreground">
            {user.name} ({user.emp_id})
          </span>
        </span>
        <Button size="sm" variant="ghost" onClick={signOut}>
          <LogOut />
          Sign out
        </Button>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

function KioskLogin() {
  const setAuth = useAuthStore((s) => s.setAuth);
  const [empId, setEmpId] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = !busy && empId.trim().length > 0 && /^\d{6}$/.test(pin);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await login("kitchen_staff", empId.trim(), pin);
      if (res.ok && res.token && res.user) {
        setAuth(res.token, res.user);
      } else {
        const first = res.errors ? Object.values(res.errors)[0] : null;
        setError(first ?? "Couldn't sign you in. Try again.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't sign you in.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="grid size-16 place-items-center rounded-2xl bg-surface-2 text-primary">
            <ChefHat className="size-8" />
          </span>
          <div>
            <h1 className="font-heading text-2xl font-bold">Kitchen Kiosk</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Sign in with the employee ID and PIN shared by your admin.
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label
              htmlFor="kitchen-emp"
              className="mb-1.5 block text-xs font-medium text-muted-foreground"
            >
              Employee ID
            </label>
            <Input
              id="kitchen-emp"
              value={empId}
              onChange={(e) => setEmpId(e.target.value)}
              placeholder="SMEMP001"
              autoComplete="username"
            />
          </div>
          <div>
            <label
              htmlFor="kitchen-pin"
              className="mb-1.5 block text-xs font-medium text-muted-foreground"
            >
              6-digit PIN
            </label>
            <Input
              id="kitchen-pin"
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              placeholder="••••••"
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </div>
          )}

          <Button type="submit" size="lg" className="w-full" disabled={!canSubmit}>
            {busy && <Loader2 className="animate-spin" />}
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}
