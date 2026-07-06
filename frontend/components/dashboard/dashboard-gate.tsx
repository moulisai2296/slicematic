"use client";

import { BarChart3, Loader2, LogOut } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { login } from "@/lib/api";
import { useAuthStore, useRoleUser } from "@/lib/auth-store";

/**
 * Dashboard gate: same admin role/credentials as components/admin/admin-gate.tsx,
 * deliberately duplicated rather than imported — this is its own standalone
 * surface (/dashboard), not a tab inside /admin, per this repo's surface
 * isolation convention (one surface's code can't be broken by another's
 * changes). Full-width webpage idiom. UX gate only; the API verifies the JWT
 * + role server-side on every /api/dashboard/* call.
 */
export function DashboardGate({ children }: { children: React.ReactNode }) {
  const { hydrated, user } = useRoleUser("admin");
  const signOut = useAuthStore((s) => s.signOut);

  if (!hydrated) return null;

  if (!user) return <DashboardLogin />;

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-surface px-4">
        <span className="flex items-center gap-2 text-sm font-medium">
          <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground">
            <BarChart3 className="size-4" />
          </span>
          SliceMatic AI Operations
          <span className="text-muted-foreground">· {user.name}</span>
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

function DashboardLogin() {
  const setAuth = useAuthStore((s) => s.setAuth);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEmpCode = email.trim().toLowerCase().startsWith("emp") || email.trim().toLowerCase().startsWith("smemp");
  const canSubmit = !busy && (isEmpCode ? email.trim().length >= 3 && password.length >= 6 : email.includes("@") && password.length >= 8);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await login("admin", email.trim().toLowerCase(), password);
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
      <div className="w-full max-w-sm space-y-6 rounded-2xl border border-border bg-card p-8 shadow-lg">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-surface-2 text-primary">
            <BarChart3 className="size-7" />
          </span>
          <div>
            <h1 className="font-heading text-2xl font-bold">Observability</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Sign in with your employee ID / email and PIN / password.
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label
              htmlFor="dash-email"
              className="mb-1.5 block text-xs font-medium text-muted-foreground"
            >
              Employee ID / Email
            </label>
            <Input
              id="dash-email"
              type="text"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="emp001 or admin@slicematic.in"
            />
          </div>
          <div>
            <label
              htmlFor="dash-password"
              className="mb-1.5 block text-xs font-medium text-muted-foreground"
            >
              PIN / Password
            </label>
            <Input
              id="dash-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••"
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
